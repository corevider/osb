/*
===========================================================================
lean.obstacle.test.cjs - behavioral pursuit and legal-escape regressions

Receives the integration runner's game fixtures. Exercises the generated
userscript through commands and observed state, with injected query failures.
===========================================================================
*/
const assert = require( "node:assert/strict" );

/*
================
runObstacleTests
================
*/
module.exports = function runObstacleTests( { fixture, combatFixture, navProduct, test } ) {
	/*
  ================
  chase
  ================
  */
	function chase( wall = true ) {
		const f = combatFixture(), target = f.World.ents.get( 30 );
		target.x = 300;
		f.Hunt.running = true;
		f.Hunt.targetGid = 30;
		if ( wall ) {
			f.Navigation.install(
				navProduct( [ {
					x: 0,
					y: 0,
					z: 0,
					yaw: 0,
					mesh: { vertices: [ 200, 0, 0, 200, 0, 500 ], edges: [ 0, 1, 0, 65535, 3, 0 ] }
				} ] )
			);
		}
		return {
			f,
			target,
			ackRelease: true,
			step( ms = 1000 ) {
				f.advance( ms );
				if ( this.ackRelease && f.commands.at( -1 )?.kind === "release-target" ) {
					fresh( f, { ...f.World.pose() } );
				}
				if ( this.ackRelease && f.commands.at( -1 )?.kind === "release-target" ) f.World.gp.target = 0;
				f.Hunt.engage( target );
			}
		};
	}
	/*
  ================
  fresh
  ================
  */
	function fresh( f, pose ) {
		f.World.applyGameplay( { ...f.World.gp, pose: { ...pose } } );
	}
	/*
  ================
  finishAbandon
  ================
  */
	function finishAbandon( c ) {
		for ( let i = 0; i < 8 && !c.f.Hunt.banned( c.f.Hunt.ban, 30 ); i++ ) c.step();
		assert.ok( c.f.Hunt.banned( c.f.Hunt.ban, 30 ) );
		assert.equal( c.f.Hunt.targetGid, 0 );
	}
	/*
  ================
  trapped
  ================
  */
	function trapped() {
		const f = combatFixture();
		f.Hunt.running = true;
		f.Hunt.state = "return";
		f.Hunt.targetGid = 30;
		const blocked = new Uint8Array( 9216 );
		blocked[5 * 96 + 5] = 1;
		f.Navigation.install( navProduct( [], blocked ) );
		fresh( f, { regionId: 1, x: 110, y: 0, z: 110 } );
		f.Trap.request( "test blocked start" );
		return f;
	}
	/*
  ================
  escapeStep
  ================
  */
	function escapeStep( f, ms = 1000 ) {
		f.advance( ms );
		return f.Trap.tick();
	}

	test("obstacle is detoured before any attack, with exclusive movement ownership", () => {
		const c = chase();
		c.step( 0 );
		assert.ok( c.f.Chase.detour );
		assert.equal( c.f.commands.at( -1 ).kind, "move" );
		c.step();
		assert.ok( c.f.commands.every( command => command.kind === "move" ) );
		assert.ok( c.f.commands.at( -1 ).destination.z > 100 );
	});
	test("ordinary terrain height differences do not reject nearby reachable mobs", () => {
		const c = chase( false );
		c.target.y = 50;
		assert.equal( c.f.Navigation.query( c.f.World.pose(), c.target ).status, "direct" );
		c.step( 0 );
		assert.ok( c.f.commands.some( command => command.kind === "skill" ) );
		assert.equal( c.f.Hunt.ban.size, 0 );
	});
	test("an uncertain route failure cannot immediately ban or halt a fresh target", () => {
		const c = chase( false );
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		c.step( 0 );
		assert.ok( c.f.commands.some( command => command.kind === "skill" ) );
		assert.equal( c.f.Chase.owns(), false );
		assert.equal( c.f.Hunt.ban.size, 0 );
		assert.ok( !c.f.commands.some( command => command.kind === "move" ) );
	});
	test("party target remains eligible on sloped ground instead of being skipped for a farther mob", () => {
		const f = combatFixture();
		const nearby = f.World.ents.get( 30 );
		nearby.y = 60;
		f.World.ents.set( 31, { ...nearby, gid: 31, x: 350, y: 0 } );
		f.World.ents.set( 2, { gid: 2, kind: "player", name: "PartyMate" } );
		f.World.gp.social = { localName: "Me", members: [ { id: 2, name: "PartyMate" } ] };
		f.World.onCast( { caster: 2, target: 30, results: [] } );
		f.Hunt.start();
		f.Hunt.tick();
		assert.equal( f.Hunt.targetGid, 30 );
		assert.ok( f.commands.some( command => command.kind === "skill" && command.gid === 30 ) );
		assert.equal( f.Hunt.ban.size, 0 );
	});
	test("native movement progress keeps an imperfect planner from abandoning the target", () => {
		const c = chase( false );
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		c.step( 0 );
		for ( let i = 1; i <= 10; i++ ) {
			fresh( c.f, { ...c.f.World.pose(), x: 100 + i * 10 } );
			c.step( 1000 );
		}
		assert.equal( c.f.Chase.owns(), false );
		assert.equal( c.f.Hunt.ban.size, 0 );
	});
	test("confirmed native hits defeat a false route rejection for the same selected target", () => {
		const c = chase( false );
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		c.step( 0 );
		for ( let token = 1; token <= 8; token++ ) {
			c.f.bus.emit( "cast", {
				caster: 1,
				token,
				skill: 500,
				results: [ { target: 30, impacts: [ { damage: 10 } ] } ]
			} );
			fresh( c.f, c.f.World.pose() );
			c.step( 3000 );
		}
		assert.equal( c.f.Hunt.running, true );
		assert.equal( c.f.Hunt.ban.size, 0 );
		assert.ok( !c.f.commands.some( command => command.kind === "release-target" ) );
	});
	test("stale gameplay alone cannot prove the selected native approach is stuck", () => {
		const c = chase( false );
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		c.step( 0 );
		c.step( 16000 );
		assert.equal( c.f.Chase.owns(), false );
		assert.equal( c.f.Hunt.ban.size, 0 );
	});
	test("one failed mob does not blacklist a different mob beside it", () => {
		const c = chase();
		c.step( 0 );
		c.f.Chase.remember( c.target );
		c.f.Chase.reset();
		const other = { ...c.target, gid: 31 };
		c.f.World.ents.set( 31, other );
		c.f.Hunt.engage( other );
		assert.equal( c.f.Chase.s.gid, 31 );
		assert.equal( c.f.Chase.s.phase, "route" );
		assert.equal( c.f.Hunt.ban.has( 31 ), false );
	});
	test("a complete detour verifies arrival before returning to attacks", () => {
		const c = chase();
		c.step( 0 );
		const route = c.f.Chase.s.route.map( p => ({ ...p }) );
		for ( const pose of route ) {
			fresh( c.f, pose );
			c.step( 600 );
		}
		fresh( c.f, c.f.World.pose() );
		c.step( 600 );
		fresh( c.f, c.f.World.pose() );
		c.step( 600 );
		c.step( 600 );
		assert.equal( c.f.Chase.detour, null );
		assert.ok( c.f.commands.some( command => command.kind === "skill" || command.kind === "attack" ) );
	});
	test("no-route outcome stops and releases a selected target instead of retrying attacks", () => {
		const c = chase();
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		c.step( 0 );
		assert.equal( c.f.Chase.owns(), false );
		fresh( c.f, c.f.World.pose() );
		c.step( 8500 );
		assert.equal( c.f.Chase.s.phase, "abandon" );
		finishAbandon( c );
		assert.ok( c.f.commands.some( command => command.kind === "release-target" ) );
		assert.ok(
			c.f.commands.some( command => command.kind === "skill" ),
			"native approach was tried before abandonment"
		);
	});
	test("failed detours exhaust a bounded episode without same-tick offensive fallback", () => {
		const c = chase();
		c.step( 0 );
		for ( let i = 0; i < 30 && !c.f.Hunt.banned( c.f.Hunt.ban, 30 ); i++ ) c.step();
		assert.ok( c.f.Hunt.banned( c.f.Hunt.ban, 30 ) );
		assert.ok( c.f.commands.every( command => ![ "attack", "skill" ].includes( command.kind ) ) );
	});
	test("unconfirmed release retains ownership then stops without selecting another enemy", () => {
		const c = chase();
		c.ackRelease = false;
		c.f.Navigation.attackRoute = () => ({ status: "unreachable", route: [] });
		for ( let i = 0; i < 22 && c.f.Hunt.running; i++ ) {
			fresh( c.f, c.f.World.pose() );
			c.step();
		}
		assert.equal( c.f.Hunt.running, false );
		const release = c.f.commands.findIndex( command => command.kind === "release-target" );
		assert.ok( release >= 0 );
		assert.ok(
			c.f.commands.slice( release ).every( command => ![ "attack", "skill", "select" ].includes( command.kind ) )
		);
	});
	test("target HP changes and cast announcements do not release a detour", () => {
		const c = chase();
		c.step( 0 );
		c.f.World.hpSeen.set( 30, 50 );
		c.f.bus.emit( "cast", { caster: 1, target: 30, skill: 500, token: 1, results: [] } );
		c.step();
		assert.ok( c.f.Chase.owns() );
		assert.equal( c.f.Chase.hit( 30 ), false );
	});
	test("positive local impacts are deduplicated and foreign damage is excluded", () => {
		const c = chase( false ),
			cast = {
				caster: 1,
				skill: 500,
				token: 10,
				results: [ { target: 30, impacts: [ { stage: 0, damage: 20 } ] } ]
			};
		c.f.bus.emit( "cast", { ...cast, caster: 9 } );
		assert.equal( c.f.Chase.hit( 30 ), false );
		c.f.bus.emit( "cast", cast );
		assert.equal( c.f.Chase.hit( 30 ), true );
		c.f.advance( 9000 );
		c.f.bus.emit( "cast", cast );
		assert.equal( c.f.Chase.hit( 30 ), false );
	});
	test("adjacent target across a thin wall has no distance exemption", () => {
		const c = chase();
		c.target.x = 205;
		fresh( c.f, { regionId: 1, x: 195, y: 0, z: 100 } );
		c.step( 0 );
		assert.ok( c.f.Chase.owns() );
		assert.ok( !c.f.commands.some( command => command.kind === "attack" ) );
	});
	test("missing collision data preserves native combat without a false geometry ban", () => {
		const c = chase();
		c.f.Navigation.scene = null;
		c.step( 0 );
		c.step( 6000 );
		assert.equal( c.f.Hunt.running, true );
		assert.equal( c.f.Chase.owns(), false );
		assert.equal( c.f.Hunt.ban.size, 0 );
	});
	test("planner search exhaustion is distinct from missing coverage", () => {
		const c = chase();
		c.f.Navigation.attackRoute = () => ({ status: "search-limit", route: [] });
		c.step( 0 );
		assert.equal( c.f.Chase.s.phase, "observe" );
		assert.equal( c.f.Hunt.ban.size, 0 );
	});
	test("invalid planner start needs a fresh native stall before escape recovery", () => {
		const f = trapped();
		f.Trap.reset();
		const target = f.World.ents.get( 30 );
		f.Hunt.engage( target );
		assert.equal( f.Trap.run, null );
		fresh( f, f.World.pose() );
		f.advance( 8500 );
		f.Hunt.engage( target );
		assert.ok( f.Trap.run );
	});
	test("disabled detours preserve ordinary combat", () => {
		const c = chase();
		c.f.Settings.profile.hunt.detour.enabled = false;
		c.step( 0 );
		assert.equal( c.f.Chase.owns(), false );
		assert.ok( c.f.commands.some( command => command.kind === "skill" ) );
	});
	test("a clear stand-off leg remains a detour when the monster chord is blocked", () => {
		const c = chase(false);
		c.f.Navigation.install(navProduct([{ x: 0, y: 0, z: 0, yaw: 0,
			mesh: { vertices: [200, 0, 90, 200, 0, 110], edges: [0, 1, 0, 65535, 3, 0] } }]));
		c.f.World.catalog.get(500).range = 125;
		assert.equal(c.f.Navigation.segment(c.f.World.pose(), c.target), false);
		const query = c.f.Navigation.attackRoute(c.f.World.pose(), c.target, 120);
		assert.equal(query.status, "route");
		assert.equal(query.route[0].z, 220);
		c.step(0);
		c.step();
		assert.equal(c.f.Chase.s.phase, "route");
		assert.ok(c.f.commands.at(-1).destination.z > 100);
		assert.ok(c.f.commands.every(command => command.kind === "move"));
	});
	test("controller sends a ranged probe after selecting a fresh target", () => {
		const c = chase();
		c.f.World.catalog.get(500).range = 300;
		c.f.World.gp.target = 0;
		c.f.Controller.tick();
		assert.equal(c.f.commands.at(-1).kind, "select");
		c.f.advance(500);
		c.f.World.applyGameplay({ ...c.f.World.gp, target: 30, targetPending: false });
		c.f.Controller.tick();
		assert.equal(c.f.commands.at(-1).kind, "skill");
		assert.equal(c.f.Chase.s.phase, "probe");
		c.f.advance(500);
		c.f.Controller.tick();
		assert.equal(c.f.commands.filter(command => command.kind === "skill").length, 1);
	});
	test("refused probe sends do not start the damage timeout and admission stays bounded", () => {
		const c = chase();
		c.f.World.catalog.get(500).range = 300;
		const raw = c.f.Cmd.raw;
		c.f.Cmd.raw = () => false;
		c.step(0);
		c.step(2100);
		assert.equal(c.f.Chase.s.phase, "probe");
		assert.equal(c.f.Chase.s.probeAt, null);
		c.f.Cmd.raw = raw;
		c.step(100);
		assert.equal(c.f.commands.at(-1).kind, "skill");
		assert.notEqual(c.f.Chase.s.probeAt, null);
		c.step(2100);
		assert.equal(c.f.Chase.s.phase, "route");
		const refused = chase();
		refused.f.World.catalog.get(500).range = 300;
		refused.f.Cmd.raw = () => false;
		refused.step(0);
		refused.step(5100);
		assert.equal(refused.f.Chase.s.phase, "route");
	});
	test("ranged trial is bounded and successful ranged damage avoids unnecessary walking", () => {
		const c = chase();
		c.f.World.catalog.get( 500 ).range = 300;
		c.step( 0 );
		assert.equal( c.f.commands.at( -1 ).kind, "skill" );
		c.step( 500 );
		assert.equal( c.f.commands.filter( command => command.kind === "skill" ).length, 1 );
		c.f.bus.emit( "cast", {
			caster: 1,
			token: 12,
			skill: 500,
			results: [ { target: 30, impacts: [ { damage: 10 } ] } ]
		} );
		c.step( 500 );
		assert.equal( c.f.Chase.detour, null );
		assert.equal( c.f.Chase.s.phase, "attack" );
	});
	test("a missed ranged trial proceeds to detour rather than trial spam", () => {
		const c = chase();
		c.f.World.catalog.get( 500 ).range = 300;
		c.step( 0 );
		c.step( 2100 );
		assert.ok( c.f.Chase.detour );
		assert.equal( c.f.commands.filter( command => command.kind === "skill" ).length, 1 );
	});
	test("navigation revision and target movement invalidate the retained route", () => {
		const c = chase();
		c.step( 0 );
		c.f.Navigation.revision++;
		c.step();
		assert.equal( c.f.Chase.s.phase, "evaluate" );
		c.step();
		c.target.z += 100;
		c.step();
		assert.equal( c.f.Chase.s.phase, "evaluate" );
	});
	test("failed approach memory expires and changes with collision revision", () => {
		const c = chase();
		c.step( 0 );
		c.f.Chase.remember( c.target );
		c.f.Chase.reset();
		c.step();
		assert.equal( c.f.Chase.s.phase, "abandon" );
		c.f.Navigation.revision++;
		assert.equal( c.f.Chase.repeated( c.target, c.f.World.pose() ), false );
		c.f.Chase.remember( c.target );
		c.f.advance( 16000 );
		assert.equal( c.f.Chase.repeated( c.target, c.f.World.pose() ), false );
	});
	test("refused halt retains chase ownership until admitted", () => {
		const c = chase(), move = c.f.Cmd.move;
		c.f.Cmd.move = () => false;
		c.step( 0 );
		c.step();
		assert.equal( c.f.Chase.s.halted, false );
		c.f.Cmd.move = move;
		c.step();
		assert.equal( c.f.Chase.s.halted, true );
	});
	test("terrain-open escape endpoints behind an object wall are rejected", () => {
		const c = chase();
		const from = { regionId: 1, x: 190, y: 0, z: 100 };
		assert.equal( c.f.Navigation.pointStatus( { ...from, x: 210 } ), "open" );
		assert.equal( c.f.Navigation.segment( from, { ...from, x: 210 }, true ), false );
	});
	test("optional native clip adapter rejects stale, shortened and unknown results", () => {
		const c = chase( false ), from = c.f.World.pose(), to = { ...from, x: 150 };
		for (
			const reply of [ null, { pose: to, epoch: -1, revision: 1 }, {
				pose: from,
				epoch: c.f.World.epoch,
				revision: c.f.Navigation.revision
			} ]
		) {
			c.f.Navigation.setClipQuery( () => reply );
			assert.equal( c.f.Navigation.segment( from, to ), false );
		}
		c.f.Navigation.setClipQuery( q => ({ pose: q.to, epoch: q.epoch, revision: q.revision }) );
		assert.equal( c.f.Navigation.segment( from, to ), true );
		c.f.Navigation.setClipQuery( null );
	});
	test("escape retries locally refused sends without consuming a movement attempt", () => {
		const f = trapped();
		escapeStep( f );
		escapeStep( f );
		const p = f.Trap.run.pending, move = f.Cmd.move;
		f.Cmd.move = () => false;
		escapeStep( f );
		assert.equal( p.sentAt, null );
		assert.equal( f.Trap.run.attempted.length, 1 );
		f.Cmd.move = move;
		escapeStep( f );
		assert.notEqual( p.sentAt, null );
	});
	test("escape requires fresh stable state and a second legal movement step", () => {
		const f = trapped();
		escapeStep( f );
		escapeStep( f );
		escapeStep( f );
		const first = f.Trap.run.pending.to;
		f.World.gp.pose = { ...first };
		escapeStep( f );
		assert.equal( f.Trap.run.verified, false );
		fresh( f, first );
		escapeStep( f );
		escapeStep( f, 600 );
		assert.equal( f.Trap.run.verified, false, "one frozen arrival snapshot does not confirm stability" );
		fresh( f, first );
		escapeStep( f, 600 );
		assert.equal( f.Trap.run.verified, true );
		assert.ok( f.Trap.run.pending );
		escapeStep( f );
		const second = f.Trap.run.pending.to;
		fresh( f, second );
		escapeStep( f );
		fresh( f, second );
		escapeStep( f, 600 );
		assert.equal( f.Trap.run, null );
		assert.equal( f.Hunt.running, true );
		assert.ok( f.Hunt.banned( f.Hunt.ban, 30 ) );
	});
	test("a cast or small correction cannot declare a trapped character free", () => {
		const f = trapped();
		f.World.hitByUs.set( 30, f.World.simNow() );
		fresh( f, { ...f.World.pose(), x: 114 } );
		escapeStep( f );
		assert.ok( f.Trap.run );
		assert.equal( f.Trap.run.verified, false );
	});
	test("escape fails boundedly and recall is off by default", () => {
		const f = trapped();
		for ( let i = 0; i < 50 && f.Hunt.running; i++ ) escapeStep( f );
		assert.equal( f.Hunt.running, false );
		assert.equal( f.Town.trip, null );
	});
	test("optional recall requires readiness and never reverses back into the trap", () => {
		const f = trapped();
		f.Settings.profile.hunt.trap.recall = true;
		f.Town.cfg().enabled = true;
		f.Town.validate = () => "";
		let began = 0;
		f.Town.begin = () => {
			began++;
			f.Town.trip = { phase: "recall" };
		};
		f.Trap.fail( "blocked" );
		assert.equal( began, 1 );
		assert.equal( f.Town.trip.recovery, true );
		f.Town.trip = null;
		f.Trap.request( "blocked again" );
		f.Trap.fail( "blocked" );
		assert.equal( began, 1 );
		assert.equal( f.Hunt.running, false );
	});
	test("a recall trip that does not start still stops hunting", () => {
		const f = trapped();
		f.Settings.profile.hunt.trap.recall = true;
		f.Town.cfg().enabled = true;
		f.Town.validate = () => "";
		f.Town.begin = () => {};
		f.Trap.fail( "blocked" );
		assert.equal( f.Hunt.running, false );
	});
	test("manual takeover, stop and epoch changes discard stale escape movement", () => {
		for (
			const cancel of [ f => f.Manual.lastAt = 200000, f => f.Hunt.stop(), f => {
				f.World.epoch++;
			}, f => f.bus.emit( "reset" ) ]
		) {
			const f = trapped();
			escapeStep( f );
			cancel( f );
			escapeStep( f );
			assert.equal( f.Trap.run, null );
		}
	});
	test("recovery town trip stops before reverse-return dispatch", () => {
		const f = combatFixture();
		f.Hunt.running = true;
		f.Town.cfg().enabled = true;
		f.Town.trip = {
			phase: "reverse",
			recovery: true,
			at: 100000,
			manualAt: f.Manual.lastAt,
			character: f.World.charName,
			config: JSON.stringify( f.Town.cfg() ),
			supplies: []
		};
		f.Town.tick();
		assert.equal( f.Hunt.running, false );
		assert.equal( f.Town.trip, null );
		assert.ok( !f.commands.some( command => command.kind === "travel-gate" ) );
	});
	test("controller keeps emergency potions ahead of obstacle movement", () => {
		const c = chase();
		c.step( 0 );
		const order = [];
		c.f.Potion.tick = () => order.push( "potion" );
		c.f.Chase.tick = () => {
			order.push( "route" );
			return true;
		};
		c.f.Trap.tick = () => false;
		c.f.Controller.tick();
		assert.deepEqual( order, [ "potion", "route" ] );
		assert.equal( c.f.Controller.mode, "obstacle pursuit" );
	});
	test("unknown map has no guessed escape endpoint and details stay opt-in", () => {
		const f = trapped();
		f.Navigation.scene = null;
		assert.equal( f.Trap.blockedAt( f.World.pose() ), "unknown" );
		assert.equal( f.Trap.nearestOpen( f.World.pose() ), null );
		assert.equal( f.Trap.trace.length, 0 );
	});
	test("outdoor-only routing does not stop dungeon combat", () => {
		const c = chase( false );
		fresh( c.f, { regionId: 0x8001, x: 100, y: 0, z: 100 } );
		c.target.regionId = 0x8001;
		c.step( 0 );
		assert.equal( c.f.Chase.owns(), false );
		assert.ok( c.f.commands.some( command => command.kind === "skill" ) );
		c.f.Trap.tick();
		c.f.advance( 30000 );
		c.f.Trap.tick();
		assert.equal( c.f.Trap.run, null );
		assert.equal( c.f.Hunt.running, true );
	});
	test("searching, resting, casting and successful offense do not trigger idle recovery", () => {
		for (
			const setup of [
				f => f.Hunt.state = "search",
				f => f.World.isSitting = () => true,
				f => f.World.isCasting = () => true
			]
		) {
			const f = combatFixture();
			f.Hunt.running = true;
			setup( f );
			for ( let i = 0; i < 10; i++ ) {
				f.advance( 5000 );
				f.Trap.tick();
			}
			assert.equal( f.Trap.run, null );
		}
	});
};
