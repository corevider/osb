/*
===========================================================================
lean.unique-nests.test.cjs - the unique hunt patrols the game's own nests

The spawn table and names come from simulated asset responses shaped like
the game page's npcpos.json, NPC manifest and textdataname; no game server
or account is involved.
===========================================================================
*/
module.exports = function uniqueNestTests( { test, fixture } ) {
	const assert = require( "node:assert/strict" );
	const plain = v => JSON.parse( JSON.stringify( v ) );
	const POS = "/assets/data/npcpos.json", MANIFEST = "/assets/npc/manifest.json", TEXTS = "/assets/text/textdataname.en.json", QUESTS = "/assets/data/questData.json";
	const DATA = {
		[ MANIFEST ]: { models: {
			a: { refObjId: 2001, codename: "MOB_CH_TIGERWOMAN", kind: "monster" },
			b: { refObjId: 2002, codename: "MOB_OA_URUCHI", kind: "monster" },
			c: { refObjId: 2003, codename: "MOB_KK_ISYUTARU", kind: "monster" },
			d: { refObjId: 2004, codename: "MOB_CH_BANDIT", kind: "monster" },
			e: { refObjId: 2005, codename: "MOB_SD_SANDKING", kind: "monster" },
			g: { refObjId: 2006, codename: "MOB_WC_FROSTLORD", kind: "monster" },
			h: { refObjId: 2007, codename: "MOB_EU_KERBEROS", kind: "monster" },
			i: { refObjId: 2008, codename: "MOB_XX_NONAME", kind: "monster" },
			n: { refObjId: 900, codename: "NPC_CH_SMITH", kind: "npc" },
			x: { codename: "MOB_NO_REF", kind: "monster" },
		} },
		[ POS ]: { rows: [
			"900\t1\t110\t0\t100", "900\t1\t500\t0\t500",
			"2001\t1\t600\t0\t100", "2001\t1\t650\t0\t120", "2001\t1\t1600\t0\t100", "2001\t9\t100\t0\t100",
			"2002\t1\t300\t0\t900",
			"2003\t-32767\t50\t0\t50",
			"2004\t1\t200\t0\t200",
			"2005\t1\t1000\t0\t1000",
			"2006\t1\t1200\t0\t300",
			"2007\t1\t1800\t0\t1800",
			"2008\t1\t5000\t0\t100",
			"9999\t1\t1\t0\t1", "2001\tbad\t1\t0\t1", "bad row",
		] },
		[ TEXTS ]: { entries: { SN_MOB_CH_TIGERWOMAN: "Tiger Girl", SN_MOB_OA_URUCHI: "Urruchi Warlord", SN_MOB_KK_ISYUTARU: "Isyutaru", SN_MOB_CH_BANDIT: "Bandit",
			SN_MOB_SD_SANDKING: "Sand King", SN_MOB_WC_FROSTLORD: "Frost Lord", SN_MOB_EU_KERBEROS: "Cerberus" } },
		[ QUESTS ]: { rows: [ "600\t1\tSN_QNO_CH_SMITH_1" ], textEntries: { SN_QNO_CH_SMITH_1: "A job for the smith" } },
	};
	function setup( { fail = false, storage } = {} ) {
		const f = fixture( undefined, storage );
		f.asked = [];
		f.Icons.request = async ( path, op ) => {
			f.asked.push( path );
			if ( fail || op !== "json" || !DATA[ path ] ) throw new Error( "not found in the game packs" );
			return plain( DATA[ path ] );
		};
		f.run = ( n = 1, ms = 300 ) => { for ( let i = 0; i < n; i++ ) { f.advance( ms ); f.Controller.tick(); } };
		f.texts = () => f.Log.lines.map( l => l.text ).join( "\n" );
		f.names = () => f.UniqueHunt.spots().map( s => s.name );
		return f;
	}
	async function loaded( opts ) {
		const f = setup( opts );
		f.Settings.profile.uniqueNests.on = true;
		await f.UniqueNests.load();
		return f;
	}
	const codes = f => f.UniqueNests.uniques().map( u => u.code );
	function spot( name, x, z = 100 ) { return { name, regionId: 1, x, y: 0, z }; }
	function arrive( f, s ) { f.World.gp.pose = { regionId: 1, x: s.x, y: 0, z: s.z }; f.run(); }
	function seeUnique( f, gid, change ) {
		const e = { gid, kind: "monster", name: "Unique " + gid, rarity: 3, regionId: 1, x: 3000, y: 0, z: 100, appearanceState: [ 0 ], maxHp: 1000, attackFlags: 16, ...change };
		f.World.ents.set( gid, e ); f.bus.emit( "spawn", e ); f.World.ents.delete( gid ); f.bus.emit( "despawn", e );
		return e;
	}

	test( "unique nests: npcpos rows, dungeon regions, the manifest join and names", async () => {
		const f = await loaded();
		assert.deepEqual( plain( f.SpawnData.npcs.get( "NPC_CH_SMITH" ) ), { refObjId: 900, regionId: 1, x: 110, y: 0, z: 100 }, "an NPC keeps its first row" );
		assert.deepEqual( plain( f.SpawnData.points( "MOB_KK_ISYUTARU" ) ), [ { regionId: 0x8001, x: 50, y: 0, z: 50 } ], "a negative dungeon region is masked to 16 bits" );
		assert.equal( f.SpawnData.points( "MOB_CH_TIGERWOMAN" ).length, 4 );
		assert.equal( f.SpawnData.code( 2005 ), "MOB_SD_SANDKING" );
		assert.equal( f.SpawnData.code( 9999 ), "", "a row whose refObjId the manifest does not know is dropped" );
		assert.equal( f.SpawnData.rows, 13, "rows with a bad region or no manifest entry are skipped" );
		assert.equal( f.UniqueNests.name( "MOB_OA_URUCHI" ), "Urruchi Warlord", "names come from textdataname SN_<codename>" );
		assert.equal( f.UniqueNests.name( "MOB_XX_NONAME" ), "MOB_XX_NONAME", "no text: the codename stands in" );
		assert.deepEqual( plain( f.UniqueNests.codesByName( "  sand KING " ) ), [ "MOB_SD_SANDKING" ] );
		assert.deepEqual( plain( f.UniqueNests.nestsOf( "MOB_CH_TIGERWOMAN" ).map( p => [ p.regionId, p.x ] ) ), [ [ 1, 600 ], [ 1, 1600 ], [ 9, 100 ] ], "rows within 40 m are one nest" );
	} );
	test( "unique nests: the quest data reads the same parsed spawn table", async () => {
		const f = await loaded();
		await f.QuestData.ready();
		assert.deepEqual( plain( f.QuestData.giver( 600 ) ), { refObjId: 900, regionId: 1, x: 110, y: 0, z: 100 } );
		assert.equal( f.asked.filter( p => p === POS ).length, 1, "npcpos.json is requested once for both" );
		assert.equal( f.asked.filter( p => p === MANIFEST ).length, 1 );
	} );
	test( "unique nests: the uniques come from the announced symbols, UNIC notices and sightings", async () => {
		const f = setup();
		f.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_UNIC", arguments: [ "Sand King" ], sequence: 1 } );
		f.Settings.profile.uniqueNests.on = true; await f.UniqueNests.load();
		const list = f.UniqueNests.uniques(), by = code => list.find( u => u.code === code );
		assert.deepEqual( plain( by( "MOB_CH_TIGERWOMAN" ) ), { code: "MOB_CH_TIGERWOMAN", name: "Tiger Girl", sources: [ "announced" ], nests: 3 } );
		assert.deepEqual( plain( by( "MOB_OA_URUCHI" ).sources ), [ "announced" ] );
		assert.deepEqual( plain( by( "MOB_KK_ISYUTARU" ).sources ), [ "announced" ] );
		assert.deepEqual( plain( by( "MOB_EU_KERBEROS" ).sources ), [ "built-in" ], "Cerberus has no own symbol and no grade in the data" );
		assert.deepEqual( plain( by( "MOB_SD_SANDKING" ).sources ), [ "notice" ], "a UNIC notice heard before the data loaded is matched by name" );
		assert.equal( by( "MOB_CH_BANDIT" ), undefined, "an ordinary monster is not a unique" );
		assert.equal( by( "MOB_WC_FROSTLORD" ), undefined );
		seeUnique( f, 50, { refObjId: 2006, name: "Frost Lord" } );
		seeUnique( f, 51, { refObjId: 2004, name: "Bandit", rarity: 0 } );
		assert.deepEqual( plain( f.UniqueNests.uniques().find( u => u.code === "MOB_WC_FROSTLORD" ).sources ), [ "seen" ], "a unique seen in view is remembered by its refObjId" );
		assert.equal( codes( f ).includes( "MOB_CH_BANDIT" ), false, "an ordinary monster seen is not" );
		f.bus.emit( "notice", { key: "UIIT_MSG_ANYONE_DEAD_UNIC", arguments: [ "Hero", "Sand King" ], sequence: 2 } );
		assert.equal( f.UniqueNests.known().names.length, 1, "the same name is kept once" );
		const g = await loaded( { storage: f.storage } );
		assert.ok( codes( g ).includes( "MOB_WC_FROSTLORD" ) && codes( g ).includes( "MOB_SD_SANDKING" ), "both survive a reload, on this computer only" );
		assert.ok( [ ...f.storage.keys() ].some( k => /unique:known/.test( k ) ) );
	} );
	test( "unique nests: the picker filters the patrol and none ticked means every known unique", async () => {
		const f = await loaded();
		assert.deepEqual( plain( f.names() ), [ "Tiger Girl nest 1 of 2", "Urruchi Warlord nest 1 of 1", "Tiger Girl nest 2 of 2", "Cerberus nest 1 of 1" ] );
		f.UniqueNests.toggle( "MOB_OA_URUCHI", true );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_OA_URUCHI" ] );
		assert.deepEqual( plain( f.names() ), [ "Urruchi Warlord nest 1 of 1" ] );
		f.UniqueNests.toggle( "MOB_EU_KERBEROS", true );
		assert.deepEqual( plain( f.names() ), [ "Urruchi Warlord nest 1 of 1", "Cerberus nest 1 of 1" ] );
		f.UniqueNests.toggle( "MOB_OA_URUCHI", false ); f.UniqueNests.toggle( "MOB_EU_KERBEROS", false );
		assert.equal( f.names().length, 4, "none ticked again: all" );
		f.Settings.profile.uniqueNests.on = false;
		assert.deepEqual( plain( f.names() ), [], "the switch off: no nests" );
	} );
	test( "unique nests: the patrol order is your spots, then nests nearest-first as a tour, then learned spots", async () => {
		const f = await loaded(), U = f.Settings.profile.unique;
		U.spots = [ spot( "Mine", 100, 1500 ) ]; U.learned = true;
		seeUnique( f, 52, { name: "Old One", x: 3000 } );
		assert.deepEqual( plain( f.names() ), [ "Mine", "Tiger Girl nest 1 of 2", "Urruchi Warlord nest 1 of 1", "Tiger Girl nest 2 of 2", "Cerberus nest 1 of 1", "Old One" ] );
		assert.deepEqual( plain( f.UniqueHunt.spots()[1] ), { regionId: 1, x: 600, y: 0, z: 100, nest: true, code: "MOB_CH_TIGERWOMAN", codes: [ "MOB_CH_TIGERWOMAN" ], name: "Tiger Girl nest 1 of 2" } );
		U.spots = [ spot( "Mine", 610 ) ];
		assert.deepEqual( plain( f.names().slice( 0, 2 ) ), [ "Mine", "Urruchi Warlord nest 1 of 1" ], "a nest within 40 m of your spot is not walked twice" );
		assert.ok( f.names().includes( "Tiger Girl nest 1 of 1" ) );
		U.spots = []; seeUnique( f, 53, { name: "Beside the nest", x: 620 } );
		assert.equal( f.names().includes( "Beside the nest" ), false, "a learned spot beside a nest is not walked twice" );
		f.Settings.profile.uniqueNests.maxM = 100;
		assert.deepEqual( plain( f.UniqueHunt.spots().filter( s => s.nest ).map( s => s.name ) ), [ "Tiger Girl nest 1 of 1", "Urruchi Warlord nest 1 of 1" ], "nests beyond the maximum distance from the start point are left out" );
		f.Settings.profile.uniqueNests.maxM = 1000; f.Settings.profile.uniqueNests.picks = [ "MOB_CH_TIGERWOMAN" ];
		assert.deepEqual( plain( f.UniqueHunt.spots().filter( s => s.nest ).map( s => s.name ) ), [ "Tiger Girl nest 1 of 2", "Tiger Girl nest 2 of 2" ], "the nest 1,536 m away is beyond 1000 m" );
		f.Settings.profile.uniqueNests.maxM = 5000;
		assert.deepEqual( plain( f.UniqueHunt.spots().filter( s => s.nest ).map( s => s.name ) ), [ "Tiger Girl nest 1 of 3", "Tiger Girl nest 2 of 3", "Tiger Girl nest 3 of 3" ] );
		f.Settings.profile.uniqueNests.picks = [ "MOB_KK_ISYUTARU" ];
		assert.deepEqual( plain( f.UniqueHunt.spots().filter( s => s.nest ).map( s => s.name ) ), [], "a nest in a dungeon is unreachable from the field" );
	} );
	test( "unique nests: the mode walks the nests and says where it is going", async () => {
		const f = await loaded(), U = f.Settings.profile.unique;
		U.waitS = 20;
		f.UniqueHunt.start();
		assert.match( f.texts(), /Unique hunt started: patrolling 4 spots, 4 of them unique nests\./ );
		assert.match( f.UniqueHunt.status(), /^Patrolling: walking to Tiger Girl nest 1 of 2\.$/ );
		assert.equal( plain( f.WalkBack.active.destination ).x, 600 );
		arrive( f, { x: 600, z: 100 } );
		assert.match( f.UniqueHunt.status(), /^Patrolling: Tiger Girl nest 1 of 2, waiting 20 s\.$/ );
		f.run( 21, 1000 );
		assert.match( f.UniqueHunt.status(), /walking to Urruchi Warlord nest 1 of 1/ );
		f.UniqueHunt.stop( "stopped by you" );
		f.Settings.profile.uniqueNests.picks = [ "MOB_KK_ISYUTARU" ];
		f.UniqueHunt.start();
		assert.match( f.UniqueHunt.status(), /^Waiting at the start point: no patrol spots saved and no chosen unique nest within 1000 m\.$/ );
	} );
	test( "unique nests: an appeared notice moves that unique's nests to the front, matched by identity", async () => {
		const f = await loaded();
		f.Settings.profile.unique.waitS = 60;
		f.UniqueHunt.start(); arrive( f, { x: 600, z: 100 } ); f.run( 61, 1000 );
		arrive( f, { x: 300, z: 900 } ); f.run( 61, 1000 );
		assert.match( f.UniqueHunt.status(), /walking to Tiger Girl nest 2 of 2/ );
		arrive( f, { x: 1600, z: 100 } );
		f.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_URRUCHI", arguments: [], sequence: 1 } );
		f.run();
		assert.match( f.texts(), /the game says Uruchi appeared; patrolling its spot first/, "the symbol's codename finds the nest named Urruchi Warlord" );
		assert.match( f.UniqueHunt.status(), /walking to Urruchi Warlord nest 1 of 1/, "instead of Cerberus, next in the normal order" );
		f.bus.emit( "notice", { key: "UIIT_MSG_DEAD_URRUCHI", arguments: [], sequence: 2 } );
		assert.equal( f.UniqueHunt.active.priority, "" );
		assert.match( f.texts(), /the game says Uruchi was killed; back to the normal patrol order/ );
		const g = await loaded();
		g.Settings.profile.unique.waitS = 60;
		g.UniqueHunt.start(); arrive( g, { x: 600, z: 100 } );
		g.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_TIGER_GIRL", arguments: [], sequence: 2 } );
		g.run();
		assert.match( g.texts(), /the game says Tiger Girl appeared; patrolling its 2 spots first/ );
		assert.match( g.UniqueHunt.status(), /Tiger Girl nest 1 of 2, waiting 60 s/, "the nearer of its nests first" );
		g.run( 61, 1000 );
		assert.match( g.UniqueHunt.status(), /walking to Tiger Girl nest 2 of 2/, "then its other nest, ahead of Urruchi Warlord" );
		arrive( g, { x: 1600, z: 100 } ); g.run( 61, 1000 );
		assert.equal( g.UniqueHunt.active.priority, "", "then the normal order" );
		assert.match( g.UniqueHunt.status(), /walking to Cerberus nest 1 of 1/ );
		g.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_UNIC", arguments: [ "Ghost Rider" ], sequence: 3 } );
		assert.match( g.texts(), /the game says Ghost Rider appeared; no saved spot has its name/, "a name the data does not know" );
		g.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_UNIC", arguments: [ "Sand King" ], sequence: 4 } );
		assert.match( g.texts(), /the game says Sand King appeared; patrolling its spot first/, "a UNIC name the data knows adds that unique's nest" );
		g.run();
		assert.match( g.UniqueHunt.status(), /walking to Sand King nest 1 of 1/ );
	} );
	test( "unique nests: nothing is loaded while the mode is unused, and a failed load falls back with one log line", async () => {
		const f = setup(), U = f.Settings.profile.unique;
		U.spots = [ spot( "Mine", 600 ) ];
		f.UniqueHunt.start(); f.run( 5 ); f.UniqueHunt.status(); f.UniqueHunt.stop( "stopped by you" );
		f.Settings.profile.uniqueNests.on = true;
		f.Hunt.start(); f.run( 5 ); f.Hunt.stop();
		seeUnique( f, 50, { refObjId: 2006 } );
		f.bus.emit( "notice", { key: "UIIT_MSG_APPEAR_UNIC", arguments: [ "Sand King" ], sequence: 1 } );
		f.UniqueHunt.spots(); f.UniqueHunt.mapNests();
		const spawnAsks = () => f.asked.filter( p => p === POS || p === MANIFEST );
		assert.deepEqual( spawnAsks(), [], "no spawn table request until the unique hunt runs with nests on" );
		f.UniqueHunt.start();
		assert.deepEqual( plain( spawnAsks().sort() ), [ MANIFEST, POS ].sort() );
		assert.equal( f.asked.filter( p => p === TEXTS ).length, 1, "the text catalogue is requested once and shared" );
		f.UniqueHunt.stop( "stopped by you" );
		const g = setup( { fail: true } );
		g.Settings.profile.unique.spots = [ spot( "Mine", 100 ) ]; g.Settings.profile.uniqueNests.on = true;
		g.UniqueHunt.start(); await g.UniqueNests.pending;
		g.run( 1000, 300 );
		const warns = g.Log.lines.filter( l => /unique nests could not be loaded/.test( l.text ) );
		assert.equal( warns.length, 1 );
		assert.match( warns[0].text, /patrolling your spots and learned spots only/ );
		assert.ok( g.UniqueHunt.active ); assert.match( g.UniqueHunt.status(), /spot 1 of 1 \(Mine\)/ );
		const asks = g.asked.length;
		g.run( 10, 1000 ); assert.equal( g.asked.length, asks, "no retry within ten minutes" );
	} );
	test( "unique nests: the nests show on the map only when chosen and loaded", async () => {
		const f = setup();
		assert.deepEqual( plain( f.UniqueHunt.mapNests() ), [] );
		f.Settings.profile.uniqueNests.on = true; await f.UniqueNests.load();
		assert.equal( f.UniqueHunt.mapNests().length, 4 );
	} );
	test( "unique nests: the settings persist, travel in share codes and backups, and old files load with the source off", () => {
		const f = setup(), D = f.DEFAULT_PROFILE.uniqueNests;
		assert.deepEqual( plain( D ), { on: false, picks: [], maxM: 1000 } );
		assert.deepEqual( plain( f.botProfile( { unique: { spots: [ spot( "Mine", 600 ) ] } } ).uniqueNests ), plain( D ), "an old file loads with the built-in source off" );
		const saved = f.botProfile( { uniqueNests: { on: true, picks: [ "MOB_OA_URUCHI", "bad code!", "MOB_OA_URUCHI", 5 ], maxM: 1234 } } );
		assert.deepEqual( plain( saved.uniqueNests ), { on: true, picks: [ "MOB_OA_URUCHI" ], maxM: 1200 } );
		assert.equal( f.botProfile( { uniqueNests: { on: "yes", maxM: 99999 } } ).uniqueNests.on, false );
		assert.equal( f.botProfile( { uniqueNests: { maxM: 99999 } } ).uniqueNests.maxM, 5000 );
		f.Settings.profile = saved;
		const shared = JSON.parse( f.ProfileShare.text() ).profile;
		assert.deepEqual( plain( shared.uniqueNests ), { on: true, picks: [ "MOB_OA_URUCHI" ], maxM: 1200 } );
		f.Settings.profile = f.botProfile( null );
		assert.deepEqual( plain( f.ProfileShare.build( shared ).uniqueNests ), { on: true, picks: [ "MOB_OA_URUCHI" ], maxM: 1200 }, "a share code carries the choice" );
		assert.deepEqual( plain( f.botProfile( JSON.parse( JSON.stringify( saved ) ) ).uniqueNests ), plain( saved.uniqueNests ), "a backup round-trips" );
	} );
};
