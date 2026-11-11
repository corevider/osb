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
			a: { refObjId: 1954, codename: "MOB_CH_TIGERWOMAN", kind: "monster" },
			b: { refObjId: 1982, codename: "MOB_OA_URUCHI", kind: "monster" },
			c: { refObjId: 2002, codename: "MOB_KK_ISYUTARU", kind: "monster" },
			d: { refObjId: 2004, codename: "MOB_CH_BANDIT", kind: "monster" },
			e: { refObjId: 2005, codename: "MOB_SD_SANDKING", kind: "monster" },
			g: { refObjId: 2006, codename: "MOB_WC_FROSTLORD", kind: "monster" },
			h: { refObjId: 5871, codename: "MOB_EU_KERBEROS", kind: "monster" },
			i: { refObjId: 2008, codename: "MOB_XX_NONAME", kind: "monster" },
			n: { refObjId: 900, codename: "NPC_CH_SMITH", kind: "npc" },
			x: { codename: "MOB_NO_REF", kind: "monster" },
		} },
		[ POS ]: { rows: [
			"900\t1\t110\t0\t100", "900\t1\t500\t0\t500",
			"1954\t1\t600\t0\t100", "1954\t1\t650\t0\t120", "1954\t1\t1600\t0\t100", "1954\t9\t100\t0\t100",
			"1982\t1\t300\t0\t900",
			"2002\t-32767\t50\t0\t50",
			"2004\t1\t200\t0\t200",
			"2005\t1\t1000\t0\t1000",
			"2006\t1\t1200\t0\t300",
			"5871\t1\t1800\t0\t1800",
			"2008\t1\t5000\t0\t100",
			"9999\t1\t1\t0\t1", "1954\tbad\t1\t0\t1", "bad row",
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
		assert.deepEqual( plain( by( "MOB_CH_TIGERWOMAN" ) ), { code: "MOB_CH_TIGERWOMAN", name: "Tiger Girl", sources: [ "announced", "built-in" ], nests: 3 } );
		assert.deepEqual( plain( by( "MOB_OA_URUCHI" ).sources ), [ "announced", "built-in" ] );
		assert.deepEqual( plain( by( "MOB_KK_ISYUTARU" ).sources ), [ "announced", "built-in" ] );
		assert.deepEqual( plain( by( "MOB_EU_KERBEROS" ).sources ), [ "built-in" ], "Cerberus has no own symbol; its refObjId is in the built-in table" );
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
		assert.match( f.UniqueHunt.status(), /^Patrolling: Tiger Girl nest 1 of 2, waiting 2 s\.$/, "a nest only settles; Wait at each spot is for your own spots" );
		f.run( 3, 1000 );
		assert.match( f.UniqueHunt.status(), /walking to Urruchi Warlord nest 1 of 1/ );
		f.UniqueHunt.stop( "stopped by you" );
		f.Settings.profile.uniqueNests.picks = [ "MOB_KK_ISYUTARU" ];
		f.UniqueHunt.start();
		assert.match( f.UniqueHunt.status(), /^Waiting at the start point: no patrol spots saved and no chosen unique nest within 1000 m\.$/ );
	} );
	test( "unique nests: an appeared notice moves that unique's nests to the front, matched by identity", async () => {
		const f = await loaded();
		f.Settings.profile.unique.waitS = 60;
		f.UniqueHunt.start(); arrive( f, { x: 600, z: 100 } ); f.run( 3, 1000 );
		arrive( f, { x: 300, z: 900 } ); f.run( 3, 1000 );
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
		assert.match( g.UniqueHunt.status(), /Tiger Girl nest 1 of 2, waiting 2 s/, "the nearer of its nests first" );
		g.run( 3, 1000 );
		assert.match( g.UniqueHunt.status(), /walking to Tiger Girl nest 2 of 2/, "then its other nest, ahead of Urruchi Warlord" );
		arrive( g, { x: 1600, z: 100 } ); g.run( 3, 1000 );
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
	const TWINS = {
		[ MANIFEST ]: { models: {
			a: { refObjId: 1954, codename: "MOB_CH_TIGERWOMAN", kind: "monster" },
			b: { refObjId: 5871, codename: "MOB_EU_KERBEROS", kind: "monster" },
			c: { refObjId: 3000, codename: "MOB_QU_KERBEROS_COPY", kind: "monster" },
			d: { refObjId: 14778, codename: "MOB_AM_CAPTAINIVY", kind: "monster" },
			e: { refObjId: 9000, codename: "MOB_EV_IVY_COPY", kind: "monster" },
			g: { refObjId: 7002, codename: "MOB_XX_BEAST_B", kind: "monster" },
			h: { refObjId: 7001, codename: "MOB_XX_BEAST_A", kind: "monster" },
			i: { refObjId: 7100, codename: "MOB_XX_LONER", kind: "monster" },
			j: { refObjId: 99999, codename: "MOB_ZZ_NOT_LISTED", kind: "monster" },
			k: { refObjId: 3810, codename: "MOB_TK_BONELORD", kind: "monster" },
		} },
		[ POS ]: { rows: [
			"1954\t1\t600\t0\t100",
			"5871\t1\t400\t0\t400", "5871\t1\t900\t0\t900", "3000\t1\t3000\t0\t3000", "3000\t1\t3200\t0\t3200",
			"14778\t1\t2000\t0\t100", "9000\t1\t2800\t0\t2800",
			"7001\t1\t6000\t0\t6000", "7002\t1\t6100\t0\t6100", "7100\t1\t6200\t0\t6200",
		] },
		[ TEXTS ]: { entries: { SN_MOB_CH_TIGERWOMAN: "Tiger Girl", SN_MOB_EU_KERBEROS: "Cerberus", SN_MOB_QU_KERBEROS_COPY: "Cerberus", SN_MOB_AM_CAPTAINIVY: "Captin Ivy",
			SN_MOB_EV_IVY_COPY: "Captin Ivy", SN_MOB_XX_BEAST_A: "Example Beast", SN_MOB_XX_BEAST_B: "Example Beast", SN_MOB_XX_LONER: "Lone Example", SN_MOB_TK_BONELORD: "Lord Yarkan" } },
	};
	async function twins( storage, rows = [] ) {
		const f = fixture( undefined, storage ), data = plain( TWINS );
		data[ POS ].rows.push( ...rows );
		f.Icons.request = async ( path, op ) => { if ( op !== "json" || !data[ path ] ) throw new Error( "not found" ); return plain( data[ path ] ); };
		f.Settings.profile.uniqueNests.on = true;
		await f.UniqueNests.load();
		f.notice = ( key, args = [] ) => f.bus.emit( "notice", { key, arguments: args, sequence: 1 } );
		f.run = ( n = 1, ms = 300 ) => { for ( let i = 0; i < n; i++ ) { f.advance( ms ); f.Controller.tick(); } };
		f.texts = () => f.Log.lines.map( l => l.text ).join( "\n" );
		return f;
	}
	const rowNames = f => plain( f.UniqueList.rows().map( r => r.name ) );
	const nestCodes = f => [ ...new Set( f.UniqueNests.spots( { regionId: 1, x: 0, y: 0, z: 0 } ).map( s => s.code ) ) ].sort();
	const monsterSpawn = ( gid, name, refObjId, level = 0, x = 1000 ) => ( { gid, kind: "monster", name, refObjId, level, rarity: 3, regionId: 1, x, y: 0, z: x, attackFlags: 16, appearanceState: [ 0 ], maxHp: 1000 } );

	test( "unique identity: two monsters named Cerberus give one row, level 24 and only the nests of refObjId 5871", async () => {
		const f = await twins();
		const rows = f.UniqueList.rows().filter( r => r.name === "Cerberus" );
		assert.equal( rows.length, 1 );
		assert.equal( rows[ 0 ].code, "MOB_EU_KERBEROS", "the table's refObjId wins over the lower refObjId 3000" );
		assert.equal( rows[ 0 ].level, 24 ); assert.equal( rows[ 0 ].nests, 2 );
		assert.equal( f.UniqueNests.uniques().filter( u => u.name === "Cerberus" ).length, 1 );
		f.notice( "UIIT_MSG_APPEAR_UNIC", [ "Cerberus" ] );
		assert.equal( f.UniqueNests.uniques().filter( u => u.name === "Cerberus" ).length, 1, "a UNIC notice adds no second row" );
		assert.deepEqual( plain( f.UniqueNests.identity( "UNIC", "Cerberus" ) ), [ "MOB_EU_KERBEROS" ], "a notice name takes one codename, never all" );
		assert.equal( f.UniqueNests.chosen().includes( "MOB_QU_KERBEROS_COPY" ), false );
		assert.equal( nestCodes( f ).includes( "MOB_QU_KERBEROS_COPY" ), false, "the patrol never walks to the second monster's spawn points" );
		const spots = f.UniqueNests.spots( { regionId: 1, x: 0, y: 0, z: 0 } ).filter( s => s.code === "MOB_EU_KERBEROS" );
		assert.deepEqual( plain( spots.map( s => [ s.x, s.z ] ) ), [ [ 400, 400 ], [ 900, 900 ] ] );
		f.Settings.profile.uniqueNests.maxM = 5000;
		assert.equal( f.UniqueNests.spots( { regionId: 1, x: 0, y: 0, z: 0 } ).some( s => s.x >= 3000 ), false, "no spot of the copy even with a long range" );
	} );

	test( "unique identity: the same for Captin Ivy, refObjId 14778", async () => {
		const f = await twins();
		const rows = f.UniqueList.rows().filter( r => r.name === "Captin Ivy" );
		assert.equal( rows.length, 1 ); assert.equal( rows[ 0 ].code, "MOB_AM_CAPTAINIVY" );
		assert.equal( rows[ 0 ].level, 30 ); assert.equal( rows[ 0 ].nests, 1 );
		f.Settings.profile.uniqueNests.maxM = 5000;
		assert.deepEqual( plain( f.UniqueNests.spots( { regionId: 1, x: 0, y: 0, z: 0 } ).filter( s => /IVY/.test( s.code ) ).map( s => s.code ) ), [ "MOB_AM_CAPTAINIVY" ] );
	} );

	test( "unique identity: the built-in levels order the list with the tracker off, and a sighted unique with no level comes last", async () => {
		const f = await twins();
		assert.equal( f.UniqueTracker.on(), false );
		assert.deepEqual( rowNames( f ), [ "Tiger Girl", "Cerberus", "Captin Ivy", "Lord Yarkan" ] );
		assert.deepEqual( plain( f.UniqueList.rows().map( r => r.level ) ), [ 20, 24, 30, 80 ] );
		f.bus.emit( "spawn", monsterSpawn( 70, "Lone Example", 7100, 0, 1200 ) );
		assert.deepEqual( rowNames( f ), [ "Tiger Girl", "Cerberus", "Captin Ivy", "Lord Yarkan", "Lone Example" ] );
		assert.equal( f.UniqueList.rows()[ 4 ].level, 0 );
	} );

	test( "unique identity: a name that several monsters share takes the one seen as a unique, else the first by refObjId, never all", async () => {
		const f = await twins();
		assert.deepEqual( plain( f.UniqueNests.identity( "UNIC", "Example Beast" ) ), [ "MOB_XX_BEAST_A" ], "no table entry, nothing seen: the lowest refObjId 7001" );
		f.bus.emit( "spawn", monsterSpawn( 71, "Example Beast", 7002, 0, 1100 ) );
		assert.deepEqual( plain( f.UniqueNests.identity( "UNIC", "example beast" ) ), [ "MOB_XX_BEAST_B" ], "the one seen with the unique rarity" );
		f.notice( "UIIT_MSG_APPEAR_UNIC", [ "Example Beast" ] );
		assert.equal( f.UniqueNests.uniques().filter( u => u.name === "Example Beast" ).length, 1 );
		assert.equal( rowNames( f ).filter( n => n === "Example Beast" ).length, 1 );
		assert.deepEqual( plain( f.UniqueNests.identity( "TIGER_GIRL", "Tiger Girl" ) ), [ "MOB_CH_TIGERWOMAN" ], "a symbol resolves through its refObjId" );
		assert.deepEqual( plain( f.UniqueNests.identity( "UNIC", "Nobody Known" ) ), [] );
	} );

	test( "unique identity: a sighting of the second monster is not recorded as the unique, and a refObjId the manifest lacks is not listed", async () => {
		const f = await twins();
		f.bus.emit( "spawn", monsterSpawn( 72, "Cerberus", 3000, 3, 3000 ) );
		assert.equal( f.UniqueState.ofCode( "MOB_EU_KERBEROS" ), null, "the copy does not make the unique alive" );
		assert.equal( f.UniqueState.levelOf( "MOB_EU_KERBEROS" ), 0 );
		assert.equal( f.UniqueState.entries().size, 0 );
		assert.equal( f.UniqueList.rows().filter( r => r.name === "Cerberus" ).length, 1 );
		f.bus.emit( "spawn", monsterSpawn( 73, "Cerberus", 5871, 24, 400 ) );
		assert.equal( f.UniqueState.ofCode( "MOB_EU_KERBEROS" ).state, "alive" );
		assert.equal( rowNames( f ).includes( "Black Tortoise Jeonuk" ), false, "a table refObjId the manifest does not know is not listed" );
	} );

	test( "unique identity: picks, states and levels saved under an extra codename are moved to the resolved one or dropped on load", async () => {
		const storage = new Map(), wall = Date.now();
		const entry = ( state, source, at ) => ( { state, at, checked: at, source } );
		storage.set( "sroBotLean:v1:unique:state", JSON.stringify( {
			MOB_QU_KERBEROS_COPY: entry( "dead", "notice", wall - 60000 ), MOB_EV_IVY_COPY: entry( "alive", "notice", wall - 1000 ), MOB_AM_CAPTAINIVY: entry( "dead", "notice", wall - 90000 ),
			"name:Mystery Beast": entry( "dead", "notice", wall - 1000 ) } ) );
		storage.set( "sroBotLean:v1:unique:levels", JSON.stringify( { MOB_QU_KERBEROS_COPY: 3, MOB_EV_IVY_COPY: 31, MOB_AM_CAPTAINIVY: 30 } ) );
		const f = fixture( undefined, storage );
		f.Icons.request = async ( path, op ) => { if ( op !== "json" || !TWINS[ path ] ) throw new Error( "not found" ); return plain( TWINS[ path ] ); };
		f.Settings.profile.uniqueNests.picks = [ "MOB_QU_KERBEROS_COPY", "MOB_EU_KERBEROS", "MOB_EV_IVY_COPY", "MOB_CH_TIGERWOMAN" ];
		await f.UniqueNests.load();
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_EU_KERBEROS", "MOB_AM_CAPTAINIVY", "MOB_CH_TIGERWOMAN" ], "one pick per unique, in the first order" );
		assert.deepEqual( plain( [ ...f.UniqueState.entries().keys() ].sort() ), [ "MOB_AM_CAPTAINIVY", "MOB_EU_KERBEROS", "name:Mystery Beast" ] );
		assert.equal( f.UniqueState.ofCode( "MOB_EU_KERBEROS" ).state, "dead", "the state moved from the extra codename" );
		assert.equal( f.UniqueState.ofCode( "MOB_AM_CAPTAINIVY" ).state, "alive", "the newer news of the two wins" );
		const stored = JSON.parse( storage.get( "sroBotLean:v1:unique:state" ) );
		assert.equal( Object.keys( stored ).some( k => /COPY/.test( k ) ), false );
		assert.deepEqual( plain( Object.fromEntries( f.UniqueState.levelMap() ) ), { MOB_EU_KERBEROS: 3, MOB_AM_CAPTAINIVY: 30 }, "a level moves when the unique has none, else it is dropped" );
		assert.equal( JSON.parse( storage.get( "sroBotLean:v1:unique:levels" ) ).MOB_QU_KERBEROS_COPY, undefined );
		assert.equal( f.UniqueList.rows().find( r => r.name === "Cerberus" ).level, 24, "the table level wins over a moved level" );
		assert.deepEqual( plain( f.UniqueNests.chosen() ), [ "MOB_EU_KERBEROS", "MOB_AM_CAPTAINIVY", "MOB_CH_TIGERWOMAN" ] );
		assert.equal( f.UniqueList.rows().filter( r => r.ticked ).length, 3 );
	} );

	test( "unique identity: ticking and unticking through an extra codename acts on the resolved unique", async () => {
		const f = await twins();
		f.UniqueNests.toggle( "MOB_QU_KERBEROS_COPY", true );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_EU_KERBEROS" ] );
		f.UniqueNests.toggle( "MOB_QU_KERBEROS_COPY", false );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [] );
	} );

	test( "unique identity: your own spot named after a unique still matches it by name, in any case and as part of a longer name", async () => {
		const f = await twins(), U = f.Settings.profile.unique;
		U.spots = [ spot( "Mine", 100, 100 ), { name: "lord yarkan fertility", regionId: 1, x: 2000, y: 0, z: 2000 } ];
		f.Settings.profile.uniqueNests.picks = [ "MOB_TK_BONELORD" ];
		assert.equal( f.UniqueNests.nestsOf( "MOB_TK_BONELORD" ).length, 1, "the game data has no nest for this unique, only the built-in extra one" );
		f.UniqueHunt.start();
		arrive( f, { x: 100, z: 100 } ); f.run( 8 );
		f.notice( "UIIT_MSG_APPEAR_BONELORD" );
		assert.match( f.texts(), /the game says Lord Yarkan appeared; patrolling its spot first/ );
		f.run();
		assert.match( f.UniqueHunt.status(), /walking to spot 2 of 2 \(lord yarkan fertility\)/ );
		f.UniqueHunt.stop( "stopped by you" );
		const g = await twins(), V = g.Settings.profile.unique;
		V.spots = [ { name: "lord yarkan fertility", regionId: 1, x: 2000, y: 0, z: 2000 } ];
		g.Settings.profile.uniqueNests.picks = [ "MOB_TK_BONELORD" ];
		g.notice( "UIIT_MSG_DEAD_BONELORD" );
		g.UniqueHunt.start(); g.run();
		assert.match( g.UniqueHunt.status(), /^Waiting: Lord Yarkan was killed/, "the chosen unique is dead, so the spot named after it is skipped and nothing is left to walk" );
		const h = await twins(), W = h.Settings.profile.unique;
		W.spots = [ { name: "lord yarkan fertility", regionId: 1, x: 2000, y: 0, z: 2000 }, spot( "Mine", 100, 100 ) ];
		h.notice( "UIIT_MSG_DEAD_BONELORD" );
		h.UniqueHunt.start(); h.run();
		assert.match( h.UniqueHunt.status(), /spot 2 of \d \(Mine\)/, "with nothing ticked the dead unique's named spot is skipped and the other spot is walked" );
	} );
	test( "unique extra nests: Lord Yarkan gets the built-in nest the game data lacks, it is not doubled by a game nest within 40 m, and no other unique gets it", async () => {
		const here = { regionId: 26247, x: 0, y: 0, z: 0 };
		const f = await twins();
		assert.deepEqual( plain( f.UniqueNests.nestsOf( "MOB_TK_BONELORD" ) ), [ { regionId: 26247, x: 84, y: -40, z: 1004 } ] );
		const spots = f.UniqueNests.spots( here );
		assert.deepEqual( plain( spots.map( s => [ s.name, s.regionId, s.x, s.y, s.z, s.code ] ) ), [ [ "Lord Yarkan nest 1 of 1", 26247, 84, -40, 1004, "MOB_TK_BONELORD" ] ], "it follows the T062 rules: the tour, nest k of n and the distance" );
		for ( const code of [ "MOB_CH_TIGERWOMAN", "MOB_EU_KERBEROS", "MOB_AM_CAPTAINIVY", "MOB_XX_BEAST_A" ] ) assert.equal( f.UniqueNests.nestsOf( code ).some( p => p.regionId === 26247 ), false, code + " does not get it" );
		assert.equal( f.UniqueList.rows().find( r => r.name === "Lord Yarkan" ).nests, 1 );
		f.Settings.profile.uniqueNests.maxM = 100;
		assert.deepEqual( plain( f.UniqueNests.spots( { regionId: 26247, x: 5000, y: 0, z: 0 } ) ), [], "beyond the maximum distance it is left out" );
		const g = await twins( undefined, [ "3810	26247	100	0	1000" ] );
		assert.deepEqual( plain( g.UniqueNests.nestsOf( "MOB_TK_BONELORD" ) ), [ { regionId: 26247, x: 100, y: 0, z: 1000 } ], "a game nest within 40 m absorbs it" );
		const h = await twins( undefined, [ "3810	26247	1000	0	1000" ] );
		assert.equal( h.UniqueNests.nestsOf( "MOB_TK_BONELORD" ).length, 2, "a game nest further away is a nest of its own" );
		assert.deepEqual( plain( h.UniqueNests.spots( here ).map( s => s.name ) ), [ "Lord Yarkan nest 1 of 2", "Lord Yarkan nest 2 of 2" ] );
		const i = await twins( undefined, [ "5871	26247	90	0	1000" ] );
		assert.equal( i.UniqueNests.nestsOf( "MOB_EU_KERBEROS" ).some( p => p.x === 84 ), false );
		assert.equal( i.UniqueNests.nestsOf( "MOB_TK_BONELORD" ).length, 1, "another unique's nest beside it does not absorb it" );
	} );
};
