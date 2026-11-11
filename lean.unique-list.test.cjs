module.exports = function uniqueListTests( { test, fixture } ) {
	const assert = require( "node:assert/strict" );
	const plain = v => JSON.parse( JSON.stringify( v ) );
	const DATA = {
		"/assets/npc/manifest.json": { models: {
			a: { refObjId: 1954, codename: "MOB_CH_TIGERWOMAN", kind: "monster" },
			b: { refObjId: 1982, codename: "MOB_OA_URUCHI", kind: "monster" },
			c: { refObjId: 2002, codename: "MOB_KK_ISYUTARU", kind: "monster" },
			h: { refObjId: 5871, codename: "MOB_EU_KERBEROS", kind: "monster" },
			x: { refObjId: 2009, codename: "MOB_XX_EXAMPLEBEAST", kind: "monster" },
		} },
		"/assets/data/npcpos.json": { rows: [ "1954\t1\t600\t0\t100", "1954\t1\t1600\t0\t100", "1982\t1\t300\t0\t900", "2002\t-32767\t50\t0\t50", "5871\t2\t100\t0\t100", "2009\t1\t900\t0\t900" ] },
		"/assets/text/textdataname.en.json": { entries: { SN_MOB_CH_TIGERWOMAN: "Tiger Girl", SN_MOB_OA_URUCHI: "Uruchi", SN_MOB_KK_ISYUTARU: "Isyutaru", SN_MOB_EU_KERBEROS: "Cerberus", SN_MOB_XX_EXAMPLEBEAST: "Example Beast" } },
	};
	async function loaded() {
		const f = fixture();
		f.asked = [];
		f.Icons.request = async ( path, op ) => { f.asked.push( path ); if ( op !== "json" || !DATA[ path ] ) throw new Error( "not found" ); return plain( DATA[ path ] ); };
		await f.UniqueNests.load();
		f.notice = ( key, args = [] ) => f.bus.emit( "notice", { key, arguments: args, sequence: 1 } );
		return f;
	}
	const names = f => plain( f.UniqueList.rows().map( r => r.name ) );

	const sighting = ( f, gid, refObjId, name, level ) => f.bus.emit( "spawn", { gid, kind: "monster", name, refObjId, level, rarity: 3, regionId: 1, x: 150, y: 0, z: 100, attackFlags: 16, appearanceState: [ 0 ], maxHp: 1000 } );
	const texts = f => plain( f.UniqueList.rows().map( r => f.UniqueList.text( r ) ) );
	const read = file => require( "node:fs" ).readFileSync( __dirname + "/" + file, "utf8" );

	test( "unique list: one row per known unique, with state pill, nests and tick; built-in levels order the known uniques", async () => {
		const f = await loaded();
		assert.deepEqual( names( f ), [ "Tiger Girl", "Cerberus", "Uruchi", "Isyutaru" ], "nothing learned yet: built-in levels, lowest first" );
		assert.equal( f.UniqueList.text( f.UniqueList.rows()[ 2 ] ), "Uruchi · Unknown · Lv 40 · 1 nest" );
		f.notice( "UIIT_MSG_APPEAR_URRUCHI" ); f.notice( "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", [ "Sample Hero" ] ); f.notice( "UIIT_MSG_APPEAR_UNIC", [ "Cerberus" ] );
		f.advance( 12 * 60000 );
		const rows = f.UniqueList.rows();
		assert.deepEqual( plain( rows.map( r => r.name ) ), [ "Tiger Girl", "Cerberus", "Uruchi", "Isyutaru" ], "by level, not alive first" );
		assert.deepEqual( texts( f ), [
			"Tiger Girl · Slain · Lv 20 · killed 12 min ago · 2 nests (game announcement)", "Cerberus · Alive · Lv 24 · 1 nest (game announcement)",
			"Uruchi · Alive · Lv 40 · 1 nest (game announcement)", "Isyutaru · Unknown · Lv 60 · 1 nest" ] );
		assert.ok( !JSON.stringify( plain( rows ) ).includes( "Sample Hero" ), "no player name in the list" );
		for ( const [ key, value ] of f.storage ) assert.ok( !value.includes( "Sample Hero" ), "no player name stored under " + key );
		assert.equal( rows.every( r => r.ticked === false ), true );
	} );

	test( "unique list: ordered by level, lowest first, ties and unknown levels by name, unknown last", async () => {
		const f = await loaded();
		f.UniqueTracker.info = new Map( [ [ "MOB_KK_ISYUTARU", { level: 40, map: "", state: "alive", label: "" } ] ] );
		sighting( f, 40, 5871, "Cerberus", 24 );
		assert.deepEqual( names( f ), [ "Tiger Girl", "Cerberus", "Isyutaru", "Uruchi" ], "20, 24, then the 40 tie by name" );
		assert.deepEqual( plain( f.UniqueList.rows().map( r => r.level ) ), [ 20, 24, 40, 40 ] );
		const g = await loaded();
		g.UniqueState.noteLevel( "MOB_OA_URUCHI", 40 ); g.notice( "UIIT_MSG_APPEAR_UNIC", [ "Example Beast" ] );
		assert.deepEqual( names( g ), [ "Tiger Girl", "Cerberus", "Uruchi", "Isyutaru", "Example Beast" ], "built-in levels fill the gaps; a unique with no level goes last" );
		g.UniqueState.noteLevel( "MOB_CH_TIGERWOMAN", 20 ); g.notice( "UIIT_MSG_APPEAR_URRUCHI" );
		assert.deepEqual( names( g ), [ "Tiger Girl", "Cerberus", "Uruchi", "Isyutaru", "Example Beast" ], "alive does not change the order" );
		assert.ok( !/Alive first/.test( read( "lean-unique-list.js" ) ), "Alive first is gone" );
	} );

	test( "unique list: a level from the tracker or from a sighting is remembered per codename and kept across a reload with the tracker off", async () => {
		const f = await loaded();
		f.UniqueTracker.apply( [ { ref: 1954, state: "slain", label: "", level: 20, map: "Example Field" }, { ref: 1982, state: "alive", label: "", level: 40, map: "" } ], 0 );
		sighting( f, 41, 5871, "Cerberus", 24 );
		assert.deepEqual( JSON.parse( f.storage.get( "sroBotLean:v1:unique:levels" ) ), { MOB_CH_TIGERWOMAN: 20, MOB_OA_URUCHI: 40, MOB_EU_KERBEROS: 24 } );
		const g = fixture( undefined, f.storage );
		g.Icons.request = async ( path, op ) => { if ( op !== "json" || !DATA[ path ] ) throw new Error( "not found" ); return plain( DATA[ path ] ); };
		await g.UniqueNests.load();
		assert.equal( g.Settings.profile.uniqueState.tracker, false, "tracker off" );
		assert.equal( g.UniqueTracker.info.size, 0, "nothing read this run" );
		assert.deepEqual( plain( g.UniqueList.rows().map( r => [ r.name, r.level ] ) ), [ [ "Tiger Girl", 20 ], [ "Cerberus", 24 ], [ "Uruchi", 40 ], [ "Isyutaru", 60 ] ] );
		sighting( g, 42, 5871, "Cerberus", 25 );
		assert.equal( g.UniqueState.levelOf( "MOB_EU_KERBEROS" ), 25, "the latest level seen is kept" );
		sighting( g, 43, 5871, "Cerberus", 0 ); sighting( g, 44, 5871, "Cerberus", 999 );
		assert.equal( g.UniqueState.levelOf( "MOB_EU_KERBEROS" ), 25, "an invalid level is ignored" );
		f.storage.set( "sroBotLean:v1:unique:levels", JSON.stringify( { "bad key!": 20, MOB_X: "high", MOB_Y: 0, MOB_OK: 33 } ) );
		const h = fixture( undefined, f.storage );
		assert.deepEqual( plain( [ ...h.UniqueState.levelMap() ] ), [ [ "MOB_OK", 33 ] ], "damaged entries are dropped" );
		for ( const value of f.storage.values() ) assert.ok( !value.includes( "Sample Hero" ) );
	} );

	test( "unique list: each state has its own class and pill text, styled in the skin", async () => {
		const f = await loaded();
		f.notice( "UIIT_MSG_APPEAR_URRUCHI" ); f.notice( "UIIT_MSG_ANYONE_DEAD_TIGER_GIRL", [ "Sample Hero" ] );
		f.UniqueTracker.info = new Map( [ [ "MOB_KK_ISYUTARU", { level: 60, map: "Example Field", state: "unseen", label: "Not up" } ] ] );
		const by = Object.fromEntries( f.UniqueList.rows().map( r => [ r.name, r ] ) );
		assert.deepEqual( plain( [ by.Uruchi, by[ "Tiger Girl" ], by.Isyutaru, by.Cerberus ].map( r => [ r.pill, r.cls ] ) ), [
			[ "Alive", "unique-alive" ], [ "Slain", "unique-dead" ], [ "Not up", "unique-notup" ], [ "Unknown", "unique-unknown" ] ] );
		const css = read( "lean-skin.css" );
		for ( const cls of [ "unique-alive", "unique-dead", "unique-notup", "unique-unknown", "unique-head", "unique-tick", "unique-side" ] ) assert.ok( css.includes( "." + cls ), cls + " is styled in the skin" );
		assert.ok( !/style\.(color|background)\b/.test( read( "lean-unique-list.js" ) ), "no inline colours on the rows" );
	} );

	test( "unique list: the Hunt header, the tick tooltip and the plain note exist", async () => {
		const source = read( "lean-unique-list.js" );
		assert.ok( source.includes( "el('span', 'Hunt', 'unique-tick')" ), "the column header" );
		assert.ok( source.includes( "UNIQUE_TICK_TIP = 'Look for this unique in the Unique hunt'" ) );
		assert.equal( ( source.match( /\.title = UNIQUE_TICK_TIP/g ) || [] ).length, 2, "the header and every tick have the tooltip" );
		assert.ok( source.includes( "'The Hunt ticks choose which uniques the Unique hunt looks for; with none ticked it looks for all of them.'" ) );
	} );

	test( "unique list: ticking turns on the nest patrol with a toast, unticking leaves it on", async () => {
		const f = await loaded();
		assert.equal( f.Settings.profile.uniqueNests.on, false );
		f.UniqueList.toggle( "MOB_CH_TIGERWOMAN", true );
		assert.equal( f.Settings.profile.uniqueNests.on, true, "the patrol is on" );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_CH_TIGERWOMAN" ] );
		assert.deepEqual( plain( f.notices ), [ "Patrol the game's unique nests is now on, because you ticked a unique to hunt." ] );
		f.UniqueList.toggle( "MOB_OA_URUCHI", true );
		assert.equal( f.notices.length, 1, "no second toast while it is already on" );
		f.UniqueList.toggle( "MOB_CH_TIGERWOMAN", false ); f.UniqueList.toggle( "MOB_OA_URUCHI", false );
		assert.equal( f.Settings.profile.uniqueNests.on, true, "unticking never turns it off" );
		assert.equal( f.notices.length, 1 );
		f.Settings.profile.uniqueNests.on = false;
		f.UniqueList.toggle( "MOB_CH_TIGERWOMAN", false );
		assert.equal( f.Settings.profile.uniqueNests.on, false, "unticking does not turn it on" );
		assert.equal( f.notices.length, 1 );
	} );

	test( "unique list: ticking a row is the same choice as the Combat picker", async () => {
		const f = await loaded();
		f.UniqueList.toggle( "MOB_CH_TIGERWOMAN", true );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_CH_TIGERWOMAN" ] );
		assert.deepEqual( plain( f.UniqueNests.chosen() ), [ "MOB_CH_TIGERWOMAN" ], "the nest patrol uses it" );
		assert.equal( f.UniqueList.rows().find( r => r.code === "MOB_CH_TIGERWOMAN" ).ticked, true );
		f.UniqueNests.toggle( "MOB_OA_URUCHI", true );
		assert.equal( f.UniqueList.rows().find( r => r.code === "MOB_OA_URUCHI" ).ticked, true, "a tick in the Combat picker shows in the list" );
		f.UniqueList.toggle( "MOB_CH_TIGERWOMAN", false );
		assert.deepEqual( plain( f.Settings.profile.uniqueNests.picks ), [ "MOB_OA_URUCHI" ] );
	} );

	test( "unique list: the nest map shows the right nests, the distance to the nearest, and says when there is no map", async () => {
		const f = await loaded();
		f.World.gp.pose = { regionId: 1, x: 500, y: 0, z: 100 };
		let p = f.UniqueList.plan( "MOB_CH_TIGERWOMAN" );
		assert.deepEqual( plain( p.outdoor ), [ { X: 1920 + 600, Z: 100 }, { X: 1920 + 1600, Z: 100 } ] );
		assert.equal( p.nearestM, 10 ); assert.equal( p.dungeon, 0 );
		assert.equal( f.UniqueList.planText( p ), "2 nests on the map. Nearest nest: 10 m." );
		const v = f.UniqueList.view( p );
		assert.equal( v.X, 1920 + 1100 ); assert.equal( v.cut, false ); assert.ok( v.upp >= 1000 / 260 - 1e-9 );
		p = f.UniqueList.plan( "MOB_KK_ISYUTARU" );
		assert.equal( p.outdoor.length, 0 ); assert.equal( p.dungeon, 1 );
		assert.equal( f.UniqueList.planText( p ), "Isyutaru spawns only in a dungeon; there is no map for dungeons." );
		f.World.gp.pose = { regionId: 0x8001, x: 60, y: 0, z: 50 };
		p = f.UniqueList.plan( "MOB_CH_TIGERWOMAN" );
		assert.equal( p.me, null ); assert.equal( f.UniqueList.planText( p ), "2 nests on the map. You are in a dungeon, so your position is not shown." );
		assert.equal( f.UniqueList.planText( f.UniqueList.plan( "MOB_KK_ISYUTARU" ) ), "Isyutaru spawns only in a dungeon; there is no map for dungeons. Nearest nest: 1 m." );
		f.World.gp.pose = { regionId: 1, x: 500, y: 0, z: 100 };
		const far = f.UniqueList.view( { outdoor: [ { X: 0, Z: 0 }, { X: 40000, Z: 0 } ], me: { X: 39000, Z: 0 } } );
		assert.deepEqual( plain( far ), { X: 40000, Z: 0, upp: 30, cut: true }, "a spread too wide for the small map centres on the nest nearest to you" );
		assert.equal( f.UniqueList.planText( { name: "Nobody", nests: 0, outdoor: [] } ), "No nest of Nobody in the game data." );
	} );

	test( "unique list: the tracker is asked only while the Setup page is shown and visible", async () => {
		const f = await loaded(); let asks = 0;
		f.UniqueTracker.onSetup = () => { asks++; };
		f.UniqueList.list = {}; f.UniqueList.header = {}; f.UniqueList.refreshRow = {}; f.UniqueList.refreshNote = {}; f.UniqueList.fill = () => {};
		f.UI.current = "Combat"; f.UniqueList.refresh(); assert.equal( asks, 0, "another page" );
		f.UI.current = "Setup"; f.UniqueList.refresh(); assert.equal( asks, 1, "the Setup page" );
		f.UI.minimised = true; f.UniqueList.refresh(); assert.equal( asks, 1, "minimised" ); f.UI.minimised = false;
		f.UI.root = { host: { hidden: true } }; f.UniqueList.refresh(); assert.equal( asks, 1, "OSB hidden" ); f.UI.root = null;
		f.UniqueList.refresh(); assert.equal( asks, 2 );
	} );
};
