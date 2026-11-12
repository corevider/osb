/*
===========================================================================
lean.unique.test.cjs - the unique hunt mode

Targets, the chance rule, the patrol, game notices, the kill and how the mode
lives beside the other modes, all against simulated game state.
===========================================================================
*/
module.exports = function uniqueTests( { test, fixture } ) {
	const assert = require( "node:assert/strict" );
	const plain = v => JSON.parse( JSON.stringify( v ) );
	function setup() {
		const f = fixture();
		f.World.rebuildCatalog( [ { id: 500, group: 50, level: 1, name: "Slash", targetRequired: true, mp: 5, cooldownGroup: 0 } ] );
		f.World.gp.skills = [ 500 ];
		f.World.gp.vitals = [ { gid: 1, hp: 100, mp: 100, maxHp: 100, maxMp: 100 } ];
		f.World.gp.skillCooldowns = [];
		f.Settings.profile.macro.rotations.unique = [ { id: 500, group: 50 } ];
		f.Settings.profile.macro.imbueBeforeAttack = false;
		f.Settings.profile.potion.enabled = false;
		f.played = [];
		f.Sound.play = kind => { f.played.push( kind ); return true; };
		f.run = ( n = 1, ms = 300 ) => { for ( let i = 0; i < n; i++ ) { f.advance( ms ); f.Controller.tick(); } };
		f.selected = gid => f.commands.some( c => c.kind === "select" && c.gid === gid );
		f.texts = () => f.Log.lines.map( l => l.text ).join( "\n" );
		return f;
	}
	function mob( f, gid, change = {} ) {
		const e = { gid, kind: "monster", name: "Mob " + gid, refObjId: 700 + gid, regionId: 1, x: 150, y: 0, z: 100, attackFlags: 16, appearanceState: [ 0 ], maxHp: 1000, rarity: 0, ...change };
		f.World.ents.set( gid, e ); f.World.hpSeen.set( gid, e.hp ?? 1000 );
		return e;
	}
	const unique = ( f, gid = 40, change = {} ) => mob( f, gid, { name: "Tiger Girl", rarity: 3, ...change } );
	function engaged( f, gid ) {
		f.World.gp.target = gid;
		f.World.hitByUs.set( gid, f.World.simNow() );
	}
	function hit( f, caster, gid, damage, fatal = false ) {
		f.World.hpSeen.set( gid, Math.max( 0, ( f.World.hpSeen.get( gid ) ?? 0 ) - damage ) );
		const cast = { caster, skill: 500, target: gid, token: Math.random(), results: [ { target: gid, impacts: [ { damage, fatal } ] } ] };
		f.bus.emit( "cast", cast );
	}
	function spot( name, x, z = 100 ) { return { name, regionId: 1, x, y: 0, z }; }
	function arrive( f, s ) { f.World.gp.pose = { regionId: 1, x: s.x, y: 0, z: s.z }; f.run(); }

	test( "unique hunt: only uniques are attacked and an ordinary monster in view is ignored", () => {
		const f = setup(); mob( f, 30 ); f.UniqueHunt.start();
		assert.ok( f.UniqueHunt.active ); assert.equal( f.Hunt.running, true );
		f.run( 5 );
		assert.equal( f.selected( 30 ), false, "the ordinary monster is left alone" );
		assert.match( f.UniqueHunt.status(), /Waiting at the start point/ );
		unique( f, 40 ); f.run( 2 );
		assert.equal( f.selected( 40 ), true, "the unique is selected" );
		assert.match( f.UniqueHunt.status(), /Going for Tiger Girl \(100%\)/ );
		assert.match( f.texts(), /going for Tiger Girl \(100% HP\): nobody else is fighting it/ );
	} );
	test( "unique hunt: a monster that hits us is fought with self-defence on and not with it off", () => {
		let f = setup(); mob( f, 30 ); f.UniqueHunt.start();
		f.World.attackers.set( 30, f.World.simNow() ); f.run( 2 );
		assert.equal( f.selected( 30 ), true );
		f = setup(); f.Settings.profile.unique.selfDefence = false; mob( f, 30 ); f.UniqueHunt.start();
		for ( let i = 0; i < 5; i++ ) { f.World.attackers.set( 30, f.World.simNow() ); f.run(); }
		assert.equal( f.selected( 30 ), false );
	} );
	test( "unique hunt: a monster that hits us on the way interrupts the patrol walk", () => {
		const f = setup(), s = spot( "Far", 1500 ); f.Settings.profile.unique.spots = [ s ];
		f.UniqueHunt.start(); f.run();
		assert.ok( f.WalkBack.active ); assert.match( f.UniqueHunt.status(), /walking to spot 1/ );
		mob( f, 30, { x: 160 } ); f.World.attackers.set( 30, f.World.simNow() ); f.run( 2 );
		assert.equal( f.WalkBack.active, null ); assert.equal( f.selected( 30 ), true );
		f.World.ents.delete( 30 ); f.World.attackers.delete( 30 ); f.World.gp.target = 0; f.run( 2 );
		assert.ok( f.WalkBack.active, "then it walks on to the spot" ); assert.equal( plain( f.WalkBack.active.destination ).x, 1500 );
		const g = setup(); g.Settings.profile.unique.spots = [ s ]; g.Settings.profile.unique.selfDefence = false;
		g.UniqueHunt.start(); g.run();
		mob( g, 30, { x: 160 } ); g.World.attackers.set( 30, g.World.simNow() ); g.run( 2 );
		assert.ok( g.WalkBack.active, "self-defence off: it keeps walking" ); assert.equal( g.selected( 30 ), false );
	} );
	test( "unique hunt: manual control pauses the patrol walk without giving up the spot", () => {
		const f = setup(), s = spot( "Far", 1500 ); f.Settings.profile.unique.spots = [ s ];
		f.UniqueHunt.start(); f.run(); assert.ok( f.WalkBack.active );
		f.Manual.lastAt = f.World.simNow(); f.run( 2 );
		assert.equal( f.WalkBack.active, null, "your own move cancels the walk" );
		assert.equal( f.UniqueHunt.active.fails.size, 0 ); assert.doesNotMatch( f.texts(), /skipped/ );
		f.run( 25 );
		assert.ok( f.WalkBack.active, "after the manual pause it walks on" ); assert.equal( plain( f.WalkBack.active.destination ).x, 1500 );
	} );
	test( "unique hunt: titans are attacked only with the titan option on", () => {
		let f = setup(); mob( f, 45, { name: "Titan", rarity: 5 } ); f.UniqueHunt.start(); f.run( 3 );
		assert.equal( f.selected( 45 ), false );
		f = setup(); f.Settings.profile.unique.titans = true; mob( f, 45, { name: "Titan", rarity: 5 } ); f.UniqueHunt.start(); f.run( 3 );
		assert.equal( f.selected( 45 ), true );
	} );
	test( "unique hunt: a unique outside the hunting area but within the chase distance is chased, and the profile is untouched", () => {
		const f = setup(), H = f.Settings.profile.hunt;
		H.center = { regionId: 1, x: 5000, y: 0, z: 5000 }; H.radius = 100; H.classes.unique = false; H.avoidKs = true;
		const before = JSON.stringify( f.Settings.profile );
		f.UniqueHunt.start(); unique( f, 40, { x: 700 } );
		assert.equal( f.Hunt.inArea( f.World.ents.get( 40 ) ), true, "the mode measures from where it is" );
		f.run( 3 );
		assert.equal( f.selected( 40 ), true );
		f.UniqueHunt.stop( "stopped by you" );
		assert.equal( JSON.stringify( f.Settings.profile ), before );
		assert.equal( f.Hunt.cfg(), H ); assert.equal( f.Hunt.running, false );
		assert.equal( f.Hunt.inArea( f.World.ents.get( 40 ) ), false );
	} );
	test( "unique hunt: while it runs uniques are preferred and the other classes avoided; after it the player's own choices are back", () => {
		const f = setup(), H = f.Settings.profile.hunt;
		Object.assign( H.classModes, { normal: "prefer", champion: "ignore", unique: "avoid", titan: "ignore" } );
		const before = JSON.stringify( H.classModes );
		f.UniqueHunt.start(); unique( f, 40, { x: 400 } ); mob( f, 30, { x: 130 } );
		const M = f.Hunt.cfg().classModes;
		assert.equal( M.unique, "prefer" ); assert.equal( M.titan, "avoid", "titans only when the unique hunt takes them" );
		assert.ok( [ "normal", "champion", "party", "giant", "partyChampion", "partyGiant", "elite" ].every( k => M[ k ] === "avoid" ) );
		assert.equal( f.Hunt.cfg().classes.unique, true ); assert.equal( f.Hunt.cfg().classes.normal, false, "the old switches match" );
		assert.equal( f.Hunt.classAllowed( f.World.ents.get( 30 ) ), false ); assert.equal( f.Hunt.classAllowed( f.World.ents.get( 40 ) ), true );
		f.UniqueHunt.stop( "stopped by you" );
		f.Settings.profile.unique.titans = true; f.UniqueHunt.start();
		assert.equal( f.Hunt.cfg().classModes.titan, "prefer", "titans taken" );
		f.UniqueHunt.stop( "stopped by you" );
		assert.equal( f.Hunt.cfg(), H ); assert.equal( JSON.stringify( H.classModes ), before );
		assert.equal( f.Hunt.classMode( f.World.ents.get( 30 ) ), "prefer" ); assert.equal( f.Hunt.classAllowed( f.World.ents.get( 40 ) ), false );
	} );
	test( "unique hunt: a unique others brought below the threshold is skipped; one nobody fights is taken", () => {
		let f = setup(); f.UniqueHunt.start();
		unique( f, 40, { hp: 500 } ); f.World.hitByOthers.set( 40, f.World.simNow() );
		mob( f, 61, { kind: "player", name: "Someone" } );
		f.run( 3 );
		assert.equal( f.selected( 40 ), false );
		assert.match( f.texts(), /skipping Tiger Girl \(50% HP\): other players are fighting it and it is below 75% HP/ );
		assert.equal( f.Log.lines.filter( l => /skipping Tiger Girl/.test( l.text ) ).length, 1, "logged once" );
		f = setup(); f.UniqueHunt.start();
		unique( f, 40, { hp: 500 } ); f.run( 2 );
		assert.equal( f.selected( 40 ), true, "nobody else fights it, so it is taken at any HP" );
		f = setup(); f.UniqueHunt.start();
		unique( f, 40, { hp: 900 } ); f.World.hitByOthers.set( 40, f.World.simNow() ); f.run( 2 );
		assert.equal( f.selected( 40 ), true, "above the threshold it is still taken" );
	} );
	test( "unique hunt: gives up when others clearly out-damage us, but never while the unique hits us", () => {
		for ( const hitsUs of [ false, true ] ) {
			const f = setup(); f.UniqueHunt.start();
			unique( f, 40 ); mob( f, 61, { kind: "player", name: "Someone" } );
			f.run( 2 ); engaged( f, 40 );
			for ( let i = 0; i < 12; i++ ) {
				hit( f, 1, 40, 5 ); hit( f, 61, 40, 30 );
				f.World.hitByOthers.set( 40, f.World.simNow() );
				if ( hitsUs ) f.World.attackers.set( 40, f.World.simNow() );
				f.run( 3 );
			}
			if ( hitsUs ) {
				assert.equal( f.Hunt.targetGid, 40, "it hits us, so the fight goes on" );
				assert.doesNotMatch( f.texts(), /giving up/ );
			} else {
				assert.match( f.texts(), /giving up Tiger Girl: others dealt about \d+% of its HP and we \d+%/ );
				assert.notEqual( f.Hunt.targetGid, 40 ); assert.equal( f.UniqueHunt.active.goal, null );
				const selects = f.commands.length; f.run( 3 );
				assert.equal( f.commands.slice( selects ).some( c => c.kind === "select" && c.gid === 40 ), false, "not taken again" );
			}
		}
	} );
	test( "unique hunt: a skipped unique that hits us is fought back", () => {
		const f = setup(); f.UniqueHunt.start();
		unique( f, 40, { hp: 300 } ); f.World.hitByOthers.set( 40, f.World.simNow() ); f.run( 2 );
		assert.equal( f.selected( 40 ), false );
		f.World.attackers.set( 40, f.World.simNow() ); f.run( 2 );
		assert.equal( f.selected( 40 ), true );
	} );
	test( "unique hunt: patrols the spots in order, waits at each and loops", () => {
		const f = setup(), U = f.Settings.profile.unique, a = spot( "First", 600 ), b = spot( "Second", 100, 700 );
		U.spots = [ a, b ]; U.waitS = 20;
		f.UniqueHunt.start();
		assert.match( f.UniqueHunt.status(), /Patrolling: walking to spot 1 of 2 \(First\)/ );
		arrive( f, a );
		assert.match( f.UniqueHunt.status(), /Patrolling: spot 1 of 2 \(First\), waiting 20 s/ );
		f.run( 10, 1000 );
		assert.match( f.UniqueHunt.status(), /spot 1 of 2/, "still waiting" );
		f.run( 11, 1000 );
		assert.match( f.UniqueHunt.status(), /walking to spot 2 of 2/ );
		arrive( f, b ); f.run( 21, 1000 );
		assert.match( f.UniqueHunt.status(), /walking to spot 1 of 2/ ); assert.equal( f.UniqueHunt.active.loops, 1 );
		assert.equal( f.Controller.mode, "unique hunt" );
	} );
	test( "unique hunt: learned sightings are remembered, de-duplicated, patrolled when chosen and cleared", () => {
		const f = setup(), U = f.Settings.profile.unique;
		f.bus.emit( "spawn", unique( f, 40, { x: 900 } ) );
		f.bus.emit( "spawn", unique( f, 41, { x: 950 } ) );
		f.bus.emit( "spawn", unique( f, 42, { name: "Uruchi", x: 3000 } ) );
		assert.deepEqual( plain( f.UniqueHunt.seen().map( s => [ s.name, s.count ] ).sort() ), [ [ "Tiger Girl", 2 ], [ "Uruchi", 1 ] ] );
		assert.equal( f.UniqueHunt.spots().length, 0, "learned spots are off by default" );
		U.spots = [ spot( "Mine", 2000 ) ]; U.learned = true;
		assert.equal( f.UniqueHunt.spots().length, 3 ); assert.equal( f.UniqueHunt.spots()[0].name, "Mine" );
		assert.equal( f.UniqueHunt.spots()[1].learned, true );
		U.spots = [ spot( "Mine", 600 ) ];
		assert.deepEqual( plain( f.UniqueHunt.spots().map( s => s.name ) ), [ "Mine", "Uruchi" ], "a learned spot beside one of yours is not walked twice" );
		f.UniqueHunt.clearSeen();
		assert.equal( f.UniqueHunt.seen().length, 0 ); assert.equal( f.UniqueHunt.spots().length, 1 );
		assert.ok( [ ...f.storage.keys() ].some( k => /unique:seen/.test( k ) ) );
	} );
	test( "unique hunt: stops at the time limit", () => {
		const f = setup(); f.Settings.profile.unique.limitM = 5; f.UniqueHunt.start();
		f.run( 1, 4 * 60000 ); assert.ok( f.UniqueHunt.active );
		f.run( 1, 61000 );
		assert.equal( f.UniqueHunt.active, null ); assert.equal( f.Hunt.running, false );
		assert.match( f.UniqueHunt.status(), /Stopped: time limit of 5 min reached/ );
	} );
	test( "unique hunt: a spot that needs a teleport is reached with Travel", () => {
		const f = setup(), s = spot( "Island", 1500 ), calls = [];
		f.Settings.profile.unique.spots = [ s ];
		f.Travel.begin = ( pose, dest, resume ) => { calls.push( { dest: plain( dest ), resume } ); f.Travel.active = { phase: "walk" }; return true; };
		f.UniqueHunt.start();
		assert.deepEqual( calls, [ { dest: { regionId: 1, x: 1500, y: 0, z: 100 }, resume: false } ] );
		assert.equal( f.UniqueHunt.active.walk.kind, "travel" );
		f.run( 2 ); assert.equal( f.UniqueHunt.active.walk.kind, "travel" );
		f.Travel.active = null; arrive( f, s );
		assert.equal( f.UniqueHunt.active.walk, null ); assert.match( f.UniqueHunt.status(), /spot 1 of 1 \(Island\), waiting/ );
	} );
	test( "unique hunt: a spot in another world is skipped, and with none reachable the mode stops", () => {
		const f = setup(); f.Settings.profile.unique.spots = [ { name: "Cave", regionId: 0x8001, x: 10, y: 0, z: 10 } ];
		f.UniqueHunt.start();
		assert.equal( f.UniqueHunt.active, null );
		assert.match( f.texts(), /spot 1 \(Cave\) skipped: it is in another world or dungeon/ );
		assert.match( f.UniqueHunt.status(), /Stopped: no patrol spot can be reached/ );
	} );
	test( "unique hunt: a game notice that a unique appeared sends the patrol to its spot first", () => {
		for ( const [ key, args, name ] of [ [ "UIIT_MSG_APPEAR_TIGER_GIRL", [], "Tiger Girl" ], [ "UIIT_MSG_APPEAR_UNIC", [ "Cerberus" ], "Cerberus" ] ] ) {
			const f = setup(), U = f.Settings.profile.unique, a = spot( "Field", 600 ), b = spot( "Dock", 100, 700 ), c = spot( name + " hill", 900, 900 );
			U.spots = [ a, b, c ]; U.waitS = 60;
			f.UniqueHunt.start(); arrive( f, a );
			f.bus.emit( "notice", { key, arguments: args, sequence: 1 } );
			f.run();
			assert.match( f.UniqueHunt.status(), /walking to spot 3 of 3/ );
			assert.match( f.texts(), new RegExp( "the game says " + name + " appeared; patrolling its spot first" ) );
		}
	} );
	test( "unique hunt: a game notice that the unique was killed ends that chase", () => {
		const f = setup(); f.UniqueHunt.start();
		const e = unique( f, 40 ); f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 100 ); f.run();
		e.appearanceState = [ 2 ]; f.World.hpSeen.set( 40, 0 );
		f.bus.emit( "notice", { key: "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", arguments: [ "Hero" ], sequence: 2 } );
		f.bus.emit( "death", e );
		assert.deepEqual( f.played, [ "uniqueKilled" ], "one chime for one death" );
		assert.match( f.texts(), /Unique killed: Tiger Girl \(by Hero\)\./ );
		const g = setup(), s = spot( "Tiger Girl", 900 ); g.Settings.profile.unique.spots = [ spot( "Field", 600 ), s ];
		g.UniqueHunt.start(); arrive( g, g.Settings.profile.unique.spots[0] );
		g.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_TIGER_GIRL", arguments: [], sequence: 1 } );
		g.bus.emit( "notice", { key: "UIIT_MSG_DEAD_TIGER_GIRL", arguments: [], sequence: 2 } );
		assert.equal( g.UniqueHunt.active.priority, "" );
		assert.match( g.texts(), /the game says Tiger Girl was killed; back to the normal patrol order/ );
	} );
	test( "unique hunt: our unique's death chimes once, another unique's does not, and leaving view is not a kill", () => {
		let f = setup(); f.UniqueHunt.start();
		const ours = unique( f, 40 ), other = unique( f, 41, { name: "Uruchi", x: 400 } );
		f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 200 ); f.run();
		assert.equal( f.selected( 41 ), false, "the nearer unique is the one it goes for" );
		assert.doesNotMatch( f.texts(), /going for Uruchi/ );
		other.appearanceState = [ 2 ]; f.bus.emit( "death", other ); f.bus.emit( "despawn", other ); f.World.ents.delete( 41 );
		assert.deepEqual( f.played, [], "a unique we did not go for plays nothing" );
		hit( f, 1, 40, 800, true );
		ours.appearanceState = [ 2 ]; f.bus.emit( "death", ours ); f.bus.emit( "despawn", ours ); f.World.ents.delete( 40 );
		assert.deepEqual( f.played, [ "uniqueKilled" ] );
		assert.match( f.texts(), /Unique killed: Tiger Girl\./ ); assert.ok( f.notices.includes( "Unique killed: Tiger Girl" ) );
		assert.equal( f.Stats.session.uniques, 1 ); assert.equal( f.Stats.display().uniques, "1" );
		f = setup(); f.UniqueHunt.start();
		const gone = unique( f, 40 ); f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 100 ); f.run();
		f.bus.emit( "despawn", gone ); f.World.ents.delete( 40 ); f.run();
		assert.deepEqual( f.played, [] ); assert.ok( f.UniqueHunt.active ); assert.equal( f.UniqueHunt.active.goal, null );
		assert.match( f.texts(), /lost Tiger Girl \(out of view\); back to patrolling/ );
	} );
	test( "unique hunt: HP zero is a death even before the state changes", () => {
		const f = setup(); f.UniqueHunt.start();
		unique( f, 40 ); f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 100 ); f.run();
		f.World.hpSeen.set( 40, 0 ); f.run();
		assert.deepEqual( f.played, [ "uniqueKilled" ] ); assert.equal( f.UniqueHunt.active.phase, "collect" );
	} );
	test( "unique hunt: after the kill the unique's drops are collected first, then the mode stops", () => {
		const f = setup(); f.UniqueHunt.start();
		const e = unique( f, 40 ); f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 1000, true );
		e.appearanceState = [ 2 ]; f.bus.emit( "death", e ); f.bus.emit( "despawn", e ); f.World.ents.delete( 40 ); f.World.gp.target = 0;
		const near = f.drop( 20, 3436 ); near.x = 120;
		f.advance( 500 );
		const own = f.drop( 21, 3436 ); own.x = 160; own.refObjId = 102; f.bus.emit( "spawn", own );
		assert.equal( f.Loot.choose( "character" ).gid, 21, "the unique's own drop goes first" );
		f.run( 12 );
		const picks = f.commands.filter( c => c.kind === "pickup" );
		assert.equal( picks[0]?.gid, 21 );
		assert.ok( f.UniqueHunt.active, "still collecting" );
		f.World.gp.inventory = [ { slot: 13, refObjId: 102, typeFlags: 3436, quantity: 1 }, { slot: 14, refObjId: 101, typeFlags: 3436, quantity: 1 } ];
		f.World.ents.delete( 21 ); f.World.ents.delete( 20 ); f.bus.emit( "despawn", own ); f.bus.emit( "despawn", near );
		f.run( 20 );
		assert.equal( f.UniqueHunt.active, null ); assert.equal( f.Hunt.running, false );
		assert.match( f.UniqueHunt.status(), /^Stopped: Tiger Girl killed\.$/ );
		f.run( 5 ); assert.equal( f.Hunt.running, false, "it does not start hunting by itself" );
	} );
	test( "unique hunt: collecting has a time limit", () => {
		const f = setup(); f.UniqueHunt.start();
		const e = unique( f, 40 ); f.run( 2 ); engaged( f, 40 ); hit( f, 1, 40, 1000, true );
		e.appearanceState = [ 2 ]; f.bus.emit( "death", e );
		f.Loot.choose = () => f.World.ents.get( 20 ) || null; f.drop( 20, 3436 );
		f.Loot.begin = () => false;
		f.run( 1, 41000 );
		assert.equal( f.UniqueHunt.active, null ); assert.match( f.UniqueHunt.status(), /Tiger Girl killed; drops collected for 40 s/ );
	} );
	test( "unique hunt: F8, Stop all and a death stop it, and it never starts beside another mode", () => {
		let f = setup(); f.UniqueHunt.start(); f.toggleBot( "stopped by you (F8)" );
		assert.equal( f.UniqueHunt.active, null ); assert.equal( f.Hunt.running, false );
		assert.match( f.UniqueHunt.status(), /^Stopped by you \(F8\)\.$/ );
		f = setup(); f.UniqueHunt.start(); f.userStop( "stopped by you (Stop all)" );
		assert.equal( f.UniqueHunt.active, null );
		f = setup(); f.UniqueHunt.start();
		f.World.gp.vitals = [ { gid: 1, hp: 0, mp: 0, maxHp: 100, maxMp: 100 } ]; f.run();
		assert.equal( f.UniqueHunt.active, null ); assert.equal( f.Hunt.running, false );
		assert.match( f.UniqueHunt.status(), /Stopped: the character died/ );
		f = setup(); f.Hunt.start(); f.UniqueHunt.start();
		assert.equal( f.UniqueHunt.active, null ); assert.ok( f.notices.includes( "Stop hunting first." ) );
		f = setup(); f.Trade.run = {}; f.UniqueHunt.start();
		assert.equal( f.UniqueHunt.active, null ); assert.ok( f.notices.includes( "Stop auto trade first." ) );
		f = setup(); f.UniqueHunt.start(); f.UniqueHunt.start();
		assert.ok( f.notices.includes( "The unique hunt is already running." ) );
	} );
	test( "unique hunt: a town trip's walk back returns to the patrol spot and resumes the mode", () => {
		const f = setup(), s = spot( "Field", 600 ); f.Settings.profile.unique.spots = [ s ];
		f.UniqueHunt.start(); arrive( f, s );
		f.World.gp.pose = { regionId: 1, x: 100, y: 0, z: 100 };
		f.WalkBack.start( true );
		assert.ok( f.UniqueHunt.active, "walking back does not end the mode" ); assert.equal( f.Hunt.running, false );
		assert.deepEqual( plain( f.WalkBack.active.destination ), { regionId: 1, x: 600, y: 0, z: 100 } );
		assert.equal( f.Settings.profile.hunt.center.x, 100, "the saved hunting spot is untouched" );
		arrive( f, s );
		assert.equal( f.Hunt.running, true ); assert.ok( f.UniqueHunt.active ); assert.equal( f.WalkBack.active, null );
	} );
	test( "unique hunt: normal hunting is unchanged when the mode is not used", () => {
		const f = setup(); mob( f, 30 ); unique( f, 40, { x: 140 } );
		f.Settings.profile.hunt.classes.unique = false;
		assert.equal( f.Hunt.cfg(), f.Settings.profile.hunt );
		f.Hunt.start(); f.run( 2 );
		assert.equal( f.selected( 30 ), true ); assert.equal( f.selected( 40 ), false );
		assert.equal( f.UniqueHunt.active, null ); assert.equal( f.Controller.mode === "unique hunt", false );
	} );
	test( "unique hunt: settings persist and old files load with defaults", () => {
		const f = setup(), D = f.DEFAULT_PROFILE.unique;
		const old = f.botProfile( { hunt: { radius: 300 } } );
		assert.deepEqual( plain( old.unique ), plain( D ) );
		assert.deepEqual( plain( D ), { spots: [], waitS: 0, learned: false, chase: 800, titans: false, selfDefence: true, skipBelow: 75, limitM: 60, chime: true } );
		const saved = f.botProfile( { unique: { spots: [ spot( "Tiger Girl", 600 ), { name: "bad" }, { name: 5, regionId: 1, x: 1, z: 2 } ], waitS: 9999, learned: true, chase: 1200, titans: true, selfDefence: false, skipBelow: 60, limitM: 30, chime: false } } );
		assert.deepEqual( plain( saved.unique ), { spots: [ spot( "Tiger Girl", 600 ), { name: "", regionId: 1, x: 1, y: 0, z: 2 } ], waitS: 600, learned: true, chase: 1200, titans: true, selfDefence: false, skipBelow: 60, limitM: 30, chime: false } );
		f.Settings.profile = saved;
		assert.equal( f.ProfileShare.strip( saved ).unique.spots.length, 2, "share codes carry the patrol spots" );
		f.World.gp.pose = { regionId: 1, x: 321, y: 0, z: 654 };
		f.Settings.profile = f.botProfile( null ); f.UniqueHunt.addSpot( "  Uruchi  " );
		assert.deepEqual( plain( f.Settings.profile.unique.spots ), [ { name: "Uruchi", regionId: 1, x: 321, y: 0, z: 654 } ] );
		f.UniqueHunt.addSpot(); f.UniqueHunt.moveSpot( 1, -1 );
		assert.deepEqual( plain( f.Settings.profile.unique.spots.map( s => s.name ) ), [ "", "Uruchi" ] );
		f.UniqueHunt.removeSpot( 0 ); assert.equal( f.Settings.profile.unique.spots.length, 1 );
	} );
	test( "unique hunt: the kill chime sounds different from the in-view chime", () => {
		const f = fixture();
		assert.ok( f.Sound.tones.uniqueKilled );
		assert.notDeepEqual( plain( f.Sound.tones.uniqueKilled.notes ), plain( f.Sound.tones.unique.notes ) );
	} );
};
