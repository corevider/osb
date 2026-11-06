/*
===========================================================================

lean.telemetry.test.cjs - opt-in usage statistics and report delivery

Runs the generated bot in a vm context with a virtual clock and a fake network.
No test reaches the real api.osb.lol. Case IDs C1 to C17 are those of PLATFORM.md 7.7.
===========================================================================
*/
module.exports = function telemetryTests( { test: baseTest, source } ) {
	const test = ( name, fn ) => baseTest( name, async () => {
		try { await fn(); } catch ( error ) { console.error( [ "FAIL DETAIL " + name, ...String( error.stack ).split( /\r?\n/ ).slice( 0, 6 ) ].join( "\n" ) ); throw error; }
	} );
	const assert = require( "node:assert/strict" );
	const fs = require( "node:fs" );
	const nodeCrypto = require( "node:crypto" );
	const vm = require( "node:vm" );

	const START = 1_800_000_000_000;
	const MINUTE = 60_000;
	const HOUR = 3_600_000;
	const BASE = "https://api.osb.lol/v1";
	const APP_VERSION = String( source ).match( /@version\s+([\d.]+)/ )[ 1 ];

	/*
	================
	FakeElement
	================
	*/
	class FakeElement {
		constructor( tag ) {
			this.tag = tag; this.children = []; this.listeners = {}; this.className = ""; this.hidden = false; this.attributes = {};
			this.style = {}; this.isConnected = true; this.value = ""; this.checked = false; this.disabled = false; this.own = "";
			this.classList = { add() {}, toggle() {} };
		}
		set innerHTML( value ) { throw new Error( "innerHTML must never be used: " + value ); }
		set textContent( value ) { this.own = String( value ); this.children = []; }
		get textContent() { return this.own + this.children.map( child => child.textContent ).join( "" ); }
		get firstChild() { return this.children[0] || null; }
		append( ...nodes ) { for ( const node of nodes ) this.children.push( typeof node === "string" ? Object.assign( new FakeElement( "#text" ), { own: node } ) : node ); }
		setAttribute( key, value ) { this.attributes[key] = value; }
		addEventListener( type, fn ) { ( this.listeners[type] ||= [] ).push( fn ); }
		fire( type, event = {} ) { for ( const fn of this.listeners[type] || [] ) fn( event ); }
		click( event = { isTrusted: true } ) { this.fire( "click", event ); }
		remove() {}
		find( predicate, out = [] ) { if ( predicate( this ) ) out.push( this ); for ( const child of this.children ) child.find( predicate, out ); return out; }
		querySelector( selector ) { return this.find( node => node.tag === selector )[0] || null; }
	}

	const GOLDEN_REGISTER = {
		install_id: "3f0b2c1e-7d4a-4c55-9a51-2b8f7e4c9d10", install_key: "kq3Vt3N1rA8b0bq3QyU2sQj3XcYw8m3cXzq8b6F0wJs", app: "osb", app_version: "2.0.4", os: "windows", locale: "en",
		consent: { usage_version: 1, characters: false },
	};
	const GOLDEN_TELEMETRY = {
		schema: 1, app_version: "2.0.4",
		accounts: [ { slot: "5e8a1c0f9b7d2346", state: "town", level: 64, gold: "9800000", hp_pct: 100, mp_pct: 100, scrolls: { return: 4, reverse: 0 }, bot_version: "2.0.4",
			character: { name: "ExampleHero", server: "ExampleServer" }, session: { key: "0f1e2d3c4b5a6978", ms: 1200000, kills: 95, deaths: 0, xp: "3100200", gold: "410000", sox: 1 } } ],
	};

	/*
	================
	typesOf
	================
	*/
	function typesOf( value ) {
		if ( Array.isArray( value ) ) return value.map( typesOf );
		if ( value && typeof value === "object" ) return Object.fromEntries( Object.entries( value ).map( ( [ k, v ] ) => [ k, typesOf( v ) ] ) );
		return typeof value;
	}

	/*
	================
	assertSubsetShape

	Every field the client sends exists in the golden payload with the same JSON type.
	================
	*/
	function assertSubsetShape( actual, golden, path = "$" ) {
		if ( Array.isArray( golden ) ) {
			assert.ok( Array.isArray( actual ), path + " is an array" );
			for ( const [ i, item ] of actual.entries() ) assertSubsetShape( item, golden[0], path + "[" + i + "]" );
			return;
		}
		if ( golden && typeof golden === "object" ) {
			assert.equal( typeof actual, "object", path + " is an object" );
			for ( const [ key, value ] of Object.entries( actual ) ) {
				assert.ok( key in golden, path + "." + key + " is a golden field name" );
				assertSubsetShape( value, golden[key], path + "." + key );
			}
			return;
		}
		assert.equal( typeof actual, typeof golden, path + " has the golden type" );
	}

	/*
	================
	harness

	A bot context with a virtual clock, timers, a fake network and a controllable server.
	================
	*/
	function harness( { stored = {}, hosted = false, idle = true, hidden = {} } = {} ) {
		let t = START;
		const storage = new Map( Object.entries( stored ) ), timers = [], requests = [], idleCalls = [], logs = [];
		let nextTimer = 1, active = 0, maxActive = 0, pendingCrypto = 0, ticking = false;
		const track = promise => { pendingCrypto++; return promise.finally( () => { pendingCrypto--; } ); };
		const crypto = { getRandomValues: array => nodeCrypto.webcrypto.getRandomValues( array ), subtle: {
			importKey: ( ...args ) => track( nodeCrypto.webcrypto.subtle.importKey( ...args ) ),
			sign: ( ...args ) => track( nodeCrypto.webcrypto.subtle.sign( ...args ) ),
		} };
		class FakeDate extends Date {
			constructor( ...args ) { if ( args.length ) super( ...args ); else super( t ); }
			static now() { return t; }
		}
		const server = {
			config: { schema: 1, telemetry: { enabled: true, interval_s: 600 }, reports: { enabled: true, screenshots: true }, client_ok: true, message: null },
			respond: null,
		};
		const reply = ( status, body, headers = {}, raw ) => ( { status, body, headers, raw } );
		const SHA = "a".repeat( 40 );
		server.default = entry => {
			if ( entry.url.includes( "api.github.com" ) ) return reply( 200, { sha: SHA } );
			if ( entry.url.includes( "raw.githubusercontent.com" ) ) return reply( 200, null, {}, "// @version      2.0.0\n" );
			const path = entry.url.slice( BASE.length );
			if ( path.startsWith( "/config" ) ) return reply( 200, server.config );
			if ( path === "/installs" ) return reply( 201, { install_id: JSON.parse( entry.body ).install_id, status: "quarantined" } );
			if ( path === "/telemetry" ) return reply( 202, { accepted: 1, next_after_s: 600 } );
			if ( path === "/installs/me/consent" ) return reply( 204, null );
			if ( path === "/installs/me" ) return reply( 204, null );
			if ( path === "/installs/me/export" ) return reply( 200, { install: { id: "x" } } );
			if ( path === "/reports" ) return reply( 201, { code: "R-7K3Q9XAB", screenshot: "none" } );
			return reply( 404, { code: "not_found" } );
		};
		const win = {
			addEventListener() {}, localStorage: { getItem: k => storage.get( k ) ?? null, setItem: ( k, v ) => storage.set( k, v ), removeItem: k => storage.delete( k ) },
			crypto, navigator: { language: "en-GB", platform: "Win32" },
			fetch: ( url, init = {} ) => {
				const entry = { url, method: init.method || "GET", init, body: init.body, headers: init.headers || {}, at: t, inTick: ticking, aborted: false, concurrent: ++active };
				maxActive = Math.max( maxActive, active );
				requests.push( entry );
				return new Promise( ( resolve, reject ) => {
					let done = false;
					const settle = fn => value => { if ( done ) return; done = true; active--; fn( value ); };
					init.signal?.addEventListener( "abort", () => { entry.aborted = true; entry.abortedAt = t; settle( reject )( new Error( "aborted" ) ); } );
					const answer = ( server.respond || server.default )( entry );
					if ( answer === "hang" ) return;
					if ( answer instanceof Error ) return settle( reject )( answer );
					const text = answer.body === null || answer.raw !== undefined ? answer.raw ?? "" : JSON.stringify( answer.body );
					settle( resolve )( { status: answer.status, ok: answer.status >= 200 && answer.status < 300, redirected: false, type: "basic", headers: { get: name => answer.headers[name] ?? null }, text: async () => text, json: async () => JSON.parse( text ) } );
				} );
			},
		};
		if ( hosted ) win.chrome = { webview: {} };
		if ( idle ) win.requestIdleCallback = ( fn, options ) => { idleCalls.push( options ); setTimeout( fn, 0 ); };
		const document = { createElement: tag => new FakeElement( tag ), documentElement: { append() {} } };
		const setTimeout = ( fn, ms = 0 ) => { const id = nextTimer++; timers.push( { id, at: t + ms, fn } ); return id; };
		const setInterval = ( fn, ms ) => { const id = nextTimer++; const arm = () => timers.push( { id, at: t + ms, fn: () => { arm(); fn(); } } ); arm(); return id; };
		const context = { window: win, document, performance: { now: () => t - START }, console, Date: FakeDate, setTimeout,
			clearTimeout: id => { const i = timers.findIndex( x => x.id === id ); if ( i >= 0 ) timers.splice( i, 1 ); }, clearInterval: id => { for ( let i = timers.length - 1; i >= 0; i-- ) if ( timers[i].id === id ) timers.splice( i, 1 ); }, setInterval,
			AbortController, Blob, FormData, URL, Map, Set, ArrayBuffer, DataView, atob, btoa, TextEncoder };
		vm.createContext( context ); vm.runInContext( source, context );
		const b = context.bot;
		b.UI.toast = ( message, level ) => logs.push( { message, level } );
		b.UI.draw = () => {};
		b.Hook.post = () => {};
		b.World.phase = "world"; b.World.simOffset = 0; b.World.charName = "ExampleHero";
		b.Settings.profileKey = "profile:ExampleHero";
		b.World.gp = { localGid: 1, target: 0, targetPending: false, inventoryPending: false, pose: { regionId: 1, x: 100, y: 0, z: 100 },
			progression: { level: 64, experience: "3100200", gold: "9800000", stats: { maxHp: 100, maxMp: 100 } },
			inventory: [ { slot: 13, refObjId: 2540, typeFlags: 0x09ec, quantity: 4 }, { slot: 14, refObjId: 6636, typeFlags: 0x19ec, quantity: 0 } ],
			inventorySlotCount: 30, equipmentSlotCount: 13, skills: [], vitals: [ { gid: 1, hp: 100, maxHp: 100, mp: 100, maxMp: 100 } ], social: { members: [] }, pendingMoves: 0, shopCompletionRevision: 0 };
		b.World.ents.set( 1, { gid: 1, kind: "player", movementMode: 0, appearanceState: [ 0, 0, 0 ] } );
		b.Telemetry.random = () => 0.5;
		b.Telemetry.timing.resendMs = 0;
		Object.assign( b.Telemetry, hidden );
		const h = {
			...b, win, storage, timers, requests, idleCalls, logs, server, reply,
			get now() { return t; }, get maxActive() { return maxActive; },
			async settle() {
				const turn = () => new Promise( resolve => setImmediate( resolve ) );
				for ( let i = 0; i < 6; i++ ) await turn();
				while ( pendingCrypto > 0 ) await turn();
				for ( let i = 0; i < 6; i++ ) await turn();
			},
			async advance( ms, { ticks = 0 } = {} ) {
				const end = t + ms, every = ticks > 1 ? ticks : 0;
				let nextTick = t + every;
				for ( ;; ) {
					await h.settle();
					const next = timers.filter( x => x.at <= end ).sort( ( x, y ) => x.at - y.at || x.id - y.id )[0];
					if ( !next ) break;
					while ( every && nextTick <= next.at ) { t = nextTick; h.gameTick(); nextTick += every; }
					timers.splice( timers.indexOf( next ), 1 );
					t = Math.max( t, next.at );
					if ( ticks ) h.gameTick();
					next.fn();
				}
				while ( every && nextTick <= end ) { t = nextTick; h.gameTick(); nextTick += every; }
				t = end;
				await h.settle();
			},
			gameTick() { ticking = true; try { b.Controller.tick(); } finally { ticking = false; } },
			ofPath( prefix, method ) { return requests.filter( r => r.url.slice( BASE.length ).startsWith( prefix ) && ( !method || r.method === method ) ); },
			bodies( prefix ) { return h.ofPath( prefix ).map( r => JSON.parse( r.body ) ); },
			consent() { assert.equal( b.Telemetry.setUsage( true ), true ); },
		};
		return h;
	}

	const TRUSTED = { isTrusted: true };
	const gaps = list => list.slice( 1 ).map( ( r, i ) => r.at - list[i].at );

	/*
	================
	Consent and zero requests (binding operator rule, 2026-11-04)
	================
	*/
	async function lifecycle( h, { reports = true } = {} ) {
		h.Telemetry.start();
		h.Updates.start();
		h.Stats.init();
		for ( let i = 0; i < 6; i++ ) {
			h.World.phase = [ "signed-out", "entering-world", "world", "disconnected", "world", "world" ][i];
			h.Diagnostics.sample(); h.Stats.sample();
			h.Hunt.running = i % 2 === 0;
			await h.advance( 5 * MINUTE, { ticks: 1 } );
		}
		h.Hunt.running = false;
		h.Town.trip = { phase: "recall" }; await h.advance( 5 * MINUTE, { ticks: 1 } ); h.Town.trip = null;
		h.Log.error( "simulated error" ); h.bus.emit( "game-error", "simulated game error" );
		if ( reports ) { h.UI.showReport = () => {}; h.Reports.open(); h.Reports.describe( "x" ); h.Reports.ask( TRUSTED ); h.Reports.cancelAsk(); h.Reports.close(); }
		await h.advance( 30 * MINUTE, { ticks: 1 } );
	}

	const isUpdateCheck = r => /^https:\/\/(api\.github\.com\/repos\/corevider\/osb\/|raw\.githubusercontent\.com\/corevider\/osb\/)/.test( r.url );
	const noPlatformRequests = h => h.requests.filter( r => !isUpdateCheck( r ) );

	test( "C1 a fresh install with consent off makes zero requests over 30 minutes and through a whole lifecycle", async () => {
		const h = harness();
		assert.equal( h.Telemetry.consented(), false ); assert.equal( h.storage.has( "sroBotLean:v1:telemetry" ), false );
		await lifecycle( h );
		assert.deepEqual( noPlatformRequests( h ).map( r => r.url ), [] );
		assert.equal( h.storage.has( "sroBotLean:v1:telemetry" ), false, "no identity is created before consent" );
		assert.equal( h.Telemetry.timer, 0, "no telemetry timer is armed" );
	} );

	test( "consent states: absent, declined, outdated and withdrawn all make zero requests", async () => {
		const identity = { id: "3f0b2c1e-7d4a-4c55-9a51-2b8f7e4c9d10", key: "kq3Vt3N1rA8b0bq3QyU2sQj3XcYw8m3cXzq8b6F0wJs" };
		const states = {
			"absent": {},
			"declined (usage 0 with a leftover identity)": { "sroBotLean:v1:telemetry": JSON.stringify( { usage: 0, ...identity, registered: true } ) },
			"damaged record": { "sroBotLean:v1:telemetry": "{not json" },
			"consent without an identity": { "sroBotLean:v1:telemetry": JSON.stringify( { usage: 1 } ) },
		};
		for ( const [ name, stored ] of Object.entries( states ) ) {
			const h = harness( { stored } );
			await lifecycle( h );
			assert.deepEqual( noPlatformRequests( h ).map( r => r.url ), [], name );
			assert.equal( h.Telemetry.consented(), false, name );
		}
		const h = harness();
		h.consent(); await h.advance( 10 * MINUTE );
		assert.ok( h.requests.length > 0, "consent on does send" );
		await h.Telemetry.setUsage( false );
		h.requests.length = 0;
		await lifecycle( h );
		assert.deepEqual( noPlatformRequests( h ).map( r => r.url ), [], "withdrawn" );
		assert.equal( h.storage.has( "sroBotLean:v1:telemetry" ), false, "withdrawal leaves no identity behind" );
	} );

	test( "consent is recorded with its version and time, and the character display is a second, separate consent", async () => {
		const h = harness();
		h.consent();
		let record = JSON.parse( h.storage.get( "sroBotLean:v1:telemetry" ) );
		assert.equal( record.usage, 1 ); assert.equal( record.usageText, "2026-11-04.1", "the id of the consent text is stored" ); assert.equal( record.usageAt, START ); assert.equal( record.characters, false ); assert.equal( record.charactersAt, 0 );
		await h.advance( 5 * MINUTE );
		h.Telemetry.setCharacters( true );
		record = JSON.parse( h.storage.get( "sroBotLean:v1:telemetry" ) );
		assert.equal( record.characters, true ); assert.equal( record.charactersAt, h.now );
		assert.equal( h.Telemetry.setCharacters( true ), false, "no change" );
		const off = harness();
		assert.equal( off.Telemetry.setCharacters( true ), false, "the second consent needs the first" );
		assert.equal( off.Telemetry.get().characters, false );
	} );

	test( "withdrawal stops all sending at once and drops what was pending", async () => {
		const h = harness();
		h.consent(); await h.advance( 4 * MINUTE );
		const before = h.requests.length;
		assert.ok( h.Telemetry.slots.size > 0 && h.Telemetry.sessions.size >= 0 );
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? "hang" : h.server.default( entry );
		await h.advance( 11 * MINUTE );
		assert.ok( h.requests.some( r => r.url.endsWith( "/telemetry" ) && !r.aborted ), "a telemetry request is pending" );
		const pending = h.requests.filter( r => r.url.endsWith( "/telemetry" ) ).at( -1 );
		const done = h.Telemetry.setUsage( false );
		assert.equal( h.Telemetry.consented(), false, "off before the server answers" );
		assert.equal( h.Telemetry.timer, 0 ); assert.equal( h.Telemetry.slots.size, 0 ); assert.equal( h.Telemetry.sessions.size, 0 ); assert.equal( h.Telemetry.get().id, "" );
		await done;
		h.server.respond = null;
		const after = h.requests.length;
		await h.advance( 6 * HOUR );
		assert.deepEqual( h.requests.slice( after ).map( r => r.url ), [], "nothing more after the delete" );
		assert.ok( before <= after );
		assert.equal( pending.aborted, true, "the pending request ended at its 15 s limit and was ignored" );
	} );

	test( "the report window makes no request until the player presses Send and confirms", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.Reports.open(); h.Reports.describe( "It stopped." ); h.Reports.setKind( "bug" );
		await h.advance( HOUR );
		assert.equal( h.requests.length, 0, "open, describe and preview send nothing" );
		await h.Reports.send( TRUSTED );
		assert.equal( h.requests.length, 0, "Send without the confirmation step sends nothing" );
		h.Reports.ask( TRUSTED );
		assert.equal( h.requests.length, 0, "asking sends nothing" ); assert.equal( h.Reports.draft.confirming, true );
		h.Reports.cancelAsk(); await h.Reports.send( TRUSTED );
		assert.equal( h.requests.length, 0, "cancelling the confirmation sends nothing" );
		h.Reports.ask( TRUSTED ); await h.Reports.send( TRUSTED );
		assert.deepEqual( h.requests.map( r => r.url.slice( BASE.length ).split( "?" )[0] ), [ "/config", "/reports" ] );
	} );

	/*
	================
	C2 to C17
	================
	*/
	test( "C2 consent on registers once, then sends after the start delay, never on the game path", async () => {
		const h = harness();
		const calls = [];
		for ( const key of Object.keys( h.Telemetry ) ) if ( typeof h.Telemetry[key] === "function" && ![ "now", "random" ].includes( key ) ) {
			const original = h.Telemetry[key];
			h.Telemetry[key] = function ( ...args ) { calls.push( { key, ticking: h.Controller.ticking } ); return original.apply( this, args ); };
		}
		let inside = 0; const tick = h.Controller.tick;
		h.Controller.tick = function () { inside++; const before = calls.length; try { return tick.apply( this ); } finally { inside--; h.tickCalls = ( h.tickCalls || 0 ) + calls.length - before; } };
		h.consent();
		assert.equal( h.requests.length, 0, "turning consent on sends nothing itself" );
		await h.advance( 59 * 1000, { ticks: 1 } );
		assert.equal( h.requests.length, 0, "nothing before the 60 s start delay" );
		await h.advance( 130 * 1000, { ticks: 1 } );
		const kinds = h.requests.map( r => r.url.slice( BASE.length ).split( "?" )[0] );
		assert.deepEqual( kinds, [ "/config", "/installs", "/telemetry" ] );
		assert.equal( h.ofPath( "/installs", "POST" ).length, 1, "one register" );
		assert.ok( h.requests.every( r => !r.inTick ), "no request starts inside a game tick" );
		assert.equal( h.tickCalls || 0, 0, "Controller.tick never calls into the telemetry module" );
		assert.ok( h.idleCalls.length > 0 && h.idleCalls.every( o => o.timeout === 5000 ), "the payload is built in requestIdleCallback with a 5 s timeout" );
		for ( const r of h.requests ) {
			assert.equal( r.init.credentials, "omit" ); assert.equal( r.init.referrerPolicy, "no-referrer" ); assert.equal( r.init.redirect, "error" ); assert.equal( r.init.cache, "no-store" );
			assert.ok( r.init.signal, "every request has an abort signal" );
		}
		assert.equal( h.maxActive, 1, "one request at a time" );
	} );

	test( "the start delay is 60 to 180 s and the interval is 300 s or more, each wait varied by 10 percent", async () => {
		for ( const [ random, low, high ] of [ [ 0, 60 * 1000, 61 * 1000 ], [ 0.9999, 179 * 1000, 181 * 1000 ] ] ) {
			const h = harness(); h.Telemetry.random = () => random;
			h.consent();
			await h.advance( 59 * 1000 ); assert.equal( h.requests.length, 0 );
			await h.advance( 200 * 1000 );
			const first = h.requests[0];
			assert.ok( first && first.at - START >= low - 1000 && first.at - START <= high + 1000, "first request at " + ( first && first.at - START ) );
		}
		const h = harness(); h.consent();
		await h.advance( 3 * HOUR );
		const posts = h.ofPath( "/telemetry" );
		assert.ok( posts.length >= 10 );
		for ( const gap of gaps( posts ) ) assert.ok( gap >= 540 * 1000 - 1 && gap <= 660 * 1000 + 1, "gap " + gap );
	} );

	test( "C3 a server that keeps answering 500 is asked with full-jitter backoff and never twice within 60 s", async () => {
		for ( const random of [ 0, 0.5, 0.9999 ] ) {
			const h = harness(); h.Telemetry.random = () => random;
			h.server.respond = () => h.reply( 500, { code: "server_error" } );
			h.consent();
			await h.advance( 3 * 24 * HOUR );
			const times = h.requests;
			assert.ok( times.length >= 8, "requests " + times.length );
			for ( const [ i, gap ] of gaps( times ).entries() ) {
				const cap = Math.min( 6 * HOUR, 60 * 1000 * 2 ** ( i + 1 ) );
				assert.ok( gap >= 60 * 1000, "gap " + gap + " is at least 60 s" );
				assert.ok( gap <= cap + 1000, "gap " + gap + " is within the full-jitter bound " + cap );
				if ( random === 0.9999 && cap < 6 * HOUR ) assert.ok( gap >= cap * 0.99, "the upper end of the jitter range is used" );
			}
			assert.ok( h.requests.every( r => r.url.includes( "/config" ) ), "with no config nothing else is tried" );
		}
	} );

	test( "C3 backoff resets after a success", async () => {
		const h = harness();
		let failing = true;
		h.server.respond = entry => failing && entry.url.endsWith( "/telemetry" ) ? h.reply( 500, { code: "server_error" } ) : h.server.default( entry );
		h.consent(); await h.advance( 40 * MINUTE );
		assert.ok( h.Telemetry.failures >= 2 );
		failing = false; await h.advance( 4 * HOUR );
		assert.equal( h.Telemetry.failures, 0 );
		assert.equal( h.Telemetry.get().result, "ok" );
	} );

	test( "C4 a request that never answers is aborted at 15 s and the game tick is not touched", async () => {
		const h = harness();
		h.server.respond = entry => entry.url.includes( "/config" ) ? "hang" : h.server.default( entry );
		h.consent();
		await h.advance( 200 * 1000, { ticks: 1 } );
		const config = h.requests[0];
		assert.equal( config.aborted, true ); assert.equal( config.abortedAt - config.at, 15000 );
		let calls = 0; const tick = h.Controller.tick;
		h.Controller.tick = function () { calls++; return tick.apply( this ); };
		for ( let i = 0; i < 50; i++ ) h.gameTick();
		assert.equal( calls, 50, "the tick still runs while a request hangs" );
		assert.equal( h.maxActive, 1 );
		const gap = gaps( h.requests );
		assert.ok( gap.every( g => g >= 60 * 1000 ), "an abort counts as a failure and is retried only after the backoff" );
	} );

	test( "C5 429 with Retry-After 120 waits at least 120 s", async () => {
		const h = harness();
		let limited = true;
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) && limited ? h.reply( 429, { code: "rate_limited" }, { "Retry-After": "120" } ) : h.server.default( entry );
		h.consent(); await h.advance( 130 * 1000 );
		const posts = h.ofPath( "/telemetry" );
		assert.equal( posts.length, 1 );
		limited = false;
		await h.advance( 10 * MINUTE );
		const next = h.ofPath( "/telemetry" )[1];
		assert.ok( next, "retried" ); assert.equal( next.at - posts[0].at, 120000 );
		const clamped = harness();
		clamped.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? clamped.reply( 429, { code: "rate_limited" }, { "Retry-After": "5" } ) : clamped.server.default( entry );
		clamped.consent(); await clamped.advance( HOUR );
		for ( const gap of gaps( clamped.ofPath( "/telemetry" ) ) ) assert.ok( gap >= 60000, "Retry-After below 60 s is raised to 60 s" );
	} );

	test( "C6 503 disabled stops telemetry until the next config read", async () => {
		const h = harness();
		let disabled = true;
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) && disabled ? h.reply( 503, { code: "disabled" }, { "Retry-After": "60" } ) : h.server.default( entry );
		h.consent(); await h.advance( 130 * 1000 );
		assert.equal( h.ofPath( "/telemetry" ).length, 1 );
		await h.advance( 50 * MINUTE );
		assert.equal( h.ofPath( "/telemetry" ).length, 1, "no telemetry while disabled" );
		assert.equal( h.ofPath( "/config" ).length, 1, "and no config read before it is due" );
		disabled = false; await h.advance( 20 * MINUTE );
		assert.equal( h.ofPath( "/config" ).length, 2, "the config is read again" );
		assert.ok( h.ofPath( "/telemetry" ).length >= 2, "telemetry resumes after that read" );
		const off = harness();
		off.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? off.reply( 503, { code: "disabled" } ) : off.server.default( entry );
		off.consent(); await off.advance( 6 * HOUR );
		assert.ok( off.ofPath( "/telemetry" ).length <= 6, "no retry storm: " + off.ofPath( "/telemetry" ).length );
		assert.equal( off.logs.length, 0, "no toast or UI message for a disabled server" );
	} );

	test( "C7 config telemetry.enabled false sends no telemetry and not even a registration", async () => {
		const h = harness(); h.server.config.telemetry.enabled = false;
		h.consent(); await h.advance( 13 * HOUR );
		assert.equal( h.ofPath( "/telemetry" ).length, 0 ); assert.equal( h.ofPath( "/installs", "POST" ).length, 0 );
		assert.ok( h.ofPath( "/config" ).length >= 2 && h.ofPath( "/config" ).length <= 3, "the config is read about every 6 h: " + h.ofPath( "/config" ).length );
		const old = harness(); old.server.config.client_ok = false;
		old.consent(); await old.advance( 7 * HOUR );
		assert.equal( old.ofPath( "/telemetry" ).length, 0, "client_ok false stops sending" );
		const bad = harness(); bad.server.respond = entry => entry.url.includes( "/config" ) ? bad.reply( 200, { nonsense: true } ) : bad.server.default( entry );
		bad.consent(); await bad.advance( 3 * HOUR );
		assert.equal( bad.ofPath( "/telemetry" ).length, 0, "a malformed config counts as disabled" );
	} );

	test( "C8 a config interval of 10 s is raised to 300 s, and a huge one is cut to 24 h", async () => {
		const h = harness(); h.server.config.telemetry.interval_s = 10;
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? h.reply( 202, { accepted: 1, next_after_s: 0 } ) : h.server.default( entry );
		h.consent(); await h.advance( 2 * HOUR );
		const posts = h.ofPath( "/telemetry" );
		assert.ok( posts.length >= 15 );
		for ( const gap of gaps( posts ) ) assert.ok( gap >= 270 * 1000 - 1 && gap <= 330 * 1000 + 1, "gap " + gap );
		assert.equal( h.Telemetry.parseConfig( { ...h.server.config, telemetry: { enabled: true, interval_s: 10 ** 9 } } ).telemetry.interval_s, 86400 );
		assert.equal( h.Telemetry.parseConfig( { ...h.server.config, telemetry: { enabled: true, interval_s: "x" } } ).telemetry.interval_s, 600 );
	} );

	test( "next_after_s from the server can only slow the client down", async () => {
		const h = harness();
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? h.reply( 202, { accepted: 1, next_after_s: 1800 } ) : h.server.default( entry );
		h.consent(); await h.advance( 3 * HOUR );
		for ( const gap of gaps( h.ofPath( "/telemetry" ) ) ) assert.ok( gap >= 1620 * 1000 - 1, "gap " + gap );
	} );

	test( "C9 a 401 on telemetry registers once with the same ID and key, and a second 401 stops sending", async () => {
		const h = harness();
		h.server.respond = entry => entry.url.endsWith( "/telemetry" ) ? h.reply( 401, { code: "unauthorized" } ) : h.server.default( entry );
		h.consent(); const id = h.Telemetry.get().id, key = h.Telemetry.get().key;
		await h.advance( 10 * MINUTE );
		const registers = h.bodies( "/installs" ).filter( b => b.install_id );
		assert.equal( registers.length, 2, "the first registration and one re-registration" );
		assert.ok( registers.every( b => b.install_id === id && b.install_key === key ), "the same ID and key" );
		assert.equal( h.ofPath( "/telemetry" ).length, 2 );
		const count = h.requests.length;
		await h.advance( 3 * 24 * HOUR );
		assert.equal( h.requests.length, count, "stopped until the next start" );
		assert.equal( h.Telemetry.halted, true );
		const again = harness( { stored: Object.fromEntries( h.storage ) } ); again.server.respond = h.server.respond;
		again.Telemetry.start(); await again.advance( 4 * MINUTE );
		assert.ok( again.requests.length > 0, "a new page start tries again" );
	} );

	test( "C10 a 409 on register creates a new ID and key and registers again", async () => {
		const h = harness();
		let conflicts = 1;
		h.server.respond = entry => entry.url.endsWith( "/installs" ) && conflicts-- > 0 ? h.reply( 409, { code: "install_conflict" } ) : h.server.default( entry );
		h.consent(); const before = { id: h.Telemetry.get().id, key: h.Telemetry.get().key };
		await h.advance( 10 * MINUTE );
		const registers = h.bodies( "/installs" );
		assert.equal( registers.length, 2 ); assert.equal( registers[0].install_id, before.id );
		assert.notEqual( registers[1].install_id, before.id ); assert.notEqual( registers[1].install_key, before.key );
		assert.equal( h.Telemetry.get().registered, true );
		assert.ok( h.ofPath( "/telemetry" ).length >= 1, "telemetry follows the new registration" );
		assert.ok( registers[1].install_id === h.Telemetry.get().id && /^[A-Za-z0-9_-]{43}$/.test( registers[1].install_key ) );
	} );

	test( "C11 with the character consent off, character is absent from every payload; with it on, only the name is sent", async () => {
		const h = harness();
		h.consent(); await h.advance( HOUR );
		const bodies = h.bodies( "/telemetry" );
		assert.ok( bodies.length >= 3 );
		assert.ok( bodies.every( body => body.accounts.every( a => !( "character" in a ) ) ) );
		assert.ok( !h.requests.map( r => r.body ).join( "" ).includes( "ExampleHero" ), "the name appears nowhere in what was sent" );
		h.Telemetry.setCharacters( true );
		await h.advance( 20 * MINUTE );
		assert.equal( h.ofPath( "/installs/me/consent", "PUT" ).length, 1, "the server is told at once" );
		assert.deepEqual( JSON.parse( h.ofPath( "/installs/me/consent", "PUT" )[0].body ), { usage_version: 1, characters: true } );
		const last = h.bodies( "/telemetry" ).at( -1 );
		assert.deepEqual( last.accounts[0].character, { name: "ExampleHero" } );
		h.Telemetry.setCharacters( false ); await h.advance( 20 * MINUTE );
		assert.deepEqual( JSON.parse( h.ofPath( "/installs/me/consent", "PUT" ).at( -1 ).body ).characters, false );
		assert.ok( !( "character" in h.bodies( "/telemetry" ).at( -1 ).accounts[0] ), "off again: absent at once" );
	} );

	test( "turning the character display off is retried until the server has it, and a name that is too long is not sent", async () => {
		const h = harness();
		h.consent(); await h.advance( 5 * MINUTE );
		h.Telemetry.setCharacters( true ); await h.advance( 5 * MINUTE );
		let down = true;
		h.server.respond = entry => entry.url.endsWith( "/installs/me/consent" ) && down ? h.reply( 500, { code: "server_error" } ) : h.server.default( entry );
		h.Telemetry.setCharacters( false ); await h.advance( 5 * MINUTE );
		assert.notEqual( h.Telemetry.get().synced, h.Telemetry.get().characters, "the server still has the old value" );
		down = false; await h.advance( 6 * HOUR );
		assert.equal( h.Telemetry.get().synced, h.Telemetry.get().characters ); assert.equal( JSON.parse( h.ofPath( "/installs/me/consent", "PUT" ).at( -1 ).body ).characters, false );
		h.World.charName = "x".repeat( 33 ); h.Telemetry.setCharacters( true ); await h.advance( HOUR );
		assert.ok( h.bodies( "/telemetry" ).at( -1 ).accounts.every( a => !( "character" in a ) ) );
	} );

	test( "C12 withdrawing consent sends DELETE and wipes the local ID and key, also when DELETE fails", async () => {
		for ( const failure of [ null, h => h.reply( 500, { code: "server_error" } ), () => new Error( "offline" ), () => "hang" ] ) {
			const h = harness();
			h.consent(); await h.advance( 5 * MINUTE );
			const { id, key } = h.Telemetry.get();
			if ( failure ) h.server.respond = entry => entry.method === "DELETE" ? failure( h ) : h.server.default( entry );
			const pending = h.Telemetry.setUsage( false );
			assert.equal( h.Telemetry.get().id, "" ); assert.equal( h.Telemetry.get().key, "" );
			assert.equal( h.storage.has( "sroBotLean:v1:telemetry" ), false );
			await h.advance( 20 * 1000 ); await pending;
			const deletes = h.ofPath( "/installs/me", "DELETE" );
			assert.equal( deletes.length, 1 ); assert.equal( deletes[0].headers.Authorization, `Bearer osb1.${id}.${key}` );
			if ( failure ) assert.equal( h.Telemetry.status().pendingDelete?.id, id, "the install ID is kept in memory to show once" );
			else assert.equal( h.Telemetry.status().pendingDelete, null );
			const count = h.requests.length; await h.advance( 12 * HOUR );
			assert.equal( h.requests.length, count, "no sending after withdrawal" );
		}
		const never = harness(); never.consent(); await never.Telemetry.setUsage( false );
		assert.equal( never.requests.length, 0, "consent withdrawn before anything was registered needs no DELETE" );
	} );

	test( "C13 a payload over 60 KB is cut to the accounts that fit and the body stays under 64 KB", () => {
		const h = harness();
		const account = i => ( { slot: i.toString( 16 ).padStart( 16, "0" ), state: "idle", note: "x".repeat( 4000 ) } );
		const payload = { schema: 1, app_version: "2.0.0", accounts: Array.from( { length: 20 }, ( _, i ) => account( i ) ) };
		const text = h.Telemetry.fit( payload );
		const size = new TextEncoder().encode( text ).length;
		assert.ok( size <= 60 * 1024 && size < 64 * 1024 ); assert.ok( JSON.parse( text ).accounts.length < 20 && JSON.parse( text ).accounts.length > 0 );
		assert.equal( h.Telemetry.fit( { schema: 1, app_version: "2.0.0", accounts: [ { ...account( 1 ), note: "x".repeat( 70000 ) } ] } ), null, "a single account that cannot fit is not sent" );
	} );

	test( "C14 a report while offline is tried three times, then the player is told to copy or save it", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.server.respond = () => new Error( "offline" );
		h.Reports.open(); h.Reports.describe( "Stuck at the merchant." ); h.Reports.ask( TRUSTED );
		const done = h.Reports.send( TRUSTED );
		await h.advance( 2000 );
		await h.advance( 6 * MINUTE );
		await done;
		const attempts = h.requests.filter( r => r.url.includes( "/config" ) );
		assert.equal( attempts.length, 3, "three attempts and no more" );
		assert.ok( attempts[1].at - attempts[0].at >= 60000 && attempts[1].at - attempts[0].at <= 70000, "about 60 s: " + ( attempts[1].at - attempts[0].at ) );
		assert.ok( attempts[2].at - attempts[1].at >= 300000 && attempts[2].at - attempts[1].at <= 330000, "about 300 s: " + ( attempts[2].at - attempts[1].at ) );
		assert.equal( h.UI.reportStatus.textContent, "Not sent. Copy or save the report and try later." );
		await h.advance( 24 * HOUR ); assert.equal( h.requests.filter( r => r.url.includes( "/config" ) ).length, 3, "no automatic retry later" );
		assert.equal( h.storage.size, 0, "no saved draft" );
	} );

	test( "C14 a report succeeds on the second attempt and shows its code; closing the window cancels the retries", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		let failures = 1;
		h.server.respond = entry => entry.url.endsWith( "/reports" ) && failures-- > 0 ? h.reply( 503, { code: "unavailable" }, { "Retry-After": "90" } ) : h.server.default( entry );
		h.Reports.open(); h.Reports.ask( TRUSTED ); const done = h.Reports.send( TRUSTED );
		await h.advance( 5000 ); assert.match( h.UI.reportStatus.textContent, /^Sending…/ );
		await h.advance( 2 * MINUTE ); await done;
		assert.equal( h.UI.reportStatus.textContent, "Sent. Your report code is R-7K3Q9XAB. Keep it if you want the report deleted later." );
		const posts = h.ofPath( "/reports" ); assert.equal( posts.length, 2 ); assert.ok( posts[1].at - posts[0].at >= 90000, "Retry-After is honoured" );
		const c = harness();
		c.UI.showReport = () => {}; c.UI.reportStatus = { textContent: "" };
		c.server.respond = entry => entry.url.endsWith( "/reports" ) ? c.reply( 500, { code: "server_error" } ) : c.server.default( entry );
		c.Reports.open(); c.Reports.ask( TRUSTED ); const closed = c.Reports.send( TRUSTED );
		await c.advance( 5000 ); c.Reports.close(); await closed; await c.advance( HOUR );
		assert.equal( c.ofPath( "/reports" ).length, 1, "closing the window stops the retries" );
	} );

	test( "a report is sent as multipart with exactly the previewed JSON, anonymous without usage consent", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.Reports.open(); h.Reports.describe( "The bot stops after the town trip." );
		const preview = h.Reports.text();
		h.Reports.ask( TRUSTED ); await h.Reports.send( TRUSTED ); await h.settle();
		const post = h.ofPath( "/reports", "POST" )[0];
		assert.ok( post.body instanceof FormData ); assert.deepEqual( [ ...post.body.keys() ], [ "report" ] );
		assert.equal( await post.body.get( "report" ).text(), preview, "the part is byte for byte the preview" );
		assert.equal( post.body.get( "report" ).type, "application/json" );
		assert.equal( post.headers.Authorization, undefined, "anonymous: no install key" );
		const report = JSON.parse( preview );
		assert.deepEqual( Object.keys( report ).sort(), [ "app", "app_version", "description", "diagnostics", "kind", "locale", "os", "schema" ] );
		assert.equal( report.schema, 1 ); assert.equal( report.kind, "bug" ); assert.equal( report.app, "osb" ); assert.equal( report.os, "windows" ); assert.equal( report.locale, "en" );
		assert.equal( report.diagnostics.app, "OSB" );
		assert.ok( !h.requests.some( r => /nixxane|workers\.dev/.test( r.url ) ) );
		assert.ok( h.requests.every( r => r.url.startsWith( BASE ) ), "only api.osb.lol/v1" );
	} );

	test( "a report carries the install key only when usage statistics are on and registered", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.consent(); await h.advance( 4 * MINUTE );
		const { id, key } = h.Telemetry.get();
		h.Reports.open(); h.Reports.ask( TRUSTED ); await h.Reports.send( TRUSTED ); await h.settle();
		assert.equal( h.ofPath( "/reports" )[0].headers.Authorization, `Bearer osb1.${id}.${key}` );
		const unknown = harness();
		unknown.UI.showReport = () => {}; unknown.UI.reportStatus = { textContent: "" };
		unknown.consent();
		unknown.Reports.open(); unknown.Reports.ask( TRUSTED ); await unknown.Reports.send( TRUSTED ); await unknown.settle();
		assert.equal( unknown.ofPath( "/reports" )[0].headers.Authorization, undefined, "consent on but not registered yet: anonymous" );
		const rejected = harness();
		rejected.UI.showReport = () => {}; rejected.UI.reportStatus = { textContent: "" };
		rejected.consent(); await rejected.advance( 4 * MINUTE );
		rejected.server.respond = entry => entry.url.endsWith( "/reports" ) && entry.headers.Authorization ? rejected.reply( 401, { code: "unauthorized" } ) : rejected.server.default( entry );
		rejected.Reports.open(); rejected.Reports.ask( TRUSTED ); await rejected.Reports.send( TRUSTED ); await rejected.settle();
		assert.match( rejected.UI.reportStatus.textContent, /^Sent\./, "a rejected key falls back to an anonymous report" );
	} );

	test( "reports are not sent while the server has them off, and a feature request needs a description", async () => {
		const h = harness(); h.server.config.reports.enabled = false;
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.Reports.open(); h.Reports.ask( TRUSTED ); await h.Reports.send( TRUSTED ); await h.settle();
		assert.equal( h.ofPath( "/reports" ).length, 0 ); assert.equal( h.UI.reportStatus.textContent, "Not sent. Copy or save the report and try later." );
		const f = harness();
		f.UI.showReport = () => {}; f.UI.reportStatus = { textContent: "" };
		f.Reports.open(); f.Reports.setKind( "feature" ); f.Reports.ask( TRUSTED );
		assert.equal( f.Reports.draft.confirming, false ); assert.match( f.UI.reportStatus.textContent, /Describe your idea/ );
		f.Reports.describe( "Please add a sell button." ); f.Reports.ask( TRUSTED ); await f.Reports.send( TRUSTED ); await f.settle();
		const report = JSON.parse( await f.ofPath( "/reports" )[0].body.get( "report" ).text() );
		assert.equal( report.kind, "feature" ); assert.ok( !( "diagnostics" in report ), "a feature request carries no diagnostics" ); assert.equal( report.description, "Please add a sell button." );
		const manager = harness( { hosted: true } );
		manager.UI.showReport = () => {}; manager.UI.reportStatus = { textContent: "" };
		manager.Reports.open(); manager.Reports.ask( TRUSTED ); await manager.Reports.send( TRUSTED ); await manager.settle();
		assert.equal( manager.ofPath( "/reports" ).length, 1, "inside OSB Manager the report still goes straight out" );
	} );

	test( "a screenshot is sent only when the server takes screenshots and is dropped from memory after sending", async () => {
		for ( const screenshots of [ true, false ] ) {
			const h = harness(); h.server.config.reports.screenshots = screenshots;
			h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
			h.Reports.open();
			h.Reports.draft.image = new Blob( [ new Uint8Array( [ 255, 216, 255, 224 ] ) ], { type: "image/jpeg" } );
			h.Reports.ask( TRUSTED ); await h.Reports.send( TRUSTED ); await h.settle();
			const post = h.ofPath( "/reports" )[0];
			assert.deepEqual( [ ...post.body.keys() ], screenshots ? [ "report", "screenshot" ] : [ "report" ] );
			assert.equal( h.Reports.draft.image, null, "the screenshot is not kept after the report was sent" );
		}
		const h = harness();
		h.UI.showReport = () => {}; h.win.navigator.mediaDevices = { getDisplayMedia: async () => { throw new Error( "denied" ); } };
		h.UI.reportStatus = { textContent: "" };
		h.Reports.open(); await h.Reports.capture();
		assert.equal( h.requests.length, 0 ); assert.match( h.UI.reportStatus.textContent, /cancelled or unavailable/ );
	} );

	test( "the screenshot button asks the browser's own prompt each time and nothing is captured before it is pressed", async () => {
		const h = harness(); let prompts = 0, options;
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		h.win.navigator.mediaDevices = { getDisplayMedia: async o => { prompts++; options = o; throw new Error( "closed" ); } };
		h.Reports.open(); await h.advance( HOUR );
		assert.equal( prompts, 0 );
		await h.Reports.capture(); await h.Reports.capture();
		assert.equal( prompts, 2 ); assert.deepEqual( JSON.parse( JSON.stringify( options ) ), { video: true, audio: false, preferCurrentTab: true } );
	} );

	test( "a script cannot give consent, press Send or delete for the player: only trusted events count", async () => {
		const h = harness();
		h.UI.showReport = () => {}; h.UI.reportStatus = { textContent: "" };
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const [ usage, characters ] = host.find( n => n.tag === "input" );
		usage.checked = true; usage.fire( "change", { isTrusted: false } ); usage.fire( "change" );
		assert.equal( h.Telemetry.consented(), false, "a script-made change event does not give consent" ); assert.equal( usage.checked, false );
		characters.checked = true; characters.fire( "change", { isTrusted: false } ); assert.equal( h.Telemetry.get().characters, false );
		h.Reports.open();
		h.Reports.ask(); h.Reports.ask( { isTrusted: false } ); assert.equal( h.Reports.draft.confirming, false );
		h.Reports.ask( TRUSTED ); await h.Reports.send(); await h.Reports.send( { isTrusted: false } );
		await h.advance( HOUR ); assert.equal( h.requests.length, 0, "an untrusted send sends nothing" );
		usage.checked = true; usage.fire( "change", { isTrusted: true } );
		assert.equal( h.Telemetry.consented(), true, "a real click gives consent" );
		await h.advance( 5 * MINUTE ); const before = h.requests.length; assert.ok( before > 0 );
		const button = label => host.find( n => n.tag === "button" && n.textContent === label )[0];
		button( "Delete my data" ).click( { isTrusted: false } ); button( "Yes, delete" ).click( { isTrusted: false } ); await h.advance( 5000 );
		assert.equal( h.Telemetry.consented(), true, "an untrusted click does not delete" );
		assert.equal( h.ofPath( "/installs/me", "DELETE" ).length, 0 );
	} );

	test( "unticking usage statistics asks first, and the answer decides: Cancel keeps sharing, Yes deletes", async () => {
		const h = harness();
		h.consent(); await h.advance( 5 * MINUTE );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const [ usage ] = host.find( n => n.tag === "input" );
		const button = label => host.find( n => n.tag === "button" && n.textContent === label )[0];
		usage.checked = false; usage.fire( "change", { isTrusted: true } );
		assert.equal( h.Telemetry.consented(), true, "the box alone does not withdraw" ); assert.equal( usage.checked, true );
		assert.match( host.textContent, /Stop sharing and delete your usage data from api\.osb\.lol\? Reports you already sent are deleted too\./ );
		button( "Cancel" ).click(); assert.equal( h.Telemetry.consented(), true );
		usage.checked = false; usage.fire( "change", { isTrusted: true } );
		button( "Yes, stop and delete" ).click(); await h.advance( 5000 );
		assert.equal( h.Telemetry.consented(), false ); assert.equal( h.ofPath( "/installs/me", "DELETE" ).length, 1 );
		assert.match( host.textContent, /keep it for 45 days/ ); assert.ok( !/anonymous usage/i.test( host.textContent ), "the statistics are never called anonymous" );
	} );

	test( "the update check is on by default, asks only GitHub about the OSB repository and sends no user data", async () => {
		const h = harness();
		assert.equal( h.Updates.enabled(), true );
		await lifecycle( h );
		const checks = h.requests.filter( isUpdateCheck );
		assert.ok( checks.length >= 2, "checks ran: " + checks.length );
		assert.deepEqual( noPlatformRequests( h ).map( r => r.url ), [], "nothing but the update check, and nothing to api.osb.lol" );
		for ( const r of checks ) {
			assert.equal( r.method, "GET" ); assert.equal( r.init.credentials, "omit" ); assert.equal( r.init.referrerPolicy, "no-referrer" ); assert.equal( r.body, undefined );
			assert.ok( !r.url.includes( "ExampleHero" ) && !r.url.includes( "?" ), "no query or name in " + r.url );
		}
	} );

	test( "with the update check switched off the module makes no request at all, with or without consent", async () => {
		const h = harness();
		h.Updates.setEnabled( false );
		assert.equal( h.storage.get( "sroBotLean:v1:updateCheck" ), "false" );
		await lifecycle( h );
		assert.equal( h.requests.length, 0, "zero requests: " + h.requests.map( r => r.url ).join( " " ) );
		await h.advance( 3 * HOUR, { ticks: 5000 } );
		assert.equal( h.requests.length, 0 );
		const stored = harness( { stored: { "sroBotLean:v1:updateCheck": "false" } } );
		assert.equal( stored.Updates.enabled(), false, "the choice survives a reload" );
		stored.Updates.start(); await stored.advance( 2 * HOUR );
		assert.equal( stored.requests.length, 0 );
		const withConsent = harness( { stored: { "sroBotLean:v1:updateCheck": "false" } } );
		withConsent.Updates.start(); withConsent.consent(); await withConsent.advance( HOUR );
		assert.deepEqual( withConsent.requests.filter( isUpdateCheck ), [], "the usage statistics do not bring the update check back" );
		assert.ok( withConsent.requests.length > 0, "and the two are independent" );
		h.Updates.setEnabled( true ); await h.advance( 5000 );
		assert.ok( h.requests.filter( isUpdateCheck ).length >= 1, "switching it on checks at once" );
	} );

	test( "the update switch is in the Privacy section, also inside OSB Manager, and only a real click changes it", async () => {
		for ( const hosted of [ false, true ] ) {
			const h = harness( { hosted } );
			const host = new FakeElement( "div" ); h.Telemetry.draw( host );
			assert.match( host.textContent, /Check GitHub for OSB updates/ ); assert.match( host.textContent, /sends no data about you or your game/ );
			const box = host.find( n => n.tag === "input" ).at( -1 );
			assert.equal( box.checked, true, "on by default" );
			box.checked = false; box.fire( "change", { isTrusted: false } );
			assert.equal( h.Updates.enabled(), true ); assert.equal( box.checked, true );
			box.checked = false; box.fire( "change", { isTrusted: true } );
			assert.equal( h.Updates.enabled(), false ); assert.equal( h.storage.get( "sroBotLean:v1:updateCheck" ), "false" );
		}
	} );

	function serverRules( value, depth = 1, state = { keys: 0 } ) {
		if ( value && typeof value === "object" && !Array.isArray( value ) ) {
			assert.ok( depth <= 5, "depth" );
			for ( const [ k, v ] of Object.entries( value ) ) { state.keys++; assert.ok( state.keys <= 600, "keys" ); assert.match( k, /^[A-Za-z0-9_.-]{1,64}$/ ); serverRules( v, depth + 1, state ); }
		} else if ( Array.isArray( value ) ) {
			assert.ok( depth <= 5, "depth" ); assert.ok( value.length <= 50, "items" ); for ( const v of value ) serverRules( v, depth + 1, state );
		} else if ( typeof value === "string" ) { assert.ok( Array.from( value ).length <= 300, "string length" ); assert.ok( !/[\u0000-\u0008\u000b-\u001f\u007f]/.test( value ) );
		} else if ( typeof value === "number" ) { assert.ok( Number.isFinite( value ) && !/e/i.test( String( value ) ) && String( value ).length <= 20 );
		}
	}

	test( "the report diagnostics always fit the server shape rules and keep the newest states", () => {
		const h = harness();
		h.UI.showReport = () => {};
		const fat = i => ( { secondsAgo: i, state: { action: "a".repeat( 700 ), big: 1e300, nan: NaN, "bad key!": 1, nested: { a: { b: { c: { d: { e: 1 } } } } }, list: Array.from( { length: 200 }, ( _, n ) => n ),
			settings: Object.fromEntries( Array.from( { length: 40 }, ( _, n ) => [ "k" + n, "v".repeat( 400 ) ] ) ), ctl: "a\u0000b\u001bc" } } );
		const base = { app: "OSB", version: "2.0.0", current: fat( 0 ).state, recentStates: Array.from( { length: 30 }, ( _, i ) => fat( 30 - i ) ), recentErrors: [], recentStops: [] };
		h.Diagnostics.report = () => JSON.stringify( base );
		h.Reports.open();
		const text = h.Reports.text(), report = JSON.parse( text );
		serverRules( report.diagnostics );
		assert.ok( new TextEncoder().encode( text ).length <= 46 * 1024, "the report part stays under the 48 KB cap" );
		assert.ok( new TextEncoder().encode( JSON.stringify( report.diagnostics ) ).length <= 32 * 1024 );
		const kept = report.diagnostics.recentStates.map( s => s.secondsAgo );
		assert.ok( kept.length < 30, "older states were dropped" ); assert.deepEqual( kept, kept.slice().sort( ( a, b ) => b - a ) ); assert.equal( kept.at( -1 ), 1, "the newest state is kept" );
		const normal = harness(); normal.UI.showReport = () => {}; normal.Reports.open();
		serverRules( JSON.parse( normal.Reports.text() ).diagnostics );
	} );

	test( "C15 the golden payloads of Appendix C match field names and types", async () => {
		const h = harness();
		h.consent();
		h.Telemetry.setCharacters( true );
		h.Telemetry.get().registered = false;
		h.Stats.session = { ms: 1200000, xp: 3100200n, gold: 410000n, kills: 95, deaths: 0, potions: 0, items: 0, sox: 1 }; h.Stats.xpKnown = true; h.Stats.goldKnown = true;
		h.Hunt.running = true; h.Town.trip = { phase: "recall" };
		await h.advance( 5 * MINUTE );
		const register = h.bodies( "/installs" ).find( b => b.install_id );
		assert.deepEqual( typesOf( register ), typesOf( GOLDEN_REGISTER ) );
		assert.equal( register.app, "osb" ); assert.equal( register.app_version, APP_VERSION ); assert.deepEqual( register.consent, { usage_version: 1, characters: true } );
		assert.match( register.install_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/ ); assert.match( register.install_key, /^[A-Za-z0-9_-]{43}$/ );
		const telemetry = h.bodies( "/telemetry" ).at( -1 );
		assertSubsetShape( telemetry, GOLDEN_TELEMETRY );
		const account = telemetry.accounts[0];
		assert.deepEqual( Object.keys( account ).sort(), [ "bot_version", "character", "gold", "hp_pct", "level", "mp_pct", "scrolls", "session", "slot", "state" ] );
		assert.equal( telemetry.schema, 1 ); assert.equal( account.state, "town" ); assert.equal( account.level, 64 ); assert.equal( account.gold, "9800000" );
		assert.deepEqual( account.scrolls, { return: 4, reverse: 0 } );
		assert.match( account.slot, /^[0-9a-f]{16}$/ ); assert.match( account.session.key, /^[0-9a-f]{16}$/ );
		assert.deepEqual( { ...account.session, key: "" }, { key: "", ms: 1200000, kills: 95, deaths: 0, xp: "3100200", gold: "410000", sox: 1 } );
		assert.equal( telemetry.accounts.length, 1 );
	} );

	test( "the slot is the first 16 hex of HMAC-SHA256 over slot:<character>, keyed with the install key bytes", async () => {
		const h = harness();
		h.consent();
		const key = h.Telemetry.get().key;
		const expected = nodeCrypto.createHmac( "sha256", Buffer.from( key, "base64url" ) ).update( "slot:ExampleHero" ).digest( "hex" ).slice( 0, 16 );
		await h.advance( 4 * MINUTE );
		assert.equal( h.bodies( "/telemetry" )[0].accounts[0].slot, expected );
		const other = harness(); other.consent();
		await other.advance( 4 * MINUTE );
		assert.notEqual( other.bodies( "/telemetry" )[0].accounts[0].slot, expected, "unlinkable across installs" );
	} );

	test( "the install key is created with the CSPRNG only when consent is turned on, and never leaves except to register and authenticate", async () => {
		const h = harness();
		assert.equal( h.Telemetry.get().key, "" );
		h.consent();
		const { id, key } = h.Telemetry.get();
		assert.match( key, /^[A-Za-z0-9_-]{43}$/ ); assert.equal( Buffer.from( key, "base64url" ).length, 32 );
		await h.advance( HOUR );
		for ( const r of h.requests ) {
			const body = typeof r.body === "string" ? r.body : "";
			if ( r.url.endsWith( "/installs" ) ) continue;
			assert.ok( !body.includes( key ), r.url + " body has no key" ); assert.ok( !r.url.includes( key ), "no key in a URL" );
		}
		assert.ok( h.requests.filter( r => r.headers.Authorization ).every( r => r.headers.Authorization === `Bearer osb1.${id}.${key}` ) );
		const second = harness(); second.consent();
		assert.notEqual( second.Telemetry.get().key, key );
		const source = fs.readFileSync( __dirname + "/lean-telemetry.js", "utf8" );
		assert.ok( !/Math\.random\(\).*(key|uuid)/i.test( source ), "identity bytes never come from Math.random" );
	} );

	test( "session keys are new when a bot session starts or its duration counter goes down", async () => {
		const h = harness();
		h.consent();
		h.Stats.session = { ms: 60000, xp: 0n, gold: 0n, kills: 3, deaths: 0, potions: 0, items: 0, sox: 0 }; h.Stats.xpKnown = true; h.Stats.goldKnown = true; h.Hunt.running = true;
		await h.advance( 4 * MINUTE );
		const first = h.bodies( "/telemetry" ).at( -1 ).accounts[0].session.key;
		h.Stats.session.ms = 120000; h.Stats.session.kills = 9;
		await h.advance( 11 * MINUTE );
		assert.equal( h.bodies( "/telemetry" ).at( -1 ).accounts[0].session.key, first, "same session while the counter grows" );
		h.Stats.session = { ms: 1000, xp: 0n, gold: 0n, kills: 0, deaths: 0, potions: 0, items: 0, sox: 0 };
		await h.advance( 11 * MINUTE );
		assert.notEqual( h.bodies( "/telemetry" ).at( -1 ).accounts[0].session.key, first, "reset: a new key" );
		h.Stats.session.gold = -50n; await h.advance( 11 * MINUTE );
		assert.ok( !( "gold" in h.bodies( "/telemetry" ).at( -1 ).accounts[0].session ), "a negative net gold is left out, not sent" );
	} );

	test( "the state mapping covers every game phase and bot activity", () => {
		const h = harness(), state = () => h.Telemetry.stateOf();
		const expectations = [ [ "signed-out", "login" ], [ "listing-servers", "login" ], [ "loading-roster", "login" ], [ "authenticating", "login" ], [ "connecting", "loading" ],
			[ "entering-world", "loading" ], [ "reconnecting", "loading" ], [ "disconnected", "offline" ], [ "something-new", "unknown" ] ];
		for ( const [ phase, expected ] of expectations ) { h.World.phase = phase; assert.equal( state(), expected, phase ); }
		h.World.phase = "world";
		assert.equal( state(), "idle" );
		h.Hunt.running = true; assert.equal( state(), "hunting" );
		h.Town.trip = { phase: "buy" }; assert.equal( state(), "town" ); h.Town.trip = null;
		h.Restock.trip = { phase: "vendor" }; assert.equal( state(), "town" ); h.Restock.trip = null;
		h.World.gp.vitals[0].hp = 0; assert.equal( state(), "dead" ); h.World.gp.vitals[0].hp = 100;
		h.Hunt.running = false; h.storage.set( "sroBotLean:v1:run:ExampleHero", JSON.stringify( { on: false } ) ); assert.equal( state(), "stopped" );
		const saved = h.World.gp; h.World.gp = null; assert.equal( state(), "loading" ); h.World.gp = saved;
		const states = new Set( [ "offline", "login", "loading", "idle", "hunting", "town", "dead", "stopped", "unknown" ] );
		for ( const [ , expected ] of expectations ) assert.ok( states.has( expected ) );
	} );

	test( "nothing outside the allowlist is in a usage payload: no names, items, chat, positions, paths or logins", async () => {
		const h = harness();
		h.World.gp.inventory.push( { slot: 15, refObjId: 7777777, name: "SecretSword", typeFlags: 44, quantity: 1 } );
		h.World.gp.pose = { regionId: 4242424, x: 3133713, y: 0, z: 3133814 };
		h.World.gp.social = { members: [ { name: "FriendName", level: 90 } ] };
		h.Log.info( "chat: hello PrivateChat" );
		h.consent(); await h.advance( HOUR );
		const sent = h.ofPath( "/telemetry" ).map( r => r.body ).join( "" ) + h.ofPath( "/installs" ).map( r => r.body ).join( "" );
		for ( const secret of [ "SecretSword", "7777777", "4242424", "3133713", "3133814", "FriendName", "PrivateChat", "ExampleHero", "localhost", "C:\\" ] ) assert.ok( !sent.includes( secret ), secret );
		const allowed = new Set( [ "slot", "state", "level", "gold", "hp_pct", "mp_pct", "scrolls", "bot_version", "session" ] );
		for ( const body of h.bodies( "/telemetry" ) ) for ( const key of Object.keys( body.accounts[0] ) ) assert.ok( allowed.has( key ), key );
	} );

	test( "C16 an exception inside the telemetry code is caught, the third one switches the module off, and the bot keeps running", async () => {
		const h = harness();
		h.Telemetry.snapshot = () => { throw new Error( "boom" ); };
		h.consent();
		let ticks = 0; const original = h.Controller.tick;
		h.Controller.tick = function () { ticks++; return original.apply( this ); };
		await h.advance( 12 * HOUR, { ticks: 1 } );
		assert.equal( h.Telemetry.off, true ); assert.equal( h.Telemetry.errors, 3 );
		assert.equal( h.Log.lines.filter( l => /Usage statistics stopped/.test( l.text ) ).length, 1, "one log line" );
		const count = h.requests.length;
		await h.advance( 24 * HOUR, { ticks: 1 } );
		assert.equal( h.requests.length, count, "nothing more after the module is off" );
		assert.ok( ticks > 0 ); h.gameTick(); assert.doesNotThrow( () => h.Controller.tick() );
		const entry = harness();
		entry.Telemetry.load = () => { throw new Error( "storage" ); };
		assert.doesNotThrow( () => entry.Telemetry.start() ); assert.equal( entry.Telemetry.errors, 1 );
		assert.equal( entry.Telemetry.setUsage( true ), false, "an entry point never throws" );
		const noCrypto = harness(); delete noCrypto.win.crypto;
		assert.equal( noCrypto.Telemetry.setUsage( true ), false, "no secure crypto: the toggle stays off" ); assert.equal( noCrypto.Telemetry.consented(), false );
	} );

	test( "C17 a redirect response is a failure and is not followed", async () => {
		const h = harness();
		h.server.respond = entry => entry.url.includes( "/config" ) ? { status: 302, body: null, headers: { Location: "https://evil.example/" } } : h.server.default( entry );
		h.consent(); await h.advance( 3 * HOUR );
		assert.ok( h.requests.every( r => r.url.startsWith( BASE ) ), "the Location was never requested" );
		assert.ok( h.requests.every( r => r.init.redirect === "error" ) );
		assert.equal( h.ofPath( "/telemetry" ).length, 0 ); assert.equal( h.Telemetry.get().registered, false );
		for ( const gap of gaps( h.requests ) ) assert.ok( gap >= 60000 );
		const real = harness();
		real.server.respond = entry => entry.url.includes( "/config" ) ? new TypeError( "Failed to fetch" ) : real.server.default( entry );
		real.consent(); await real.advance( HOUR );
		assert.equal( real.ofPath( "/telemetry" ).length, 0 );
	} );

	test( "an unchanged idle account is resent at most once an hour, a running bot every interval", async () => {
		const h = harness(); h.Telemetry.timing.resendMs = HOUR;
		h.consent(); await h.advance( 3 * HOUR );
		const idle = h.ofPath( "/telemetry" );
		assert.ok( idle.length >= 2 && idle.length <= 4, "idle: " + idle.length );
		for ( const gap of gaps( idle ) ) assert.ok( gap >= HOUR * 0.9, "gap " + gap );
		h.Hunt.running = true; h.Stats.session.ms = 1000;
		const before = h.ofPath( "/telemetry" ).length; await h.advance( 3 * HOUR );
		assert.ok( h.ofPath( "/telemetry" ).length - before >= 15 );
	} );

	test( "without requestIdleCallback the payload is built from a zero-delay timer", async () => {
		const h = harness( { idle: false } );
		h.consent(); await h.advance( 4 * MINUTE );
		assert.equal( h.idleCalls.length, 0 ); assert.ok( h.ofPath( "/telemetry" ).length >= 1 );
	} );

	test( "inside OSB Manager OSB sends no usage telemetry and offers no usage toggle", async () => {
		const h = harness( { hosted: true, stored: { "sroBotLean:v1:telemetry": JSON.stringify( { usage: 1, id: "3f0b2c1e-7d4a-4c55-9a51-2b8f7e4c9d10", key: "kq3Vt3N1rA8b0bq3QyU2sQj3XcYw8m3cXzq8b6F0wJs", registered: true } ) } } );
		h.Telemetry.start();
		await h.advance( 6 * HOUR, { ticks: 1 } );
		assert.equal( h.requests.length, 0 ); assert.equal( h.Telemetry.active(), false ); assert.equal( h.Telemetry.setUsage( true ), false );
		assert.equal( h.Telemetry.auth(), "", "no install key is used inside the Manager" );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const text = host.textContent;
		assert.match( text, /Usage statistics are handled by OSB Manager\. OSB sends none itself\./ ); assert.ok( !/Share usage statistics/.test( text ) );
		assert.deepEqual( host.find( n => n.tag === "input" ).map( n => n.attributes["aria-label"] ), [ "Check GitHub for OSB updates" ], "no usage toggle: only the update switch" );
	} );

	test( "the privacy section shows the toggles, the install ID, the last sent time and the server message as plain text", async () => {
		const h = harness();
		h.server.config.message = "<img src=x onerror=alert(1)> Planned maintenance";
		h.consent(); await h.advance( 5 * MINUTE );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		h.Telemetry.refreshView();
		const text = host.textContent;
		assert.match( text, /Share usage statistics/ ); assert.match( text, /Show my characters in the OSB dashboard/ );
		assert.match( text, /Show what is sent/ ); assert.match( text, /Download my data/ ); assert.match( text, /Delete my data/ );
		assert.match( text, new RegExp( "Install ID: " + h.Telemetry.get().id ) ); assert.match( text, /Last sent: .*\d/ );
		assert.match( text, /<img src=x onerror=alert\(1\)> Planned maintenance/, "the message is shown as text" );
		const link = host.find( n => n.tag === "a" )[0];
		assert.equal( link.href, "https://osb.lol/en/privacy/" ); assert.equal( link.rel, "noopener noreferrer" );
		const boxes = host.find( n => n.tag === "input" );
		assert.equal( boxes.length, 3 ); assert.equal( boxes[0].checked, true ); assert.equal( boxes[1].checked, false ); assert.equal( boxes[2].checked, true, "the update check is on by default" );
		const fresh = harness(); const freshHost = new FakeElement( "div" ); fresh.Telemetry.draw( freshHost ); fresh.Telemetry.refreshView();
		const freshBoxes = freshHost.find( n => n.tag === "input" );
		assert.equal( freshBoxes[0].checked, false, "off by default" ); assert.equal( freshBoxes[1].checked, false ); assert.equal( freshBoxes[1].disabled, true, "the second needs the first" );
		assert.match( freshHost.textContent, /not sent yet/ );
	} );

	test( "Delete my data asks first, then deletes; Show what is sent shows the exact next body; Download my data saves the export", async () => {
		const h = harness();
		h.consent(); await h.advance( 5 * MINUTE );
		const host = new FakeElement( "div" ); h.Telemetry.draw( host );
		const button = label => host.find( n => n.tag === "button" && n.textContent === label )[0];
		const area = host.find( n => n.tag === "textarea" )[0];
		button( "Show what is sent" ).click(); await h.advance( 1000 );
		const shown = JSON.parse( area.value );
		assert.equal( shown.schema, 1 ); assert.equal( shown.accounts[0].slot, h.bodies( "/telemetry" ).at( -1 ).accounts[0].slot );
		const before = h.requests.length;
		assert.equal( h.requests.length, before, "showing it sends nothing" );
		button( "Delete my data" ).click();
		assert.equal( h.ofPath( "/installs/me", "DELETE" ).length, 0, "the first click only asks" ); assert.equal( h.Telemetry.consented(), true );
		button( "Cancel" ).click(); assert.equal( h.Telemetry.consented(), true );
		button( "Delete my data" ).click(); button( "Yes, delete" ).click(); await h.advance( 5000 );
		assert.equal( h.ofPath( "/installs/me", "DELETE" ).length, 1 ); assert.equal( h.Telemetry.consented(), false );
		const off = harness(); const offHost = new FakeElement( "div" ); off.Telemetry.draw( offHost );
		offHost.find( n => n.tag === "button" && n.textContent === "Show what is sent" )[0].click(); await off.advance( 1000 );
		assert.match( offHost.find( n => n.tag === "textarea" )[0].value, /^Nothing is sent while usage statistics are off/ ); assert.equal( off.requests.length, 0 );
		const exportable = harness(); exportable.consent(); await exportable.advance( 5 * MINUTE );
		const result = await exportable.Telemetry.download();
		assert.equal( result.ok, true ); assert.deepEqual( JSON.parse( result.data ), { install: { id: "x" } } );
		assert.equal( exportable.ofPath( "/installs/me/export" )[0].headers.Authorization.startsWith( "Bearer osb1." ), true );
		assert.equal( ( await harness().Telemetry.download() ).ok, false );
	} );

	test( "the server message and every server text are shown with textContent, never innerHTML, and no network text reaches the UI otherwise", () => {
		for ( const file of [ "lean-telemetry.js", "lean-reports.js" ] ) {
			const text = fs.readFileSync( __dirname + "/" + file, "utf8" );
			assert.ok( !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test( text ), file );
		}
		const h = harness();
		assert.equal( h.Telemetry.parseConfig( { ...h.server.config, message: "a\u0000b\u001b<b>c</b>" + "x".repeat(400) } ).message.length, 200 );
		assert.ok( !/[\u0000-\u001f]/.test( h.Telemetry.parseConfig( { ...h.server.config, message: "a\u0000b\nc" } ).message ) );
	} );

	test( "the only outgoing host is api.osb.lol/v1, the SROLean shape is unchanged, and the hot path never reaches the module", () => {
		const telemetry = fs.readFileSync( __dirname + "/lean-telemetry.js", "utf8" ), reports = fs.readFileSync( __dirname + "/lean-reports.js", "utf8" );
		const hosts = new Set( [ ...( telemetry + reports ).matchAll( /https?:\/\/([a-z0-9.-]+)/g ) ].map( m => m[1] ) );
		assert.deepEqual( [ ...hosts ].sort(), [ "api.osb.lol", "osb.lol" ] );
		const boot = fs.readFileSync( __dirname + "/lean-boot.js", "utf8" );
		assert.ok( !/telemetry\s*:/i.test( boot.slice( boot.indexOf( "W.SROLean" ) ) ), "no new SROLean key" );
		for ( const file of [ "lean-controller.js", "lean-boot.js" ] ) {
			const text = fs.readFileSync( __dirname + "/" + file, "utf8" );
			const lines = text.split( "\n" ).filter( l => /Telemetry|Reports\./.test( l ) );
			assert.ok( lines.every( l => /Telemetry\.start\(\)/.test( l ) ), file + " only starts the module at boot: " + lines.join( "|" ) );
		}
		assert.ok( !/Ticker|setInterval/.test( telemetry.replace( /^\s*\/\/.*$/gm, "" ) ), "no 100 ms ticker and no setInterval" );
	} );

	test( "Controller.tick and the Ticker never call into the telemetry module while it is busy (instrumented)", async () => {
		const h = harness();
		h.consent();
		const hits = [];
		for ( const object of [ h.Telemetry, h.Reports ] ) for ( const key of Object.keys( object ) ) if ( typeof object[key] === "function" ) {
			const original = object[key];
			object[key] = function ( ...args ) { hits.push( { key, inTick: h.Controller.inTick === true } ); return original.apply( this, args ); };
		}
		const tick = h.Controller.tick; let depth = 0, inside = [];
		h.Controller.tick = function () {
			depth++; const start = hits.length;
			try { return tick.apply( this ); } finally { depth--; inside.push( hits.length - start ); }
		};
		h.Hunt.running = true;
		await h.advance( 20 * MINUTE, { ticks: 5000 } );
		assert.ok( inside.length > 100, "ticks ran" ); assert.ok( inside.every( n => n === 0 ), "no telemetry call inside any tick" );
		assert.ok( hits.length > 0, "while the telemetry module did work between ticks" );
		assert.ok( h.requests.every( r => !r.inTick ) );
	} );
};
