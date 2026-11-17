module.exports = function uniqueTabTests( { test, fixture } ) {
	const assert = require( "node:assert/strict" );
	const plain = v => JSON.parse( JSON.stringify( v ) );
	const read = file => require( "node:fs" ).readFileSync( __dirname + "/" + file, "utf8" );

	function fakeDocument() {
		return { createElement( tag ) {
			const events = {};
			return { tag, children: [], className: "", value: "", textContent: "", dataset: {}, style: {}, attributes: {}, hidden: false,
				setAttribute( k, v ) { this.attributes[ k ] = v; }, append( ...children ) { this.children.push( ...children ); },
				replaceChildren( ...children ) { this.children = children; }, addEventListener( name, fn ) { events[ name ] = fn; },
				fire( name, arg ) { events[ name ]?.( arg ); }, querySelectorAll() { return []; }, querySelector() { return null; } };
		} };
	}
	const walk = ( node, out = [] ) => { out.push( node ); for ( const child of node.children || [] ) if ( child && typeof child === "object" ) walk( child, out ); return out; };
	const textsOf = node => walk( node ).map( n => n.textContent ).filter( t => typeof t === "string" && t );
	const hasText = ( node, text ) => textsOf( node ).some( t => t.includes( text ) );
	const uiFixture = () => {
		const document = fakeDocument(), f = fixture( document );
		f.UI.pane = document.createElement( "div" ); f.UI.nav = document.createElement( "nav" );
		f.UI.balance = () => {}; f.UI.update = () => {}; f.UI.classic = false; f.UI.tip = {}; f.UI.refreshers = [];
		return f;
	};
	function drawn( f, name ) {
		f.UI.refreshers = [];
		f.UI.pane.children = [];
		f.UI[ "section_" + name ]( f.UI.pane );
	}

	test( "unique tab: the compact page list has Unique right after Setup", () => {
		const f = uiFixture(), names = [];
		f.UI.button = name => { names.push( name ); return { dataset: {}, append() {}, setAttribute() {} }; };
		f.UI.paintPath = () => {}; f.UI.nav = { replaceChildren() {}, append() {} };
		f.UI.buildNav();
		assert.equal( names[ names.indexOf( "Setup" ) + 1 ], "Unique" );
		assert.equal( names.filter( n => n === "Unique" ).length, 1 );
	} );

	test( "unique tab: the classic tab list has Unique right after Setup and Training place holds no unique section", () => {
		const f = fixture();
		const tabs = f.UI.classicTabs(), names = tabs.map( t => t.name );
		assert.equal( names[ names.indexOf( "Setup" ) + 1 ], "Unique" );
		const unique = tabs[ names.indexOf( "Unique" ) ];
		assert.deepEqual( plain( unique.pages ), [ "Unique" ] );
		assert.deepEqual( plain( unique.sections.map( s => s[ 0 ] ) ), [ "uniqueHunt", "uniqueList", "uniqueSettings", "uniqueSafety" ] );
		const training = tabs[ names.indexOf( "Training place" ) ];
		assert.equal( training.sections.some( s => /unique/i.test( s[ 0 ] ) ), false );
		for ( const tab of tabs ) for ( const [ section ] of tab.sections || [] ) assert.equal( typeof f.UI[ "section_" + section ], "function", section + " is drawn" );
		assert.equal( typeof f.UI.section_combatUnique, "undefined" );
	} );

	test( "unique tab: tabFor sends every unique place to the Unique tab", () => {
		const f = fixture();
		assert.equal( f.UI.tabFor( "Unique" ), "Unique" );
		assert.equal( f.UI.tabFor( "Combat", "Unique hunt" ), "Unique" );
		assert.equal( f.UI.tabFor( "Combat", "Hunt area" ), "Training place" );
		assert.equal( f.UI.tabFor( "Combat", "Skills" ), "Skills" );
		assert.equal( f.UI.tabFor( "Setup" ), "Setup" );
		assert.equal( f.UI.tabFor( "Settings" ), "Extra" );
	} );

	test( "unique tab: the old Combat, Unique hunt link opens the Unique tab in both layouts, and is() follows", () => {
		const f = fixture();
		f.UI.draw = () => {};
		f.UI.classic = false; f.UI.current = "Combat"; f.UI.combatTab = "Skills";
		f.UI.show( "Combat", "Unique hunt" );
		assert.equal( f.UI.current, "Unique" );
		assert.equal( f.UI.combatTab, "Skills", "the Combat sub-tab is left alone" );
		assert.equal( f.UI.is( "Unique" ), true );
		assert.equal( f.UI.is( "Combat" ), false );
		assert.equal( f.UI.is( "Combat", "Unique hunt" ), true );
		assert.equal( f.UI.is( "Setup" ), false );
		f.UI.show( "Setup" ); assert.equal( f.UI.is( "Unique" ), false ); assert.equal( f.UI.is( "Setup" ), true );
		f.UI.classic = true; f.UI.ctab = "Skills"; f.UI.current = "Combat";
		f.UI.show( "Combat", "Unique hunt" );
		assert.equal( f.UI.ctab, "Unique" );
		assert.equal( f.UI.is( "Unique" ), true );
		assert.equal( f.UI.is( "Combat" ), false );
		assert.equal( f.UI.is( "Setup" ), false );
		f.UI.show( "Unique" ); assert.equal( f.UI.ctab, "Unique" );
		f.UI.show( "Combat", "Hunt area" ); assert.equal( f.UI.ctab, "Training place" ); assert.equal( f.UI.is( "Unique" ), false );
	} );

	test( "unique tab: the list asks the tracker on the Unique page, not on Setup or Combat", () => {
		const f = fixture(); let asks = 0;
		f.UniqueTracker.onSetup = () => { asks++; };
		f.UniqueList.list = {}; f.UniqueList.header = {}; f.UniqueList.refreshRow = {}; f.UniqueList.refreshNote = {}; f.UniqueList.fill = () => {};
		f.UI.classic = false;
		for ( const page of [ "Setup", "Combat" ] ) { f.UI.current = page; f.UniqueList.refresh(); }
		assert.equal( asks, 0 );
		f.UI.current = "Unique"; f.UniqueList.refresh(); assert.equal( asks, 1 );
		f.UI.classic = true; f.UI.ctab = "Setup"; f.UniqueList.refresh(); assert.equal( asks, 1, "classic Setup tab" );
		f.UI.ctab = "Unique"; f.UniqueList.refresh(); assert.equal( asks, 2, "classic Unique tab" );
	} );

	test( "unique tab: the Combat page has no Unique hunt sub-tab and draws no unique settings", () => {
		const f = uiFixture();
		f.UI.current = "Combat";
		for ( const combatTab of [ "Skills", "Buffs & imbue", "Hunt area", "Unique hunt" ] ) {
			f.UI.combatTab = combatTab; f.UI.draw();
			const subtabs = f.UI.pane.children[ 0 ];
			assert.deepEqual( plain( subtabs.children.map( b => b.textContent ) ), [ "Skills", "Buffs & imbue", "Hunt area" ] );
			for ( const text of [ "Patrols your unique spots", "Add this spot", "Unique nests" ] ) assert.equal( hasText( f.UI.pane, text ), false, text + " on " + combatTab );
		}
		f.UI.combatTab = "Hunt area"; f.UI.draw();
		assert.equal( hasText( f.UI.pane, "Monster classes" ), true );
		assert.equal( hasText( f.UI.pane, "Unique" ), true, "the Unique row of the class table stays" );
		assert.equal( hasText( f.UI.pane, "Titan" ), true, "the Titan row stays" );
	} );

	test( "unique tab: the Unique page holds every unique control and Setup holds none", () => {
		const f = uiFixture();
		f.UI.current = "Unique"; f.UI.draw();
		for ( const text of [ "Patrols your unique spots", "Uniques", "Add this spot", "Chime when a unique monster comes into view", "Chime when the hunted unique dies",
			"Use the game site's unique tracker", "Unique nests", "When a unique appears nearby", "Unique distance (m)", "Unique nearby: action" ] ) {
			assert.equal( hasText( f.UI.pane, text ), true, text );
		}
		const order = textsOf( f.UI.pane );
		assert.ok( order.indexOf( "Unique hunt" ) < order.indexOf( "Uniques" ), "hunt card first, list after it" );
		f.UI.current = "Setup"; f.UI.draw();
		for ( const text of [ "Patrols your unique spots", "Click a name for a small map", "Add this spot", "Unique nests" ] ) assert.equal( hasText( f.UI.pane, text ), false, text + " is not on Setup" );
		assert.equal( hasText( f.UI.pane, "Ready to hunt?" ), true );
	} );

	test( "unique tab: Zero-setup leveling is the last group on the Setup page, below Starter settings", () => {
		const f = uiFixture();
		f.UI.current = "Setup"; f.UI.draw();
		const legends = f.UI.pane.children.filter( n => n.tag === "fieldset" ).map( n => n.children[ 0 ].textContent );
		assert.deepEqual( plain( legends ), [ "Ready to hunt?", "Checklist", "Starter settings", "Zero-setup leveling" ] );
	} );

	test( "unique tab: the unique chime and the unique safety trigger left Loot and Safety, and every key stays", () => {
		const f = uiFixture();
		drawn( f, "lootCollection" );
		const sounds = f.UI.pane;
		assert.equal( hasText( sounds, "Chime when another player comes near" ), true );
		assert.equal( hasText( sounds, "Chime when a unique monster comes into view" ), false );
		drawn( f, "settingsSafety" );
		const safety = f.UI.pane;
		assert.equal( hasText( safety, "Stop after this many deaths (0 = off)" ), true );
		assert.equal( hasText( safety, "When a player attacks the character" ), true );
		for ( const text of [ "When a unique appears nearby", "Unique distance (m)", "Unique nearby: action" ] ) assert.equal( hasText( safety, text ), false, text );
		drawn( f, "uniqueSafety" );
		for ( const text of [ "When a unique appears nearby", "Unique distance (m)", "Unique nearby: action" ] ) assert.equal( hasText( f.UI.pane, text ), true, text );
		const p = f.Settings.profile;
		assert.deepEqual( plain( p.hunt.safety.unique ), { on: false, meters: 50, action: "stop" } );
		assert.equal( p.sounds.unique, false );
		assert.equal( p.unique.chime, true );
	} );

	test( "unique tab: the unique safety trigger still changes the same key", () => {
		const f = uiFixture();
		drawn( f, "uniqueSafety" );
		const boxes = walk( f.UI.pane ).filter( n => n.tag === "input" && n.type === "checkbox" );
		assert.equal( boxes.length, 1 );
		boxes[ 0 ].checked = true; boxes[ 0 ].fire( "change" );
		assert.equal( f.Settings.profile.hunt.safety.unique.on, true );
	} );

	test( "unique tab: the old pages no longer name the unique cards in their sources", () => {
		const ui = read( "lean-ui.js" ), setup = read( "lean-setup.js" ), unique = read( "lean-unique.js" );
		assert.equal( ui.includes( "combatUnique" ), false );
		assert.equal( /'Hunt area', 'Unique hunt'/.test( ui ), false );
		assert.equal( setup.includes( "UniqueHunt" ), false );
		assert.equal( setup.includes( "UniqueList" ), false );
		assert.equal( unique.includes( "UI.show('Combat', 'Unique hunt')" ), false );
	} );
};
