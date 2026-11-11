module.exports = function emergencyTests({ test, fixture }) {
  const assert = require('node:assert/strict');
  function emergencyFixture(entries, learned = [500, 501, 502]) {
    const f = fixture();
    f.World.rebuildCatalog([
      { id: 500, group: 50, name: 'Heal self', level: 1, targetRequired: false, active: true },
      { id: 501, group: 51, name: 'Mana burst', level: 1, targetRequired: false, active: true },
      { id: 502, group: 52, name: 'Strike', level: 1, targetRequired: true, active: true },
      { id: 600, group: 60, name: 'Rotation hit', level: 1, targetRequired: true, active: true }]);
    f.World.applyGameplay({ ...f.World.gp, skills: [...learned, 600] });
    f.Settings.profile.macro.rotations.normal = [{ id: 600, group: 60 }];
    f.Settings.profile.macro.emergency = entries.map(e => ({ enabled: true, ...e }));
    f.Settings.profile.macro.castGapMs = 350;
    f.Hunt.start();
    return f;
  }
  const emergencyVitals = (f, hp, mp = 100) => { f.World.gp.vitals = [{ gid: 1, hp, maxHp: 100, mp, maxMp: 100 }]; };
  const skillIds = f => f.commands.filter(c => c.kind === 'skill').map(c => c.skillId);
  const emergencyMob = (f, gid, attacking = true) => {
    f.World.ents.set(gid, { gid, kind: 'monster', rarity: 0, name: 'Mob', regionId: 1, x: 120, y: 0, z: 100, attackFlags: 16, appearanceState: [0] });
    if (attacking) f.World.attackers.set(gid, f.World.simNow());
  };
  const logLines = (f, pattern) => { const lines = []; f.bus.on('log', e => { if (pattern.test(e.text)) lines.push(e.text); }); return lines; };
  test('emergency skills are off and empty by default, and old profiles load with an empty list', () => {
    const f = fixture();
    assert.deepEqual(JSON.parse(JSON.stringify(f.Settings.profile.macro.emergency)), []);
    const old = f.botProfile({ macro: { castGapMs: 400 }, hunt: { radius: 300 } });
    assert.deepEqual(JSON.parse(JSON.stringify(old.macro.emergency)), []);
    const junk = f.botProfile({ macro: { emergency: [null, 5, { id: 500, group: 50, trigger: 'bogus', value: 5 }, { id: 500, trigger: 'hp', value: 500 }, ...Array.from({ length: 9 }, () => ({ id: 501, group: 51, trigger: 'mp', value: 10 }))] } });
    assert.equal(junk.macro.emergency.length, 6, 'the list holds at most six entries');
    assert.deepEqual(JSON.parse(JSON.stringify(junk.macro.emergency[0])), { id: 500, group: 500, trigger: 'hp', value: 99, enabled: true });
  });
  test('emergency skills travel through share codes and backups', () => {
    const f = fixture(), p = f.Settings.profile;
    p.macro.emergency = [{ id: 500, group: 50, trigger: 'attackers', value: 4, enabled: false }];
    const g = fixture(), back = g.ProfileShare.build(JSON.parse(f.ProfileShare.text(true)).profile);
    assert.deepEqual(JSON.parse(JSON.stringify(back.macro.emergency)), JSON.parse(JSON.stringify(p.macro.emergency)));
    const kept = g.botProfile(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(JSON.parse(JSON.stringify(kept.macro.emergency)), JSON.parse(JSON.stringify(p.macro.emergency)));
    assert.equal(g.ProfileShare.build({ hunt: { radius: 200 } }).macro.emergency.length, 0);
  });
  test('emergency HP skill goes before the rotation, by list order, and not while sitting, dead, stopped, in a town trip or twice within 3 s', () => {
    const f = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30 }, { id: 501, group: 51, trigger: 'hp', value: 30 }]);
    emergencyMob(f, 30, false); f.World.gp.target = 30; f.Hunt.targetGid = 30; f.Hunt.targetSince = 100000;
    const lines = logLines(f, /Emergency:/);
    emergencyVitals(f, 30);
    f.Controller.tick(); assert.deepEqual(skillIds(f), [600], 'HP at the level is not below it: the rotation runs');
    f.advance(1000); emergencyVitals(f, 25); f.Controller.tick();
    assert.deepEqual(skillIds(f), [600, 500], 'at 25% the first entry in the list goes before the rotation');
    assert.equal(f.Controller.mode, 'emergency');
    assert.deepEqual(lines, ['Emergency: Heal self (HP 25% < 30%)']);
    f.advance(400); f.Controller.tick(); assert.deepEqual(skillIds(f), [600, 500, 501], 'the second entry follows while the first waits for its guard');
    f.advance(400); f.Controller.tick(); assert.equal(skillIds(f).filter(id => id === 500).length, 1, 'not twice within 3 seconds');
    assert.equal(skillIds(f).at(-1), 600, 'then the rotation resumes');
    f.advance(3000); f.Controller.tick(); assert.equal(skillIds(f).filter(id => id === 500).length, 2, 'tried again after 3 seconds');
    const g = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30 }]);
    emergencyVitals(g, 25); g.World.ents.get(1).movementMode = 4; g.Controller.tick();
    assert.deepEqual(skillIds(g), [], 'not while sitting');
    g.World.ents.get(1).movementMode = 0; g.Town.trip = { phase: 'walk-vendor', at: 0 }; g.Controller.tick();
    assert.deepEqual(skillIds(g), [], 'not during a town trip');
    g.Town.trip = null; g.Hunt.stop(); g.Controller.tick(); assert.deepEqual(skillIds(g), [], 'not while the bot is stopped');
    g.Hunt.start(); g.World.ents.get(1).appearanceState = [2, 0, 0]; g.Controller.tick(); assert.deepEqual(skillIds(g), [], 'not while dead');
    const h = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30, enabled: false }]); emergencyVitals(h, 5); h.Controller.tick();
    assert.deepEqual(skillIds(h), [], 'an entry that is ticked off never casts');
  });
  test('an emergency skill respects the skill gap, a blocked skill, the MP check and the target it needs', () => {
    const f = emergencyFixture([{ id: 502, group: 52, trigger: 'hp', value: 30 }, { id: 500, group: 50, trigger: 'hp', value: 30 }]);
    emergencyVitals(f, 10);
    f.Controller.tick(); assert.deepEqual(skillIds(f), [500], 'a skill that needs a monster waits for one; the self skill casts');
    f.advance(1000); emergencyMob(f, 31, false); f.World.gp.target = 31; f.Controller.tick();
    assert.deepEqual(skillIds(f), [500, 502], 'with a monster targeted it is cast on the target');
    assert.equal(f.commands.filter(c => c.kind === 'skill').at(-1).gid, 31);
    const g = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30 }]); emergencyVitals(g, 10);
    g.Combat.lastCastAt = 100000; g.Controller.tick(); assert.deepEqual(skillIds(g), [], 'inside the skill gap');
    g.advance(400); g.Combat.blocked = () => true; g.Controller.tick(); assert.deepEqual(skillIds(g), [], 'a skill the server keeps refusing');
    const h = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30 }]);
    h.World.catalog.get(500).mp = 80; h.World.gp.vitals = [{ gid: 1, hp: 10, maxHp: 100, mp: 40, maxMp: 100 }];
    h.Controller.tick(); assert.deepEqual(skillIds(h), [], 'not enough MP');
  });
  test('emergency MP and attacker triggers fire at their threshold and not below it', () => {
    const f = emergencyFixture([{ id: 501, group: 51, trigger: 'mp', value: 20 }]);
    emergencyVitals(f, 100, 20); f.Controller.tick(); assert.equal(skillIds(f).includes(501), false, 'MP at the level is not below it');
    f.advance(500); emergencyVitals(f, 100, 19); f.Controller.tick(); assert.equal(skillIds(f).includes(501), true, 'MP 19% < 20%');
    const g = emergencyFixture([{ id: 500, group: 50, trigger: 'attackers', value: 3 }]); emergencyVitals(g, 100);
    emergencyMob(g, 40); emergencyMob(g, 41); g.Controller.tick(); assert.equal(skillIds(g).includes(500), false, 'two attackers are below three');
    emergencyMob(g, 42); g.advance(500); g.Controller.tick(); assert.equal(skillIds(g).includes(500), true, 'three attackers');
    assert.equal(g.Combat.attackerCount(), 3, 'the count is the one cornered Berserk uses');
    g.advance(6000); assert.equal(g.Combat.attackerCount(), 0, 'old attacks expire');
  });
  test('emergency skills also run while walking back and in the unique hunt, with at most one log line per entry in 10 s', () => {
    const f = emergencyFixture([{ id: 500, group: 50, trigger: 'hp', value: 30 }]), lines = logLines(f, /Emergency:/);
    f.Hunt.running = false; f.WalkBack.active = { destination: { regionId: 1, x: 500, y: 0, z: 100 }, resume: true };
    emergencyVitals(f, 23);
    assert.equal(f.Emergency.tick(), true, 'while walking back');
    assert.deepEqual(lines, ['Emergency: Heal self (HP 23% < 30%)']);
    f.advance(4000); f.Emergency.tick(); f.advance(4000); f.Emergency.tick();
    assert.equal(lines.length, 1, 'never more than one line per entry in 10 seconds');
    f.advance(3000); f.Emergency.tick(); assert.equal(lines.length, 2, 'then again');
    f.WalkBack.active = null; f.UniqueHunt.active = { phase: 'patrol' }; f.advance(4000);
    assert.equal(f.Emergency.tick(), true, 'in the unique hunt');
  });
};
