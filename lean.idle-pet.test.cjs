module.exports = function idlePetTests( { test, fixture, pickupPet, play } ) {
	const assert = require( "node:assert/strict" );
	const petSends = f => f.commands.filter( c => c.kind === "cos-pickup" ).length;
	function spy( type, extra = {} ) {
		const calls = [];
		const e = { type, isTrusted: true, code: "", composedPath: () => [ { tagName: "CANVAS" } ], ...extra };
		for ( const name of [ "preventDefault", "stopPropagation", "stopImmediatePropagation" ] ) e[name] = () => calls.push( name );
		e.calls = calls;
		return e;
	}
	function listening( f ) {
		const listeners = [];
		f.Loot.listenInput( { addEventListener: ( type, fn, options ) => listeners.push( { type, fn, options } ) } );
		return listeners;
	}
	function idle( f ) { pickupPet( f, 0x147 ); f.drop( 20, 3436 ); return f; }
	function tickFor( f, ms ) { for ( let t = 0; t < ms; t += 100 ) { f.advance( 100 ); f.Controller.tick(); } }

	test( "idle pet: a click, key or wheel in the game holds new pet pickups for the set time, and nothing is prevented", () => {
		const f = idle( fixture() ), listeners = listening( f );
		assert.deepEqual( listeners.map( l => l.type ), [ "pointerdown", "keydown", "wheel" ] );
		for ( const l of listeners ) assert.deepEqual( { ...l.options }, { capture: true, passive: true }, l.type + " is a passive capture listener" );
		assert.equal( f.Settings.profile.hunt.pickup.petInputHoldS, 3, "3 s by default" );
		for ( const l of listeners ) {
			const g = idle( fixture() ), mine = listening( g ).find( x => x.type === l.type ), e = spy( l.type, { code: "KeyR" } );
			mine.fn( e ); g.Controller.tick();
			assert.equal( petSends( g ), 0, l.type + " holds the pet" );
			assert.deepEqual( e.calls, [], l.type + " is never prevented or stopped" );
			assert.match( g.Loot.petStatus(), /Pet waiting: you are playing; it collects in your pauses\./ );
			g.advance( 2900 ); g.Controller.tick(); assert.equal( petSends( g ), 0, "still held at 2.9 s" );
			g.advance( 100 ); g.Controller.tick(); assert.equal( petSends( g ), 1, "free after 3 s" );
		}
		const g = idle( fixture() ); g.Settings.profile.hunt.pickup.petInputHoldS = 8;
		g.Loot.noteInput( spy( "pointerdown" ) ); g.advance( 7900 ); g.Controller.tick(); assert.equal( petSends( g ), 0 );
		g.advance( 100 ); g.Controller.tick(); assert.equal( petSends( g ), 1, "the hold is a setting" );
		const h = idle( fixture() );
		h.Controller.tick(); assert.equal( petSends( h ), 1 );
		h.Loot.noteInput( spy( "keydown", { code: "KeyI" } ) );
		h.Loot.active.retryAt = 1; h.Loot.active.failure = ""; h.advance( 1000 ); h.Controller.tick();
		assert.equal( petSends( h ), 1, "a retry of the running pickup waits too" );
		assert.equal( h.Hook.guards.length, 0, "OSB never swallows a game command" );
	} );

	test( "idle pet: the input hold also applies during the manual-control pause while hunting, and not while the bot hunts alone", () => {
		const f = idle( fixture() ); f.Hunt.start();
		play( f, "attack", { gid: 30 } ); f.Loot.noteInput( spy( "pointerdown" ) );
		f.advance( 100 ); f.Controller.tick();
		assert.equal( f.Controller.mode, "manual" ); assert.equal( petSends( f ), 0, "held in the manual pause" );
		f.advance( 2800 ); f.Controller.tick(); assert.equal( petSends( f ), 0 );
		f.advance( 100 ); f.Controller.tick(); assert.equal( petSends( f ), 1, "the pet collects in the player's pause" );
		assert.equal( f.Controller.mode, "manual", "hunting itself still waits for the manual pause" );
		const g = idle( fixture() ); g.Hunt.start(); g.Loot.noteInput( spy( "wheel" ) ); g.advance( 100 ); g.Controller.tick();
		assert.equal( petSends( g ), 1, "a hunting bot without manual control is not held by a scroll of the camera" );
	} );

	test( "idle pet: input inside the OSB window, the no-render mask, OSB hotkeys and synthetic events do not count", () => {
		const f = idle( fixture() ), host = { id: "sro-bot-lean" }, mask = { tagName: "DIV" };
		f.UI.root = { host }; f.RenderControl.mask = mask;
		for ( const e of [ spy( "pointerdown", { composedPath: () => [ { tagName: "BUTTON" }, host ] } ), spy( "wheel", { composedPath: () => [ { tagName: "DIV" }, host ] } ),
			spy( "keydown", { code: "KeyA", composedPath: () => [ { tagName: "INPUT" }, host ] } ), spy( "pointerdown", { composedPath: () => [ mask ] } ),
			spy( "keydown", { code: "F8" } ), spy( "keydown", { code: "F7" } ), spy( "pointerdown", { isTrusted: false } ) ] ) {
			f.Loot.noteInput( e ); assert.deepEqual( e.calls, [] );
		}
		assert.equal( f.Loot.inputAt, -Infinity );
		f.Controller.tick(); assert.equal( petSends( f ), 1, "the pet collects meanwhile" );
		f.Loot.noteInput( spy( "keydown", { code: "KeyR" } ) ); assert.ok( f.Loot.inputAt > 0, "a key in the game counts" );
	} );

	test( "idle pet: with the bot stopped only drops near the pet are taken; hunting keeps the full reach", () => {
		const f = fixture(); pickupPet( f, 0x147 );
		const far = f.drop( 20, 3436 ); far.x = 360;
		assert.equal( f.Settings.profile.hunt.pickup.petIdleRadius, 250, "25 m by default" );
		f.Controller.tick(); assert.equal( petSends( f ), 0, "26 m from the pet: left while stopped" );
		assert.equal( f.Loot.whyNot( far ), "petIdle" );
		assert.match( f.Diagnostics.noLoot(), /1: farther from the pet than it reaches while the bot is stopped/ );
		const near = f.drop( 21, 3436 ); near.x = 340;
		f.Controller.tick(); assert.equal( f.commands.at( -1 ).target, 21, "24 m: taken" );
		const g = fixture(); pickupPet( g, 0x147 ); g.Settings.profile.hunt.pickup.petIdleRadius = 100;
		const mid = g.drop( 20, 3436 ); mid.x = 250; g.Controller.tick(); assert.equal( petSends( g ), 0, "a 10 m reach leaves a drop at 15 m" );
		g.Hunt.start(); g.advance( 100 ); g.Controller.tick(); assert.equal( g.commands.at( -1 )?.target, 20, "hunting takes it" );
		const h = fixture(); pickupPet( h, 0x147 ); const d = h.drop( 20, 3436 ); d.x = 360; h.Hunt.start(); h.Controller.tick();
		assert.equal( h.commands.at( -1 )?.target, 20, "the hunting pet still reaches 26 m" );
	} );

	function collector( f, holdMs ) {
		const pet = pickupPet( f, 0x147 ), locks = [];
		let t = 100000, gid = 100, sent = 0, since = null;
		const place = () => { const e = f.drop( ++gid, 3436 ); e.x = 150; };
		place();
		return {
			locks, step() {
				f.advance( 100 ); t += 100; f.Controller.tick();
				if ( petSends( f ) > sent ) { sent = petSends( f ); f.World.gp.inventoryPending = true; f.Loot.watchLock(); since = t; return; }
				if ( since === null || t - since < holdMs ) return;
				f.World.gp.inventoryPending = false; pet.inventory.push( { slot: 0, refObjId: 101, quantity: 1 } );
				locks.push( { at: since, end: t } ); since = null;
				const done = f.Loot.active?.gid; f.Controller.tick();
				if ( done ) { f.World.ents.delete( done ); f.bus.emit( "despawn", { gid: done } ); }
				pet.inventory.length = 0; place();
			},
		};
	}

	test( "idle pet: with the bot stopped the pet's share of the inventory lock stays under a third of any 10 s", () => {
		for ( const holdMs of [ 600, 1500, 3000 ] ) {
			const f = fixture(), c = collector( f, holdMs );
			for ( let i = 0; i < 1200; i++ ) c.step();
			assert.ok( c.locks.length >= 6, holdMs + " ms locks: the pet still collects (" + c.locks.length + ")" );
			let worst = 0;
			for ( const w of c.locks ) {
				const from = w.end - 10000;
				const held = c.locks.reduce( ( n, l ) => n + Math.max( 0, Math.min( l.end, w.end ) - Math.max( l.at, from ) ), 0 );
				worst = Math.max( worst, held );
			}
			assert.ok( worst <= 10000 / 3 + 100, holdMs + " ms locks: the worst 10 s window held " + worst + " ms" );
		}
		const f = fixture(), c = collector( f, 9000 );
		while ( !c.locks.length ) c.step();
		c.step(); assert.match( f.Loot.petStatus(), /Pet waiting: leaving the inventory free for you\./ );
		for ( let i = 0; i < 600; i++ ) c.step();
		assert.ok( c.locks.length >= 3 );
		for ( let i = 1; i < c.locks.length; i++ ) assert.ok( c.locks[i].at - c.locks[i - 1].end >= 10000, "after a 9 s lock the inventory stays free for 10 s" );
		const g = fixture(), h = collector( g, 9000 );
		g.Hunt.start(); for ( let i = 0; i < 400; i++ ) h.step();
		assert.ok( h.locks.length >= 3, "the cap is for a stopped bot only" );
	} );

	test( "idle pet: a return scroll or teleport holds the pet until the world change has settled", () => {
		const f = idle( fixture() );
		f.World.gp.returnScroll = { startedAtMs: 100000, durationMs: 10000 };
		tickFor( f, 5000 ); assert.equal( petSends( f ), 0, "no pickup while the scroll is cast" );
		assert.match( f.Loot.petStatus(), /Pet waiting: a return scroll or teleport is under way\./ );
		f.World.gp.returnScroll = null; f.World.phase = "entering-world"; f.bus.emit( "phase", "entering-world" );
		tickFor( f, 4000 ); assert.equal( petSends( f ), 0, "nothing during the loading screen" );
		f.World.phase = "world"; f.bus.emit( "phase", "world" );
		f.Controller.tick(); f.advance( 2900 ); f.Controller.tick(); assert.equal( petSends( f ), 0, "the new world settles first" );
		f.advance( 100 ); f.Controller.tick(); assert.equal( petSends( f ), 1, "then the pet collects" );
		const g = idle( fixture() ); g.World.gp.returnScroll = {}; g.Controller.tick(); g.World.gp.returnScroll = null;
		g.advance( 2900 ); g.Controller.tick(); assert.equal( petSends( g ), 0, "a cancelled scroll also settles" );
		g.advance( 100 ); g.Controller.tick(); assert.equal( petSends( g ), 1 );
		const h = idle( fixture() ); h.Hunt.start(); h.World.gp.returnScroll = {}; h.Controller.tick();
		assert.equal( petSends( h ), 0, "also while hunting" );
	} );

	test( "idle pet: the switch Pet collects while the bot is stopped, off and on", () => {
		const f = idle( fixture() ), P = f.Settings.profile.hunt.pickup;
		assert.equal( P.petWhileStopped, true, "on by default" );
		P.petWhileStopped = false;
		tickFor( f, 5000 ); assert.equal( petSends( f ), 0, "off: nothing while stopped" );
		assert.match( f.Loot.petStatus(), /Pet waits while the bot is stopped/ );
		f.Hunt.start(); f.advance( 100 ); f.Controller.tick(); assert.equal( petSends( f ), 1, "off: the hunting pet still collects" );
		const g = idle( fixture() ); g.Controller.tick(); assert.equal( petSends( g ), 1, "on: the pet collects while stopped" );
		g.Settings.profile.hunt.pickup.petWhileStopped = false; g.advance( 100 ); g.Controller.tick();
		assert.equal( g.Loot.active, null, "turning it off drops the idle pickup" );
		g.Settings.profile.hunt.pickup.petWhileStopped = true; g.advance( 1000 ); g.Controller.tick(); assert.equal( petSends( g ), 2, "on again" );
	} );

	test( "idle pet: the new settings persist, travel in shares and backups, are checked, and old files get the defaults", async () => {
		const f = fixture(), P = f.Settings.profile.hunt.pickup;
		const old = f.botProfile( { hunt: { pickup: { collector: "pet", petWhileManual: false } } } ).hunt.pickup;
		assert.deepEqual( [ old.petWhileStopped, old.petInputHoldS, old.petIdleRadius, old.petWhileManual ], [ true, 3, 250, false ] );
		const bad = f.botProfile( { hunt: { pickup: { petWhileStopped: "yes", petInputHoldS: 99, petIdleRadius: 7 } } } ).hunt.pickup;
		assert.deepEqual( [ bad.petWhileStopped, bad.petInputHoldS, bad.petIdleRadius ], [ true, 30, 50 ] );
		const odd = f.botProfile( { hunt: { pickup: { petInputHoldS: -4, petIdleRadius: 9999 } } } ).hunt.pickup;
		assert.deepEqual( [ odd.petInputHoldS, odd.petIdleRadius ], [ 0, 500 ] );
		Object.assign( P, { petWhileStopped: false, petInputHoldS: 5, petIdleRadius: 120 } ); f.Settings.saveProfile();
		const again = f.botProfile( JSON.parse( JSON.stringify( f.Settings.profile ) ) ).hunt.pickup;
		assert.deepEqual( [ again.petWhileStopped, again.petInputHoldS, again.petIdleRadius ], [ false, 5, 120 ] );
		const code = await f.ProfileShare.encode( f.ProfileShare.text( true ) ), g = fixture();
		g.ProfileShare.pending = await g.ProfileShare.preview( code ); assert.equal( g.ProfileShare.apply(), true );
		const shared = g.Settings.profile.hunt.pickup;
		assert.deepEqual( [ shared.petWhileStopped, shared.petInputHoldS, shared.petIdleRadius ], [ false, 5, 120 ] );
		const u = fixture(); u.storage.set( "sroBotLean:v1:backup:profile:default", JSON.stringify( { at: 1, profile: { hunt: { pickup: { enabled: true } } } } ) );
		assert.equal( u.ProfileShare.undo(), true );
		const back = u.Settings.profile.hunt.pickup;
		assert.deepEqual( [ back.petWhileStopped, back.petInputHoldS, back.petIdleRadius ], [ true, 3, 250 ] );
	} );
};
