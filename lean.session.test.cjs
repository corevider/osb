/*
===========================================================================

lean.session.test.cjs - potion timing and reverse destination contracts

Exercises the generated bot through the existing simulated game fixture.
===========================================================================
*/
module.exports = function sessionTests( { test, fixture, townFixture } ) {
	const assert = require( "node:assert/strict" );

	/*
	================
	prepareReverse
	================
	*/
	function prepareReverse( f, revival ) {
		f.Town.begin( revival );
		f.Town.enter( "reverse" );
		f.pet.inventory = [];
		f.World.gp.inventory.find( item => item.refObjId === 15 ).quantity = 50;
		f.World.gp.inventory.find( item => item.slot === 6 ).durability = 10;
		f.World.gp.target = 63;
		f.World.gp.targetCapabilities = 0x20000000;
		f.advance( 1000 );
		f.Town.tick();
	}

	test( "reverse travel uses the death choice for revival and recall for services", () => {
		for ( const revival of [ true, false ] ) {
			const f = townFixture();
			prepareReverse( f, revival );
			const command = f.commands.find( command => command.kind === "travel-gate" );
			assert.equal( command.type, 5 );
			assert.equal( command.target, revival ? 3 : 2 );
		}
	} );

	test( "an explicit revival recall setting retains the last-scroll destination", () => {
		const f = townFixture();
		f.Town.cfg().deathReturn = "recall";
		f.Town.lastScrollPoint = { ...f.World.pose(), x: 1200 };
		prepareReverse( f, true );
		assert.equal( f.Town.trip.origin.x, 1200 );
		assert.equal( f.commands.find( command => command.kind === "travel-gate" ).target, 2 );
	} );

	test( "a known death point cannot be confirmed by landing elsewhere in the hunt area", () => {
		const f = townFixture();
		f.Town.deathPoint = { ...f.World.pose(), x: 1100 };
		f.Town.begin( true );
		assert.equal( f.Town.trip.origin.x, 1100 );
		f.Town.enter( "reverse-wait" );
		f.Town.phase( "entering-world" );
		f.World.gp.pose.x = 700;
		f.Town.tick();
		assert.ok( f.Town.trip );
		f.World.gp.pose.x = 1100;
		f.Town.tick();
		assert.equal( f.Town.trip, null );
	} );

	test( "revival return needs a reverse scroll but no unused return scroll", () => {
		const f = townFixture();
		f.World.gp.inventory = f.World.gp.inventory.filter( item => item.typeFlags !== 0x09ec );
		assert.equal( f.Town.validate( true ), "" );
		assert.match( f.Town.validate(), /return scroll/ );
		prepareReverse( f, true );
		assert.equal( f.commands.find( command => command.kind === "travel-gate" ).target, 3 );
	} );

	test( "death location survives revival bootstrap for the same character", () => {
		const f = townFixture();
		f.UI.mount = f.UI.draw = f.UI.update = f.Ticker.start = () => {};
		f.boot();
		f.Settings.profileKey = "profile:TestHero";
		f.World.gp.pose.x = 1050;
		f.World.local().appearanceState[0] = 2;
		f.Controller.tick();
		f.advance( 5100 ); f.Controller.tick();
		f.bus.emit( "phase", "entering-world" );
		f.bus.emit( "reset" );
		f.bus.emit( "character", "TestHero" );
		f.World.local().appearanceState[0] = 0;
		f.World.gp.pose.x = 100;
		f.Controller.tick();
		assert.equal( f.Town.trip.origin.x, 1050 );
		assert.equal( f.Town.trip.reverseChoice, 3 );
	} );

	test( "refused death returns stop after bounded retries without substituting recall", () => {
		const f = townFixture();
		prepareReverse( f, true );
		for ( let attempt = 0; attempt < 3; attempt++ ) {
			f.World.applyGameplay( { ...f.World.gp, error: "No saved death point" } );
			f.advance( 6000 ); f.Town.tick();
			if ( f.Town.trip ) { f.advance( 100 ); f.Town.tick(); }
		}
		const commands = f.commands.filter( command => command.kind === "travel-gate" );
		assert.equal( commands.length, 3 );
		assert.ok( commands.every( command => command.target === 3 ) );
		assert.equal( f.Town.trip, null );
		assert.equal( f.Hunt.running, false );
		assert.equal( f.World.gp.inventory.find( item => item.typeFlags === 0x19ec ).quantity, 2 );
	} );

	test( "potion profile validates milliseconds and preserves existing valid delays", () => {
		const f = fixture();
		for ( const value of [ -1, 1.5, Infinity, "500", 60001 ] ) {
			assert.equal( f.botProfile( { potion: { delayMs: value } } ).potion.delayMs, 350 );
		}
		for ( const value of [ 0, 350, 1234, 60000 ] ) {
			assert.equal( f.botProfile( { potion: { delayMs: value } } ).potion.delayMs, value );
		}
	} );

	test( "automatic potion attempts honor the selected interval and inventory admission", () => {
		const f = fixture();
		f.Settings.profile.potion.delayMs = 1250;
		f.World.me = () => ( { maxHp: 100, hpPct: 10, mpPct: 100, abnormal: 0 } );
		let uses = 0;
		f.Potion.use = () => { uses++; f.Potion.lastUse = 100000 + uses * 1250; return true; };
		f.Potion.lastUse = 100000;
		f.advance( 1249 ); f.Potion.tick(); assert.equal( uses, 0 );
		f.advance( 1 ); f.Potion.tick(); assert.equal( uses, 1 );
		f.advance( 1250 ); f.World.gp.inventoryPending = true;
		f.Potion.tick(); assert.equal( uses, 1 );
		f.World.gp.inventoryPending = false;
		f.Potion.tick(); assert.equal( uses, 2 );
	} );
};
