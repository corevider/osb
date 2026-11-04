/*
===========================================================================
lean-trap.js - bounded recovery using legal, observed movement

Owns escape admission, reverse breadcrumbs and a second move that confirms
freedom. A local send or a cast timestamp is never proof of escape.
===========================================================================
*/
const TRAP_LIMIT = {
	admission: 5000,
	motion: 6000,
	verify: 500,
	crumbs: 32,
	candidates: 4,
	arrive: 7,
	progress: 8,
	recallCooldown: 300000
};

/*
================
Trap
================
*/
const Trap = {
	crumbs: [],
	idle: null,
	stage: 0,
	at: 0,
	from: null,
	tile: "unknown",
	message: "",
	lastBreadcrumbAt: -Infinity,
	run: null,
	lastRecallAt: -Infinity,
	trace: [],
	/*
  ================
  cfg
  ================
  */
	cfg() {
		return Settings.profile.hunt.trap;
	},
	/*
  ================
  walking
  ================
  */
	walking() {
		return [ "fight", "return", "loot" ].includes( Hunt.state ) && !World.isCasting() && !World.isSitting();
	},
	/*
  ================
  busy
  ================
  */
	busy() {
		return !!(Town.trip || WalkBack.active || Resurrect.trip || Restock.trip || Restock.recording ||
			BuffGear.run || Alchemy.run || World.gp?.storage || Restock.activeShop());
	},
	/*
  ================
  reset
  ================
  */
	reset( clearCrumbs = false ) {
		this.idle = null;
		this.stage = 0;
		this.from = null;
		this.run = null;
		if ( clearCrumbs ) this.crumbs = [];
	},
	/*
  ================
  record

  Local, opt-in diagnostic detail. Ordinary report uploads do not include poses.
  ================
  */
	record( reason ) {
		this.message = reason;
		if ( this.cfg().diagnostics ) {
			this.trace.push( {
				at: now(),
				reason,
				stage: this.stage,
				pose: { ...World.pose() },
				epoch: World.epoch,
				revision: Navigation.revision,
				sent: this.run?.pending?.sentAt ?? null
			} );
			if ( this.trace.length > 64 ) this.trace.shift();
		}
	},
	/*
  ================
  blockedAt
  ================
  */
	blockedAt( pose ) {
		return { open: "no", blocked: "yes", unknown: "unknown" }[Navigation.pointStatus( pose )];
	},
	/*
  ================
  nearestOpen
  ================
  */
	nearestOpen( pose ) {
		return Navigation.escapeCandidates( pose )[0] || null;
	},
	/*
  ================
  stepBack
  ================
  */
	stepBack( pose ) {
		for ( let i = this.crumbs.length - 1; i >= 0; i-- ) {
			const p = this.crumbs[i];
			if (
				p.epoch !== undefined && p.epoch !== World.epoch ||
				p.revision !== undefined && p.revision !== Navigation.revision
			) continue;
			if ( dist2D( pose, p ) >= 8 && dist2D( pose, p ) <= 120 && Navigation.segment( pose, p, true ) ) return p;
		}
		return null;
	},
	/*
  ================
  status
  ================
  */
	status() {
		return this.stage ? this.message : "";
	},
	/*
  ================
  request
  ================
  */
	request( reason ) {
		if ( !this.cfg()?.enabled || this.run ) return;
		const pose = World.pose();
		if ( !pose || !Hunt.running || !World.inWorld() || World.isDead() || this.busy() ) return;
		this.from = { ...pose };
		this.tile = this.blockedAt( pose );
		this.stage = 1;
		this.at = now();
		this.run = {
			epoch: World.epoch,
			revision: Navigation.revision,
			manualAt: Manual.lastAt,
			at: now(),
			phase: "halt",
			pending: null,
			attempted: [],
			retreat: false,
			verified: false,
			gid: Hunt.targetGid || Chase.s?.gid || 0,
			target: Chase.s?.target,
			fresh: null
		};
		Loot.suspend();
		this.record( "Recovering: " + reason );
		Log.warn( this.message );
	},
	/*
  ================
  candidate
  ================
  */
	candidate() {
		const r = this.run, pose = World.pose();
		const crumb = !r.retreat && this.stepBack( pose );
		if ( crumb ) {
			r.retreat = true;
			return crumb;
		}
		this.stage = 2;
		return Navigation.escapeCandidates( pose ).find( p => !r.attempted.some( a => dist2D( a, p ) < 7 ) ) || null;
	},
	/*
  ================
  fail

  Recall is opt-in and delegates to the existing town owner. Hunting is not
  resumed into the same trap without a completed legal trip and approach ban.
  ================
  */
	fail( reason ) {
		const r = this.run;
		if ( r?.gid ) Hunt.ban.set( r.gid, now() + CHASE_LIMIT.ban );
		const recall = this.cfg().recall && now() - this.lastRecallAt >= TRAP_LIMIT.recallCooldown &&
			Town.cfg().enabled && !Town.validate();
		this.record( "Trapped: " + reason );
		Log.warn( this.message );
		Sound.play( "pet-full" );
		this.reset( true );
		Chase.reset();
		if ( recall ) {
			this.lastRecallAt = now();
			Town.begin();
			// A recovery trip ends in town. Automatically reversing would reenter
			// the same blocked origin, so this safety trip never spends a reverse.
			if ( Town.trip ) {
				Town.trip.recovery = true;
				return;
			}
		}
		Hunt.stop( "character cannot move (trapped): " + reason );
	},
	/*
  ================
  free
  ================
  */
	free() {
		const r = this.run;
		if ( r?.gid ) Hunt.ban.set( r.gid, now() + CHASE_LIMIT.ban );
		if ( Chase.s && r?.target ) Chase.remember( r.target );
		Hunt.targetGid = 0;
		this.record( "Free again: two movement steps confirmed." );
		Log.info( this.message );
		Chase.reset();
		this.reset( true );
	},
	/*
  ================
  tick
  ================
  */
	tick() {
		const t = now(), pose = World.pose();
		if ( !this.cfg()?.diagnostics ) this.trace = [];
		if (
			!this.cfg()?.enabled || !Hunt.running || !World.inWorld() || World.isDead() || this.busy() ||
			now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000
		) {
			this.reset();
			return false;
		}
		if ( !pose ) return false;
		if ( pose.regionId & DUNGEON ) {
			this.reset( true );
			return false;
		}
		if ( !this.run ) {
			if (
				Navigation.pointStatus( pose ) === "open" && t - this.lastBreadcrumbAt >= 500 &&
				(!this.crumbs.length || dist2D( this.crumbs.at( -1 ), pose ) >= 8)
			) {
				this.crumbs.push( { ...pose, epoch: World.epoch, revision: Navigation.revision } );
				this.lastBreadcrumbAt = t;
				if ( this.crumbs.length > TRAP_LIMIT.crumbs ) this.crumbs.shift();
			}
			if ( !this.walking() || Chase.hit( Hunt.targetGid ) ) {
				this.idle = null;
				return false;
			}
			if ( !this.idle || dist2D( this.idle.pose, pose ) > TRAP_LIMIT.progress ) {
				this.idle = { pose: { ...pose }, since: t };
			}
			if ( t - this.idle.since < this.cfg().seconds * 1000 ) return false;
			this.request( "no useful movement or confirmed damage." );
		}
		const r = this.run;
		if ( !r ) return false;
		if ( r.epoch !== World.epoch || r.revision !== Navigation.revision || r.manualAt !== Manual.lastAt ) {
			this.reset( true );
			Chase.reset();
			return true;
		}
		if ( t - r.at > 45000 ) {
			this.fail( "escape episode timed out" );
			return true;
		}
		if ( r.phase === "halt" ) {
			if ( !World.isCasting() && !World.gp?.targetPending && Cmd.move( pose ) ) r.phase = "choose";
			return true;
		}
		if ( World.isCasting() || World.isSitting() || World.gp?.inventoryPending || World.gp?.pendingMoves ) {
			return true;
		}
		let p = r.pending;
		if ( p ) {
			const distance = dist2D( pose, p.to );
			// New gameplay state, an actual admitted send and a stable endpoint are
			// required; old snapshots or one correction cannot complete an escape.
			if (
				p.sentAt !== null && World.gp !== p.state && distance <= TRAP_LIMIT.arrive &&
				Navigation.pointStatus( pose ) === "open"
			) {
				if ( p.arrivedAt === null ) {
					p.arrivedAt = t;
					p.arrivedState = World.gp;
					return true;
				}
				if ( World.gp === p.arrivedState || t - p.arrivedAt < TRAP_LIMIT.verify ) return true;
				if ( r.verified ) {
					this.free();
					return true;
				}
				r.verified = true;
				r.pending = null;
				r.phase = "choose";
			} else {
				p.arrivedAt = null;
				if ( p.sentAt === null ) {
					if ( t - p.at > TRAP_LIMIT.admission ) {
						this.fail( "escape movement could not be admitted" );
						return true;
					}
					if ( Navigation.segment( pose, p.to, true ) && Cmd.move( p.to ) ) {
						p.sentAt = t;
						p.state = World.gp;
						this.record( "Escape move sent; waiting for observed arrival." );
					}
					return true;
				}
				if ( t - p.sentAt < TRAP_LIMIT.motion ) return true;
				r.pending = null;
				r.phase = "choose";
				r.verified = false;
				this.record( "Escape did not reach its endpoint; choosing another legal step." );
			}
		}
		if ( r.attempted.length >= TRAP_LIMIT.candidates ) {
			this.fail( "bounded escape attempts failed" );
			return true;
		}
		const to = this.candidate();
		if ( !to ) {
			this.fail( "no legal escape endpoint is reachable" );
			return true;
		}
		r.attempted.push( { ...to } );
		r.pending = { to: { ...to }, at: t, sentAt: null, state: World.gp, arrivedAt: null };
		this.record(
			r.verified ? "Verifying escape with a second movement step." : "Trying a collision-checked escape step."
		);
		return true;
	}
};
bus.on( "hunt", () => Trap.reset( true ) );
for ( const event of [ "reset", "profile", "character" ] ) {
	bus.on( event, () => {
		Trap.reset( true );
		Trap.trace = [];
	} );
}
Hook.observers.push( command => {
	if ( command?.kind === "gameplay" ) Trap.reset( true );
} );
