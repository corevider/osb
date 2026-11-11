module.exports = function uniqueStateTests( { test, fixture } ) {
	const assert = require( "node:assert/strict" );
	const plain = v => JSON.parse( JSON.stringify( v ) );
	const POS = "/assets/data/npcpos.json", MANIFEST = "/assets/npc/manifest.json", TEXTS = "/assets/text/textdataname.en.json";
	const DATA = {
		[ MANIFEST ]: { models: {
			a: { refObjId: 1954, codename: "MOB_CH_TIGERWOMAN", kind: "monster" },
			b: { refObjId: 1982, codename: "MOB_OA_URUCHI", kind: "monster" },
			h: { refObjId: 5871, codename: "MOB_EU_KERBEROS", kind: "monster" },
		} },
		[ POS ]: { rows: [ "1954\t1\t600\t0\t100", "1954\t1\t1600\t0\t100", "1982\t1\t300\t0\t900", "5871\t1\t1800\t0\t1800" ] },
		[ TEXTS ]: { entries: { SN_MOB_CH_TIGERWOMAN: "Tiger Girl", SN_MOB_OA_URUCHI: "Uruchi", SN_MOB_EU_KERBEROS: "Cerberus" } },
	};
	const MINUTE = 60000;
	function setup( storage ) {
		const f = fixture( undefined, storage );
		f.World.rebuildCatalog( [ { id: 500, group: 50, level: 1, name: "Slash", targetRequired: true, mp: 5, cooldownGroup: 0 } ] );
		f.World.gp.skills = [ 500 ];
		f.World.gp.vitals = [ { gid: 1, hp: 100, mp: 100, maxHp: 100, maxMp: 100 } ];
		f.World.gp.skillCooldowns = [];
		f.Settings.profile.macro.rotations.unique = [ { id: 500, group: 50 } ];
		f.Settings.profile.macro.imbueBeforeAttack = false;
		f.Settings.profile.potion.enabled = false;
		f.played = [];
		f.Sound.play = kind => { f.played.push( kind ); return true; };
		f.Icons.request = async ( path, op ) => { if ( op !== "json" || !DATA[ path ] ) throw new Error( "not found" ); return plain( DATA[ path ] ); };
		f.run = ( n = 1, ms = 300 ) => { for ( let i = 0; i < n; i++ ) { f.advance( ms ); f.Controller.tick(); } };
		f.selected = gid => f.commands.some( c => c.kind === "select" && c.gid === gid );
		f.texts = () => f.Log.lines.map( l => l.text ).join( "\n" );
		f.notice = ( key, args = [] ) => f.bus.emit( "notice", { key, arguments: args, sequence: 1 } );
		return f;
	}
	async function nests( picks = [], storage ) {
		const f = setup( storage );
		Object.assign( f.Settings.profile.uniqueNests, { on: true, picks } );
		await f.UniqueNests.load();
		return f;
	}
	function unique( f, gid = 40, change = {} ) {
		const e = { gid, kind: "monster", name: "Tiger Girl", refObjId: 1954, rarity: 3, regionId: 1, x: 150, y: 0, z: 100, attackFlags: 16, appearanceState: [ 0 ], maxHp: 1000, ...change };
		f.World.ents.set( gid, e ); f.World.hpSeen.set( gid, e.hp ?? 1000 );
		return e;
	}
	function hit( f, gid, damage ) {
		f.World.hitByUs.set( gid, f.World.simNow() );
		f.World.hpSeen.set( gid, Math.max( 0, ( f.World.hpSeen.get( gid ) ?? 0 ) - damage ) );
		f.bus.emit( "cast", { caster: 1, skill: 500, target: gid, token: Math.random(), results: [ { target: gid, impacts: [ { damage } ] } ] } );
	}
	function stopsAfterKill( f, why ) {
		assert.deepEqual( f.played, [ "uniqueKilled" ], why + ": one kill chime" );
		assert.equal( f.UniqueHunt.active?.phase, "collect", why + ": it collects the drops" );
		assert.match( f.texts(), /Tiger Girl counts as our kill/ );
		f.run( 15 );
		assert.equal( f.UniqueHunt.active, null, why + ": then it stops" );
		assert.match( f.UniqueHunt.status(), /^Stopped: Tiger Girl killed\.$/ );
		assert.equal( f.UniqueState.ofCode( "MOB_CH_TIGERWOMAN" )?.state, "dead" );
	}
	const moves = f => f.commands.filter( c => c.kind === "move" || c.kind === "ground-move" ).length;

	test( "unique state: a goal that is dead in view without a death event counts as our kill (2.0.6 dropped it as out of reach)", () => {
		const f = setup(); f.UniqueHunt.start();
		unique( f ); f.run( 2 ); hit( f, 40, 300 ); f.run();
		f.World.ents.set( 40, { ...f.World.ents.get( 40 ), appearanceState: [ 2 ] } );
		f.run();
		assert.doesNotMatch( f.texts(), /lost Tiger Girl/ );
		stopsAfterKill( f, "dead in view" );
	} );

	test( "unique state: a goal that vanishes at low HP right after our hits counts as our kill; one at high HP or long after is lost", () => {
		let f = setup(); f.UniqueHunt.start();
		let e = unique( f ); f.run( 2 ); hit( f, 40, 920 ); f.run();
		f.World.ents.delete( 40 ); f.bus.emit( "despawn", e );
		assert.match( f.texts(), /it vanished at 8% HP right after our hits/ );
		stopsAfterKill( f, "vanished at low HP" );
		f = setup(); f.UniqueHunt.start();
		e = unique( f ); f.run( 2 ); hit( f, 40, 920 ); f.run( 20, 500 );
		f.World.ents.delete( 40 ); f.bus.emit( "despawn", e ); f.run();
		assert.deepEqual( f.played, [] ); assert.match( f.texts(), /lost Tiger Girl \(out of view\)/ );
	} );

	test( "unique state: a DEAD or ANYONE_DEAD notice for our goal counts as our kill, in view or just after it left view", () => {
		let f = setup(); f.UniqueHunt.start();
		let e = unique( f ); f.run( 2 ); hit( f, 40, 920 ); f.run( 20, 500 );
		f.World.ents.delete( 40 ); f.bus.emit( "despawn", e ); f.run();
		assert.match( f.texts(), /lost Tiger Girl \(out of view\)/ );
		f.advance( 5000 ); f.notice( "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", [ "Sample Hero" ] );
		assert.match( f.texts(), /a game notice after it left view/ );
		stopsAfterKill( f, "notice after it left view" );
		f = setup(); f.UniqueHunt.start();
		e = unique( f ); f.run( 2 ); hit( f, 40, 300 ); f.run();
		f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" );
		stopsAfterKill( f, "notice while in view" );
		f = setup(); f.UniqueHunt.start();
		e = unique( f ); f.run( 2 ); hit( f, 40, 300 ); f.run( 20, 500 ); f.World.ents.delete( 40 ); f.bus.emit( "despawn", e ); f.run();
		f.advance( 20000 ); f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" ); f.run();
		assert.deepEqual( f.played, [], "a notice long after the goal was lost is not our kill" ); assert.ok( f.UniqueHunt.active );
	} );

	test( "unique state: a goal we selected that dies before our first hit lands counts as our kill", () => {
		let f = setup(); f.UniqueHunt.start();
		let e = unique( f ); f.run( 2 );
		assert.equal( f.Hunt.targetGid, 40 ); assert.equal( f.World.hitByUs.has( 40 ), false );
		f.run();
		e.appearanceState = [ 2 ]; f.bus.emit( "death", e );
		stopsAfterKill( f, "selected, not yet hit" );
	} );

	test( "unique state: a unique we hit by hand during the manual pause that dies counts as our kill", () => {
		let f = setup(), e; f.UniqueHunt.start(); f.Manual.lastAt = 100000 + 1;
		e = unique( f ); f.advance( 100 ); hit( f, 40, 500 ); f.Controller.tick();
		assert.equal( f.UniqueHunt.active.goal, null, "the manual pause chose nothing" );
		e.appearanceState = [ 2 ]; f.bus.emit( "death", e );
		stopsAfterKill( f, "hit by hand" );
	} );

	test( "unique state: a dead chosen unique is not patrolled; others and unnamed spots are", async () => {
		const f = await nests( [ "MOB_CH_TIGERWOMAN", "MOB_OA_URUCHI" ] );
		f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" );
		f.Settings.profile.unique.spots = [ { name: "Tiger Girl hill", regionId: 1, x: 2000, y: 0, z: 2000 }, { name: "", regionId: 1, x: 100, y: 0, z: 2500 } ];
		f.UniqueHunt.start(); f.run();
		assert.match( f.UniqueHunt.status(), /walking to Uruchi nest 1 of 1|walking to spot 2 of/ );
		const visited = new Set();
		for ( let i = 0; i < 6; i++ ) {
			const a = f.UniqueHunt.active, s = f.UniqueHunt.spots()[ a.index ];
			visited.add( s.name || "unnamed" );
			f.World.gp.pose = { regionId: 1, x: s.x, y: 0, z: s.z }; f.WalkBack.cancel( "", false ); a.walk = null; f.UniqueHunt.arrived( a.index ); a.waitUntil = 0; f.run();
		}
		assert.deepEqual( [ ...visited ].sort(), [ "Uruchi nest 1 of 1", "unnamed" ] );
	} );

	test( "unique state: with every chosen unique dead the character stands still, says why, and APPEAR resumes", async () => {
		const f = await nests( [ "MOB_CH_TIGERWOMAN" ] );
		f.notice( "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", [ "Sample Hero" ] );
		f.advance( 12 * MINUTE );
		f.UniqueHunt.start(); f.run( 10 );
		assert.equal( f.WalkBack.active, null ); assert.equal( moves( f ), 0, "no walking" );
		assert.ok( f.UniqueHunt.active, "the mode keeps running" );
		assert.match( f.UniqueHunt.status(), /^Waiting: Tiger Girl was killed 12 min ago\.$/ );
		assert.match( f.texts(), /waiting here, every chosen unique is dead: Tiger Girl was killed 12 min ago/ );
		f.notice( "UIIT_MSG_APPEAR_TIGER_GIRL" ); f.run();
		assert.match( f.UniqueHunt.status(), /walking to Tiger Girl nest 1 of 2/ ); assert.ok( f.WalkBack.active );
		assert.match( f.texts(), /may be up again; patrolling/ );
	} );

	test( "unique state: a death is trusted for the set time, then the unique is patrolled again", async () => {
		const f = await nests( [ "MOB_CH_TIGERWOMAN" ] );
		assert.equal( f.Settings.profile.uniqueState.deadTrustM, 30, "30 min by default" );
		f.Settings.profile.uniqueState.deadTrustM = 10;
		f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" ); f.UniqueHunt.start(); f.run();
		assert.match( f.UniqueHunt.status(), /^Waiting: Tiger Girl was killed/ );
		f.run( 1, 9 * MINUTE ); assert.match( f.UniqueHunt.status(), /^Waiting: Tiger Girl was killed 9 min ago\./ );
		f.run( 1, MINUTE + 1000 ); assert.match( f.UniqueHunt.status(), /walking to Tiger Girl nest 1 of 2/, "after 10 min it is unknown again" );
		assert.equal( f.UniqueState.ofCode( "MOB_CH_TIGERWOMAN" ), null );
	} );

	test( "unique state: the picker shows killed or alive, sightings and kills feed the state, and newer news wins", async () => {
		const f = await nests();
		const label = code => f.UniqueNests.label( f.UniqueNests.uniques().find( u => u.code === code ) );
		assert.equal( label( "MOB_CH_TIGERWOMAN" ), "Tiger Girl · 2 nests" );
		f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" ); f.advance( 12 * MINUTE );
		assert.equal( label( "MOB_CH_TIGERWOMAN" ), "Tiger Girl · 2 nests · killed 12 min ago" );
		f.notice( "UIIT_MSG_APPEAR_TIGER_GIRL" );
		assert.equal( label( "MOB_CH_TIGERWOMAN" ), "Tiger Girl · 2 nests · alive" );
		f.notice( "UIIT_MSG_APPEAR_UNIC", [ "Cerberus" ] ); assert.equal( label( "MOB_EU_KERBEROS" ), "Cerberus · 1 nest · alive" );
		const e = unique( f, 41, { name: "Uruchi", refObjId: 1982 } ); f.bus.emit( "spawn", e );
		assert.equal( f.UniqueState.ofCode( "MOB_OA_URUCHI" ).source, "seen" ); assert.equal( label( "MOB_OA_URUCHI" ), "Uruchi · 1 nest · alive" );
		e.appearanceState = [ 2 ]; f.bus.emit( "death", e );
		assert.equal( label( "MOB_OA_URUCHI" ), "Uruchi · 1 nest · killed less than a minute ago" );
		f.advance( 90 * MINUTE ); f.notice( "UIIT_MSG_DEAD_TIGER_GIRL" );
		assert.equal( label( "MOB_CH_TIGERWOMAN" ), "Tiger Girl · 2 nests · killed less than a minute ago", "a later death replaces an older state" );
	} );

	test( "unique state: only codenames, states and times are stored, never a player's name, and they survive a reload", async () => {
		const storage = new Map(), f = await nests( [], storage );
		f.notice( "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", [ "Sample Hero" ] );
		f.notice( "UIIT_MSG_ANYONE_DEAD_UNIC", [ "Other Player", "Cerberus" ] );
		f.notice( "UIIT_MSG_DEAD_UNIC", [ "Mystery Beast" ] );
		const raw = storage.get( "sroBotLean:v1:unique:state" ), saved = JSON.parse( raw );
		assert.deepEqual( Object.keys( saved ).sort(), [ "MOB_CH_TIGERWOMAN", "MOB_EU_KERBEROS", "name:Mystery Beast" ] );
		for ( const v of Object.values( saved ) ) assert.deepEqual( Object.keys( v ).sort(), [ "at", "checked", "source", "state" ] );
		for ( const [ key, value ] of storage ) assert.ok( !value.includes( "Sample Hero" ) && !value.includes( "Other Player" ), "no player name in " + key );
		const g = setup( storage );
		assert.equal( g.UniqueState.ofCode( "MOB_CH_TIGERWOMAN" ).state, "dead", "the state survives a reload" );
		storage.set( "sroBotLean:v1:unique:state", JSON.stringify( { "bad key!": { state: "dead", at: 1, source: "notice" }, MOB_X: { state: "zombie", at: 1, source: "notice" } } ) );
		assert.equal( setup( storage ).UniqueState.entries().size, 0, "damaged entries are dropped" );
	} );

	test( "unique state: the trust time persists, is checked, and old files get 30 min", async () => {
		const f = setup();
		assert.equal( f.botProfile( { unique: { waitS: 30 } } ).uniqueState.deadTrustM, 30 );
		assert.equal( f.botProfile( { uniqueState: { deadTrustM: 1 } } ).uniqueState.deadTrustM, 5 );
		assert.equal( f.botProfile( { uniqueState: { deadTrustM: 999 } } ).uniqueState.deadTrustM, 240 );
		f.Settings.profile.uniqueState.deadTrustM = 45; f.Settings.saveProfile();
		const code = await f.ProfileShare.encode( f.ProfileShare.text( true ) ), g = setup();
		g.ProfileShare.pending = await g.ProfileShare.preview( code ); assert.equal( g.ProfileShare.apply(), true );
		assert.equal( g.Settings.profile.uniqueState.deadTrustM, 45 );
		assert.equal( f.botProfile( JSON.parse( JSON.stringify( f.Settings.profile ) ) ).uniqueState.deadTrustM, 45 );
	} );

	function arrive( f, x, z ) { f.World.gp.pose = { regionId: 1, x, y: 0, z }; f.run(); }
	function monster( f, gid, change = {} ) {
		const e = { gid, kind: "monster", name: "Mob " + gid, refObjId: 700, rarity: 0, regionId: 1, x: 650, y: 0, z: 150, attackFlags: 16, appearanceState: [ 0 ], maxHp: 1000, ...change };
		f.World.ents.set( gid, e ); f.World.hpSeen.set( gid, 1000 ); f.bus.emit( "spawn", e );
		return e;
	}

	test( "unique patrol: at a nest with no unique in view the patrol moves on after a short settle", async () => {
		const f = await nests( [ "MOB_CH_TIGERWOMAN", "MOB_OA_URUCHI" ] );
		assert.equal( f.Settings.profile.unique.waitS, 0, "Wait at each spot is 0 by default" );
		f.UniqueHunt.start(); assert.match( f.UniqueHunt.status(), /walking to Tiger Girl nest 1 of 2/ );
		arrive( f, 600, 100 );
		assert.match( f.UniqueHunt.status(), /^Patrolling: Tiger Girl nest 1 of 2, waiting 2 s\.$/ );
		f.run( 5 ); assert.match( f.UniqueHunt.status(), /Tiger Girl nest 1 of 2, waiting/, "still settling 1.5 s after arriving" );
		f.run( 2 ); assert.match( f.UniqueHunt.status(), /walking to Uruchi nest 1 of 1/, "then on, with nothing in view" );
		const g = await nests( [ "MOB_CH_TIGERWOMAN", "MOB_OA_URUCHI" ] );
		g.UniqueHunt.start(); arrive( g, 600, 100 );
		for ( let i = 0; i < 15; i++ ) { monster( g, 80 + i ); g.run( 1 ); }
		assert.match( g.UniqueHunt.status(), /Tiger Girl nest 1 of 2/, "monsters still arriving 4.5 s after arrival: it keeps looking" );
		g.run( 2 ); assert.match( g.UniqueHunt.status(), /walking to Uruchi nest 1 of 1/, "but never longer than 5 s" );
		const h = await nests( [ "MOB_CH_TIGERWOMAN", "MOB_OA_URUCHI" ] );
		h.UniqueHunt.start(); arrive( h, 600, 100 );
		for ( let i = 0; i < 5; i++ ) { monster( h, 80 + i ); h.run( 1 ); }
		h.run( 2 ); assert.match( h.UniqueHunt.status(), /Tiger Girl nest 1 of 2/, "1.8 s after arriving, 0.3 s after the last monster" );
		h.run( 3 ); assert.match( h.UniqueHunt.status(), /walking to Uruchi nest 1 of 1/, "once no monster arrived for 1 s" );
		assert.equal( g.commands.some( c => c.kind === "select" && c.gid >= 80 ), false, "ordinary monsters are not fought" );
	} );

	test( "unique patrol: a unique in view at a nest is taken instead of moving on", async () => {
		const f = await nests( [ "MOB_CH_TIGERWOMAN", "MOB_OA_URUCHI" ] );
		f.UniqueHunt.start(); arrive( f, 600, 100 );
		unique( f, 40, { x: 650, z: 150 } ); f.bus.emit( "spawn", f.World.ents.get( 40 ) ); f.run( 2 );
		assert.equal( f.selected( 40 ), true );
		f.run( 20 );
		assert.match( f.UniqueHunt.status(), /^Going for Tiger Girl/ ); assert.equal( f.WalkBack.active, null );
		const g = await nests( [ "MOB_CH_TIGERWOMAN" ] ); g.Settings.profile.unique.titans = true;
		g.UniqueHunt.start(); arrive( g, 600, 100 );
		monster( g, 45, { name: "Titan", rarity: 5 } ); g.run( 20 );
		assert.equal( g.selected( 45 ), true, "a chosen titan too" ); assert.equal( g.WalkBack.active, null );
	} );

	test( "unique patrol: your own spot with a wait still waits; nests and learned spots never do", async () => {
		const f = await nests( [ "MOB_OA_URUCHI" ] ), U = f.Settings.profile.unique;
		U.spots = [ { name: "Field", regionId: 1, x: 1200, y: 0, z: 1200 } ]; U.waitS = 20;
		f.UniqueHunt.start(); arrive( f, 1200, 1200 );
		assert.match( f.UniqueHunt.status(), /^Patrolling: spot 1 of 2 \(Field\), waiting 20 s\.$/ );
		f.run( 60 ); assert.match( f.UniqueHunt.status(), /spot 1 of 2 \(Field\), waiting/, "18 s later it still waits" );
		f.run( 8 ); assert.match( f.UniqueHunt.status(), /walking to Uruchi nest 1 of 1/ );
		arrive( f, 300, 900 ); assert.match( f.UniqueHunt.status(), /Uruchi nest 1 of 1, waiting 2 s/, "the nest does not take the 20 s" );
		f.storage.set( "sroBotLean:v1:unique:seen", JSON.stringify( [ { name: "Sand King", regionId: 1, x: 3000, y: 0, z: 3000, at: 1, count: 1 } ] ) ); U.learned = true;
		const learned = f.UniqueHunt.spots().findIndex( s => s.learned );
		f.UniqueHunt.active.index = learned - 1; f.UniqueHunt.active.waitUntil = 0; f.run( 8 );
		arrive( f, 3000, 3000 ); assert.match( f.UniqueHunt.status(), /spot 3 of 3 \(Sand King\), waiting 2 s/, "a learned spot only settles" );
	} );

	test( "unique patrol: an old file that saved 30 s still waits 30 s, at your own spots only", async () => {
		const f = await nests( [ "MOB_OA_URUCHI" ] );
		const old = f.botProfile( { unique: { waitS: 30, spots: [ { name: "Field", regionId: 1, x: 1200, y: 0, z: 1200 } ] }, uniqueNests: { on: true, picks: [ "MOB_OA_URUCHI" ] } } );
		assert.equal( old.unique.waitS, 30 );
		assert.equal( f.botProfile( { unique: { learned: true } } ).unique.waitS, 0, "a file without the field gets the new default" );
		f.Settings.profile = old;
		f.UniqueHunt.start(); arrive( f, 1200, 1200 );
		assert.match( f.UniqueHunt.status(), /spot 1 of 2 \(Field\), waiting 30 s/ );
		f.run( 1, 29000 ); assert.match( f.UniqueHunt.status(), /spot 1 of 2 \(Field\), waiting/ );
		f.run( 1, 1500 ); assert.match( f.UniqueHunt.status(), /walking to Uruchi nest/ );
		arrive( f, 300, 900 ); assert.match( f.UniqueHunt.status(), /Uruchi nest 1 of 1, waiting 2 s/ );
	} );
};
