module.exports = function buffGearTests({ test, buffGearFixture, partyGear, casts, secondaryWornFixture }) {
  const assert = require('node:assert/strict');
  const swapMove = (f, gp) => {
    const p = f.BuffGear.run?.pending;
    if (!p) return;
    const from = gp.inventory.find(i => i.slot === p.source), to = gp.inventory.find(i => i.slot === p.destination);
    from.slot = p.destination; if (to) to.slot = p.source;
  };
  const play = (f, gp, ms) => {
    let cycles = 0, was = !!f.BuffGear.run;
    for (let t = 0; t < ms; t += 300) {
      f.advance(300); f.Controller.tick(); swapMove(f, gp);
      if (f.BuffGear.run && !was) cycles++;
      was = !!f.BuffGear.run;
    }
    return cycles;
  };
  const lines = (f, pattern) => Array.from(f.Log.lines.filter(l => pattern.test(l.text)), l => l.text);
  const skillSends = f => f.commands.filter(c => c.kind === 'skill').length;
  const ownBuff = () => {
    const f = buffGearFixture(), gp = f.World.gp, at = s => gp.inventory.find(i => i.slot === s)?.refObjId;
    f.Settings.profile.macro.buffs = [{ id: 20, group: 20, gearSet: 1, enabled: true, mode: 'hunt' }];
    f.Hunt.start(); f.commands.length = 0;
    return { f, gp, at };
  };
  test('an own buff on cooldown once the buff weapon is on is held for two minutes instead of restarting the swap', () => {
    const { f, gp, at } = ownBuff(), cooldown = f.World.cooldownLeft.bind(f.World);
    f.World.cooldownLeft = id => id === 20 && at(6) === 200 ? 5000 : cooldown(id);
    const first = play(f, gp, 15000);
    assert.equal(first, 1, 'one weapon change');
    assert.equal(f.BuffGear.run, null); assert.equal(at(6), 100, 'the combat weapon is back');
    assert.equal(skillSends(f), 0, 'nothing was cast');
    assert.deepEqual(lines(f, /^Skipping /), ['Skipping Cleric buff for two minutes: it could not be cast after changing weapons (cooldown).']);
    assert.match(f.BuffGear.status(), /Cleric buff: skipped because it could not be cast after changing weapons \(cooldown\)/);
    assert.equal(play(f, gp, 100000), 0, 'no new weapon change while the buff is held');
    assert.equal(f.Hunt.running, true, 'hunting goes on');
    assert.equal(lines(f, /^Skipping /).length, 1, 'the hold is logged once');
    assert.equal(play(f, gp, 15000), 1, 'tried again after two minutes');
    assert.equal(lines(f, /^Skipping /).length, 2, 'the new hold is logged again');
  });
  test('an own buff the game will not send within 3 s is held for two minutes', () => {
    const { f, gp, at } = ownBuff();
    f.Hook.guards.push(c => c?.command?.kind === 'skill');
    assert.equal(play(f, gp, 60000), 1, 'one weapon change in a minute');
    assert.equal(at(6), 100);
    assert.deepEqual(lines(f, /^Skipping /), ['Skipping Cleric buff for two minutes: it could not be cast after changing weapons (the cast was not sent).']);
    assert.equal(play(f, gp, 50000), 0);
  });
  test('an own buff that is already on after the swap is dropped without a hold', () => {
    const { f, gp } = ownBuff();
    f.advance(300); f.Controller.tick(); assert.ok(f.BuffGear.run, 'the change starts');
    f.confirmBuff(20);
    play(f, gp, 10000);
    assert.equal(f.BuffGear.run, null);
    assert.equal(lines(f, /^Skipping /).length, 0);
    assert.equal(f.BuffGear.skipped.has(20), false);
  });
  test('the buff gear status explains a shield buff without a shield in the bag instead of throwing', () => {
    const f = buffGearFixture(), gp = f.World.gp;
    gp.inventory = gp.inventory.filter(i => i.slot !== 7 && i.slot !== 14);
    f.World.catalog.set(20, { ...f.World.catalog.get(20), code: 'SKILL_EU_CLERIC_SHIELD_A' });
    f.Settings.profile.macro.buffAuto = true;
    f.Settings.profile.macro.buffs = [{ id: 20, group: 20, enabled: true, mode: 'hunt' }];
    assert.match(f.BuffGear.status(), /Cleric buff needs a shield, and none you can use is in your bag\./);
    assert.equal(f.Diagnostics.sample().buffGearStatus, f.BuffGear.status());
    gp.inventory.push({ slot: 14, refObjId: 201, typeFlags: (1 << 11) | (4 << 7) | 44, plus: 0 });
    assert.match(f.BuffGear.status(), /Cleric buff: due now; your .+ is worn for it\./);
  });
  test('a party buff on cooldown once the buff weapon is on is held on that member for two minutes', () => {
    const { f, gp, at } = partyGear(), cooldown = f.World.cooldownLeft.bind(f.World);
    f.World.cooldownLeft = id => id === 2002 && at(6) === 300 ? 5000 : cooldown(id);
    assert.equal(play(f, gp, 15000), 1, 'one weapon change');
    assert.equal(at(6), 100); assert.deepEqual(casts(f), []);
    assert.deepEqual(lines(f, /skipping Guard/), ['Party support: skipping Guard on Tank for two minutes: it could not be cast after changing weapons (cooldown).']);
    assert.equal(play(f, gp, 100000), 0, 'no new weapon change while Guard on Tank is held');
    assert.equal(f.Hunt.running, true);
    assert.equal(play(f, gp, 15000), 1, 'tried again after two minutes');
  });
  test('a party buff that cannot be sent to the member within 3 s is held on that member for two minutes', () => {
    const { f, gp, at } = partyGear();
    f.Hook.guards.push(c => c?.command?.gid === 60);
    assert.equal(play(f, gp, 60000), 1, 'one weapon change in a minute');
    assert.equal(at(6), 100);
    assert.deepEqual(lines(f, /skipping Guard/), ['Party support: skipping Guard on Tank for two minutes: it could not be cast after changing weapons (the cast was not sent).']);
  });
  test('a party buff whose member is out of range after the swap is held on that member', () => {
    const { f, gp, at } = partyGear();
    f.advance(1000); f.Controller.tick(); assert.ok(f.BuffGear.run?.party);
    f.World.ents.get(60).x = 2000;
    play(f, gp, 10000);
    assert.equal(f.BuffGear.run, null); assert.equal(at(6), 100);
    assert.deepEqual(lines(f, /skipping Guard/), ['Party support: skipping Guard on Tank for two minutes: it could not be cast after changing weapons (out of range or out of view).']);
  });

  const staffBuff = f => {
    f.World.catalog.set(20, { ...f.World.catalog.get(20), name: 'Earth Fence', admit: { weaponKinds: [15] } });
    f.Settings.profile.macro.buffAuto = true;
    f.Settings.profile.macro.buffs = [{ id: 20, group: 20, gearSet: 0, enabled: true, mode: 'hunt' }];
    f.World.gp.skills = [20, 30, 40];
    f.World.catalog.set(40, { id: 40, group: 40, name: 'Frozen Spear', targetRequired: true, targets: 4, actionMs: 1000, admit: { weaponKinds: [15] } });
  };
  const staffMoves = f => f.commands.filter(c => c.kind === 'inventory-move' && c.destination === 6 && f.World.gp.inventory.find(i => i.slot === c.source)?.refObjId === 200).length;
  test('the primary weapon refused twice right after entering the world is not given up: it goes on once the game takes it', () => {
    const f = secondaryWornFixture('staff', 'harp'), staff = f.BuffGear.key(f.World.gp.inventory.find(i => i.refObjId === 200));
    staffBuff(f);
    f.enter(); f.advance(6000); f.Hunt.start();
    const until = f.World.simNow() + 12000;
    f.play(12000, p => !(p.from === staff && f.World.simNow() < until));
    assert.ok(f.Log.lines.filter(l => /did not equip|would not equip/.test(l.text)).length >= 1, 'the game refused the staff');
    f.play(60000);
    assert.equal(f.BuffGear.bad.has(staff), false, 'the primary weapon is never given up for good');
    assert.equal(f.t073.at(6), 200, 'the staff is worn again');
    assert.deepEqual(lines(f, /waits until the game takes/), ['Earth Fence waits until the game takes #200 again; it refused it a moment ago.'], 'the wait is logged once');
    assert.equal(f.Hunt.running, true);
    assert.ok(f.Log.lines.filter(l => /(did not equip|would not equip) .*(30 s|every five minutes)\.$/.test(l.text)).length <= 1, 'one line for the refusal: ' + f.Log.lines.map(l => l.text).join(' | '));
  });
  test('a primary weapon the game keeps refusing is tried again every five minutes and logged once', () => {
    const f = secondaryWornFixture('staff', 'harp'), staff = f.BuffGear.key(f.World.gp.inventory.find(i => i.refObjId === 200));
    f.Settings.profile.macro.buffs = [];
    f.enter(); f.advance(6000); f.Hunt.start();
    f.play(12 * 60000, p => p.from !== staff);
    assert.equal(f.BuffGear.bad.has(staff), false);
    assert.equal(f.t073.at(6), 300, 'hunting goes on with what is worn');
    assert.equal(f.Hunt.running, true);
    assert.ok(staffMoves(f) >= 4, 'tried again: ' + staffMoves(f));
    assert.equal(f.Log.lines.filter(l => /did not equip .*tried again in 30 s\.$/.test(l.text)).length, 1);
    assert.equal(f.Log.lines.filter(l => /would not equip .*every five minutes\.$/.test(l.text)).length, 1);
  });
  test('attack skills refused for the weapon cut the wait for the primary weapon short', () => {
    const f = secondaryWornFixture('staff', 'harp'), staff = f.BuffGear.key(f.World.gp.inventory.find(i => i.refObjId === 200));
    staffBuff(f); f.Settings.profile.macro.buffs = [];
    f.enter(); f.advance(6000); f.Hunt.start();
    const until = f.World.simNow() + 45000;
    f.play(45000, p => !(p.from === staff && f.World.simNow() < until));
    assert.equal(f.t073.at(6), 300, 'refused twice: the long wait runs');
    for (let n = 0; n < 12 && f.t073.at(6) !== 200; n++) { f.Combat.fail(40, 0); f.play(5000); }
    assert.equal(f.t073.at(6), 200, 'the staff goes on well before five minutes');
    assert.equal(f.Hunt.running, true);
  });
  test('a reconnect puts the combat gear back on even after an earlier refusal hold', () => {
    const f = secondaryWornFixture('staff', 'harp');
    f.Settings.profile.macro.buffs = [];
    f.BuffGear.combatHold = f.World.simNow() + 300000;
    f.World.phase = 'disconnected'; f.bus.emit('phase', 'disconnected', 'world', true);
    f.World.phase = 'world'; f.enter(); f.Hunt.start(); f.play(20000);
    assert.deepEqual([f.t073.at(6), f.t073.at(7)], f.t073.home, 'the combat gear is back after the reconnect');
    assert.equal(f.Hunt.running, true);
  });
  const ordered = (buffs, setup = () => {}) => {
    const f = buffGearFixture(), gp = f.World.gp, sent = [];
    f.World.catalog.set(40, { id: 40, group: 40, name: 'Plain buff', targetRequired: false, actionMs: 1000, durationMs: 60000 });
    gp.skills = [20, 30, 40];
    f.Settings.profile.macro.buffs = buffs;
    setup(f);
    const cast = f.Combat.cast.bind(f.Combat);
    f.Combat.cast = (id, ...a) => { const ok = cast(id, ...a); if (ok) { sent.push(id); f.confirmBuff(id); } return ok; };
    f.Hunt.start(); f.commands.length = 0;
    return { f, gp, sent };
  };
  test('buffs on different weapons are cast in the order of the buff list', () => {
    const { f, gp, sent } = ordered([{ id: 30, group: 30, gearSet: 2, enabled: true, mode: 'hunt' }, { id: 20, group: 20, gearSet: 1, enabled: true, mode: 'hunt' }]);
    play(f, gp, 30000);
    assert.deepEqual(sent, [30, 20]);
  });
  test('a buff that needs no weapon change and comes first in the list is cast before the change', () => {
    const { f, gp, sent } = ordered([{ id: 40, group: 40, enabled: true, mode: 'hunt' }, { id: 20, group: 20, gearSet: 1, enabled: true, mode: 'hunt' }]);
    play(f, gp, 30000);
    assert.deepEqual(sent.slice(0, 2), [40, 20]);
  });
  test('a buff that is already on is renewed after the due ones, without waiting for a confirmation it does not need', () => {
    const { f, gp, sent } = ordered([{ id: 20, group: 20, gearSet: 1, enabled: true, mode: 'hunt' }, { id: 30, group: 30, gearSet: 1, enabled: true, mode: 'hunt' }], f => {
      f.World.catalog.set(20, { ...f.World.catalog.get(20), name: 'Holy Recovery Division', actionMs: undefined });
      f.World.gp.buffSlots = [{ state: 'active', effect: { gid: 1, skill: 20, remainingMs: 30000, receivedAtMs: f.World.simNow() } }];
    });
    const start = f.World.simNow();
    let back = 0;
    for (let t = 0; t < 30000 && !back; t += 300) { f.advance(300); f.Controller.tick(); swapMove(f, gp); if (sent.length === 2 && !f.BuffGear.run) back = f.World.simNow() - start; }
    assert.deepEqual(sent, [30, 20], 'the due buff first, then the renewal');
    assert.ok(back > 0 && back < 9000, 'the change is over in ' + back + ' ms');
  });
};
