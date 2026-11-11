module.exports = function safetyTests({ test, fixture, townFixture }) {
  const assert = require('node:assert/strict');
  test('safety triggers are off by default, and old profiles load with them off', () => {
    const f = fixture();
    assert.deepEqual(JSON.parse(JSON.stringify(f.Settings.profile.hunt.safety)), { deaths: 0, party: { min: 0, action: 'stop' }, player: { on: false, action: 'stop' }, unique: { on: false, meters: 50, action: 'stop' } });
    const old = f.botProfile({ macro: { castGapMs: 400 }, hunt: { radius: 300 } });
    assert.equal(old.hunt.safety.deaths, 0); assert.equal(old.hunt.safety.player.on, false); assert.equal(old.hunt.safety.party.min, 0); assert.equal(old.hunt.safety.unique.on, false);
    const junk = f.botProfile({ hunt: { safety: { deaths: 'x', party: { min: 99, action: 'bogus' }, player: { on: 'yes', action: 'town' }, unique: { on: true, meters: -4, action: 'town' } } } });
    assert.equal(junk.hunt.safety.deaths, 0); assert.equal(junk.hunt.safety.party.min, 8); assert.equal(junk.hunt.safety.party.action, 'stop');
    assert.equal(junk.hunt.safety.player.on, false); assert.equal(junk.hunt.safety.player.action, 'town'); assert.equal(junk.hunt.safety.unique.meters, 5);
  });
  test('safety triggers travel through share codes and backups', () => {
    const f = fixture(), p = f.Settings.profile;
    p.hunt.safety.deaths = 3; p.hunt.safety.party = { min: 3, action: 'town' }; p.hunt.safety.player.on = true; p.hunt.safety.unique = { on: true, meters: 80, action: 'town' };
    const g = fixture(), back = g.ProfileShare.build(JSON.parse(f.ProfileShare.text(true)).profile);
    assert.deepEqual(JSON.parse(JSON.stringify(back.hunt.safety)), JSON.parse(JSON.stringify(p.hunt.safety)));
    assert.deepEqual(JSON.parse(JSON.stringify(g.botProfile(JSON.parse(JSON.stringify(p))).hunt.safety)), JSON.parse(JSON.stringify(p.hunt.safety)));
    assert.equal(g.ProfileShare.build({ hunt: { radius: 200 } }).hunt.safety.deaths, 0);
  });
  function safetyFixture(patch = {}) {
    const f = fixture(); f.World.charName = 'Hero'; f.Settings.profile.hunt.onDeath = 'revive';
    const s = f.Settings.profile.hunt.safety;
    s.deaths = patch.deaths ?? 0; Object.assign(s.party, patch.party || {}); Object.assign(s.player, patch.player || {}); Object.assign(s.unique, patch.unique || {});
    f.Hunt.start(); f.RunIntent.set(true); f.Controller.tick();
    return f;
  }
  const dies = f => { f.World.ents.get(1).appearanceState = [2, 0, 0]; f.bus.emit('death', f.World.ents.get(1)); f.Controller.tick(); };
  const revives = f => { f.World.ents.get(1).appearanceState = [0, 0, 0]; f.Controller.tick(); };
  const lastStop = f => f.Diagnostics.stops.at(-1)?.reason || '';
  test('safety: the death limit stops the bot at the Nth death, counts each death once and starts over with a new start', () => {
    const f = safetyFixture({ deaths: 2 });
    dies(f); assert.equal(f.Hunt.running, true, 'one death is below the limit');
    f.Controller.tick(); f.Controller.tick(); revives(f);
    dies(f); assert.equal(f.Hunt.running, false, 'the second death stops it');
    assert.match(lastStop(f), /^safety: 2 deaths this session/);
    assert.ok(f.notices.some(n => /Safety: 2 deaths this session/.test(n)));
    assert.equal(f.RunIntent.stopped(), true, 'a safety stop is the choice of the player');
    revives(f); f.advance(5000); f.Controller.tick();
    f.Hunt.start(); f.Controller.tick(); dies(f); assert.equal(f.Hunt.running, true, 'the count began again with the new start');
    const g = safetyFixture({ deaths: 0 }); dies(g); revives(g); dies(g); assert.equal(g.Hunt.running, true, '0 = off');
  });
  test('safety: a party that is too small waits 10 seconds, then stops; no party, no trigger', () => {
    const members = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'M' + i }));
    const f = fixture(); f.World.charName = 'Hero'; f.World.gp.social = { members: members(3), localName: 'M0' };
    f.Settings.profile.hunt.safety.party = { min: 3, action: 'stop' }; f.Hunt.start(); f.Controller.tick();
    f.World.gp.social = { members: members(2), localName: 'M0' }; f.Controller.tick();
    f.advance(9000); f.Controller.tick(); assert.equal(f.Hunt.running, true, 'a member who relogs does not trigger it');
    f.World.gp.social = { members: members(3), localName: 'M0' }; f.Controller.tick(); f.advance(5000);
    f.World.gp.social = { members: members(2), localName: 'M0' }; f.Controller.tick(); f.advance(9000); f.Controller.tick();
    assert.equal(f.Hunt.running, true, 'the wait starts over after the party was whole again');
    f.advance(2000); f.Controller.tick(); assert.equal(f.Hunt.running, false);
    assert.match(lastStop(f), /^safety: the party has 2 members, fewer than 3/);
    const g = fixture(); g.World.charName = 'Hero'; g.Settings.profile.hunt.safety.party = { min: 3, action: 'stop' }; g.Hunt.start(); g.Controller.tick(); g.advance(60000); g.Controller.tick();
    assert.equal(g.Hunt.running, true, 'not in a party');
    const h = fixture(); h.World.charName = 'Hero'; h.World.gp.social = { members: members(3), localName: 'M0' }; h.Settings.profile.hunt.safety.party = { min: 3, action: 'stop' }; h.Hunt.start(); h.Controller.tick();
    h.World.gp.social = { members: [], localName: 'M0' }; h.Controller.tick(); h.advance(11000); h.Controller.tick();
    assert.equal(h.Hunt.running, false, 'in a party when the bot started, now alone');
  });
  function attackCast(f, caster, impacts = [{ damage: 40 }], extra = {}) {
    f.bus.emit('cast', { caster, skill: 700, target: 1, results: [{ target: 1, impacts }], ...extra });
    f.Controller.tick();
  }
  test('safety: a player hit fires the trigger; party members, own pets, monsters and harmless casts never do', () => {
    const f = safetyFixture({ player: { on: true } });
    f.World.gp.social = { members: [{ name: 'Mate' }, { name: 'Hero' }], localName: 'Hero' };
    f.World.ents.set(60, { gid: 60, kind: 'player', name: 'Mate' }); f.World.ents.set(61, { gid: 61, kind: 'player', name: 'Stranger' });
    f.World.ents.set(62, { gid: 62, kind: 'monster', name: 'Mob' }); f.World.ents.set(63, { gid: 63, kind: 'cos', ownerGid: 1 }); f.World.ents.set(64, { gid: 64, kind: 'cos', ownerGid: 60 });
    attackCast(f, 60); attackCast(f, 62); attackCast(f, 63); attackCast(f, 1); attackCast(f, 64);
    assert.equal(f.Hunt.running, true, 'party members, a monster, an own pet and the character itself never count');
    attackCast(f, 61, [{ damage: 0 }]); attackCast(f, 61, []);
    assert.equal(f.Hunt.running, true, 'a harmless cast from a stranger does not count');
    f.bus.emit('cast', { caster: 61, skill: 701, target: 9, results: [{ target: 9, impacts: [{ damage: 50 }] }] }); f.Controller.tick();
    assert.equal(f.Hunt.running, true, 'a hit on somebody else does not count');
    attackCast(f, 61);
    assert.equal(f.Hunt.running, false); assert.match(lastStop(f), /^safety: a player attacked the character/);
    const h = safetyFixture({ player: { on: false } }); h.World.ents.set(61, { gid: 61, kind: 'player', name: 'Stranger' }); attackCast(h, 61);
    assert.equal(h.Hunt.running, true, 'off by default');
  });
  test('safety: a unique within the distance fires it, never in the unique hunt or with the unique class ticked', () => {
    const unique = (f, x, rarity = 3) => f.World.ents.set(80, { gid: 80, kind: 'monster', name: 'Boss', rarity, regionId: 1, x, y: 0, z: 100, appearanceState: [0] });
    const f = safetyFixture({ unique: { on: true, meters: 30 } });
    unique(f, 500); f.Controller.tick(); assert.equal(f.Hunt.running, true, 'too far: 40 m away');
    unique(f, 390, 0); f.Controller.tick(); assert.equal(f.Hunt.running, true, 'a normal monster is not a unique');
    unique(f, 390); f.Controller.tick(); assert.equal(f.Hunt.running, false, '29 m away'); assert.match(lastStop(f), /^safety: a unique \(Boss\) is within 30 m/);
    const g = safetyFixture({ unique: { on: true, meters: 30 } }); g.UniqueHunt.active = { phase: 'patrol' }; unique(g, 200); g.Controller.tick();
    assert.equal(g.Hunt.running, true, 'never while the unique hunt runs');
    const h = safetyFixture({ unique: { on: true, meters: 30 } }); h.Settings.profile.hunt.classes.unique = true; unique(h, 200); h.Controller.tick();
    assert.equal(h.Hunt.running, true, 'never when the unique class is ticked');
    const i = safetyFixture({ unique: { on: false, meters: 30 } }); unique(i, 200); i.Controller.tick();
    assert.equal(i.Hunt.running, true, 'off by default');
  });
  test('safety: go to town and stop starts the trip with the safety reason and stops the bot in town', () => {
    const f = townFixture(); f.World.charName = 'Hero';
    f.Settings.profile.hunt.safety.unique = { on: true, meters: 30, action: 'town' };
    f.World.ents.set(80, { gid: 80, kind: 'monster', name: 'Boss', rarity: 3, regionId: 1, x: 720, y: 0, z: 100, appearanceState: [0] });
    f.RunIntent.set(true); f.Controller.tick();
    assert.equal(f.Hunt.running, true, 'the trip starts, hunting is not stopped yet');
    f.Controller.tick();
    assert.ok(f.Town.trip, 'a town trip began'); assert.match(f.Town.trip.why, /^safety: a unique \(Boss\) is within 30 m/);
    assert.match(f.Town.lastTrip.why, /^safety: /);
    f.Town.enter('leave'); f.Controller.tick();
    assert.equal(f.Town.trip, null); assert.equal(f.Hunt.running, false, 'the bot stops in town');
    assert.equal(f.WalkBack.active, null, 'it does not walk back'); assert.match(lastStop(f), /^safety: a unique/);
    f.advance(130000); f.Settings.profile.hunt.retry = true; f.Controller.tick(); assert.equal(f.Hunt.running, false, 'nothing starts it again');
    const g = townFixture(); g.World.charName = 'Hero'; g.Town.cfg().enabled = false;
    g.Settings.profile.hunt.safety.player = { on: true, action: 'town' }; g.World.ents.set(61, { gid: 61, kind: 'player', name: 'Stranger' });
    g.Controller.tick(); attackCast(g, 61);
    assert.equal(g.Hunt.running, false, 'with no town setup it stops at once'); assert.equal(g.Town.trip, null);
    const h = townFixture(); h.World.charName = 'Hero'; h.World.gp.inventory = h.World.gp.inventory.filter(i => i.typeFlags !== 0x09ec);
    h.Settings.profile.hunt.safety.deaths = 0; h.Settings.profile.hunt.safety.party = { min: 3, action: 'town' }; h.World.gp.social = { members: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], localName: 'A' };
    h.Controller.tick(); h.World.gp.social = { members: [{ name: 'A' }], localName: 'A' }; h.Controller.tick(); h.advance(11000); h.Controller.tick();
    assert.equal(h.Hunt.running, false, 'no return scroll to start the trip: it stops'); assert.equal(h.Town.trip, null);
  });
  test('safety: a stop by a trigger is not started again by the retry, auto-start or a reconnect', () => {
    const f = safetyFixture({ deaths: 1 }); f.Settings.profile.hunt.retry = true; f.Settings.profile.hunt.autoStart = true;
    dies(f); assert.equal(f.Hunt.running, false);
    assert.equal(f.Retry.final(lastStop(f)), true, 'the retry treats it as final');
    revives(f); f.advance(200000); f.Controller.tick(); assert.equal(f.Hunt.running, false);
    assert.equal(f.AutoStart.pending(), false); assert.equal(f.RunIntent.stopped(), true, 'a later entry into the game stays stopped');
    const g = townFixture(); g.World.charName = 'Hero'; g.Settings.profile.hunt.retry = true;
    g.Settings.profile.hunt.safety.unique = { on: true, meters: 30, action: 'town' };
    g.World.ents.set(80, { gid: 80, kind: 'monster', name: 'Boss', rarity: 3, regionId: 1, x: 720, y: 0, z: 100, appearanceState: [0] });
    g.RunIntent.set(true); g.Controller.tick(); g.Controller.tick(); g.Town.fail('Inventory transaction timed out.'); g.Controller.tick();
    g.advance(200000); g.Controller.tick(); assert.equal(g.Hunt.running, false, 'a safety trip that fails does not start again either');
  });
};
