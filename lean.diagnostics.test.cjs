/*
===========================================================================

lean.diagnostics.test.cjs - error reports under the one sharing switch

Runs the generated bot in the telemetry harness: a vm context with a virtual
clock and a fake network. No test reaches the real api.osb.lol. Case IDs DG1
to DG24 are those of DIAGNOSTICS.md 3.7 that apply to OSB, adapted to the one
switch of the operator decisions of 2026-11-12. Every name is made up.
===========================================================================
*/
module.exports = function diagnosticsTests( { test: baseTest, harness, lifecycle, FakeElement, assertSubsetShape, noPlatformRequests, constants } ) {
	const test = ( name, fn ) => baseTest( name, async () => {
		try { await fn(); } catch ( error ) { console.error( [ "FAIL DETAIL " + name, ...String( error.stack ).split( /\r?\n/ ).slice( 0, 6 ) ].join( "\n" ) ); throw error; }
	} );
	const assert = require( "node:assert/strict" );
	const fs = require( "node:fs" );
	const nodeCrypto = require( "node:crypto" );
	const { MINUTE, HOUR, BASE } = constants;
	const KEY = "sroBotLean:v1:telemetry";
	const IDENTITY = { id: "3f0b2c1e-7d4a-4c55-9a51-2b8f7e4c9d10", key: "kq3Vt3N1rA8b0bq3QyU2sQj3XcYw8m3cXzq8b6F0wJs" };
	const DIAG = { enabled: true, perf: false, interval_s: 600, perf_interval_s: 1800, sample_pct: 100 };
	const SCRIPT_ID = "0b7c3f0e-1d2a-4c55-9a51-77aa00ccee11";
	const TAMPERMONKEY = "chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/userscript.html?name=OSB.user.js&id=" + SCRIPT_ID;
	const GAME = "https://game.invalid/assets/index-4f2a.js";
	const TRUSTED = { isTrusted: true };
	const plain = value => JSON.parse( JSON.stringify( value ) );

	/*
	================
	diagHarness

	The telemetry harness with a server whose config turns diagnostics on.
	================
	*/
	function diagHarness( options = {}, diagnostics = DIAG ) {
		const h = harness( options );
		if ( diagnostics ) h.server.config.diagnostics = { ...diagnostics };
		const base = h.server.default;
		h.ruleBreaks = [];
		h.server.default = entry => {
			if ( entry.url.slice( BASE.length ) !== "/diagnostics" ) return base( entry );
			const broken = serverRules( JSON.parse( entry.body ), h.now );
			h.ruleBreaks.push( ...broken );
			return broken.length ? h.reply( 400, { code: "invalid" } ) : h.reply( 202, { accepted_events: ( JSON.parse( entry.body ).events || [] ).length, accepted_perf: 0, next_after_s: 600 } );
		};
		h.Diag.start();
		return h;
	}
	async function shareOn( h ) {
		h.consent();
		await h.advance( 3 * MINUTE );
		assert.equal( h.Diag.recording(), true, "recording starts once the server config allows it" );
	}
	function ownError( Type, message, frames = [ "Object.observe:14210:31", "Object.guard:12018:20", "Object.tick:12110:12" ], url = TAMPERMONKEY ) {
		const error = new Type( message );
		error.stack = Type.name + ": " + message + "\n" + frames.map( f => { const [ fn, line, column ] = f.split( ":" ); return "    at " + fn + " (" + url + ":" + line + ":" + column + ")"; } ).join( "\n" ) +
			"\n    at " + GAME + ":1:20345";
		return error;
	}
	const fail = ( h, module, error ) => h.Controller.guard( module, () => { throw error; } );
	const diagBodies = h => h.bodies( "/diagnostics" );
	const events = h => diagBodies( h ).flatMap( b => b.events || [] );
	const everything = h => h.requests.map( r => String( r.body ?? "" ) + " " + JSON.stringify( r.headers ) + " " + r.url ).join( "\n" );

	/*
	================
	Consent version 2 and zero requests
	================
	*/
	test( "DG1 DG2 sharing off, undecided, declined, outdated version 1 or a damaged record: errors, warnings and stops record nothing and no request is made", async () => {
		const states = {
			"undecided": {},
			"declined": { [KEY]: JSON.stringify( { usage: 0, ...IDENTITY, registered: true } ) },
			"outdated version 1": { [KEY]: JSON.stringify( { usage: 1, usageText: "2026-11-04.1", ...IDENTITY, registered: true, synced: false } ) },
			"damaged record": { [KEY]: "{not json" },
		};
		for ( const [ name, stored ] of Object.entries( states ) ) {
			const h = diagHarness( { stored } );
			h.Telemetry.start();
			h.Quest.observe = () => { throw ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ); };
			h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
			h.Log.warn( "Town trip timed out." );
			for ( const fn of h.listeners.error || [] ) fn( { error: ownError( RangeError, "Invalid array length" ) } );
			await lifecycle( h );
			await h.advance( 2 * HOUR, { ticks: 1 } );
			assert.deepEqual( noPlatformRequests( h ).map( r => r.url ), [], name + ": no request at all" );
			assert.equal( h.Diag.recording(), false, name );
			assert.equal( h.Diag.inbox.length + h.Diag.pending.size, 0, name + ": nothing recorded" );
			assert.equal( h.digests.length, 0, name + ": nothing hashed" );
		}
	} );

	test( "consent version 2: registration and the consent call send usage_version 2, and diagnostics use the same install", async () => {
		const h = diagHarness();
		await shareOn( h );
		const record = JSON.parse( h.storage.get( KEY ) );
		assert.equal( record.usage, 2 ); assert.equal( record.usageText, "2026-11-12.1" );
		assert.deepEqual( JSON.parse( h.ofPath( "/installs", "POST" )[0].body ).consent, { usage_version: 2, characters: false } );
		h.Telemetry.setCharacters( true ); await h.advance( 1000 );
		assert.deepEqual( JSON.parse( h.ofPath( "/installs/me/consent", "PUT" )[0].body ), { usage_version: 2, characters: true } );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		await h.advance( 10 * MINUTE );
		const kinds = h.requests.map( r => r.method + " " + r.url.slice( BASE.length ).split( "?" )[0] );
		assert.deepEqual( kinds.filter( k => !/telemetry/.test( k ) ), [ "GET /config", "POST /installs", "PUT /installs/me/consent", "POST /diagnostics" ] );
		const post = h.ofPath( "/diagnostics" )[0];
		assert.equal( post.headers.Authorization, h.ofPath( "/telemetry" )[0].headers.Authorization, "one install identity" );
		assert.equal( post.headers["Content-Type"], "application/json" );
		assert.equal( post.init.credentials, "omit" ); assert.equal( post.init.redirect, "error" ); assert.equal( post.init.referrerPolicy, "no-referrer" );
	} );

	test( "a stored version 1 consent is outdated: off, nothing is sent, and the switch shows Changed until Settings has been opened once", async () => {
		const stored = { [KEY]: JSON.stringify( { usage: 1, usageText: "2026-11-04.1", usageAt: 1, ...IDENTITY, registered: true, synced: true, characters: true } ) };
		const h = diagHarness( { stored } );
		h.Telemetry.start();
		await h.advance( 3 * HOUR, { ticks: 1 } );
		assert.equal( noPlatformRequests( h ).length, 0 );
		assert.equal( h.Telemetry.consented(), false ); assert.equal( h.Telemetry.outdated(), true ); assert.equal( h.Telemetry.get().characters, false, "the names sub-switch is off too" );
		assert.equal( h.Telemetry.auth(), "", "an outdated consent never links a report" );
		const draw = target => { const host = new FakeElement( "div" ); target.Telemetry.draw( host ); return host; };
		const changedOf = host => host.find( n => n.tag === "p" && /The text of this switch changed: it now also covers error reports and performance data\. Switch it on again if you want to share\./.test( n.textContent ) )[0];
		const first = draw( h );
		assert.equal( changedOf( first ).hidden, false ); assert.match( changedOf( first ).textContent, /^Changed / );
		assert.equal( first.find( n => n.tag === "input" )[0].checked, false, "the switch is off" );
		assert.equal( changedOf( draw( h ) ).hidden, false, "it stays while this Settings visit lasts" );
		assert.equal( JSON.parse( h.storage.get( KEY ) ).changedSeen, true );
		const later = diagHarness( { stored: Object.fromEntries( h.storage ) } );
		assert.equal( changedOf( draw( later ) ).hidden, true, "after the first opening the mark is gone" );
		const fresh = diagHarness();
		assert.equal( changedOf( draw( fresh ) ).hidden, true, "a new install has nothing to mark" );
	} );

	test( "switching on from version 1 keeps the install: one PUT consent with usage_version 2 and characters off, no second registration", async () => {
		const stored = { [KEY]: JSON.stringify( { usage: 1, usageText: "2026-11-04.1", ...IDENTITY, registered: true, synced: true, characters: true } ) };
		const h = diagHarness( { stored } );
		h.Telemetry.start();
		assert.equal( h.Telemetry.setUsage( true ), true );
		await h.advance( 3 * MINUTE );
		assert.equal( h.Telemetry.get().id, IDENTITY.id );
		assert.equal( h.ofPath( "/installs", "POST" ).length, 0 );
		assert.deepEqual( JSON.parse( h.ofPath( "/installs/me/consent", "PUT" )[0].body ), { usage_version: 2, characters: false } );
		assert.equal( h.ofPath( "/telemetry" ).length, 1 );
		const answer = h.server.default;
		const again = diagHarness( { stored } );
		again.server.respond = entry => entry.url.endsWith( "/installs/me/consent" ) ? again.reply( 404, { code: "not_found" } ) : answer( entry );
		again.Telemetry.start(); again.Telemetry.setUsage( true );
		await again.advance( 5 * MINUTE );
		assert.equal( again.ofPath( "/installs", "POST" ).length, 1, "an install the server no longer knows registers again with the same ID" );
		assert.equal( JSON.parse( again.ofPath( "/installs", "POST" )[0].body ).install_id, IDENTITY.id );
	} );

	test( "DG4 turning sharing on starts with empty buffers: nothing recorded before that moment is sent", async () => {
		const h = diagHarness();
		h.Telemetry.start();
		fail( h, "Before consent", ownError( TypeError, "x is not a function" ) );
		await shareOn( h );
		fail( h, "First run", ownError( TypeError, "y is not a function" ) );
		await h.advance( MINUTE );
		assert.equal( h.Diag.pending.size, 1 );
		h.Telemetry.setUsage( false ); await h.advance( 1000 );
		assert.equal( h.Diag.pending.size + h.Diag.inbox.length, 0 );
		await shareOn( h );
		fail( h, "Second run", ownError( TypeError, "z is not a function" ) );
		await h.advance( 11 * MINUTE );
		assert.deepEqual( events( h ).map( e => e.error.module ), [ "second-run" ] );
	} );

	test( "DG4 a trail never carries log entries written before sharing was turned on", async () => {
		const h = diagHarness();
		h.Telemetry.start();
		h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "info", text: "Before consent", details: { durationMs: 1111 } } );
		h.Log.info( "Hunting started before consent." );
		await h.advance( 1000 );
		await shareOn( h );
		h.Activity.emit( { category: "town", code: "operation-end", level: "info", outcome: "confirmed", text: "After consent", details: { durationMs: 2222 } } );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		await h.advance( 10 * MINUTE );
		const [ error ] = events( h ).filter( e => e.kind === "js_error" );
		assert.ok( error, "the error was sent" );
		assert.deepEqual( error.trail.map( t => t.k ), [ "operation-end" ], "only entries written while sharing was on" );
		assert.ok( !JSON.stringify( error.trail ).includes( "1111" ) );
	} );

	test( "DG16 switching off wipes the buffers, cancels the job, aborts the request in flight and makes exactly one DELETE", async () => {
		const h = diagHarness();
		await shareOn( h );
		const answer = h.server.default;
		h.server.respond = entry => entry.url.endsWith( "/diagnostics" ) ? "hang" : answer( entry );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of null (reading 'x')" ) );
		await h.advance( 9 * MINUTE + 5000 );
		const inFlight = h.ofPath( "/diagnostics" )[0];
		assert.ok( inFlight && !inFlight.aborted, "a diagnostics request is in flight" );
		fail( h, "Party", ownError( RangeError, "Invalid array length" ) );
		await h.advance( 1000 );
		h.Telemetry.setUsage( false );
		await h.advance( 1000 );
		assert.equal( inFlight.aborted, true );
		assert.equal( h.Diag.pending.size + h.Diag.inbox.length + h.Diag.trailed.size + h.Diag.terms.size, 0 );
		const after = h.requests.length;
		await h.advance( 3 * HOUR, { ticks: 1 } );
		assert.deepEqual( h.requests.slice( after - 1 ).map( r => r.method + " " + r.url.slice( BASE.length ) ), [ "DELETE /installs/me" ] );
		assert.equal( h.Telemetry.timer, 0 );
	} );

	test( "DG5 telemetry and diagnostics share one lane: never two requests in flight", async () => {
		const h = diagHarness();
		const answer = h.server.default;
		let slow = 0;
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) && slow++ % 2 === 0 ? "hang" : answer( entry );
		await shareOn( h );
		for ( let i = 0; i < 24; i++ ) { fail( h, "Module " + ( i % 4 ), ownError( TypeError, "boom " + i % 4 ) ); await h.advance( 5 * MINUTE, { ticks: 1 } ); }
		assert.ok( h.ofPath( "/diagnostics" ).length >= 2 );
		assert.ok( h.requests.some( r => r.aborted ), "some telemetry requests hung until the 15 s abort" );
		assert.equal( h.maxActive, 1 );
	} );

	/*
	================
	Deduplication, limits and size
	================
	*/
	test( "DG6 1000 identical errors in 10 minutes give one event with count 1000 and one trail", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Log.info( "Hunting started." );
		for ( let minute = 0; minute < 10; minute++ ) {
			for ( let i = 0; i < 100; i++ ) fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
			await h.advance( 50 * 1000 );
		}
		await h.advance( 5 * MINUTE );
		const sent = events( h );
		assert.equal( sent.length, 1 ); assert.equal( sent[0].count, 1000 ); assert.ok( Array.isArray( sent[0].trail ) );
	} );

	test( "DG7 100 distinct fingerprints in one hour: at most 30 events and dropped.rate_limited 70", async () => {
		const h = diagHarness();
		await shareOn( h );
		const start = h.now;
		for ( let i = 0; i < 100; i++ ) { fail( h, "Module " + i, ownError( TypeError, "boom" ) ); await h.advance( 10 * 1000 ); }
		await h.advance( start + HOUR - h.now );
		assert.equal( events( h ).length, 30, "at most 30 in the hour" );
		fail( h, "After the hour", ownError( TypeError, "boom" ) );
		await h.advance( 15 * MINUTE );
		assert.equal( events( h ).length, 31 );
		assert.equal( diagBodies( h ).reduce( ( n, b ) => n + ( b.dropped?.rate_limited || 0 ), 0 ), 70, "the counter rides with the next batch" );
	} );

	test( "the same fingerprint goes on the wire at most once per hour; repeats wait in its count", async () => {
		const h = diagHarness();
		await shareOn( h );
		const error = () => ownError( TypeError, "Cannot read properties of undefined (reading 'x')" );
		fail( h, "Quest", error() ); await h.advance( 10 * MINUTE );
		assert.equal( events( h ).length, 1 );
		fail( h, "Quest", error() ); fail( h, "Party", ownError( RangeError, "Invalid array length" ) ); await h.advance( 1000 );
		fail( h, "Quest", error() ); await h.advance( 10 * MINUTE );
		assert.deepEqual( events( h ).map( e => e.error.module ), [ "quest", "party" ], "the repeat is held back" );
		await h.advance( 50 * MINUTE );
		const repeat = events( h ).filter( e => e.error.module === "quest" );
		assert.equal( repeat.length, 2 ); assert.equal( repeat[1].count, 2 ); assert.equal( repeat[1].trail, undefined, "the trail goes with the first occurrence only" );
		const sent = h.ofPath( "/diagnostics" ).filter( r => JSON.parse( r.body ).events.some( e => e.error?.module === "quest" ) ).map( r => r.at );
		assert.ok( sent[1] - sent[0] >= HOUR );
	} );

	test( "DG9 a batch over 60 KB drops trails first (newest events first), then whole events (oldest first), and stays under 64 KB", async () => {
		const h = diagHarness();
		await shareOn( h );
		for ( let i = 0; i < 400; i++ ) h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "info", text: "x" + i, details: { durationMs: 123456 + i, distance: 1000 + i, revision: i, attempt: i } } );
		for ( let i = 0; i < 50; i++ ) { fail( h, "Module " + i, ownError( TypeError, "boom" ) ); await h.advance( 1000 ); }
		h.Diag.admitted.length = 0;
		const config = h.Telemetry.diagnosticsConfig();
		const built = await h.Diag.compose( config, { preview: true } );
		assert.ok( Buffer.byteLength( built.text ) <= 60 * 1024 );
		const trails = built.payload.events.map( e => !!e.trail );
		assert.ok( trails.includes( false ) && trails.includes( true ) );
		assert.ok( trails.indexOf( false ) > trails.lastIndexOf( true ), "the newest events lose their trails first" );
		const frames = Array.from( { length: 16 }, ( _, i ) => "Frame" + "x".repeat( 80 ) + i + "@1234567:12345" );
		h.Diag.pending.clear();
		for ( let i = 0; i < 50; i++ ) h.Diag.pending.set( i.toString( 16 ).padStart( 16, "0" ), { mono: i, count: 1, event: { kind: "js_error", source: "osb", fp: i.toString( 16 ).padStart( 16, "0" ), at: "2026-11-12T14:20:00Z", count: 1,
			error: { type: "TypeError", template: "y".repeat( 160 ), module: "m" + i, handled: true, origin: "guard", frames }, context: { phase: "world", mode: "hunting", dead: false, uptime_s: 60 } } } );
		const cut = h.Diag.assemble( config );
		assert.ok( Buffer.byteLength( cut.text ) <= 60 * 1024 );
		assert.ok( cut.payload.events.length < 50 );
		assert.equal( cut.payload.dropped.oversize, 50 - cut.payload.events.length );
		assert.equal( cut.payload.events[0].error.module, "m" + ( 50 - cut.payload.events.length ), "the oldest events went first" );
	} );

	/*
	================
	Scrubbing (DIAGNOSTICS.md 5.1 and the canaries of 5.4)
	================
	*/
	function naive( h ) {
		h.Diag.template = message => String( message );
		h.Diag.leaks = () => false;
		h.Diag.trail = mono => h.Log.lines.filter( e => e.mono <= mono ).slice( -20 ).map( e => ( { s: 0, l: e.level, c: e.category, k: "legacy", text: e.text } ) );
		const build = h.Diag.build.bind( h.Diag );
		h.Diag.build = raw => { const out = build( raw ); if ( out && raw.kind === "warn" ) out.body.warn.text = raw.text; return out; };
	}
	async function canaryRun( scrubbed ) {
		const h = diagHarness();
		if ( !scrubbed ) naive( h );
		h.World.charName = "CanaryHero"; h.Settings.profileKey = "profile:CanaryHero";
		await shareOn( h );
		h.World.ents.set( 77, { gid: 77, kind: "player", name: "CanaryRezzer" } );
		h.World.gp.social = { localName: "CanaryHero", members: [ { id: 1, name: "CanaryHero" }, { id: 2, name: "CanaryMate" } ] };
		h.bus.emit( "spawn", { kind: "player", name: "CanaryRezzer" } );
		h.bus.emit( "chat", { sender: "CanaryChatter", text: "selling CanaryItem" } );
		h.Log.info( "Resurrection offered: CanaryRezzer." );
		h.Log.info( "Accepted resurrection from CanaryRezzer (party member)." );
		h.Log.info( "Chat from CanaryChatter: selling CanaryItem" );
		h.Log.info( "Auto trade: CanaryTraderA to CanaryTraderB." );
		h.Log.warn( "Party member CanaryMate is too far away to support." );
		fail( h, "Party", ownError( TypeError, "CanaryHero is not a function" ) );
		fail( h, "Reconnect", ownError( Error, "failed for CanaryHero" ) );
		fail( h, "Updates", ownError( TypeError, "Failed to fetch https://example.invalid/path?user=CanaryHero&token=abc123" ) );
		fail( h, "Share", ownError( RangeError, "Invalid file C:\\Users\\CanaryUser\\osb.json" ) );
		await h.advance( 10 * MINUTE );
		return { h, body: h.ofPath( "/diagnostics" ).map( r => r.body ).join( "\n" ) };
	}
	const CANARIES = {
		"a resurrection offer naming a player": "CanaryRezzer",
		"a chat line": "CanaryChatter",
		"a party member's name in a warning": "CanaryMate",
		"an error message holding the character name": "CanaryHero",
		"a URL with a query": "?user=",
		"a trade line": "CanaryTraderA",
		"a path with a user name": "CanaryUser",
	};

	test( "DG10 a known name with letters outside A-Z never leaves as a fragment in a template", async () => {
		const h = diagHarness();
		h.World.charName = "ÇakırBeyQz"; h.Settings.profileKey = "profile:ÇakırBeyQz";
		await shareOn( h );
		h.World.gp.social = { localName: "ÇakırBeyQz", members: [ { id: 2, name: "ŞahinKurtQz" } ] };
		fail( h, "Party", ownError( TypeError, "ÇakırBeyQz is not a function" ) );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of ŞahinKurtQz" ) );
		await h.advance( 10 * MINUTE );
		const body = h.ofPath( "/diagnostics" ).map( r => r.body ).join( "\n" );
		const list = body.split( "\n" ).flatMap( b => JSON.parse( b ).events );
		const byModule = m => list.find( e => e.error?.module === m )?.error;
		assert.equal( byModule( "party" ).template, "<x> is not a function" );
		assert.equal( byModule( "quest" ).template, "Cannot read properties of <x>" );
		for ( const fragment of [ "akrBeyQz", "BeyQz", "ahinKurtQz", "KurtQz" ] ) assert.ok( !body.includes( fragment ), fragment );
	} );

	test( "DG10 an unknown name in an engine message becomes <x>, lowerCamel or not ASCII, and OSB's own identifiers stay", async () => {
		const h = diagHarness();
		await shareOn( h );
		fail( h, "Party", ownError( TypeError, "cnryLowerZq is not a function" ) );
		fail( h, "Quest", ownError( TypeError, "ÇnryUmlautZq is not a function" ) );
		fail( h, "Safety", ownError( TypeError, "Controller.guard is not a function" ) );
		fail( h, "Retry", ownError( TypeError, "cnryLowerZq.members is not iterable" ) );
		fail( h, "Level spot", ownError( TypeError, "Controller[guard] is not a function" ) );
		await h.advance( 10 * MINUTE );
		const body = h.ofPath( "/diagnostics" ).map( r => r.body ).join( "\n" );
		const list = body.split( "\n" ).flatMap( b => JSON.parse( b ).events );
		const byModule = m => list.find( e => e.error?.module === m )?.error;
		assert.equal( byModule( "party" ).template, "<x> is not a function" );
		assert.equal( byModule( "quest" ).template, "<x> is not a function" );
		assert.equal( byModule( "safety" ).template, "Controller.guard is not a function" );
		assert.equal( byModule( "retry" ).template, "<x>.members is not iterable" );
		assert.equal( byModule( "level-spot" ).template, "<x> is not a function", "two known words joined by a dropped character are checked again" );
		for ( const fragment of [ "cnryLowerZq", "nryUmlautZq", "UmlautZq", "LowerZq" ] ) assert.ok( !body.includes( fragment ), fragment );
	} );

	test( "the diagnostics vocabulary matches the code, holds OSB's own values only, and a stale copy fails with how to regenerate it", () => {
		const { spawnSync } = require( "node:child_process" );
		const os = require( "node:os" );
		const path = require( "node:path" );
		const python = process.env.PYTHON || ( process.platform === "win32" ? "python" : "python3" );
		const check = folder => spawnSync( python, [ path.join( folder, "diagnostics_vocabulary.py" ), "--check" ], { encoding: "utf8" } );
		const run = check( __dirname );
		assert.equal( run.status, 0, run.stdout + run.stderr );
		const text = fs.readFileSync( __dirname + "/diagnostics-vocabulary.json", "utf8" );
		const vocabulary = JSON.parse( text );
		const source = fs.readFileSync( __dirname + "/osb.user.js", "utf8" );
		assert.equal( vocabulary.version, source.match( /@version\s+([\d.]+)/ )[ 1 ] );
		assert.deepEqual( Object.keys( vocabulary ), [ "version", "modules", "stop_codes", "activity_categories", "activity_codes", "error_codes", "error_types", "phases", "modes",
			"town_phases", "outcomes", "refusal_sources", "refusal_reasons", "engine_words", "identifiers" ] );
		for ( const module of [ "quest", "party", "safety", "idle-pet-pickup", "controller", "panel", "simulation", "pet-attack", "follow-party-member" ] ) assert.ok( vocabulary.modules.includes( module ), module );
		for ( const code of [ "stuck-no-progress", "town-trip-failed", "player-stop", "other" ] ) assert.ok( vocabulary.stop_codes.includes( code ), code );
		for ( const code of [ "operation-end", "approach-abandoned", "game-refusal", "trip-phase", "toggle-town", "stall-closed", "legacy" ] ) assert.ok( vocabulary.activity_codes.includes( code ), code );
		assert.ok( !vocabulary.activity_codes.includes( "legacy-message" ) );
		for ( const word of [ "Quest", "observe", "Controller", "guard", "tick", "members" ] ) assert.ok( vocabulary.identifiers.includes( word ), word );
		for ( const word of [ "cnryLowerZq", "CnryHeroZq" ] ) assert.ok( !vocabulary.identifiers.includes( word ), word );
		const folder = fs.mkdtempSync( path.join( os.tmpdir(), "osb-vocabulary-" ) );
		try {
			fs.copyFileSync( __dirname + "/diagnostics_vocabulary.py", path.join( folder, "diagnostics_vocabulary.py" ) );
			fs.copyFileSync( __dirname + "/osb.user.js", path.join( folder, "osb.user.js" ) );
			fs.writeFileSync( path.join( folder, "diagnostics-vocabulary.json" ), text.replace( "\"stuck-no-progress\"", "\"cnry-forged-zq\"" ) );
			const stale = check( folder );
			assert.equal( stale.status, 1 );
			assert.match( stale.stdout, /differs from the code: run "python3 build-lean\.py"/ );
		} finally {
			fs.rmSync( folder, { recursive: true, force: true } );
		}
	} );

	test( "DG10 DG11 canaries: each leaks without the scrubber and none leaves with it", async () => {
		const plain = await canaryRun( false ), safe = await canaryRun( true );
		assert.ok( safe.body.length > 0 && plain.body.length > 0 );
		for ( const [ what, canary ] of Object.entries( CANARIES ) ) {
			assert.ok( plain.body.includes( canary ), what + ": the test catches a leak without the scrubber" );
			assert.ok( !safe.body.includes( canary ), what + ": nothing leaves with the scrubber" );
		}
		for ( const forbidden of [ "CanaryItem", "example.invalid", "token=", ":\\\\", "\\\\Users", SCRIPT_ID, "chrome-extension", IDENTITY.key, safe.h.Telemetry.get().key, safe.h.Telemetry.get().id ] ) {
			assert.ok( !safe.body.includes( forbidden ), forbidden );
		}
		const list = safe.body.split( "\n" ).flatMap( b => JSON.parse( b ).events );
		const byModule = m => list.find( e => e.error?.module === m )?.error;
		assert.equal( byModule( "party" ).template, "<x> is not a function", "an unquoted known name becomes <x>" );
		assert.equal( byModule( "reconnect" ).type, "Error" ); assert.equal( byModule( "reconnect" ).template, undefined, "our own error messages are never sent" );
		assert.equal( byModule( "updates" ).template, "Failed to fetch <url>" );
		assert.equal( byModule( "share" ).template, "Invalid file <path>" );
		const warn = list.find( e => e.kind === "warn" && e.warn.category === "party" );
		assert.deepEqual( warn.warn, { category: "party", code: "legacy", error_class: "unclassified-error" } );
		assert.ok( list.flatMap( e => e.trail || [] ).every( t => Object.keys( t ).every( k => [ "s", "l", "c", "k", "o", "n", "d", "e" ].includes( k ) ) ) );
	} );

	test( "DG10 a quoted name in an engine message becomes <q>, and the private terms never reach storage or a log", async () => {
		const { h, body } = await canaryRun( true );
		assert.equal( h.Diag.template( "Cannot create property 'x' on string 'CanaryPlayer'" ), "Cannot create property <q> on string <q>" );
		assert.equal( h.Diag.template( "Unexpected token 'P', \"PlayerName\" is not valid JSON" ), "Unexpected token <q>, <q> is not valid JSON" );
		assert.equal( h.Diag.template( "Invalid count 123456 at 0xBEEF for user@example.invalid" ), "Invalid count <n> at <n> for <x>" );
		assert.equal( h.Diag.template( "Cannot read /home/CanaryUser/x" ), "Cannot read <path>" );
		assert.ok( h.Diag.terms.has( "canaryrezzer" ) && h.Diag.terms.has( "canarymate" ) && h.Diag.terms.has( "canarychatter" ) );
		assert.ok( ![ ...h.storage.values() ].join( " " ).includes( "CanaryMate" ), "the private terms are never stored" );
		assert.ok( !h.Log.lines.some( l => /canarymate/.test( l.text ) ), "or logged" );
		assert.ok( !body.includes( "canarymate" ) );
	} );

	test( "DG11 frames: only our script's frames as fn@line:col, Tampermonkey and Violentmonkey forms, no URL or script ID, at most 16", () => {
		const h = diagHarness();
		const stack = [ "TypeError: x",
			"    at Object.observe (" + TAMPERMONKEY + ":14210:31)",
			"    at new Thing (moz-extension://8e1f0c2a-0000-4000-8000-000000000001/userscript.html?name=OSB.user.js&id=" + SCRIPT_ID + ":12:3)",
			"    at async Object.run [as go] (chrome-extension://jinjaccalgkegednnccohejagnlnfdag/OSB.user.js#1:20:4)",
			"    at https://game.invalid/a.js:1:2", "    at https://game.invalid/b.js:3:4",
			"    at Object.<anonymous> (chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/userscript.html?name=Other.user.js&id=1:1:1)",
			"    at Object.CanaryHero (" + TAMPERMONKEY + ":5:6)",
			"    at weird name! (" + TAMPERMONKEY + ":7:8)" ].join( "\n" );
		h.Diag.addTerm( "CanaryHero" );
		const { frames, firstOurs } = h.Diag.frames( stack );
		assert.equal( firstOurs, true );
		assert.deepEqual( plain( frames ), [ "Object.observe@14210:31", "Thing@12:3", "Object.run@20:4", "ext", "<x>", "?@7:8" ] );
		const many = Array.from( { length: 40 }, ( _, i ) => "    at f" + i + " (" + TAMPERMONKEY + ":" + i + ":1)" ).join( "\n" );
		assert.equal( h.Diag.frames( many ).frames.length, 16 );
		assert.deepEqual( plain( h.Diag.frames( "f@" + TAMPERMONKEY + ":3:4\n@" + GAME + ":1:1" ).frames ), [ "f@3:4", "ext" ], "the Firefox form is read too" );
	} );

	test( "DG13 uncaught errors and rejections count only when our script threw them", async () => {
		const h = diagHarness();
		await shareOn( h );
		const foreign = new TypeError( "game broke" ); foreign.stack = "TypeError: game broke\n    at render (" + GAME + ":10:20)\n    at x (" + TAMPERMONKEY + ":1:1)";
		const other = new TypeError( "other script" ); other.stack = "TypeError: other script\n    at f (chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/userscript.html?name=Helper.user.js&id=2:1:1)";
		for ( const fn of h.listeners.error ) { fn( { error: foreign } ); fn( { message: "Script error." } ); }
		for ( const fn of h.listeners.unhandledrejection ) { fn( { reason: other } ); fn( { reason: ownError( TypeError, "ours" ) } ); }
		await h.advance( 10 * MINUTE );
		const sent = events( h );
		assert.equal( sent.length, 1 );
		assert.deepEqual( { origin: sent[0].error.origin, handled: sent[0].error.handled }, { origin: "rejection", handled: false } );
	} );

	/*
	================
	Capture points
	================
	*/
	test( "capture: Log.error and Log.warn become structured codes, refusals keep source, reason and native code, and a guard error is not counted twice", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "warn", text: "Target 12: blocked", details: { revision: 4, durationMs: 8000, monsterId: 99 } } );
		h.Log.warn( "Town trip timed out near CanaryTown." );
		h.Activity.refusal( "Cast rejected: 9" );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		await h.advance( 10 * MINUTE );
		const sent = events( h );
		assert.deepEqual( sent.filter( e => e.kind === "warn" ).map( e => e.warn ), [
			{ category: "movement", code: "approach-abandoned" },
			{ category: "town", code: "legacy", error_class: "timeout" },
			{ category: "combat", code: "game-refusal", refusal: { source: "cast", reason: "unmapped-error", native: 0x3009 } },
		] );
		assert.equal( sent.filter( e => e.kind === "js_error" ).length, 1 );
		assert.ok( !sent.some( e => e.kind === "warn" && /error/.test( JSON.stringify( e.warn ) ) && e.warn.category === "engine" ), "the guard's own Log.error is not a second event" );
		assert.ok( !JSON.stringify( sent ).includes( "CanaryTown" ) );
	} );

	test( "capture: every catch site reports the error object (guard, tick, data, panel, pet attack, wardrobe)", () => {
		const read = file => fs.readFileSync( __dirname + "/" + file, "utf8" );
		const controller = read( "lean-controller.js" ), wardrobe = read( "build-wardrobe.py" ), build = read( "build-lean.py" );
		assert.match( controller, /guard\(name, fn\) \{\n\s+try \{ return fn\(\); \} catch \(e\) \{\n\s+Diag\.error\(name, e, 'guard'\);/ );
		assert.match( controller, /catch \(e\) \{\n\s+Diag\.error\('controller', e, 'tick'\);/ );
		assert.match( read( "lean-ui.js" ), /Diag\.error\('panel', e, 'panel'\)/ );
		assert.match( read( "lean-pet.js" ), /Diag\.error\('pet-attack', e, 'guard'\)/ );
		assert.match( wardrobe, /Diag\.error\('wardrobe', e, 'guard'\)/ );
		assert.match( build, /Diag\.error\('simulation', err, 'data'\)/ );
		assert.match( read( "lean-diagnostics.js" ), /Diag\.stop\(source, text\)/ );
	} );

	test( "capture: a tick error and a data error carry the game phase, the bot mode, the town phase and the dead flag as enums", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Controller.mode = "town service"; h.Town.trip = { phase: "walk-vendor" };
		h.Diag.error( "simulation", ownError( TypeError, "bad batch" ), "data" );
		h.Town.trip = null; h.World.phase = "weird-phase"; h.Controller.mode = "obstacle pursuit"; h.Hunt.running = true;
		h.Diag.error( "controller", ownError( RangeError, "deep" ), "tick" );
		h.World.phase = "world"; h.Hunt.running = false;
		await h.advance( 10 * MINUTE );
		const [ data, tick ] = events( h );
		assert.deepEqual( { ...data.context, uptime_s: 0 }, { phase: "world", mode: "town", town_phase: "walk-vendor", dead: false, uptime_s: 0 } );
		assert.equal( data.error.origin, "data" ); assert.equal( data.error.module, "simulation" );
		assert.deepEqual( { phase: tick.context.phase, mode: tick.context.mode }, { phase: "other", mode: "hunting" } );
		assert.ok( Number.isInteger( tick.context.uptime_s / 60 ) );
	} );

	test( "the bot's own stops are sent as StopCodes; the player's own stop and mode switches are not", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		h.Hunt.running = false; h.Town.fail( "Storage is full near CanaryTown." );
		h.stopAll( "internal error" );
		h.Hunt.running = true; h.userStop();
		h.Hunt.running = true; h.Hunt.stop( "walking back to the hunting spot" );
		await h.advance( 10 * MINUTE );
		assert.deepEqual( events( h ).filter( e => e.kind === "bot_stop" ).map( e => e.stop ), [
			{ code: "stuck-no-progress", source: "stop" }, { code: "town-trip-failed", source: "town" }, { code: "internal-error", source: "stop_all" },
		] );
		assert.ok( !diagBodies( h ).join( "" ).includes( "CanaryTown" ) );
	} );

	test( "StopCodes source scan: every literal stop reason in the source maps to a code, never to other", () => {
		const h = diagHarness();
		const scan = [
			[ "lean-*.js", /\bHunt\.stop\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-controller.js", /\bthis\.stop\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-*.js", /\bstopAll\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-*.js", /\buserStop\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-*.js", /\bRetry\.note\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-walkback.js", /\bthis\.cancel\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-unique.js", /\bthis\.stop\(\s*(['"`])([^'"`$]+)/g, "unique hunt: " ],
			[ "lean-travel.js", /\bthis\.fail\(\s*(['"`])([^'"`$]+)/g, "Travel stopped: " ],
			[ "lean-trap.js", /\bHunt\.stop\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "lean-lure.js", /\bHunt\.stop\(\s*(['"`])([^'"`$]+)/g, "" ],
			[ "restock.js", /\bHunt\.stop\(\s*(['"`])([^'"`$]+)/g, "" ],
		];
		const files = pattern => pattern.includes( "*" ) ? fs.readdirSync( __dirname ).filter( f => /^lean-.*\.js$/.test( f ) && f !== "lean-wardrobe-core.js" ) : [ pattern ];
		const unmapped = [], seen = new Set();
		for ( const [ pattern, regex, prefix ] of scan ) for ( const file of files( pattern ) ) {
			const text = fs.readFileSync( __dirname + "/" + file, "utf8" );
			for ( const match of text.matchAll( regex ) ) {
				const reason = prefix + match[2];
				seen.add( reason );
				if ( h.StopCodes.code( "stop", reason ) === "other" ) unmapped.push( file + ": " + reason );
			}
		}
		assert.ok( seen.size >= 25, "the scan found the stop reasons (" + seen.size + ")" );
		assert.deepEqual( unmapped, [] );
		for ( const reason of [ "safety: 3 deaths this session", "safety: a player attacked the character", "safety: the party has 1 member, fewer than 2", "world change", "game connection failed" ] ) {
			assert.notEqual( h.StopCodes.code( "stop", reason ), "other", reason );
		}
		assert.equal( h.StopCodes.code( "town", "anything at all" ), "town-trip-failed" );
		assert.equal( h.StopCodes.code( "stop", "something new" ), "other" );
	} );

	test( "the tick does no network, JSON or hashing for diagnostics: capture only queues fixed data", async () => {
		const h = diagHarness();
		await shareOn( h );
		const capture = new Set( [ "error", "warn", "stop", "queue", "same", "later", "recording", "silently", "context" ] ), hits = [];
		for ( const key of Object.keys( h.Diag ) ) if ( typeof h.Diag[key] === "function" && !capture.has( key ) ) {
			const original = h.Diag[key];
			h.Diag[key] = function ( ...args ) { hits.push( { key, inTick: h.ticking } ); return original.apply( this, args ); };
		}
		let n = 0;
		h.Quest.observe = () => { if ( n++ % 3 === 0 ) throw ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ); };
		h.Log.warn( "Town trip timed out." );
		const before = h.digests.length;
		await h.advance( 15 * MINUTE, { ticks: 500 } );
		assert.ok( n > 1000, "ticks ran" );
		assert.deepEqual( hits.filter( x => x.inTick ).map( x => x.key ), [], "no processing, JSON or hashing inside a tick" );
		assert.ok( h.digests.slice( before ).every( d => !d.inTick ) && h.digests.length > before );
		assert.ok( h.requests.every( r => !r.inTick ) );
		assert.ok( events( h ).find( e => e.error?.module === "quest" ).count > 300 );
	} );

	/*
	================
	The batch job
	================
	*/
	test( "DG14 diagnostics failures back off on their own and never change the telemetry schedule", async () => {
		const run = async status => {
			const h = diagHarness();
			const answer = h.server.default;
			h.server.respond = entry => entry.url.endsWith( "/diagnostics" ) ? ( status === 429 ? h.reply( 429, { code: "rate_limited" }, { "Retry-After": "1200" } ) : h.reply( status, { code: status === 503 ? "unavailable" : "error" } ) ) : answer( entry );
			await shareOn( h );
			for ( let i = 0; i < 12; i++ ) { fail( h, "Module " + i, ownError( TypeError, "boom" ) ); await h.advance( 10 * MINUTE ); }
			return h;
		};
		for ( const status of [ 500, 503, 429 ] ) {
			const h = await run( status );
			const diag = h.ofPath( "/diagnostics" ).map( r => r.at ), telemetry = h.ofPath( "/telemetry" ).map( r => r.at );
			assert.ok( diag.length >= 2, status + " diagnostics tried again" );
			const gaps = diag.slice( 1 ).map( ( t, i ) => t - diag[i] );
			assert.ok( gaps.every( g => g >= 60000 ), status + " never twice within 60 s" );
			if ( status === 429 ) assert.ok( gaps.every( g => g >= 1200000 ), "Retry-After is honoured" );
			const telemetryGaps = telemetry.slice( 1 ).map( ( t, i ) => t - telemetry[i] );
			assert.ok( telemetryGaps.every( g => g >= 540000 && g <= 660000 ), status + " telemetry keeps its interval: " + telemetryGaps );
			assert.equal( h.Telemetry.failures, 0, "the telemetry failure counter is untouched" );
		}
	} );

	test( "DG15 the server flag: 503 disabled waits for the next config read; enabled false, a missing block or sample_pct 0 records nothing", async () => {
		for ( const diagnostics of [ { ...DIAG, enabled: false }, null, { ...DIAG, sample_pct: 0 } ] ) {
			const h = diagHarness( {}, diagnostics );
			h.consent(); await h.advance( 3 * MINUTE );
			fail( h, "Quest", ownError( TypeError, "x" ) );
			await h.advance( 2 * HOUR );
			assert.equal( h.Diag.recording(), false ); assert.equal( h.ofPath( "/diagnostics" ).length, 0 ); assert.ok( h.ofPath( "/telemetry" ).length >= 10, "usage statistics still flow" );
			assert.equal( h.Diag.pending.size + h.Diag.inbox.length, 0 );
		}
		const h = diagHarness();
		const answer = h.server.default;
		h.server.respond = entry => entry.url.endsWith( "/diagnostics" ) ? h.reply( 503, { code: "disabled" } ) : answer( entry );
		await shareOn( h );
		fail( h, "Quest", ownError( TypeError, "x" ) ); await h.advance( 10 * MINUTE );
		const first = h.ofPath( "/diagnostics" ).length, configs = h.ofPath( "/config" ).length;
		assert.equal( first, 1 );
		fail( h, "Party", ownError( TypeError, "y" ) ); await h.advance( 55 * MINUTE );
		assert.equal( h.ofPath( "/diagnostics" ).length, 1, "nothing until the config is read again" );
		await h.advance( 10 * MINUTE );
		assert.ok( h.ofPath( "/config" ).length > configs, "the config is read again after an hour" );
		const parse = block => plain( h.Telemetry.parseConfig( { ...h.server.config, diagnostics: block } ).diagnostics );
		assert.deepEqual( parse( { enabled: true, perf: true, interval_s: 10, perf_interval_s: 5, sample_pct: 150 } ), { enabled: true, perf: true, interval_s: 600, perf_interval_s: 1800, sample_pct: 100 } );
		assert.deepEqual( parse( { enabled: true, interval_s: 9e9, perf_interval_s: 9e9, sample_pct: -4 } ), { enabled: true, perf: false, interval_s: 86400, perf_interval_s: 86400, sample_pct: 0 } );
		assert.equal( parse( { enabled: "yes" } ).enabled, false ); assert.equal( parse( "on" ).enabled, false );
		assert.equal( h.Telemetry.parseConfig( { ...h.server.config, client_ok: false, diagnostics: DIAG } ).diagnostics.enabled, false );
	} );

	test( "DG21 403 consent_required: one PUT consent, one retry later, a second 403 stops diagnostics until reload while telemetry goes on", async () => {
		const h = diagHarness();
		const answer = h.server.default;
		h.server.respond = entry => entry.url.endsWith( "/diagnostics" ) ? h.reply( 403, { code: "consent_required" } ) : answer( entry );
		await shareOn( h );
		const puts = () => h.ofPath( "/installs/me/consent", "PUT" );
		fail( h, "Quest", ownError( TypeError, "x" ) ); await h.advance( 10 * MINUTE );
		assert.equal( h.ofPath( "/diagnostics" ).length, 1 ); assert.equal( puts().length, 1 );
		assert.deepEqual( JSON.parse( puts()[0].body ), { usage_version: 2, characters: false } );
		await h.advance( 10 * MINUTE );
		assert.equal( h.ofPath( "/diagnostics" ).length, 2 );
		fail( h, "Party", ownError( TypeError, "y" ) );
		await h.advance( 3 * HOUR );
		assert.equal( h.ofPath( "/diagnostics" ).length, 2, "stopped for this page" ); assert.equal( puts().length, 1 );
		assert.ok( h.ofPath( "/telemetry" ).length >= 20 );
	} );

	test( "DG20 an exception inside the diagnostics code is caught, the third switches it off, it never reports itself and the bot keeps running", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Diag.build = () => { throw new TypeError( "diag bug" ); };
		for ( let i = 0; i < 3; i++ ) { fail( h, "Module " + i, ownError( TypeError, "boom " + i ) ); await h.advance( 1000, { ticks: 1 } ); }
		assert.equal( h.Diag.off, true ); assert.equal( h.Diag.recording(), false );
		fail( h, "Quest", ownError( TypeError, "later" ) );
		assert.equal( h.Diag.inbox.length, 0 );
		await h.advance( HOUR, { ticks: 100 } );
		assert.equal( h.ofPath( "/diagnostics" ).length, 0 ); assert.ok( h.ofPath( "/telemetry" ).length >= 5, "usage statistics and the bot go on" );
	} );

	/*
	================
	Payload shape and "Show what is sent"
	================
	*/
	const GOLDEN_93 = {
		schema: 1, app: "osb", app_version: "2.0.14", run: "91d0c3b7a5e24f86", env: {},
		events: [ {
			kind: "js_error", source: "osb", fp: "77e1a0b9c2d4f531", at: "2026-11-12T14:20:00Z", count: 12,
			error: { type: "TypeError", template: "Cannot read properties of <q> (reading <q>)", module: "quest", handled: true, origin: "guard", frames: [ "Quest.observe@14210:31" ] },
			stop: { code: "stuck-no-progress", source: "stop" },
			warn: { category: "combat", code: "game-refusal", error_class: "timeout", refusal: { source: "cast", reason: "unmapped-error", native: 12305 } },
			context: { phase: "world", mode: "hunting", town_phase: "walk-vendor", dead: false, uptime_s: 5400 },
			trail: [ { s: -42, l: "info", c: "town", k: "operation-end", o: "confirmed", n: 2, e: "unclassified-error",
				d: { durationMs: 61200, distance: 1, attempt: 1, quantity: 1, hpPct: 1, mpPct: 1, delayMs: 1, kills: 1, deaths: 1, potions: 1, items: 1, revision: 4, visited: 1, progressAgeMs: 1, skillId: 1, leg: 1, legs: 1, attackingPlayer: true, choice: true } } ],
		} ],
		perf: [ { at: "2026-11-12T14:00:00Z", span_s: 1800, samples: 30, js_heap_mb: { used: 131, total: 160 }, tick_ms: { p50: 1.2, p95: 3.0, p99: 8.4, max: 41.0, late_pct: 0.3 },
			gap_ms: { p50: 100.1, p95: 104.0, p99: 180.0, max: 912.0, late_pct: 0.3 }, long_tasks: { count: 3, total_ms: 412.0 } } ],
		dropped: { rate_limited: 0, oversize: 0, sampled_out: 0 },
	};
	const ONE_OF = { js_error: "error", bot_stop: "stop", warn: "warn" };

	test( "DG22 DG23 the OSB batch matches the golden payload of DIAGNOSTICS.md 9.3; every at is minute-aligned and no millisecond time is sent", async () => {
		const h = diagHarness();
		await shareOn( h );
		h.Activity.emit( { category: "town", code: "operation-end", outcome: "confirmed", text: "Town trip done", details: { durationMs: 61200, goldChange: 5, monsterId: 7 } } );
		h.Log.info( "Accepted resurrection from CanaryRezzer (party member)." );
		h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "warn", outcome: "unconfirmed", text: "Target 1: x", details: { revision: 4, durationMs: 8000 } } );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'quests')" ) );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		h.Activity.refusal( "Cast rejected: 17" );
		await h.advance( 10 * MINUTE );
		const [ body ] = diagBodies( h );
		assert.deepEqual( h.ruleBreaks, [] );
		assertSubsetShape( body, GOLDEN_93 );
		assert.deepEqual( Object.keys( body ).sort(), [ "app", "app_version", "env", "events", "run", "schema" ] );
		assert.equal( body.schema, 1 ); assert.equal( body.app, "osb" ); assert.match( body.run, /^[0-9a-f]{16}$/ ); assert.deepEqual( body.env, {} );
		for ( const e of body.events ) {
			assert.match( e.fp, /^[0-9a-f]{16}$/ ); assert.match( e.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/ );
			assert.deepEqual( Object.keys( e ).filter( k => [ "error", "stop", "warn", "process", "hang", "gpu", "run_end" ].includes( k ) ), [ ONE_OF[e.kind] ] );
			for ( const t of e.trail || [] ) { assert.ok( t.s <= 0 && t.s >= -600 ); assert.ok( !( "goldChange" in ( t.d || {} ) ) && !( "monsterId" in ( t.d || {} ) ) ); }
		}
		const error = body.events.find( e => e.kind === "js_error" );
		assert.deepEqual( error.error, { type: "TypeError", template: "Cannot read properties of undefined (reading <q>)", module: "quest", handled: true, origin: "guard",
			frames: [ "Object.observe@14210:31", "Object.guard@12018:20", "Object.tick@12110:12", "ext" ] } );
		assert.deepEqual( error.trail.map( t => t.k ), [ "operation-end", "legacy", "approach-abandoned" ] );
		assert.deepEqual( error.trail[1], { s: 0, l: "info", c: "party", k: "legacy", e: "unclassified-error" } );
		assert.deepEqual( error.trail[0].d, { durationMs: 61200 } );
		const text = h.ofPath( "/diagnostics" )[0].body;
		assert.ok( !/\d{13}/.test( text ), "no millisecond timestamps" );
		assert.ok( Buffer.byteLength( text ) <= 64 * 1024 );
	} );

	test( "the fingerprint is the first 16 hex of SHA-256 over osb, kind, type, module, our first five frames without positions and the template", async () => {
		const h = diagHarness();
		await shareOn( h );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		await h.advance( 10 * MINUTE );
		const sha = text => nodeCrypto.createHash( "sha256" ).update( text ).digest( "hex" ).slice( 0, 16 );
		const [ error, stop ] = events( h );
		assert.equal( error.fp, sha( "osb|js_error|TypeError|quest|Object.observe,Object.guard,Object.tick|Cannot read properties of undefined (reading <q>)" ) );
		assert.equal( stop.fp, sha( "osb|bot_stop|stuck-no-progress|stop" ) );
		const moved = ownError( TypeError, "Cannot read properties of undefined (reading 'y')", [ "Object.observe:999:1", "Object.guard:2:2", "Object.tick:3:3" ] );
		h.Diag.inbox.length = 0; fail( h, "Quest", moved ); await h.advance( 1000 );
		assert.ok( h.Diag.pending.has( error.fp ), "a new release with other line numbers groups with the same fingerprint" );
	} );

	test( "DG24 Show what is sent shows the next diagnostics batch exactly as it is sent, and sends nothing", async () => {
		const h = diagHarness();
		await shareOn( h );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		await h.advance( 1000 );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const before = h.requests.length;
		host.find( n => n.tag === "button" && n.textContent === "Show what is sent" )[0].click( TRUSTED );
		await h.advance( 1000 );
		const [ usage, errors ] = host.find( n => n.tag === "textarea" );
		assert.equal( JSON.parse( usage.value ).schema, 1 );
		const shown = JSON.parse( errors.value );
		assert.equal( h.requests.length, before, "showing it sends nothing" );
		await h.advance( 10 * MINUTE );
		assert.deepEqual( diagBodies( h )[0], shown );
		const off = diagHarness(); const offHost = new FakeElement( "div" ); off.Telemetry.draw( offHost );
		offHost.find( n => n.tag === "button" && n.textContent === "Show what is sent" )[0].click( TRUSTED ); await off.advance( 1000 );
		assert.equal( offHost.find( n => n.tag === "textarea" )[1].value, "No error reports are recorded while sharing is off." );
		assert.equal( noPlatformRequests( off ).length, 0 );
	} );

	test( "the texts are the final 2026-11-12.1 wording of CONSENT.md", async () => {
		const h = diagHarness();
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const text = host.textContent;
		for ( const line of [
			"Share usage statistics, error reports and performance data",
			"When this is on, OSB sends data to our server, api.osb.lol, about every 10 minutes, so we can see how OSB is used and find and fix its errors:",
			"Errors: which part of OSB failed and how (the error type, a fixed message and the place in our code), why the bot stopped by itself, the game phase and what the bot did just before (fixed event codes, never the text of your log).",
			"Performance: how long the bot's steps take and the page's memory use, with the OSB version.",
			"Unless you also turn on character names below, it contains no character, player or account names.",
			"Delete all data for this install from api.osb.lol, including linked reports, error reports and performance data? Sharing is turned off. This cannot be undone.",
		] ) assert.ok( text.includes( line ), line );
		assert.deepEqual( host.find( n => n.tag === "a" ).map( a => [ a.textContent, a.href ] ), [
			[ "Privacy policy", "https://osb.lol/en/privacy/" ], [ "KVKK notice (Turkish)", "https://osb.lol/kvkk/aydinlatma-metni/" ], [ "KVKK explicit consent (Turkish)", "https://osb.lol/kvkk/acik-riza-metni/" ] ] );
		assert.ok( !/anonymous/i.test( text ) );
		const ui = fs.readFileSync( __dirname + "/lean-ui.js", "utf8" );
		assert.ok( ui.includes( "We never copy your description or the details into a public GitHub issue. If the report shows a bug, we may open a public issue that we write ourselves, with only our own summary, the product and version and the report code. It never contains your install ID, character names, e-mail or screenshot. Kept for 6 months after the matter closes." ) );
		assert.ok( !/quote your description/.test( ui ) );
	} );

	/*
	================
	serverRules

	An independent copy of the server parser rules of DIAGNOSTICS.md 3.3 and 3.3.1
	(osb-platform DiagnosticsParser, T076) for an OSB batch. Returns "path rule" strings.
	================
	*/
	function serverRules( body, now = Date.parse( "2026-11-12T15:00:00Z" ) ) {
		const errors = [], fail = ( path, rule ) => errors.push( path + " " + rule );
		const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/, HEX16 = /^[0-9a-f]{16}$/, VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
		const FRAME = /^(ext|[A-Za-z_$<?][A-Za-z0-9_$<>.+-]{0,95}(@[0-9]{1,7}:[0-9]{1,5}|\+IL_[0-9A-F]{4,6})?)$/;
		const TEMPLATE = /^[A-Za-z0-9 .,:;()<>'_/-]*$/, TYPE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/, MINUTE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/;
		const MODES = [ "idle", "hunting", "fight", "loot", "resting", "town", "returning", "travelling", "quest", "resurrect", "party-support", "recording", "shopping", "error", "other" ];
		const NUMBER_KEYS = [ "durationMs", "distance", "attempt", "quantity", "hpPct", "mpPct", "delayMs", "kills", "deaths", "potions", "items", "revision", "visited", "progressAgeMs", "skillId", "leg", "legs" ];
		const walk = ( value, path ) => {
			if ( value === null ) return fail( path, "null" );
			if ( typeof value === "string" && /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/.test( value ) ) fail( path, "characters" );
			if ( typeof value === "number" && !Number.isFinite( value ) ) fail( path, "type" );
			if ( Array.isArray( value ) ) value.forEach( ( v, i ) => walk( v, path + "[" + i + "]" ) );
			else if ( value && typeof value === "object" ) for ( const [ k, v ] of Object.entries( value ) ) walk( v, path + "." + k );
		};
		const depth = value => value && typeof value === "object" ? 1 + Math.max( 0, ...Object.values( value ).map( depth ) ) : 0;
		const keys = ( object, path, allowed ) => {
			if ( !object || typeof object !== "object" || Array.isArray( object ) ) { fail( path, "type" ); return false; }
			for ( const k of Object.keys( object ) ) if ( !allowed.includes( k ) ) fail( path + "." + k, "unknown" );
			return true;
		};
		const text = ( object, key, path, required, pattern ) => {
			if ( !( key in object ) ) { if ( required ) fail( path, "required" ); return; }
			if ( typeof object[key] !== "string" ) return fail( path, "type" );
			if ( pattern && !pattern.test( object[key] ) ) fail( path, "format" );
		};
		const int = ( object, key, path, required, min, max ) => {
			if ( !( key in object ) ) { if ( required ) fail( path, "required" ); return; }
			const v = object[key];
			if ( typeof v !== "number" || !Number.isInteger( v ) ) return fail( path, "type" );
			if ( v < min || v > max ) fail( path, "range" );
		};
		const number = ( object, key, path, min, max, integer ) => {
			if ( !( key in object ) ) return fail( path, "required" );
			const v = object[key];
			if ( typeof v !== "number" ) return fail( path, "type" );
			if ( integer ? !Number.isInteger( v ) : Math.round( v * 10 ) / 10 !== v ) return fail( path, "precision" );
			if ( v < min || v > max ) fail( path, "range" );
		};
		const bool = ( object, key, path, required ) => {
			if ( !( key in object ) ) { if ( required ) fail( path, "required" ); return; }
			if ( typeof object[key] !== "boolean" ) fail( path, "type" );
		};
		const uptime = ( object, key, path ) => {
			if ( !( key in object ) ) return;
			int( object, key, path, false, 0, 2592000 );
			if ( object[key] % 60 !== 0 ) fail( path, "step" );
		};
		const minute = ( object, key, path ) => {
			if ( typeof object[key] !== "string" || !MINUTE.test( object[key] ) ) return fail( path, "format" );
			const t = Date.parse( object[key] );
			if ( t < now - 7 * 86400000 || t > now + 600000 ) fail( path, "range" );
		};
		const sorted = ( array, path ) => { if ( Array.isArray( array ) && array.some( ( v, i ) => i && v < array[i - 1] ) ) fail( path, "order" ); };
		const text8 = JSON.stringify( body );
		if ( Buffer.byteLength( text8 ) > 64 * 1024 ) fail( "body", "size" );
		if ( depth( body ) > 8 ) fail( "body", "depth" );
		walk( body, "body" );
		if ( !keys( body, "body", [ "schema", "app", "app_version", "run", "env", "events", "perf", "dropped" ] ) ) return errors;
		if ( body.schema !== 1 ) fail( "schema", "value" );
		if ( body.app !== "osb" ) fail( "app", "install" );
		text( body, "app_version", "app_version", true, VERSION ); text( body, "run", "run", true, HEX16 );
		keys( body.env, "env", [ "os_build", "webview2", "dotnet", "ram_gb", "cores", "gpu_vendor" ] );
		if ( body.dropped !== undefined && keys( body.dropped, "dropped", [ "rate_limited", "oversize", "sampled_out" ] ) ) {
			for ( const k of Object.keys( body.dropped ) ) int( body.dropped, k, "dropped." + k, false, 0, 100000 );
		}
		if ( body.events !== undefined && ( !Array.isArray( body.events ) || body.events.length > 50 ) ) fail( "events", "items" );
		for ( const [ i, e ] of ( body.events || [] ).entries() ) {
			const p = "events[" + i + "]", detail = { js_error: "error", bot_stop: "stop", warn: "warn" }[e.kind];
			if ( Buffer.byteLength( JSON.stringify( e ) ) > 4096 ) fail( p, "size" );
			if ( !detail ) { fail( p + ".kind", "value" ); continue; }
			keys( e, p, [ "kind", "source", "fp", "at", "count", "context", "trail", detail ] );
			if ( e.source !== "osb" ) fail( p + ".source", "value" );
			text( e, "fp", p + ".fp", true, HEX16 ); if ( e.fp === "0000000000000000" ) fail( p + ".fp", "reserved" );
			minute( e, "at", p + ".at" ); int( e, "count", p + ".count", true, 1, 100000 );
			if ( !( detail in e ) ) fail( p + "." + detail, "required" );
			const d = e[detail] || {};
			if ( e.kind === "js_error" && keys( d, p + ".error", [ "type", "template", "module", "handled", "origin", "frames" ] ) ) {
				text( d, "type", p + ".error.type", true, TYPE );
				if ( "template" in d && ( typeof d.template !== "string" || d.template.length > 160 || !TEMPLATE.test( d.template ) ) ) fail( p + ".error.template", "format" );
				text( d, "module", p + ".error.module", false, CODE ); bool( d, "handled", p + ".error.handled", true );
				if ( ![ "guard", "tick", "data", "panel", "window", "rejection" ].includes( d.origin ) ) fail( p + ".error.origin", "value" );
				if ( "frames" in d && ( !Array.isArray( d.frames ) || d.frames.length > 16 || d.frames.some( f => typeof f !== "string" || !FRAME.test( f ) ) ) ) fail( p + ".error.frames", "format" );
			}
			if ( e.kind === "bot_stop" && keys( d, p + ".stop", [ "code", "source" ] ) ) {
				text( d, "code", p + ".stop.code", true, CODE );
				if ( ![ "stop", "town", "stop_all" ].includes( d.source ) ) fail( p + ".stop.source", "value" );
			}
			if ( e.kind === "warn" && keys( d, p + ".warn", [ "category", "code", "error_class", "refusal" ] ) ) {
				text( d, "category", p + ".warn.category", true, CODE ); text( d, "code", p + ".warn.code", true, CODE ); text( d, "error_class", p + ".warn.error_class", false, CODE );
				if ( "refusal" in d && keys( d.refusal, p + ".warn.refusal", [ "source", "reason", "native" ] ) ) {
					text( d.refusal, "source", p + ".warn.refusal.source", true, CODE ); text( d.refusal, "reason", p + ".warn.refusal.reason", true, CODE );
					int( d.refusal, "native", p + ".warn.refusal.native", true, 0, 65535 );
				}
			}
			if ( "context" in e && keys( e.context, p + ".context", [ "phase", "mode", "town_phase", "dead", "login_stage", "window", "windows", "light", "hidden", "uptime_s" ] ) ) {
				const c = e.context;
				text( c, "phase", p + ".context.phase", false, CODE ); text( c, "town_phase", p + ".context.town_phase", false, CODE );
				if ( "mode" in c && !MODES.includes( c.mode ) ) fail( p + ".context.mode", "value" );
				bool( c, "dead", p + ".context.dead", false ); uptime( c, "uptime_s", p + ".context.uptime_s" );
			}
			if ( "trail" in e ) {
				if ( !Array.isArray( e.trail ) || e.trail.length > 20 ) fail( p + ".trail", "items" );
				for ( const [ j, t ] of ( e.trail || [] ).entries() ) {
					const q = p + ".trail[" + j + "]";
					if ( !keys( t, q, [ "s", "l", "c", "k", "o", "n", "w", "e", "d" ] ) ) continue;
					int( t, "s", q + ".s", true, -86400, 0 );
					if ( ![ "info", "warn", "error", "cmd" ].includes( t.l ) ) fail( q + ".l", "value" );
					text( t, "c", q + ".c", true, CODE ); text( t, "k", q + ".k", true, CODE ); text( t, "o", q + ".o", false, CODE ); text( t, "e", q + ".e", false, CODE );
					int( t, "n", q + ".n", false, 1, 100000 ); int( t, "w", q + ".w", false, 1, 64 );
					if ( "d" in t && keys( t.d, q + ".d", [ ...NUMBER_KEYS, "attackingPlayer", "choice" ] ) ) {
						for ( const [ k, v ] of Object.entries( t.d ) ) {
							if ( NUMBER_KEYS.includes( k ) ? typeof v !== "number" || Math.abs( v ) > 1e9 : typeof v !== "boolean" ) fail( q + ".d." + k, "range" );
							if ( typeof v === "number" && Math.round( v * 10 ) / 10 !== v ) fail( q + ".d." + k, "precision" );
						}
					}
				}
			}
		}
		if ( body.perf !== undefined && ( !Array.isArray( body.perf ) || body.perf.length > 2 ) ) fail( "perf", "items" );
		for ( const [ i, f ] of ( body.perf || [] ).entries() ) {
			const p = "perf[" + i + "]";
			if ( Buffer.byteLength( JSON.stringify( f ) ) > 8192 ) fail( p, "size" );
			if ( !keys( f, p, [ "at", "span_s", "samples", "js_heap_mb", "tick_ms", "gap_ms", "long_tasks" ] ) ) continue;
			minute( f, "at", p + ".at" ); int( f, "span_s", p + ".span_s", true, 60, 86400 ); int( f, "samples", p + ".samples", true, 1, 1440 );
			if ( "js_heap_mb" in f && keys( f.js_heap_mb, p + ".js_heap_mb", [ "used", "total" ] ) ) for ( const k of Object.keys( f.js_heap_mb ) ) number( f.js_heap_mb, k, p + ".js_heap_mb." + k, 0, 262144, true );
			for ( const key of [ "tick_ms", "gap_ms" ] ) if ( key in f && keys( f[key], p + "." + key, [ "p50", "p95", "p99", "max", "late_pct" ] ) ) {
				for ( const k of [ "p50", "p95", "p99", "max" ] ) number( f[key], k, p + "." + key + "." + k, 0, 600000, false );
				number( f[key], "late_pct", p + "." + key + ".late_pct", 0, 100, false );
			}
			if ( "long_tasks" in f && keys( f.long_tasks, p + ".long_tasks", [ "count", "total_ms" ] ) ) {
				number( f.long_tasks, "count", p + ".long_tasks.count", 0, 100000, true ); number( f.long_tasks, "total_ms", p + ".long_tasks.total_ms", 0, 86400000, false );
			}
			for ( const [ path, array ] of Object.entries( { each: f.js_heap_mb?.each, used_each: f.js_heap_mb?.used_each } ) ) sorted( array, p + "." + path );
		}
		return errors;
	}
	const GOLDEN_93_EXACT = {
		schema: 1, app: "osb", app_version: "2.0.14", run: "91d0c3b7a5e24f86", env: {},
		events: [
			{ kind: "js_error", source: "osb", fp: "77e1a0b9c2d4f531", at: "2026-11-12T14:20:00Z", count: 12,
				error: { type: "TypeError", template: "Cannot read properties of <q> (reading <q>)", module: "quest", handled: true, origin: "guard", frames: [ "Quest.observe@14210:31", "Controller.guard@12018:20", "Controller.tick@12110:12", "ext" ] },
				context: { phase: "world", mode: "hunting", dead: false, uptime_s: 5400 },
				trail: [ { s: -42, l: "info", c: "town", k: "operation-end", o: "confirmed", d: { durationMs: 61200 } }, { s: -30, l: "info", c: "party", k: "legacy", e: "unclassified-error" },
					{ s: -12, l: "warn", c: "movement", k: "approach-abandoned", o: "unconfirmed", d: { revision: 4, durationMs: 8000 } } ] },
			{ kind: "bot_stop", source: "osb", fp: "3d2c1b0a99887766", at: "2026-11-12T14:31:00Z", count: 1, stop: { code: "stuck-no-progress", source: "stop" }, context: { phase: "world", mode: "hunting", dead: false, uptime_s: 6060 } },
			{ kind: "warn", source: "osb", fp: "e0f1a2b3c4d5e6f7", at: "2026-11-12T14:33:00Z", count: 40, warn: { category: "combat", code: "game-refusal", refusal: { source: "cast", reason: "unmapped-error", native: 12305 } },
				context: { phase: "world", mode: "fight", dead: false, uptime_s: 6180 } },
		],
		perf: [ { at: "2026-11-12T14:00:00Z", span_s: 1800, samples: 30, js_heap_mb: { used: 131, total: 160 }, tick_ms: { p50: 1.2, p95: 3.0, p99: 8.4, max: 41.0, late_pct: 0.3 },
			gap_ms: { p50: 100.1, p95: 104.0, p99: 180.0, max: 912.0, late_pct: 0.3 }, long_tasks: { count: 3, total_ms: 412.0 } } ],
	};

	test( "the server parser rules of DIAGNOSTICS.md 3.3.1: the golden 9.3 batch passes and each broken rule is caught", () => {
		assert.deepEqual( serverRules( GOLDEN_93_EXACT ), [] );
		const broken = ( change, rule ) => { const body = JSON.parse( JSON.stringify( GOLDEN_93_EXACT ) ); change( body ); assert.ok( serverRules( body ).some( r => r.endsWith( rule ) ), rule + ": " + serverRules( body ) ); };
		broken( b => { b.events[0].error.module = null; }, "events[0].error.module null" );
		broken( b => { b.dropped = { rate_limited: null }; }, "dropped.rate_limited null" );
		broken( b => { b.perf[0].tick_ms.p50 = 14.55; }, "perf[0].tick_ms.p50 precision" );
		broken( b => { b.perf[0].js_heap_mb.used = 131.5; }, "perf[0].js_heap_mb.used precision" );
		broken( b => { b.events[1].fp = "0000000000000000"; }, "events[1].fp reserved" );
		broken( b => { b.events[1].context.uptime_s = 6061; }, "events[1].context.uptime_s step" );
		broken( b => { delete b.events[2].warn.refusal.native; }, "events[2].warn.refusal.native required" );
		broken( b => { b.events[0].trail[0].d.goldChange = 5; }, "events[0].trail[0].d.goldChange unknown" );
		broken( b => { b.events[0].stop = { code: "x", source: "stop" }; }, "events[0].stop unknown" );
		broken( b => { b.events[0].at = "2026-11-12T14:20:30Z"; }, "events[0].at format" );
		broken( b => { b.perf[0].js_heap_mb = { used_each: [ 3, 1 ] }; }, "perf[0].used_each order" );
	} );

	test( "every batch OSB builds passes the server parser rules: no nulls, one decimal at most, no reserved fingerprint, uptime in minutes, refusal only with its native code", async () => {
		const h = diagHarness( {}, { ...DIAG, perf: true } );
		await shareOn( h );
		h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "info", text: "x", details: { distance: 12.345, hpPct: 33.333, durationMs: 8000, revision: 4, attackingPlayer: true, monsterId: 9, goldChange: 4 } } );
		h.Log.info( "Accepted resurrection from CanaryRezzer (party member)." );
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		fail( h, "Party", ownError( Error, "own message" ) );
		h.Diag.error( "", ownError( RangeError, "Invalid array length" ), "window", false );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		h.Town.fail( "Storage is full." );
		h.Activity.refusal( "Cast rejected: 17" );
		h.Activity.refusal( "Something odd happened" );
		h.Log.warn( "Town trip timed out." );
		const golden = JSON.parse( JSON.stringify( GOLDEN_93_EXACT.perf[0] ) );
		golden.at = new Date( Math.floor( h.now / MINUTE ) * MINUTE - 30 * MINUTE ).toISOString().replace( ".000Z", "Z" );
		h.Diag.perf.push( { ...golden, tick_ms: { ...golden.tick_ms, p50: 14.55 } }, { ...golden, long_tasks: null }, golden );
		await h.advance( 10 * MINUTE );
		const [ body ] = diagBodies( h );
		assert.deepEqual( serverRules( body, h.now ), [] );
		assert.deepEqual( plain( body.perf ), [ golden ], "perf entries that break the rules are dropped, the valid one is sent" );
		assert.equal( h.Diag.perf.length, 0 );
		const warns = body.events.filter( e => e.kind === "warn" ).map( e => e.warn );
		assert.ok( warns.some( w => w.refusal?.native === 0x3011 ) );
		assert.ok( warns.every( w => !w.refusal || Number.isInteger( w.refusal.native ) ), "a refusal without a native code is sent without the refusal object" );
		const trail = body.events.find( e => e.error?.module === "quest" ).trail[0];
		assert.deepEqual( trail.d, { durationMs: 8000, distance: 12.3, hpPct: 33.3, revision: 4, attackingPlayer: true } );
		assert.ok( body.events.every( e => e.context.uptime_s % 60 === 0 ) );
		assert.ok( !/null/.test( h.ofPath( "/diagnostics" )[0].body ) );
		const zero = diagHarness();
		zero.win.crypto.subtle.digest = async () => new ArrayBuffer( 32 );
		assert.equal( await zero.Diag.fingerprint( "anything" ), "0000000000000001", "the reserved overflow fingerprint is never produced" );
		assert.equal( zero.Diag.wire( { a: [ 1, 2.5, "x" ] } ), true );
		for ( const bad of [ { a: null }, { a: 14.55 }, { a: [ undefined ] }, { a: "\u0007" }, { a: "\ud83d\ude00" }, { a: NaN } ] ) assert.equal( zero.Diag.wire( bad ), false, JSON.stringify( bad ) );
	} );

	test( "inside OSB Manager OSB records no diagnostics, makes no request and says the Manager handles them", async () => {
		const stored = { [KEY]: JSON.stringify( { usage: 2, usageText: "2026-11-12.1", ...IDENTITY, registered: true, syncedUsage: 2 } ) };
		const h = diagHarness( { hosted: true, stored } );
		h.Telemetry.start();
		fail( h, "Quest", ownError( TypeError, "x" ) );
		for ( const fn of h.listeners.error ) fn( { error: ownError( TypeError, "y" ) } );
		await h.advance( 2 * HOUR, { ticks: 1 } );
		assert.equal( h.requests.length, 0 ); assert.equal( h.Diag.recording(), false ); assert.equal( h.Diag.inbox.length, 0 );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		assert.match( host.textContent, /Usage statistics, error reports and performance data are handled by OSB Manager\. OSB sends none itself\./ );
	} );
	/*
	================
	Inside OSB Manager (T084, DIAGNOSTICS.md 3.6, DG25)
	================
	*/
	const ON = { type: "osb-diagnostics", on: true }, OFF = { type: "osb-diagnostics", on: false };
	const wrapped = message => ( { schema: 1, app: "osb", app_version: "2.0.13", run: "0123456789abcdef", env: {}, events: message.events } );
	const pageSize = text => Buffer.byteLength( text ) + 5 * ( text.match( /[<>&']/g ) || [] ).length;
	function hostedHarness( options = {} ) {
		const h = diagHarness( { hosted: true, ...options } );
		h.Telemetry.start();
		return h;
	}
	function checkPosted( h ) {
		const batches = h.webview.posted.filter( p => p.message.type !== "osb-diagnostics-perf" );
		for ( const post of batches ) {
			assert.deepEqual( Object.keys( post.message ), [ "type", "events" ], "events only, no perf and no dropped" );
			assert.equal( post.message.type, "osb-diagnostics-batch" );
			assert.ok( post.message.events.length >= 1 && post.message.events.length <= 10, "1 to 10 events" );
			assert.ok( pageSize( post.text ) <= 12 * 1024, "at most 12 KB as the Manager measures it" );
			assert.deepEqual( serverRules( wrapped( post.message ), h.now ), [], "serverRules" );
			for ( const e of post.message.events ) assert.equal( e.source, "osb" );
		}
		const times = batches.map( p => p.at );
		for ( let i = 1; i < times.length; i++ ) assert.ok( times[i] - times[i - 1] >= MINUTE, "at most one message per 60 s" );
	}

	test( "DG25 inside OSB Manager OSB records nothing and posts nothing until the Manager says on, and never asks api.osb.lol", async () => {
		const h = hostedHarness();
		fail( h, "Quest", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		await h.advance( 10 * MINUTE );
		assert.equal( h.Diag.recording(), false );
		assert.equal( h.Diag.inbox.length + h.Diag.pending.size, 0, "nothing recorded without on: true" );
		assert.equal( h.webview.posted.length, 0 );

		h.host( ON );
		assert.equal( h.Diag.recording(), true );
		for ( let i = 0; i < 15; i++ ) fail( h, "Module " + i, ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		h.Hunt.running = true; h.Hunt.stop( "stuck: no progress after 3 recoveries" );
		h.Log.warn( "Town trip timed out." );
		await h.advance( 30 * 1000 );
		assert.equal( h.webview.posted.length, 0, "nothing before the first 60 s" );
		await h.advance( 30 * 1000 );
		assert.equal( h.webview.posted.length, 1 );
		assert.equal( h.webview.posted[0].message.events.length, 10, "at most 10 events" );
		await h.advance( 3 * MINUTE );
		assert.equal( h.webview.posted.length, 2, "the rest follows a minute later, and no empty message after it" );
		const kinds = h.webview.posted.flatMap( p => p.message.events.map( e => e.kind ) );
		assert.equal( kinds.filter( k => k === "js_error" ).length, 15 );
		assert.ok( kinds.includes( "bot_stop" ) && kinds.includes( "warn" ) );
		checkPosted( h );

		fail( h, "Module 0", ownError( TypeError, "Cannot read properties of undefined (reading 'x')" ) );
		await h.advance( 2 * HOUR );
		checkPosted( h );
		assert.equal( h.requests.length, 0, "no request at all, to api.osb.lol or anywhere" );
		assert.equal( h.Diag.job.sentAt, 0, "the batch job never ran" );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		assert.match( host.textContent, /Usage statistics, error reports and performance data are handled by OSB Manager\. OSB sends none itself\./ );
	} );

	test( "DG25 on: false wipes the buffers and stops the posts; malformed switch messages change nothing", async () => {
		const h = hostedHarness();
		for ( const bad of [ null, {}, { type: "osb-diagnostics" }, { type: "osb-diagnostics", on: "true" }, { type: "osb-diagnostics", on: 1 }, { type: "light", on: true } ] ) h.host( bad );
		assert.equal( h.Diag.recording(), false, "only a boolean on turns it on" );
		h.host( ON );
		fail( h, "Quest", ownError( TypeError, "x is not a function" ) );
		await h.advance( 20 * 1000 );
		assert.ok( h.Diag.pending.size > 0 );
		h.host( OFF );
		assert.equal( h.Diag.recording(), false );
		assert.equal( h.Diag.inbox.length + h.Diag.pending.size + h.Diag.terms.size, 0, "buffers and private terms wiped" );
		assert.equal( h.Diag.hostTimer, 0, "the post timer is cancelled" );
		fail( h, "Quest", ownError( TypeError, "x is not a function" ) );
		await h.advance( 10 * MINUTE );
		assert.equal( h.webview.posted.length, 0, "nothing is posted after on: false" );
		h.host( ON );
		await h.advance( 2 * MINUTE );
		assert.equal( h.webview.posted.length, 0, "nothing recorded before the second on is posted: " + JSON.stringify( h.webview.posted.map( p => p.message.events ) ) );
		assert.equal( h.requests.length, 0 );
	} );

	test( "DG25 a hosted message is cut to 12 KB: trails go first, then whole events", async () => {
		const h = hostedHarness();
		h.host( ON );
		for ( let i = 0; i < 400; i++ ) h.Activity.emit( { category: "movement", code: "approach-abandoned", level: "info", text: "x" + i, details: { durationMs: 123456 + i, distance: 1000 + i, revision: i, attempt: i } } );
		const frames = Array.from( { length: 16 }, ( _, j ) => "Object.step" + "x".repeat( 60 ) + j + ":" + ( 1000000 + j ) + ":12345" );
		for ( let i = 0; i < 12; i++ ) fail( h, "Module " + i, ownError( TypeError, "Cannot read properties of undefined (reading '" + i + "')", frames ) );
		await h.advance( 30 * 1000 );
		const built = h.Diag.assemble( null, { hosted: true, preview: true } );
		const full = JSON.stringify( { type: "osb-diagnostics-batch", events: [ ...h.Diag.pending.values() ].slice( 0, 10 ).map( p => p.event ) } );
		assert.ok( pageSize( full ) > 12 * 1024, "the uncut message would be over 12 KB" );
		assert.ok( pageSize( built.text ) <= 12 * 1024 );
		const trails = built.message.events.map( e => !!e.trail );
		assert.ok( trails.includes( false ), "trails were cut" );
		assert.ok( trails.indexOf( false ) > trails.lastIndexOf( true ), "the newest events lose their trails first" );
		await h.advance( 30 * 1000 );
		assert.equal( h.webview.posted.length, 1 );
		checkPosted( h );
	} );

	const PERF_ON = { type: "osb-diagnostics", on: true, perf: true }, PERF_OFF = { type: "osb-diagnostics", on: true, perf: false };
	function perfHosted() {
		const h = hostedHarness();
		h.observers = [];
		const made = h.observers;
		h.win.PerformanceObserver = class { constructor( callback ) { this.callback = callback; made.push( this ); } observe() {} disconnect() {} static get supportedEntryTypes() { return [ "longtask" ]; } };
		h.Telemetry.get().config = { at: h.now, value: { telemetry: { enabled: true, interval_s: 600 }, reports: { enabled: true, screenshots: true }, client_ok: true, message: null,
			diagnostics: { enabled: true, perf: true, interval_s: 600, perf_interval_s: 1800, sample_pct: 100 } } };
		return h;
	}
	const perfPosts = h => h.webview.posted.filter( p => p.message.type === "osb-diagnostics-perf" );
	function assertNoPerfState( h, label ) {
		assert.equal( h.Perf.on, false, label );
		assert.equal( h.Perf.ticks + h.Perf.gaps + h.Perf.samples + h.Perf.tasks, 0, label + ": no histogram counts, samples or long tasks" );
		assert.ok( h.Perf.tickBins.every( v => v === 0 ) && h.Perf.gapBins.every( v => v === 0 ), label );
		assert.equal( h.Perf.heap, null, label ); assert.equal( h.Perf.observer, null, label );
		assert.equal( h.Perf.timer, 0, label + ": no heap sampler" );
		assert.equal( h.Diag.perf.length, 0, label );
	}

	test( "hosted OSB keeps no perf state unless the Manager asks this window, even when a stored config asks for perf", async () => {
		const h = perfHosted();
		for ( const message of [ ON, PERF_OFF, { type: "osb-diagnostics", on: true, perf: "yes" }, { type: "osb-diagnostics", on: false, perf: true } ] ) {
			h.host( message );
			h.Diag.sync();
			for ( let i = 0; i < 500; i++ ) h.gameTick();
			await h.advance( HOUR );
			assertNoPerfState( h, JSON.stringify( message ) );
			assert.equal( h.observers.length, 0, "no long-task observer" );
		}
		assert.equal( perfPosts( h ).length, 0 );
		assert.equal( h.requests.length, 0 );
	} );

	test( "the window the Manager asks records perf for one span, answers once with an OSB perf entry of at most 2 KB, then records nothing", async () => {
		const h = perfHosted();
		h.host( PERF_ON );
		assert.equal( h.Perf.on, true );
		assert.equal( h.observers.length, 1 );
		for ( let minute = 0; minute < 35; minute++ ) {
			for ( let i = 0; i < 20; i++ ) h.gameTick();
			await h.advance( MINUTE );
		}
		const answers = perfPosts( h );
		assert.equal( answers.length, 1, "one answer" );
		const { message, text } = answers[0];
		assert.deepEqual( Object.keys( message ), [ "type", "perf" ] );
		assert.ok( pageSize( text ) <= 2048, "at most 2 KB" );
		assert.ok( message.perf.span_s >= 1800 && message.perf.samples >= 30 );
		assert.ok( message.perf.tick_ms && message.perf.gap_ms );
		assert.deepEqual( serverRules( { schema: 1, app: "osb", app_version: "2.0.13", run: "0123456789abcdef", env: {}, events: [], perf: [ message.perf ] }, h.now ), [], "the OSB perf rules" );
		assertNoPerfState( h, "after the answer" );
		for ( let minute = 0; minute < 70; minute++ ) { for ( let i = 0; i < 20; i++ ) h.gameTick(); await h.advance( MINUTE ); }
		assert.equal( perfPosts( h ).length, 1, "no second answer without a new ask" );
		assertNoPerfState( h, "a span later" );
		h.host( PERF_OFF ); h.host( PERF_ON );
		assert.equal( h.Perf.on, true, "a new ask starts a new span" );
		assert.equal( h.Perf.ticks, 0, "from empty histograms" );
	} );

	test( "perf: false or on: false in the middle of a span stops perf and wipes it without an answer", async () => {
		for ( const stop of [ PERF_OFF, OFF ] ) {
			const h = perfHosted();
			h.host( PERF_ON );
			for ( let minute = 0; minute < 10; minute++ ) { for ( let i = 0; i < 20; i++ ) h.gameTick(); await h.advance( MINUTE ); }
			assert.ok( h.Perf.ticks > 0 );
			h.host( stop );
			assertNoPerfState( h, JSON.stringify( stop ) );
			await h.advance( HOUR );
			assert.equal( perfPosts( h ).length, 0 );
		}
	} );

	/*
	================
	Perf tests (T083)
	================
	*/
	const binOf = ( value, low, high ) => Math.min( 31, value > low ? Math.floor( 32 * Math.log( value / low ) / Math.log( high / low ) ) : 0 );
	const tickBinOf = value => binOf( value, 0.05, 1000 ), gapBinOf = value => binOf( value, 10, 10000 );
	const shapeOf = value => Array.isArray( value ) ? value.map( shapeOf ) : value && typeof value === "object" ? Object.fromEntries( Object.entries( value ).map( ( [ k, v ] ) => [ k, shapeOf( v ) ] ) ) : typeof value;
	function perfHarness( diagnostics = { ...DIAG, perf: true }, { observer = true, memory = true } = {} ) {
		const h = diagHarness( {}, diagnostics );
		h.observers = [];
		if ( observer ) {
			const made = h.observers;
			h.win.PerformanceObserver = class { constructor( callback ) { this.callback = callback; this.observed = []; this.disconnected = false; made.push( this ); }
				observe( options ) { this.observed.push( options ); } disconnect() { this.disconnected = true; } static get supportedEntryTypes() { return [ "longtask", "navigation" ]; } };
		}
		h.heapReads = [];
		if ( memory ) Object.defineProperty( h.context.performance, "memory", { configurable: true, get() { h.heapReads.push( { inTick: h.ticking } ); return { usedJSHeapSize: 131 * 1048576 + 400000, totalJSHeapSize: 160 * 1048576 }; } } );
		const original = h.context.performance.now;
		let extra = 0, previous = 0;
		h.run = steps => {
			for ( const [ duration, gap ] of steps ) {
				extra += gap - previous; previous = duration;
				h.Controller.tick = () => { extra += duration; };
				h.gameTick();
			}
		};
		h.context.performance.now = () => original() + extra;
		return h;
	}
	const perfBodies = h => diagBodies( h ).flatMap( body => body.perf || [] );

	test( "perf: tick durations and gaps go into 32 fixed log-scale bins, extremes land in the end bins, and the percentiles stay within a bin of the true value", async () => {
		const h = perfHarness();
		await shareOn( h );
		assert.equal( h.Perf.on, true );
		const tickBins = h.Perf.tickBins, gapBins = h.Perf.gapBins;
		const typeOf = value => Object.prototype.toString.call( value );
		assert.ok( typeOf( tickBins ) === "[object Uint32Array]" && typeOf( gapBins ) === "[object Uint32Array]" && tickBins.length === 32 && gapBins.length === 32 );
		const steps = [ [ 1.2, 104 ], [ 1.2, 104 ], [ 1.2, 104 ], [ 8, 104 ], [ 41, 250.5 ], [ 0, 104 ], [ 5000, 104 ], [ 1, 1000000 ] ];
		h.run( steps );
		const expectedTicks = new Array( 32 ).fill( 0 ), expectedGaps = new Array( 32 ).fill( 0 );
		for ( const [ duration ] of steps ) expectedTicks[tickBinOf( duration )]++;
		for ( const [ , gap ] of steps.slice( 1 ) ) expectedGaps[gapBinOf( gap )]++;
		assert.deepEqual( Array.from( tickBins ), expectedTicks );
		assert.deepEqual( Array.from( gapBins ), expectedGaps );
		assert.equal( expectedTicks[0], 1, "a zero duration is in the first bin" ); assert.equal( expectedTicks[31], 1, "a duration over 1 s is in the last bin" ); assert.equal( expectedGaps[31], 1, "a gap over 10 s is in the last bin" );
		assert.equal( h.Perf.ticks, 8 ); assert.equal( h.Perf.gaps, 7 );
		assert.equal( h.Perf.lateTicks, 1, "a tick over 50 ms is late" ); assert.equal( h.Perf.lateGaps, 2, "a gap over 250 ms is late" );
		const entry = h.Perf.entry( { preview: false } );
		assert.equal( entry.tick_ms.max, 5000 ); assert.equal( entry.gap_ms.max, 600000, "a gap over the 600000 ms cap is cut to it" );
		assert.equal( entry.tick_ms.late_pct, 12.5 ); assert.equal( entry.gap_ms.late_pct, 28.6 );
		for ( const key of [ "tick_ms", "gap_ms" ] ) {
			const s = entry[key];
			assert.ok( s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max, key + " is ordered" );
		}
		await h.advance( 31 * MINUTE );
		assert.equal( h.Perf.tickBins, tickBins ); assert.equal( h.Perf.gapBins, gapBins );
		assert.equal( h.Perf.ticks, 0 ); assert.equal( h.Perf.gaps, 0 ); assert.equal( h.Perf.lateTicks, 0 ); assert.equal( h.Perf.lateGaps, 0 );
		assert.ok( Array.from( tickBins ).every( n => n === 0 ) && Array.from( gapBins ).every( n => n === 0 ), "the histograms are reset after the entry" );
		const sent = perfBodies( h );
		assert.equal( sent.length, 1, "one entry for the span" ); assert.equal( sent[0].tick_ms.max, 5000 );
		h.run( [ [ 2, 104 ] ] );
		assert.equal( h.Perf.ticks, 1 ); assert.equal( Array.from( tickBins ).reduce( ( a, b ) => a + b, 0 ), 1 );
		const lcg = ( seed => () => ( seed = ( seed * 1664525 + 1013904223 ) % 4294967296 ) / 4294967296 )( 7 );
		const wide = perfHarness(); await shareOn( wide );
		const durations = Array.from( { length: 3000 }, () => Math.exp( Math.log( 0.5 ) + lcg() * ( Math.log( 20 ) - Math.log( 0.5 ) ) ) );
		wide.run( durations.map( d => [ d, 104 ] ) );
		const sorted = [ ...durations ].sort( ( a, b ) => a - b );
		const wideEntry = wide.Perf.entry( { preview: false } );
		for ( const [ key, q ] of [ [ "p50", 0.5 ], [ "p95", 0.95 ], [ "p99", 0.99 ] ] ) {
			const exact = sorted[Math.ceil( q * sorted.length ) - 1], ratio = wideEntry.tick_ms[key] / exact;
			assert.ok( ratio > 1 / 1.45 && ratio < 1.45, key + " " + wideEntry.tick_ms[key] + " against " + exact );
		}
		assert.equal( wideEntry.tick_ms.max, Math.round( sorted[sorted.length - 1] * 10 ) / 10 );
		assert.equal( wideEntry.gap_ms.p50, 104 ); assert.equal( wideEntry.gap_ms.max, 104 );
	} );

	test( "perf: after perf_interval_s one entry in the 3.3 OSB shape reaches the server, passes the server rules and has the shape of the golden 9.3 entry", async () => {
		const h = perfHarness();
		await shareOn( h );
		const spanStart = h.Perf.spanEpoch;
		h.run( Array.from( { length: 300 }, () => [ 1.2, 100.1 ] ) );
		const tasks = h.observers[0];
		assert.deepEqual( plain( tasks.observed ), [ { type: "longtask" } ], "one long task observer" );
		tasks.callback( { getEntries: () => [ { name: "self", duration: 100.25, attribution: [ { name: "private" } ] }, { duration: 150 }, { duration: 161.75 } ] } );
		await h.advance( 45 * MINUTE );
		assert.deepEqual( h.ruleBreaks, [] );
		const entries = perfBodies( h );
		assert.equal( entries.length, 1 );
		const [ entry ] = entries;
		const golden = GOLDEN_93_EXACT.perf[0];
		assert.deepEqual( shapeOf( entry ), shapeOf( golden ) );
		assert.deepEqual( Object.keys( entry ), Object.keys( golden ) );
		assert.ok( entry.span_s >= 1800 && entry.span_s <= 1860, "span " + entry.span_s ); assert.equal( entry.samples, 30 );
		assert.deepEqual( entry.js_heap_mb, { used: 131, total: 160 } );
		assert.deepEqual( entry.tick_ms, { p50: 1.2, p95: 1.2, p99: 1.2, max: 1.2, late_pct: 0 } );
		assert.deepEqual( entry.gap_ms, { p50: 100.1, p95: 100.1, p99: 100.1, max: 100.1, late_pct: 0 } );
		assert.deepEqual( entry.long_tasks, { count: 3, total_ms: 412 } );
		assert.ok( !JSON.stringify( entry ).includes( "private" ) && !JSON.stringify( entry ).includes( "self" ), "long task names are never kept" );
		assert.equal( Date.parse( entry.at ), Math.floor( spanStart / 60000 ) * 60000, "the entry starts where the span started" );
		const posted = diagBodies( h ).find( body => body.perf );
		assert.deepEqual( serverRules( posted, h.now ), [] );
		assert.equal( JSON.stringify( posted ).includes( "null" ), false );
		assert.ok( h.heapReads.length >= 30 && h.heapReads.every( read => !read.inTick ), "the heap is read from the idle sampler, never in a tick" );
		assert.ok( h.idleCalls.length >= 30 );
		assert.equal( h.Diag.perf.length, 0, "a sent entry is removed from the queue" );
		const plainBrowser = perfHarness( undefined, { observer: false, memory: false } );
		await shareOn( plainBrowser );
		plainBrowser.run( [ [ 1.2, 100 ], [ 1.4, 100 ] ] );
		const bare = plainBrowser.Perf.entry( { preview: false } );
		assert.deepEqual( Object.keys( bare ), [ "at", "span_s", "samples", "tick_ms", "gap_ms" ], "without longtask or performance.memory those fields are left out" );
		assert.equal( plainBrowser.observers.length, 0 );
		const empty = perfHarness( undefined, { observer: false, memory: false } );
		await shareOn( empty );
		assert.equal( empty.Perf.entry( { preview: false } ), null, "with nothing to report there is no entry" );
		empty.Perf.close(); assert.equal( empty.Diag.perf.length, 0 );
	} );

	test( "perf: nothing is timed or kept while recording is off, perf is off, sampling excludes the page or sharing is switched off", async () => {
		const sampler = t => t.fn.toString().includes( "sample" );
		const off = perfHarness();
		off.run( [ [ 1.2, 100 ], [ 1.2, 100 ] ] );
		assert.equal( off.Perf.on, false ); assert.equal( off.Perf.ticks, 0 ); assert.equal( off.Perf.gaps, 0 );
		assert.equal( off.observers.length, 0 ); assert.equal( off.timers.filter( sampler ).length, 0 );
		await off.advance( 3 * HOUR, { ticks: 1000 } );
		assert.equal( off.Perf.ticks, 0 ); assert.equal( off.Diag.perf.length, 0 ); assert.equal( off.heapReads.length, 0 );
		assert.equal( noPlatformRequests( off ).length, 0 );

		const noPerf = perfHarness( { ...DIAG, perf: false } );
		await shareOn( noPerf );
		assert.equal( noPerf.Diag.recording(), true ); assert.equal( noPerf.Perf.on, false );
		noPerf.run( [ [ 1.2, 100 ], [ 1.2, 100 ] ] );
		await noPerf.advance( 2 * HOUR, { ticks: 1000 } );
		assert.equal( noPerf.Perf.ticks, 0 ); assert.equal( noPerf.observers.length, 0 ); assert.equal( noPerf.heapReads.length, 0 );
		assert.equal( noPerf.Diag.perf.length, 0 ); assert.equal( perfBodies( noPerf ).length, 0 );
		assert.equal( await noPerf.Diag.preview(), "" );

		const sampledOut = perfHarness( { ...DIAG, perf: true, sample_pct: 0 } );
		sampledOut.consent(); await sampledOut.advance( 3 * MINUTE );
		assert.equal( sampledOut.Diag.recording(), false ); assert.equal( sampledOut.Perf.on, false ); assert.equal( sampledOut.observers.length, 0 );
		sampledOut.run( [ [ 1.2, 100 ] ] ); assert.equal( sampledOut.Perf.ticks, 0 );

		const h = perfHarness();
		await shareOn( h );
		h.run( [ [ 1.2, 100 ], [ 1.2, 100 ] ] );
		assert.equal( h.Perf.ticks, 2 );
		h.server.config.diagnostics = { ...DIAG, perf: false };
		await h.Telemetry.readConfig();
		assert.equal( h.Perf.on, false, "the server turning perf off stops it" ); assert.equal( h.Perf.ticks, 0 );
		assert.equal( h.observers[0].disconnected, true ); assert.equal( h.Diag.perf.length, 0 );
		h.run( [ [ 1.2, 100 ] ] );
		assert.equal( h.Perf.ticks, 0 );
		h.server.config.diagnostics = { ...DIAG, perf: true };
		await h.Telemetry.readConfig();
		assert.equal( h.Perf.on, true ); assert.equal( h.observers.length, 2 );
		h.run( [ [ 1.2, 100 ], [ 1.2, 100 ] ] );
		h.Perf.heap = { used: 5, total: 6 }; h.Perf.samples = 3; h.Perf.close();
		assert.equal( h.Diag.perf.length, 1 );
		await h.Telemetry.setUsage( false );
		await h.advance( 1000 );
		assert.equal( h.Perf.on, false ); assert.equal( h.Perf.ticks, 0 ); assert.equal( h.Perf.heap, null );
		assert.equal( h.observers[1].disconnected, true ); assert.equal( h.Diag.perf.length, 0 );
		h.run( [ [ 1.2, 100 ] ] );
		assert.equal( h.Perf.ticks, 0, "after switching off nothing is timed" );
		assert.equal( h.timers.filter( sampler ).length, 0, "the sampler chain is cancelled" );
	} );

	test( "perf: the entry queue keeps two entries, drops the oldest, and an entry that breaks a parser rule is never queued", async () => {
		const h = perfHarness();
		await shareOn( h );
		for ( const max of [ 3, 4, 5 ] ) { h.run( [ [ 1, 104 ], [ max, 104 ] ] ); h.Perf.samples = 2; h.Perf.close(); }
		assert.equal( h.Diag.perf.length, 2 );
		assert.deepEqual( plain( h.Diag.perf.map( e => e.tick_ms.max ) ), [ 4, 5 ], "the oldest entry went" );
		h.Perf.heap = { used: 131.55, total: 160 }; h.run( [ [ 1, 104 ] ] ); h.Perf.close();
		assert.deepEqual( plain( h.Diag.perf.map( e => e.tick_ms.max ) ), [ 4, 5 ], "a value with two decimals is dropped, not queued" );
		assert.equal( h.Perf.ticks, 0, "the histograms are reset even when the entry is dropped" );
	} );

	test( "perf: Show what is sent includes the next perf entry, and showing it sends nothing", async () => {
		const h = perfHarness();
		await shareOn( h );
		const first = JSON.parse( await h.Diag.preview() );
		assert.deepEqual( Object.keys( first.perf[0] ), [ "at", "span_s", "samples", "js_heap_mb", "long_tasks" ], "before any tick only the memory and long task fields exist" );
		h.run( Array.from( { length: 50 }, () => [ 1.2, 100.1 ] ) );
		const shown = JSON.parse( await h.Diag.preview() );
		assert.equal( shown.perf.length, 1 ); assert.equal( shown.perf[0].tick_ms.p50, 1.2 ); assert.equal( shown.perf[0].js_heap_mb.used, 131 );
		assert.deepEqual( shown.events, [] );
		assert.deepEqual( serverRules( shown, h.now ), [] );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const before = h.requests.length;
		host.find( n => n.tag === "button" && n.textContent === "Show what is sent" )[0].click( TRUSTED );
		await h.advance( 1000 );
		const text = host.find( n => n.tag === "textarea" )[1].value;
		assert.equal( JSON.parse( text ).perf.length, 1 ); assert.ok( JSON.parse( text ).perf[0].tick_ms.max < 1.3 );
		assert.equal( h.requests.length, before, "showing it sends nothing" ); assert.equal( h.Diag.perf.length, 0, "a preview queues nothing" );
		assert.equal( h.Perf.ticks, 50, "a preview does not reset the histograms" );
		const quiet = perfHarness( { ...DIAG, perf: false } ); await shareOn( quiet );
		quiet.run( [ [ 1.2, 100 ], [ 1.2, 100 ] ] );
		assert.equal( await quiet.Diag.preview(), "" );
	} );

	test( "perf: the tick adds numbers to fixed arrays and does nothing else: no allocation, JSON, hashing, network, timer, observer or Diag and Perf call", async () => {
		const match = fs.readFileSync( __dirname + "/lean-perf.js", "utf8" ).match( /  step\(\) \{[\s\S]*?\n  \},\n  begin\(\) \{[\s\S]*?\n  \},\n  end\(started\) \{[\s\S]*?\n  \},\n/ );
		assert.ok( match, "step, begin and end sit together in lean-perf.js" );
		const source = match[0];
		assert.ok( source.includes( "Controller.tick()" ) );
		for ( const forbidden of [ /\bnew\b/, /JSON/, /crypto/i, /fetch/, /Telemetry/, /\bDiag\b/, /=>/, /\.map\(/, /\.filter\(/, /\.slice\(/, /\.push\(/, /\bawait\b/, /\.\.\./, /setTimeout/, /performance\.memory/, /\[\s*\]/, /\{\s*\w+\s*:/ ] ) assert.ok( !forbidden.test( source ), String( forbidden ) );
		const h = perfHarness();
		await shareOn( h );
		const bins = [ h.Perf.tickBins, h.Perf.gapBins ], fields = Object.keys( h.Perf ).sort();
		const hits = [];
		const watch = ( owner, name, skip ) => {
			for ( const key of Object.keys( owner ) ) if ( typeof owner[key] === "function" && !skip.includes( key ) ) {
				const original = owner[key];
				owner[key] = function ( ...args ) { hits.push( { key: name + "." + key, inTick: h.ticking } ); return original.apply( this, args ); };
			}
		};
		watch( h.Diag, "Diag", [ "error", "warn", "stop", "queue", "same", "later", "recording", "silently", "context" ] );
		watch( h.Perf, "Perf", [ "step", "begin", "end" ] );
		const sampler = x => x.fn.toString().includes( "sample" ), timers = h.timers.filter( sampler ).length, observers = h.observers.length, digests = h.digests.length, requests = h.requests.length;
		for ( let i = 0; i < 2000; i++ ) h.gameTick();
		assert.equal( h.Perf.ticks, 2000 ); assert.equal( h.Perf.gaps, 1999 );
		assert.deepEqual( plain( hits.filter( x => x.inTick ).map( x => x.key ) ), [], "no Diag or Perf call inside a tick" );
		assert.equal( h.digests.length, digests ); assert.equal( h.requests.length, requests );
		assert.equal( h.timers.filter( sampler ).length, timers, "the tick schedules no sampler timer" ); assert.equal( timers, 1 ); assert.equal( h.observers.length, observers );
		assert.equal( h.Perf.tickBins, bins[0] ); assert.equal( h.Perf.gapBins, bins[1] );
		assert.deepEqual( Object.keys( h.Perf ).sort(), fields, "the tick adds no property" );
		assert.ok( h.heapReads.every( read => !read.inTick ) );
	} );
};
