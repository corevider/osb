/*
===========================================================================
lean-refusals.js - meaningful refusals without routine cooldown warning spam

Cast refusals carry no request ID. Nearby commands are evidence, never an
assertion that a particular skill caused the refusal. Retention is independent
of optional command capture, so standard exports retain these diagnostics.
===========================================================================
*/
const REFUSAL_LIMIT = { recent: 32, ageMs: 3000, groupMs: 30000, stallMs: 15000, warnMs: 60000 };
const REFUSAL_MEANINGS = {
	"cooldown-or-action-recovery": "The skill is still cooling down or the previous skill action is still recovering. The packet does not distinguish which.",
	"unmapped-error": "The game rejected this request type, but this code has not been decoded here.",
	"unclassified-error": "The client reported an error without a recognized request type and numeric code."
};
Activity.refusals = [];
Activity.refusalGroups = new Map();
Activity.recentCommands = [];
Activity.castProgressAt = now();
Activity.refusalWarningAt = -Infinity;

/*
================
Activity.safeFailure

Only enums, bounded command evidence and numbers enter standard exports.
================
*/
Activity.safeFailure = function( value ) {
	const source = [ "cast", "inventory", "unknown" ].includes( value.source ) ? value.source : "unknown";
	const reason = Object.hasOwn( REFUSAL_MEANINGS, value.reason ) ? value.reason : "unclassified-error";
	const numeric = number => Number.isFinite( number ) ? number : null;
	return { source, reason, explanation: REFUSAL_MEANINGS[reason],
		nativeErrorCode: Number.isInteger( value.nativeErrorCode ) ? value.nativeErrorCode : null,
		correlation: "recent-commands-only-not-a-request-match",
		recentCommands: (value.recentCommands || []).slice( -3 ).map( command => ( {
			kind: [ "skill", "attack", "cos-attack", "item-use", "shop-buy", "shop-sell", "storage-move", "inventory-move", "travel-gate" ].includes( command.kind ) ? command.kind : "other",
			ageMs: numeric( command.ageMs ), skillId: numeric( command.skillId ), monsterId: numeric( command.monsterId ),
			localCooldownMs: numeric( command.localCooldownMs )
		} ) ),
		state: { inventoryPending: !!value.state?.inventoryPending, movementPending: !!value.state?.movementPending,
			targetPending: !!value.state?.targetPending, casting: !!value.state?.casting } };
};

/*
================
Activity.refusal

OpenSRO skilladmit.go and skillcost.go return 0x3005 for cooldown/action
recovery. Client combat.ts exposes its low byte as "Cast rejected: 5".
This meaning applies only to that cast channel, never inventory code 5.
================
*/
Activity.refusal = function( message ) {
	const match = String( message ).match( /^(Cast|Inventory) rejected:\s*(\d+)\s*$/i );
	const source = match ? match[1].toLowerCase() : "unknown";
	const code = match ? Number( match[2] ) : null;
	const routine = source === "cast" && code === 5;
	const reason = routine ? "cooldown-or-action-recovery" : match ? "unmapped-error" : "unclassified-error";
	const recentCommands = this.recentCommands.filter( command => command.epoch === World.epoch && command.session === this.session &&
		now() - command.at <= REFUSAL_LIMIT.ageMs && (source !== "cast" || [ "skill", "attack", "cos-attack" ].includes( command.kind )) ).slice( -3 ).map( command => ( {
		...command, ageMs: now() - command.at, localCooldownMs: command.skillId ? World.cooldownLeft( command.skillId ) : null
	} ) );
	const failure = this.safeFailure( { source, reason, nativeErrorCode: source === "cast" && code !== null ? 0x3000 + code : code,
		recentCommands, state: { inventoryPending: World.gp?.inventoryPending, movementPending: World.gp?.pendingMoves,
			targetPending: World.gp?.targetPending, casting: World.isCasting() } } );
	const commandKey = JSON.stringify( recentCommands.map( command => [ command.kind, command.skillId, command.monsterId ] ) );
	const key = JSON.stringify( [ this.session, World.epoch, source, code, routine ? null : commandKey ] );
	const previous = this.refusalGroups.get( key );
	if ( previous && now() - previous.lastMono < REFUSAL_LIMIT.groupMs && (this.refusals.includes( previous ) || Log.lines.includes( previous )) ) {
		previous.repeatCount++; previous.lastAt = Date.now(); previous.lastMono = now(); previous.failure = failure; this.revision++;
		if ( commandKey !== previous.sampleKey ) {
			previous.failureSamples.push( failure );
			if ( previous.failureSamples.length > 8 ) previous.failureSamples.shift();
			previous.sampleKey = commandKey;
		}
	} else {
		const entry = this.emit( { category: source === "cast" ? "combat" : "engine", code: routine ? "cast-not-ready" : "game-refusal",
			level: routine ? "info" : "warn", outcome: "refused", diagnosticOnly: routine, failure,
			text: "Game reported: " + message,
			userText: routine ? "Skill not ready yet." : source === "inventory" ? "The game refused an inventory action (code " + code + ")." : source === "cast" ? "The game refused a skill action (code " + code + ")." : "The game reported an error; details are available in the export.",
			details: { errorCode: code } } );
		if ( entry ) { entry.failureSamples = [ failure ]; entry.sampleKey = commandKey; this.refusalGroups.set( key, entry ); }
	}
	if ( this.refusalGroups.size > 400 ) this.refusalGroups.delete( this.refusalGroups.keys().next().value );
	if ( routine && previous && Hunt.running && now() - previous.mono >= REFUSAL_LIMIT.stallMs &&
		now() - this.castProgressAt >= REFUSAL_LIMIT.stallMs && now() - this.refusalWarningAt >= REFUSAL_LIMIT.warnMs ) {
		this.refusalWarningAt = now();
		this.emit( { category: "combat", code: "cast-readiness-stalled", level: "warn", outcome: "waiting",
			text: "Repeated cast readiness refusals without a recent observed cast.",
			userText: "Skills have not been ready for a while.", failure } );
	}
};

/*
================
Read-only evidence bindings
================
*/
bus.on( "command", command => {
	Activity.recentCommands.push( { at: now(), epoch: World.epoch, session: Activity.session, kind: command.kind,
		skillId: command.kind === "skill" && Number.isInteger( command.skillId ) ? command.skillId : null,
		monsterId: World.ents.get( command.gid )?.kind === "monster" ? command.gid : null } );
	if ( Activity.recentCommands.length > REFUSAL_LIMIT.recent ) Activity.recentCommands.shift();
} );
bus.on( "cast", cast => { if ( cast.caster === World.localGid() ) Activity.castProgressAt = now(); } );
bus.on( "reset", () => { Activity.recentCommands.length = 0; Activity.refusalGroups.clear(); Activity.castProgressAt = now(); } );
bus.on( "character", () => { Activity.recentCommands.length = 0; Activity.refusalGroups.clear(); Activity.castProgressAt = now(); } );
