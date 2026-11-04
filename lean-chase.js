/*
===========================================================================
lean-chase.js - exclusive ownership of blocked combat approaches

Failed routes retain movement until stopped. HP changes and jitter cannot
renew an episode budget; only observed local impacts establish damage.
===========================================================================
*/
const CHASE_LIMIT = {
	send: 900,
	stalled: 3000,
	episode: 15000,
	unknown: 5000,
	verify: 500,
	ban: 60000,
	memory: 15000,
	progress: 8,
	targetMove: 40,
	replans: 2
};
const CHASE_OBSERVE_MS = 8000;

/*
================
Chase
================
*/
const Chase = {
	s: null,
	detour: null,
	message: "",
	detours: 0,
	failures: [],
	hits: new Map(),
	seenHits: new Set(),
	castIds: new WeakMap(),
	nextCastId: 0,
	/*
  ================
  cfg
  ================
  */
	cfg() {
		return Settings.profile.hunt.detour;
	},
	/*
  ================
  reset
  ================
  */
	reset( clear = false ) {
		this.s = this.detour = null;
		if ( clear ) {
			this.failures = [];
			this.hits.clear();
			this.seenHits.clear();
		}
	},
	/*
  ================
  owns
  ================
  */
	owns() {
		return !!this.s && ![ "attack", "observe" ].includes( this.s.phase );
	},
	/*
  ================
  hit
  ================
  */
	hit( gid, since = now() - 8000 ) {
		return (this.hits.get( gid ) ?? -Infinity) >= since;
	},
	/*
  ================
  observe

  Repeated cast publications are not new hits. Party damage cannot cancel a
  detour; a local cast send without positive result impacts proves nothing.
  ================
  */
	observe( cast ) {
		if ( cast.caster !== World.localGid() ) return;
		if ( !this.castIds.has( cast ) ) this.castIds.set( cast, ++this.nextCastId );
		const token = cast.token ?? cast.startedAtMs ?? this.castIds.get( cast );
		for ( const result of cast.results || [] ) {
			for ( const [index, impact] of (result.impacts || []).entries() ) {
				if ( !(impact.damage > 0) ) continue;
				const key = `${token}:${cast.skill}:${result.target}:${impact.stage ?? index}:${impact.damage}`;
				if ( this.seenHits.has( key ) ) continue;
				this.seenHits.add( key );
				this.hits.set( result.target, now() );
			}
		}
		while ( this.seenHits.size > 512 ) this.seenHits.delete( this.seenHits.values().next().value );
		while ( this.hits.size > 256 ) this.hits.delete( this.hits.keys().next().value );
	},
	/*
  ================
  radius

  Unknown weapon reach is not guessed. Authored skills can supply a conservative
  stand-off goal; successful ranged offense is preserved independently.
  ================
  */
	radius( target ) {
		const ranges = Combat.rotation( monsterClass( target ) ).map( e => World.skill( Combat.resolve( e ) ) )
			.filter( s => s?.targetRequired && !s.groundTarget && s.range > 0 ).map( s => s.range );
		return Math.min( 120, ranges.length ? Math.max( 7, Math.min( ...ranges ) - 5 ) : 7 );
	},
	/*
  ================
  canProbe

  Authored range permits one bounded ranged trial, not a new line-of-sight rule.
  ================
  */
	canProbe( target ) {
		const distance = dist2D( World.pose(), target );
		return Combat.rotation( monsterClass( target ) ).some( e => {
			const s = World.skill( Combat.resolve( e ) );
			return s?.targetRequired && !s.groundTarget && s.range >= 60 && s.range >= distance;
		} );
	},
	/*
  ================
  remember
  ================
  */
	remember( target ) {
		this.failures.push( {
			gid: target.gid,
			from: { ...this.s.origin },
			target: { ...target },
			at: now(),
			revision: Navigation.revision,
			epoch: World.epoch
		} );
		if ( this.failures.length > 32 ) this.failures.shift();
	},
	/*
  ================
  repeated

  A short-lived failure describes one approach, never a permanent area ban.
  ================
  */
	repeated( target, from ) {
		this.failures = this.failures.filter( f =>
			now() - f.at < CHASE_LIMIT.memory &&
			f.epoch === World.epoch && f.revision === Navigation.revision
		);
		return this.failures.some( f =>
			f.gid === target.gid && dist2D( f.from, from ) < 40 && dist2D( f.target, target ) < 40
		);
	},
	/*
  ================
  abandon
  ================
  */
	abandon( target, reason ) {
		this.remember( target );
		this.s.phase = "abandon";
		this.s.reason = reason;
		this.s.abandonAt = now();
		this.s.halted = false;
		this.s.released = false;
		this.message = "Blocked target: " + reason + "; stopping its approach.";
		return true;
	},
	/*
  ================
  settle

  A refused or cast-held halt retains ownership rather than resuming attacks.
  ================
  */
	settle() {
		const s = this.s;
		if ( World.isCasting() || World.gp?.targetPending ) return false;
		if ( !s.halted ) {
			if ( Cmd.move( World.pose() ) ) s.halted = true;
			return false;
		}
		return !World.gp?.pendingMoves;
	},
	/*
  ================
  stalled

  A failed simplified query is not proof that native combat cannot proceed.
  Keep ordinary target ownership until fresh state shows no approach or damage.
  ================
  */
	stalled( target ) {
		const s = this.s, t = now(), distance = dist2D( World.pose(), target );
		if ( !s.observation ) s.observation = { at: t, best: distance, state: World.gp };
		const o = s.observation;
		if (
			World.gp.target !== target.gid || World.gp.targetPending || World.isCasting() ||
			World.gp.inventoryPending || this.hit( target.gid, o.at ) || distance < o.best - CHASE_LIMIT.progress
		) {
			o.at = t;
			o.best = distance;
			o.state = World.gp;
		}
		return World.gp !== o.state && t - o.at >= Math.max( CHASE_OBSERVE_MS, this.cfg().stallMs );
	},
	/*
  ================
  observeApproach
  ================
  */
	observeApproach( target ) {
		this.s.phase = "observe";
		this.s.at = now();
		this.detour = null;
		this.stalled( target );
		this.message = "Letting the game approach the selected target; route result is inconclusive.";
		return false;
	},
	/*
  ================
  drive
  ================
  */
	drive( target ) {
		if ( !this.cfg()?.enabled || !Hunt.running || !World.inWorld() || World.isDead() ) {
			this.reset();
			return false;
		}
		const pose = World.pose(), t = now();
		if ( !pose || !Number.isFinite( dist2D( pose, target ) ) ) return false;
		// The admitted bot planner is outdoor-only. Do not disable otherwise valid
		// dungeon combat merely because no outdoor collision scene can cover it.
		if ( pose.regionId & DUNGEON ) {
			this.reset();
			return false;
		}
		let s = this.s;
		if ( !s || s.gid !== target.gid ) {
			s = this.s = {
				gid: target.gid,
				phase: "evaluate",
				at: t,
				origin: { ...pose },
				target: { ...target },
				progressAt: t,
				best: Infinity,
				revision: Navigation.revision,
				epoch: World.epoch,
				replans: 0,
				halted: false,
				route: [],
				index: 0,
				sentAt: -Infinity,
				verifyAt: null
			};
			this.detour = null;
		}
		if ( s.epoch !== World.epoch ) {
			this.reset();
			return true;
		}
		if ( s.phase === "probe" ) {
			if ( s.probeAt !== null && this.hit( target.gid, s.probeAt ) ) {
				s.phase = "attack";
				s.at = t;
				s.checkedAt = t;
				return false;
			}
			// Allow ordinary combat to admit the trial, including preparatory imbues.
			if ( s.probeAt === null && t - s.probeReadyAt < CHASE_LIMIT.unknown ) return false;
			if ( s.probeAt !== null && t - s.probeAt < 2000 ) return true;
			s.phase = "evaluate";
		}
		if ( s.phase === "abandon" ) {
			if ( t - s.abandonAt > CHASE_LIMIT.episode ) {
				Hunt.stop( "Blocked approach could not be stopped safely." );
				return true;
			}
			if ( !this.settle() ) return true;
			if ( World.gp.target === target.gid ) {
				if ( !s.released && Cmd.release() ) {
					s.released = true;
					s.releaseAt = t;
				} else if ( s.released && t - s.releaseAt > CHASE_LIMIT.unknown ) {
					Hunt.stop( "Blocked target release was not confirmed." );
				}
				return true;
			}
			Hunt.ban.set( target.gid, t + CHASE_LIMIT.ban );
			Hunt.targetGid = 0;
			this.message = "Dropped blocked target: " + s.reason;
			Log.warn( this.message );
			this.reset();
			return true;
		}
		if ( s.phase === "attack" && this.hit( target.gid ) && !this.detour ) {
			s.at = t;
			return false;
		}
		const observedStall = s.phase === "observe" && this.stalled( target );
		if ( s.phase === "observe" && !observedStall ) return false;
		if ( t - s.at > CHASE_LIMIT.episode ) return this.abandon( target, "approach timed out" );
		if ( s.phase === "attack" && t - s.checkedAt < this.cfg().stallMs ) return false;
		if ( [ "evaluate", "unknown", "attack", "observe" ].includes( s.phase ) ) {
			const query = Navigation.attackRoute( pose, target, this.radius( target ) );
			s.checkedAt = t;
			if ( query.status === "unknown" ) {
				return this.observeApproach( target );
			}
			if ( query.status === "invalid-start" ) {
				if ( !observedStall ) return this.observeApproach( target );
				if ( !Trap.cfg()?.enabled ) return this.abandon( target, "blocked start; escape recovery is disabled" );
				Trap.request( "Current position is blocked." );
				return true;
			}
			if ( query.status === "direct" ) {
				if ( s.phase === "attack" && World.gp.target === target.gid && !World.isCasting() ) {
					const distance = dist2D( pose, target );
					if ( distance < s.best - CHASE_LIMIT.progress ) {
						s.best = distance;
						s.at = t;
					} else if ( t - s.at >= Math.max( this.cfg().stallMs * 2, CHASE_LIMIT.stalled ) ) {
						return this.abandon( target, "native approach made no progress" );
					}
				}
				s.phase = "attack";
				s.halted = false;
				return false;
			}
			if ( !s.probed && this.canProbe( target ) ) {
				if ( World.gp.target !== target.gid || World.gp.targetPending ) {
					Cmd.select( target.gid );
					return true;
				}
				if ( World.isCasting() ) return true;
				s.probed = true;
				s.probeReadyAt = t;
				s.probeAt = null;
				s.phase = "probe";
				return false;
			}
			if ( query.status !== "route" ) {
				if ( !observedStall || query.status === "search-limit" ) return this.observeApproach( target );
				return this.abandon(
					target,
					"native approach stalled; planner found no route"
				);
			}
			if ( this.repeated( target, pose ) ) return this.abandon( target, "this approach recently failed" );
			s.phase = "route";
			s.route = query.route;
			s.index = 0;
			s.progressAt = t;
			s.best = Infinity;
			s.target = { ...target };
			s.revision = Navigation.revision;
			this.detour = s;
			this.detours++;
			this.message = "Walking around the obstacle before attacking.";
		}
		if ( !this.settle() ) return true;
		if ( World.isSitting() || World.gp?.inventoryPending ) return true;
		if (
			s.revision !== Navigation.revision || dist2D( s.target, target ) > CHASE_LIMIT.targetMove ||
			t - s.progressAt > CHASE_LIMIT.stalled
		) {
			if ( ++s.replans > CHASE_LIMIT.replans ) return this.abandon( target, "detour made no progress" );
			s.phase = "evaluate";
			s.halted = false;
			this.detour = null;
			return true;
		}
		while ( s.index < s.route.length && dist2D( pose, s.route[s.index] ) <= PURSUIT_NAV.arrive ) {
			s.index++;
			s.progressAt = t;
			s.best = Infinity;
		}
		if ( s.index >= s.route.length ) {
			if ( !Navigation.segment( pose, target ) ) {
				return this.abandon( target, "final attack approach is blocked" );
			}
			if ( World.gp === s.verifyState ) return true;
			s.verifyAt ??= t;
			s.verifyState = World.gp;
			if ( t - s.verifyAt < CHASE_LIMIT.verify ) return true;
			s.phase = "attack";
			s.at = t;
			s.checkedAt = t;
			s.halted = false;
			this.detour = null;
			return true;
		}
		const destination = s.route[s.index], distance = dist2D( pose, destination );
		if ( distance < s.best - CHASE_LIMIT.progress ) {
			s.best = distance;
			s.progressAt = t;
		}
		if ( !Navigation.segment( pose, destination ) ) {
			return this.abandon( target, "next waypoint is no longer reachable" );
		}
		if ( t - s.sentAt >= CHASE_LIMIT.send ) {
			const delta = regionDelta( pose, destination ), length = Math.hypot( ...delta );
			const start = Navigation.local( pose ), scale = Math.min( 1, PURSUIT_NAV.step / length );
			const step = Navigation.pose( { x: start.x + delta[0] * scale, z: start.z + delta[1] * scale }, pose.y );
			if ( Navigation.segment( pose, step ) && Cmd.move( step ) ) s.sentAt = t;
		}
		return true;
	},
	/*
  ================
  tick
  ================
  */
	tick() {
		if ( !this.owns() ) return false;
		if (
			!Hunt.running || !World.inWorld() || World.isDead() ||
			now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000 ||
			Town.trip || WalkBack.active || Restock.trip || Restock.recording || Restock.activeShop() ||
			World.gp?.storage
		) {
			this.reset();
			return false;
		}
		const target = World.ents.get( this.s.gid );
		if ( !isAttackableMob( target ) ) {
			if ( !this.settle() ) return true;
			this.reset();
			return true;
		}
		Hunt.state = "fight";
		Loot.preparePet();
		if ( Loot.active?.petGid ) Loot.tick();
		else if ( !Loot.active && Hunt.cfg().pickup.enabled && Loot.petMode() ) {
			const drop = Loot.choose( "pet" );
			if ( drop ) Loot.begin( drop );
		}
		return this.drive( target );
	}
};

/*
================
engageWithObstaclePursuit
================
*/
const engageBeforeChase = Hunt.engage;
Hunt.engage = function( target ) {
	if ( Chase.drive( target ) ) return;
	return engageBeforeChase.apply( this, arguments );
};
// Cmd emits this event only after local dispatch succeeds. Selection, buffs and
// refused sends cannot consume the probe's damage observation window.
bus.on( "command", command => {
	const s = Chase.s;
	if ( s?.phase !== "probe" || s.probeAt !== null || command.gid !== s.gid ) return;
	if ( command.kind === "attack" || command.kind === "skill" && World.skill( command.skillId )?.targetRequired ) {
		s.probeAt = now();
	}
});
bus.on( "cast", cast => Chase.observe( cast ) );
bus.on( "hunt", () => Chase.reset() );
for ( const event of [ "reset", "profile", "character" ] ) bus.on( event, () => Chase.reset( true ) );
Hook.observers.push( command => {
	if ( command?.kind === "gameplay" ) Chase.reset();
} );
