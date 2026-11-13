// Confirm every native inventory move before casting or restoring combat gear.
// A buff's gear choice: a saved set's id, 0 for the automatic choice, or one of the weapons and shield chosen under Combat.
const BUFF_GEAR_KINDS = ['primary', 'secondary', 'shield'];
const BUFF_COMBAT_HOLD_MS = 5 * 60000;
const BUFF_RUN_BUDGET_MS = 60000; // a weapon change stops starting casts after this and restores the combat gear
const BUFF_MOVE_REFUSED_MS = 2000;
const BUFF_MOVE_COUNTED_MS = 15000;
const BUFF_MOVE_WATCH_MS = 1000;
const BUFF_MOVE_TOTAL_MS = 45000;
const BUFF_SETTLE_MS = 5000;
const BUFF_COMBAT_RETRY_MS = 30000;
const BUFF_MISSING_MS = 10000;
const BUFF_PAIR_WINDOW_MS = 60000;
const BUFF_PAIR_MAX = 2;
const BUFF_HOLD_MS = 2 * 60000;
const BUFF_ORDER_WAIT_MS = 10000;
const BuffGear = {
  run: null, recovery: null, autoRestore: false, message: 'Buff weapon swapping off.', skipped: new Map(), waiting: '', started: false, bad: new Set(), combatHold: 0, restoreAt: 0, sentAt: -Infinity, wantAt: -Infinity,
  worldAt: -Infinity, strikes: new Map(), missingAt: null, pairs: [], looped: new Set(), combatAt: -Infinity, orderAt: null, explained: '',
  cfg() { return Settings.profile.macro; },
  items() { return World.gp?.inventory || []; },
  at(slot) { return this.items().find(i => i.slot === slot) || null; },
  key(i) { return i ? JSON.stringify([i.refObjId, i.typeFlags, i.plus ?? 0, i.variance ?? null, i.magic ?? null]) : null; },
  weapon(i) { return i && (i.typeFlags & 0x7e) === 0x2c && (i.typeFlags >>> 7 & 15) === 6; },
  shield(i) { return i && (i.typeFlags & 0x1e) === 0x0c && (i.typeFlags >>> 5 & 3) !== 3 && (i.typeFlags >>> 7 & 15) === 4; },
  find(key) {
    if (!key) return null;
    const matches = this.items().filter(i => this.key(i) === key);
    return matches.length === 1 ? matches[0] : null;
  },
  // Identical copies are interchangeable, so a skill-driven (auto) set accepts any copy: the equipped one first, then the lowest slot.
  findAny(key) {
    if (!key) return null;
    const matches = this.items().filter(i => this.key(i) === key).sort((a, b) => (a.slot > 7) - (b.slot > 7) || a.slot - b.slot);
    return matches[0] || null;
  },
  lookup(set, key) { return set.auto ? this.findAny(key) : this.find(key); },
  kind(i) { return i ? i.typeFlags >>> 11 & 31 : 0; },
  KIND_NAMES: { 2: 'sword', 3: 'blade', 4: 'spear', 5: 'glaive', 6: 'bow', 7: 'sword', 8: 'two-handed sword', 9: 'axe', 10: 'dark staff', 11: 'staff', 12: 'crossbow', 13: 'dagger', 14: 'harp', 15: 'staff' },
  kindName(kinds) { return [...new Set(kinds.map(k => this.KIND_NAMES[k] || 'weapon type ' + k))].join(' or '); },
  oneHanded(kind) { return [10, 15, 2, 3, 7, 13].includes(kind); },
  // Weapon types the game says this skill needs (admit.weaponKinds: 255 = any, 1 = bare hands), or null when any weapon works.
  // Skills gated by required items (reqi) are judged by the server on those items instead, so they are left alone.
  need(id) {
    const admit = World.skill(id)?.admit;
    if (!admit || admit.reqi || !Array.isArray(admit.weaponKinds)) return null;
    const kinds = admit.weaponKinds.filter(k => k !== 255 && k !== 1);
    return kinds.length ? kinds : null;
  },
  // The skill needs a weapon type the equipped weapon is not.
  mismatch(id) {
    const kinds = this.need(id), w = this.at(6);
    return kinds && this.weapon(w) ? !kinds.includes(this.kind(w)) : false;
  },
  // The skill needs a shield in the off-hand (fire shield and the like), judged from its required item or its name.
  shieldSkill(id) {
    const info = World.skill(id), admit = info?.admit;
    if (!info) return false;
    return !!(admit?.shield || admit?.reqShield || admit?.reqi && /shield/i.test(JSON.stringify(admit.reqi)) || /_SHIELD_/i.test(String(info.code || info.codename || info.name || '')));
  },
  // A shield skill is due while no shield is worn, or a two-handed weapon is.
  shieldMissing(id) { return this.shieldSkill(id) && !this.shield(this.at(7)); },
  // The bag shield to wear for a shield skill: the shield chosen under Combat first.
  pickShield() {
    const gp = World.gp, list = this.items().filter(i => i.slot >= (gp.equipmentSlotCount || 13) && this.shield(i) && (i.durability ?? 1) > 0 && !this.bad.has(this.key(i)));
    list.sort((a, b) => (ItemRules.guarded(b) ? 1 : 0) - (ItemRules.guarded(a) ? 1 : 0) || (b.plus ?? 0) - (a.plus ?? 0) || a.slot - b.slot);
    return list[0] || null;
  },
  auto() { const c = this.cfg(); return !!(c.buffSwap && c.buffAuto); },
  // Buffs the gear cycle owns for the weapon they need, not the weapon someone assigned.
  owns(b) { return this.auto() && !!b.enabled && !b.gearSet && (this.mismatch(Combat.resolve(b)) || this.shieldMissing(Combat.resolve(b))); },
  // The bag weapon to wear for this skill: the highest plus the character can wield, or why there is none.
  pick(kinds) {
    const gp = World.gp, level = gp?.progression?.level;
    const list = this.items().filter(i => i.slot >= (gp.equipmentSlotCount || 13) && this.weapon(i) && kinds.includes(this.kind(i)) &&
      (i.durability ?? 1) > 0 && !this.bad.has(this.key(i)) && !(level >= 0 && Town.requiredLevel(i) > level));
    // The secondary weapon chosen under Combat comes first, then the primary, then the highest plus.
    const g = ItemRules.cfg().gear || {}, chosen = i => { const k = this.key(i); return k === g.secondaryWeapon ? 2 : k === g.primaryWeapon ? 1 : 0; };
    list.sort((a, b) => chosen(b) - chosen(a) || (b.plus ?? 0) - (a.plus ?? 0) || a.slot - b.slot);
    return list[0] || null;
  },
  setup() { return { weapon: this.key(this.at(6)), shield: this.key(this.at(7)), auto: true }; },
  // Arrows (kind 1) or bolts (kind 2): ETC items of type 4, known by their type word, codename or this server's item number.
  isAmmo(i, kind = 0) {
    if (!i) return false;
    const tf = i.typeFlags, code = i.codename || Items.data.get(i.refObjId)?.code || '';
    const found = Number.isInteger(tf) && (tf & 2044) === 620 ? tf >>> 11 : /^ITEM_ETC_AMMO_ARROW/.test(code) || i.refObjId === 62 ? 1 : /^ITEM_ETC_AMMO_BOLT/.test(code) || i.refObjId === 10376 ? 2 : 0;
    return (found === 1 || found === 2) && (!kind || found === kind) && (i.quantity ?? 1) > 0;
  },
  // What a bow (arrows) or a crossbow (bolts) shoots: the worn stack when it fits, otherwise the biggest fitting stack in the bag.
  ammoFor(weapon) {
    const kind = this.kind(weapon) === 6 ? 1 : this.kind(weapon) === 12 ? 2 : 0, off = this.at(7), equipped = World.gp?.equipmentSlotCount || 13;
    if (!kind) return null;
    if (this.isAmmo(off, kind)) return this.key(off);
    const stack = this.items().filter(i => i.slot >= equipped && this.isAmmo(i, kind)).sort((a, b) => (b.quantity ?? 1) - (a.quantity ?? 1) || a.slot - b.slot)[0];
    return stack ? this.key(stack) : null;
  },
  // What may sit in the off-hand slot of a set: a shield, or arrows or bolts.
  offhand(i) { return this.shield(i) || this.isAmmo(i); },
  // The chosen shield when it is carried and the game has not refused it.
  chosenShield() { const k = ItemRules.cfg().gear?.shield; return this.shield(this.findAny(k)) && !this.bad.has(k) ? k : null; },
  // The combat gear: the primary weapon chosen under Combat, with the chosen shield when it is one-handed (or the worn
  // shield without one), and with arrows or bolts when it is a bow or crossbow. Null without a usable primary weapon.
  combat() {
    const k = ItemRules.cfg().gear?.primaryWeapon, weapon = this.findAny(k), off = this.at(7);
    if (!this.weapon(weapon) || this.bad.has(k)) return null;
    const shield = this.oneHanded(this.kind(weapon)) ? this.chosenShield() || (this.shield(off) ? this.key(off) : null) : this.ammoFor(weapon);
    return { id: 'gear:primary', name: 'your primary weapon', auto: true, primary: true, weapon: k, shield };
  },
  // What the character goes back to after buffs: the combat gear, or what is worn when no primary weapon is chosen.
  home() { const combat = this.combat(); return combat && (!this.held() || this.matches(combat)) ? combat : this.setup(); },
  held() { return now() < this.combatHold && !(now() - this.combatAt >= BUFF_COMBAT_RETRY_MS && this.weaponRefused()); },
  weaponRefused() {
    const primary = this.findAny(ItemRules.cfg().gear?.primaryWeapon), worn = this.at(6);
    if (!this.weapon(primary)) return false;
    for (const [key, s] of Combat.stuck) {
      const kinds = this.need(Number(String(key).split(':')[0]));
      if (now() < s.until && kinds?.includes(this.kind(primary)) && !(this.weapon(worn) && kinds.includes(this.kind(worn)))) return true;
    }
    return false;
  },
  chosenKey(key) { const g = ItemRules.cfg().gear || {}; return !!key && (key === g.primaryWeapon || key === g.shield); },
  strike(key) {
    const n = (this.strikes.get(key) || 0) + 1;
    this.strikes.set(key, n); this.combatAt = now(); this.combatHold = now() + (n > 1 ? BUFF_COMBAT_HOLD_MS : BUFF_COMBAT_RETRY_MS);
    return n;
  },
  refuseCombat(key, what) {
    const n = this.strike(key);
    const text = n > 1 ? `The game would not equip ${what}; hunting goes on with what is worn, and it is tried again every five minutes.`
      : `The game did not equip ${what}; hunting goes on with what is worn, and it is tried again in ${BUFF_COMBAT_RETRY_MS / 1000} s.`;
    if (n <= 2) Log.warn(text);
    return text;
  },
  explain(text) {
    if (text && text !== this.explained) Log.info(text);
    this.explained = text;
  },
  // The home gear, or the primary weapon's set built at another moment: its off-hand may hold arrows or bolts.
  homeLike(set, home) { return set === home || !!(set.primary && home?.primary); },
  // The gear a buff assigned to the primary weapon, the secondary weapon or the shield wears, or why there is none.
  gearFor(kind, home) {
    const g = ItemRules.cfg().gear || {};
    if (kind === 'primary') return home.primary ? home : g.primaryWeapon ? 'Your primary weapon is not carried, or the game would not equip it.' : 'Choose a primary weapon under Combat and carry it.';
    if (kind === 'secondary') {
      const weapon = this.findAny(g.secondaryWeapon);
      if (!this.weapon(weapon)) return 'Choose a secondary weapon under Combat and carry it.';
      return { id: 'gear:secondary', name: 'your secondary weapon', auto: true, weapon: g.secondaryWeapon, shield: this.oneHanded(this.kind(weapon)) ? this.chosenShield() : this.ammoFor(weapon) };
    }
    if (!this.chosenShield()) return 'Choose a shield under Combat and carry it.';
    const weapon = [this.findAny(g.primaryWeapon), this.findAny(g.secondaryWeapon), this.at(6)].find(w => this.weapon(w) && this.oneHanded(this.kind(w)));
    if (!weapon) return 'A shield needs a one-handed primary or secondary weapon.';
    return { id: 'gear:shield', name: 'your shield', auto: true, weapon: this.key(weapon), shield: g.shield };
  },
  matches(set) { return set.weapon === this.key(this.at(6)) && set.shield === this.key(this.at(7)); },
  signature() { return JSON.stringify([this.cfg().buffSwap, this.cfg().buffAuto, this.cfg().buffSets, this.cfg().buffs]); },
  init() {
    if (this.started) return;
    this.started = true;
    Hook.observers.push(command => {
      if (command.kind === 'gameplay' && command.command?.kind === 'inventory-move' && this.run) this.fail('Manual equipment move interrupted buff swaps.');
    });
    bus.on('game-error', text => {
      const p = this.run?.pending;
      if (p && /^Inventory (?:rejected: \d+|command unavailable)$/.test(String(text))) p.error = String(text);
    });
    bus.on('phase', phase => { if (phase === 'world') this.entered(); });
    bus.on('cast', c => {
      const p = this.run?.cast;
      if (p && c.caster === World.localGid() && c.skill === p.id && !c.resultOnly && c.cancelledAtMs === undefined) p.accepted = true;
    });
  },
  save(name) {
    if (this.run || this.recovery || Hunt.running || World.gp?.inventoryPending || !World.inWorld()) return UI.toast('Stop hunting and settle gear restoration first.', 'warn');
    const set = this.setup();
    if (!this.weapon(this.at(6)) || this.at(7) && !this.shield(this.at(7))) return UI.toast('Equip a buff weapon and an optional shield first. Remove arrows or bolts from the off-hand slot.', 'warn');
    if (!this.find(set.weapon) || set.shield && !this.find(set.shield)) return UI.toast('Identical gear cannot be distinguished. Keep only one matching copy.', 'warn');
    const sets = this.cfg().buffSets;
    if (sets.length >= 8) return UI.toast('Up to eight buff sets can be saved.', 'warn');
    sets.push({ ...set, id: Math.max(0, ...sets.map(s => Number(s.id) || 0)) + 1, name: String(name || 'Buff set').trim().slice(0, 40) || 'Buff set' });
    Settings.saveProfile(); UI.draw();
  },
  entered() {
    this.worldAt = now(); this.combatHold = 0; this.combatAt = -Infinity; this.restoreAt = 0;
    this.strikes.clear(); this.pairs = []; this.looped.clear(); this.orderAt = null;
  },
  reset() {
    this.run = this.recovery = null; this.skipped.clear(); this.bad.clear(); this.combatHold = 0; this.restoreAt = 0; this.combatAt = -Infinity;
    this.strikes.clear(); this.missingAt = null; this.pairs = []; this.looped.clear(); this.orderAt = null; this.explained = '';
    this.message = 'Buff gear reset. Check equipped weapons after reconnecting.';
  },
  // Dying or changing world mid-swap is not a failure: remember the combat gear and put it back on once alive again.
  interrupt(text, soft = false) {
    if (!this.run) return;
    if (!soft) return this.fail(text);
    this.recovery = this.run.home; this.autoRestore = true; this.restoreAt = 0; this.run = null;
    this.message = text + ' Combat gear is restored once the character is back.';
  },
  fail(text) {
    this.autoRestore = false;
    if (this.run) this.recovery = this.run.home;
    this.run = null;
    if (Hunt.running) Hunt.stop(text);
    this.message = text + ' Check gear or use Restore combat gear.';
    UI.toast(this.message, 'warn');
  },
  cancel() {
    if (!this.run) return;
    this.run.restoring = true; this.run.queue = []; this.run.cancelled = true;
    this.message = 'Stopping buffs; restoring combat gear.';
  },
  // Called every tick: a swap cut short by death or a world change puts the combat weapon back by itself.
  resume() {
    const due = now() >= this.restoreAt || now() - this.combatAt >= BUFF_COMBAT_RETRY_MS && this.weaponRefused();
    if (this.autoRestore && this.recovery && !this.run && due && !this.settling()) this.restore(true);
  },
  restore(auto = false) {
    const gp = World.gp;
    const windowOpen = !!(gp?.returnScroll || gp?.storage || Restock.activeShop() || gp?.exchange?.open || gp?.exchange?.requesting || gp?.stall?.phase && gp.stall.phase !== 'none');
    if (this.run || !this.recovery || !World.inWorld() || World.isDead() || gp?.inventoryPending || World.isCasting()) return;
    // The automatic restore waits out travel and open game windows instead of saying so every tick; only a manual one explains itself.
    if (windowOpen || !auto && Hunt.running || Town.trip || WalkBack.active || Restock.trip || Alchemy.run || Alchemy.pending) {
      if (windowOpen && !auto) return UI.toast('Close the open trade, stall or shop before restoring gear.', 'warn');
      if (auto) return;
      return UI.toast('Stop hunting and travel before restoring gear.', 'warn');
    }
    this.run = this.create(this.recovery, []); this.run.restoring = true; this.recovery = null; this.autoRestore = false;
  },
  create(home, queue) {
    return { home, worn: this.setup(), queue, restoring: false, pending: null, cast: null, effects: [],
      at: now(), manualAt: Manual.lastAt, character: World.charName, profile: Settings.profile, signature: this.signature() };
  },
  // earlyMs: during a weapon change that happens anyway, renew a buff with up to this much left.
  due(b, auto, earlyMs = 0) {
    if (!b.enabled || !b.gearSet && !auto) return 0;
    const id = Combat.resolve(b), info = World.skill(id);
    if (!id || !info || info.targetRequired && !(info.targets & 1) || Combat.blocked(id) || !Cmd.canCast(id) || !Combat.mpOk(id, World.me())) return 0;
    const skip = this.skipped.get(b.group);
    if (skip) { if (skip.signature === this.signature() && now() < skip.until) return 0; this.skipped.delete(b.group); }
    const remaining = World.buffRemaining(id);
    if (remaining > Math.max((b.refreshS ?? 3) * 1000, earlyMs)) return 0;
    const gap = Math.max(4000, Math.min((info?.durationMs || 20000) * .85, 600000));
    return now() - (Combat.buffCastAt.get(b.group) ?? -Infinity) >= gap ? id : 0;
  },
  // Anything an equipment change must not interrupt.
  blocked() {
    return !!(this.recovery || !World.inWorld() || World.isDead() || this.settling() ||
        Combat.busy() || World.isSitting() || World.local()?.mountedOn || World.gp?.inventoryPending ||
        World.gp?.pendingMoves || World.gp?.returnScroll || now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000 ||
        Town.trip || WalkBack.active || Restock.trip || Restock.recording || Resurrect.trip || now() < Resurrect.holdUntil ||
        Restock.activeShop() || World.gp?.storage || World.gp?.exchange?.open || World.gp?.exchange?.requesting || World.gp?.stall?.phase && World.gp.stall.phase !== 'none' ||
        Alchemy.run || Alchemy.pending || Loot.active && !Loot.active.petGid || Loot.pressed());
  },
  petWait() {
    if (!Loot.petInFlight()) return false;
    this.wantAt = now();
    return true;
  },
  // The bag weapon (and shield) for a skill the worn weapon cannot cast, or why there is none.
  autoSet(id, home) {
    const wantShield = this.shieldMissing(id);
    let kinds = this.need(id), weapon;
    if (wantShield) {
      // A shield only goes with a one-handed weapon: keep the worn one if it is, otherwise wear a one-handed bag weapon.
      const worn = this.at(6);
      kinds = kinds ? kinds.filter(k => this.oneHanded(k)) : [];
      weapon = this.weapon(worn) && this.oneHanded(this.kind(worn)) && (!kinds.length || this.need(id)?.includes(this.kind(worn))) ? worn : this.pick(kinds.length ? kinds : [10, 15, 2, 3, 7, 13]);
      if (!this.pickShield()) return `${World.skillName(id)} needs a shield, and none you can use is in your bag.`;
    } else weapon = this.pick(kinds);
    if (!weapon) return `${World.skillName(id)} needs a ${this.kindName(kinds)}, and none you can use is in your bag.`;
    const key = this.key(weapon) + (wantShield ? ':shield' : '');
    const shield = wantShield ? this.key(this.pickShield()) : this.oneHanded(this.kind(weapon)) && this.shield(this.at(7)) ? home.shield : null;
    return { id: 'auto:' + key, name: weapon.name || Items.name(weapon.refObjId), auto: true, weapon: this.key(weapon), shield };
  },
  // Why a swap to these sets and back home cannot start, or '' when it can.
  problem(home, sets) {
    if (!home.primary && !this.weapon(this.at(6))) return 'Equip your combat weapon before hunting.';
    for (const set of [home, ...sets]) {
      const name = set === home ? 'your combat gear' : set.auto ? set.name : 'the saved set "' + set.name + '"';
      if (!this.lookup(set, set.weapon)) return `Cannot find ${name}: its weapon is not in your bag or equipped (or two copies look identical). Save the buff set again.`;
      if (!this.weapon(this.lookup(set, set.weapon))) return `${name} is not a weapon any more. Save the buff set again.`;
      if (set.shield && (!this.lookup(set, set.shield) || !this.homeLike(set, home) && !this.offhand(this.lookup(set, set.shield)))) return `Cannot find the shield of ${name} (or two copies look identical). Save the buff set again.`;
    }
    // A weapon swaps places with its bag copy, so it needs no space. Only taking the off-hand item off (shield, arrows) needs one free bag slot.
    let offhand = this.key(this.at(7)), stash = false;
    for (const set of [...sets, home]) { if (offhand && offhand !== set.shield) stash = true; offhand = set.shield; }
    return stash && World.freeBagSlots() < 1 ? 'Buff swaps need one free bag slot to take off your shield.' : '';
  },
  settling() { return now() - this.worldAt < BUFF_SETTLE_MS || !Array.isArray(World.gp?.inventory); },
  pairKey(set) { return JSON.stringify([this.key(this.at(6)), this.key(this.at(7)), set.weapon, set.shield || null]); },
  remember(set) { this.pairs.push({ key: this.pairKey(set), at: now() }); },
  looping(set) {
    const key = this.pairKey(set), t = now();
    this.pairs = this.pairs.filter(p => t - p.at < BUFF_PAIR_WINDOW_MS);
    for (const k of this.looped) if (!this.pairs.some(p => p.key === k)) this.looped.delete(k);
    if (this.pairs.filter(p => p.key === key).length < BUFF_PAIR_MAX) return false;
    this.waiting = `The change to ${set.name} already ran twice within a minute; waiting before the next one.`;
    if (!this.looped.has(key)) { this.looped.add(key); Log.warn(this.waiting); }
    return true;
  },
  missing() {
    const key = ItemRules.cfg().gear?.primaryWeapon;
    if (!key || this.findAny(key)) { this.missingAt = null; return false; }
    this.missingAt ??= now();
    if (now() - this.missingAt < BUFF_MISSING_MS) return true;
    this.missingAt = null;
    this.message = `Your primary weapon (${ItemRules.gearName(key)}) is not in your bag. Put it in your bag, or choose another primary weapon (or None) under Combat, Buffs & imbue, Weapons and shield.`;
    Log.warn(this.message); Hunt.stop(this.message);
    return true;
  },
  begin() {
    if (!Hunt.running || this.blocked() || this.missing()) return false;
    const queue = [], swap = this.cfg().buffSwap, auto = this.auto(), home = this.home(), buffs = this.cfg().buffs;
    if (home.primary && !this.matches(home)) return this.wearCombat(home);
    let note = '', held = '', first = -1;
    buffs.forEach((b, index) => {
      const owned = auto && !b.gearSet && this.owns(b), saved = swap && Number(b.gearSet), kind = swap && BUFF_GEAR_KINDS.includes(b.gearSet);
      if (!owned && !saved && !kind) return;
      const id = this.due(b, owned);
      if (!id) return;
      const set = saved ? this.cfg().buffSets.find(s => s.id === Number(b.gearSet)) : kind ? this.gearFor(b.gearSet, home) : this.autoSet(id, home);
      if (!set) return;
      if (typeof set === 'string') { note = set; return; }
      if (this.held() && (this.strikes.has(set.weapon) || set.shield && this.strikes.has(set.shield))) {
        held ||= `${World.skillName(id)} waits until the game takes ${set.name} again; it refused it a moment ago.`;
        return;
      }
      if (first < 0) first = index;
      let q = queue.find(e => e.set.id === set.id);
      if (!q) queue.push(q = { set, buffs: [] });
      q.buffs.push({ b, id, auto: owned });
    });
    this.explain(held);
    const wait = text => { this.waiting = text; return false; };
    if (!queue.length) return wait(held || note);
    const before = buffs.slice(0, first).find(b => this.plain(b));
    if (!before) this.orderAt = null;
    else {
      this.orderAt ??= now();
      if (now() - this.orderAt < BUFF_ORDER_WAIT_MS) return wait(`${World.skillName(Combat.resolve(before))} comes first in the buff list.`);
    }
    // A buff is due, so say why the swap cannot start instead of waiting silently.
    const why = this.problem(home, queue.map(q => q.set));
    if (why) return wait(why);
    this.waiting = note;
    if (this.looping(queue[0].set) || this.petWait() || !Cmd.move(World.pose())) return false;
    const have = queue.flatMap(q => q.buffs);
    for (const q of queue) { const more = this.extras(q.set, home, have); q.buffs.push(...more); have.push(...more); }
    this.remember(queue[0].set); Loot.suspend(); Hunt.state = 'buff'; this.run = this.create(home, queue); this.run.party = have.some(e => e.party);
    this.orderAt = null;
    this.message = 'Pausing combat for buff gear.';
    return true;
  },
  plain(b) {
    const id = Combat.resolve(b), info = World.skill(id);
    if (!b.enabled || b.gearSet || this.owns(b) || !id || info?.targetRequired || Combat.blocked(id) || !Cmd.canCast(id) || !Combat.mpOk(id, World.me())) return false;
    const rem = World.buffRemaining(id);
    if (rem > (b.refreshS ?? 3) * 1000) return false;
    const gap = rem < 0 && !Combat.buffSeen.has(b.group) ? Math.max(4000, Math.min((info?.durationMs || 20000) * .85, 600000)) : 1500;
    return now() - (Combat.buffCastAt.get(b.group) || 0) >= gap;
  },
  // Two sets that put on the same weapon and off-hand item.
  same(a, b) { return !!a && !!b && a.weapon === b.weapon && (a.shield || null) === (b.shield || null); },
  // The gear a buff of yours is cast with, or null when it needs no change.
  gearOf(b, home) {
    const set = Number(b.gearSet) ? this.cfg().buffSets.find(s => s.id === Number(b.gearSet))
      : BUFF_GEAR_KINDS.includes(b.gearSet) ? this.gearFor(b.gearSet, home)
      : this.owns(b) ? this.autoSet(Combat.resolve(b), home) : null;
    return set && typeof set !== 'string' ? set : null;
  },
  // What else is worth casting while this gear is on, so one weapon change covers it all instead of one change per buff
  // and member: your own buffs cast with the same gear that run out within a minute (while hunting), and the party
  // buffs that need it, due or running out within a minute, on each member and on you.
  extras(set, home, have) {
    const out = [];
    if (this.cfg().buffSwap && Hunt.running) for (const b of this.cfg().buffs) {
      if (have.some(e => e.b === b) || !this.same(this.gearOf(b, home), set)) continue;
      const auto = this.owns(b), id = this.due(b, auto, SUPPORT_EARLY_MS);
      if (id) out.push({ b, id, auto, early: SUPPORT_EARLY_MS });
    }
    return [...out, ...Support.entriesFor(set, have.filter(e => e.party))];
  },
  // While hunting with a primary weapon chosen, put the combat gear back on when something else is worn (after a
  // reconnect or a manual change): the primary weapon, and with a one-handed one the shield.
  wearCombat(home) {
    if (!home.primary || this.matches(home) || this.held()) return false;
    if (this.at(7) && this.key(this.at(7)) !== home.shield && World.freeBagSlots() < 1) { this.waiting = 'Wearing your combat gear needs one free bag slot to take off the off-hand item.'; return false; }
    if (this.looping(home) || this.petWait() || !Cmd.move(World.pose())) return false;
    this.remember(home); Loot.suspend(); Hunt.state = 'buff'; this.run = this.create(home, []); this.run.restoring = true; this.run.combat = true;
    this.message = 'Wearing your combat gear.';
    return true;
  },
  // The gear a party buff needs, null when what is worn will do, or why it cannot be cast. It follows Swap weapons for
  // buffs, and for the automatic choice Wear the weapon each buff needs.
  forParty(b, id) {
    if (!this.cfg().buffSwap) return null;
    const home = this.home(), set = BUFF_GEAR_KINDS.includes(b.gear) ? this.gearFor(b.gear, home)
      : this.cfg().buffAuto && (this.mismatch(id) || this.shieldMissing(id)) ? this.autoSet(id, home) : null;
    return set && typeof set !== 'string' && this.matches(set) ? null : set;
  },
  // Party support: wear the gear, cast the buff at the member, then go back to the combat gear. Also while hunting is stopped.
  // entry: { party: true, id, due() (still wanted), cast() (sent), shows() (on the member), ended() (gone with the weapon) }.
  startParty(set, entry) {
    if (this.run || this.blocked()) return false;
    const home = this.home(), why = this.problem(home, [set]);
    if (why) { this.waiting = why; return false; }
    if (this.petWait() || !Cmd.move(World.pose())) return false;
    Loot.suspend(); if (Hunt.running) Hunt.state = 'buff';
    this.run = this.create(home, [{ set, buffs: [entry, ...this.extras(set, home, [entry])] }]); this.run.party = true;
    this.message = 'Equipping ' + set.name + ' for party buffs.';
    return true;
  },
  move(source, destination, resent = false) {
    const r = this.run, from = this.key(this.at(source)), to = this.key(this.at(destination));
    if (!from || !Cmd.spaced('inventory-move')) return;
    if (Cmd.raw({ kind: 'inventory-move', source, destination, quantity: 0 }, resent ? 'Buff gear: move equipment again' : 'Buff gear: move equipment')) {
      this.sentAt = now();
      r.pending = { source, destination, from, to, at: now(), seenAt: now(), counted: 0, calm: 0, resent };
    }
  },
  refusedText(p, what) { return `The game refused to move ${what} (slot ${p.source} to ${p.destination}) twice${p.error ? ' (' + p.error + ')' : ''}`; },
  refusedMove(r, p, what) {
    const text = this.refusedText(p, what);
    r.pending = null;
    if (!r.restoring && r.queue.length) {
      const q = r.queue.shift();
      for (const e of q?.buffs || []) if (!e.party) this.skipped.set(e.b.group, { signature: r.signature, until: now() + 120000, why: 'the game refused to wear its gear, trying again in two minutes' });
      r.refused = text + '; its buffs wait two minutes.'; this.message = r.refused + ' Restoring combat gear.';
      Log.warn(r.refused);
      return true;
    }
    if (!this.weapon(this.at(6))) { this.fail(text + '; no weapon is worn.'); return true; }
    this.recovery = r.home; this.autoRestore = true; this.restoreAt = now() + BUFF_COMBAT_HOLD_MS; this.combatAt = now(); this.run = null;
    this.message = text + '; hunting goes on with what is worn, and the combat gear is tried again in five minutes.';
    Log.warn(this.message);
    return true;
  },
  equip(set) {
    if (this.matches(set)) return true;
    const weapon = this.lookup(set, set.weapon), shield = this.lookup(set, set.shield);
    if (!weapon || !this.weapon(weapon) || set.shield && (!shield || !this.homeLike(set, this.run.home) && !this.offhand(shield))) { this.fail('Required equipment missing or ambiguous.'); return false; }
    if (this.at(7) && this.key(this.at(7)) !== set.shield) {
      const gp = World.gp;
      let empty = -1;
      for (let slot = gp.equipmentSlotCount || 13; slot < gp.inventorySlotCount; slot++) if (!this.at(slot)) { empty = slot; break; }
      if (empty < 0) { this.fail('No bag space to remove the off-hand item.'); return false; }
      this.move(7, empty); return false;
    }
    if (weapon.slot !== 6) { this.move(weapon.slot, 6); return false; }
    if (shield && shield.slot !== 7) { this.move(shield.slot, 7); return false; }
    return false;
  },
  tick() {
    if (!this.run) return this.begin();
    const r = this.run, gp = World.gp;
    if (r.character !== World.charName || r.profile !== Settings.profile) { this.reset(); return false; }
    if (!World.inWorld() || World.isDead()) { this.interrupt('World change or death interrupted buff swaps.', true); return false; }
    if (Manual.lastAt !== r.manualAt) { this.fail('Manual control interrupted buff swaps.'); return true; }
    if (now() - r.at > 120000) { this.fail('Buff gear cycle timed out.'); return true; }
    if (!Hunt.running && !r.party || r.signature !== this.signature()) this.cancel();
    // Party buffs also go out while hunting is stopped; your own buffs only while hunting.
    if (!Hunt.running) for (const q of r.queue) q.buffs = q.buffs.filter(e => e.party);
    if (r.pending) {
      const p = r.pending, t = now(), swapped = this.key(this.at(p.destination)) === p.from && this.key(this.at(p.source)) === p.to;
      Loot.watchLock();
      const lock = Loot.lock, own = !!lock && lock.owner === 'gear' && lock.at >= p.at;
      if (own) p.lockSeen = true;
      if (!gp.inventoryPending || own && !swapped) p.counted += t - p.seenAt;
      p.calm = gp.inventoryPending ? 0 : p.calm + (t - p.seenAt <= BUFF_MOVE_WATCH_MS ? t - p.seenAt : 0);
      p.seenAt = t;
      if (!gp.inventoryPending && swapped) r.pending = null;
      else {
        const item = this.at(p.source) || this.at(p.destination), what = item ? item.name || Items.name(item.refObjId) : 'an item';
        // Nothing moved and nothing is pending: the game refused it (level, class). Skip that weapon, put gear back, carry on.
        const unchanged = !gp.inventoryPending && p.calm > BUFF_MOVE_REFUSED_MS && this.key(this.at(p.source)) === p.from && this.key(this.at(p.destination)) === p.to;
        if (unchanged && !p.resent && (p.lockSeen || p.error)) {
          if (!Loot.petInFlight()) {
            this.move(p.source, p.destination, true);
            if (r.pending !== p) Log.info(`The game did not take the move of ${what} (slot ${p.source} to ${p.destination}); sending it once more.`);
          }
          return true;
        }
        const refused = unchanged, expired = p.counted > BUFF_MOVE_COUNTED_MS, timedOut = expired || t - p.at > BUFF_MOVE_TOTAL_MS;
        const chosen = p.destination === 6 && p.from === r.home.weapon || p.destination === 7 && p.from === r.home.shield;
        if (refused && (r.restoring || !r.queue.length) && r.home.primary && chosen) {
          r.pending = null;
          // A refused shield: the primary stays, with the shield worn before if there was one. A refused primary: what was worn.
          r.home = p.destination === 7 ? { ...r.home, shield: this.shield(this.findAny(r.worn.shield)) ? r.worn.shield : null } : r.worn;
          r.combat = false; r.refused = this.refuseCombat(p.from, what);
          this.message = r.refused; return true;
        }
        if (r.combat && (refused || timedOut)) {
          const n = this.strike('combat'); this.run = null;
          this.message = `The game would not move ${what}; your combat gear stays as it is for ${n > 1 ? 'five minutes' : BUFF_COMBAT_RETRY_MS / 1000 + ' s'}.`;
          if (n <= 2) Log.warn(this.message);
          return true;
        }
        if (refused && !r.restoring && r.queue[0]?.set.auto && this.chosenKey(p.from) && (p.destination === 6 || p.destination === 7)) {
          r.pending = null; r.queue.shift(); r.refused = this.refuseCombat(p.from, what);
          this.message = r.refused + ' Restoring combat gear.';
          return true;
        }
        if (refused && !r.restoring && r.queue[0]?.set.auto && (p.destination === 6 || p.destination === 7 && p.from === r.queue[0].set.shield)) {
          this.bad.add(p.from); r.pending = null; r.queue.shift();
          r.refused = `The game would not equip ${what}; another weapon is tried next time.`; this.message = r.refused + ' Restoring combat gear.';
          return true;
        }
        if (refused && p.resent) return this.refusedMove(r, p, what);
        if (timedOut) {
          if (expired && r.queue[0]?.set.auto && p.destination === 6 && !this.chosenKey(p.from)) this.bad.add(p.from);
          const busy = expired ? '' : ` The game's inventory stayed busy with ${gp.inventoryPending && lock ? 'another action (' + lock.owner + ')' : 'other actions'} for ${Math.round((t - p.at) / 1000)} s.`;
          this.fail(`Equipment move unconfirmed (${what}, slot ${p.source} to ${p.destination}); ${p.resent ? 'sent twice' : 'no retry sent'}.${busy}`);
        }
        return true;
      }
    }
    if (r.cast) {
      const p = r.cast, remaining = p.party ? (p.entry.shows() ? 1 : 0) : World.buffRemaining(p.id);
      if (remaining > 0) { p.accepted = true; p.visible = true; }
      // A party buff one member cannot take, or that never shows on them, does not end the change: the next one goes.
      const refused = !p.accepted && p.party && p.entry.refused?.();
      if (refused) { this.message = refused; r.cast = null; return true; }
      if (now() < p.until || World.isCasting()) return true;
      if (!p.accepted && p.party) { if (now() - p.at > 10000) r.cast = null; return true; }
      if (!p.accepted) { if (now() - p.at > 10000) { this.skipped.set(p.group, { signature: r.signature, until: now() + 120000, why: 'the cast was not confirmed, trying again in two minutes' }); this.cancel(); this.message = 'Buff cast unconfirmed; restoring combat gear.'; r.cast = null; } return true; }
      r.effects.push(p); r.cast = null;
    }
    if (Combat.busy() || gp.inventoryPending || World.isSitting() || World.local()?.mountedOn || Loot.pressed() || Loot.petInFlight()) return true;
    if (Restock.activeShop() || gp.storage || gp.exchange?.open || gp.exchange?.requesting || gp.stall?.phase && gp.stall.phase !== 'none' || gp.returnScroll) { this.fail('Buff swaps interrupted by another game action.'); return true; }
    if (r.restoring || !r.queue.length) {
      this.message = 'Restoring combat gear.';
      if (!this.equip(r.home)) return true;
      this.strikes.delete(r.home.weapon); this.strikes.delete(r.home.shield); if (r.home.primary) this.strikes.delete('combat');
      if (!r.restoredAt) { r.restoredAt = now(); return true; }
      if (now() - r.restoredAt < 1000) return true;
      for (const p of r.effects) if (p.visible && (p.party ? !p.entry.shows() : World.buffRemaining(p.id) <= 0)) {
        if (p.party) { p.entry.ended(); continue; }
        this.skipped.set(p.group, { signature: r.signature, until: Infinity, why: 'it ended when the weapon changed back, so it stays with your combat weapon until buff settings change' });
        this.message = 'A buff ended after changing weapons; skipped until buff settings change.';
      }
      if (this.message === 'Restoring combat gear.') this.message = (r.refused ? r.refused + ' ' : '') + 'Combat gear restored.';
      this.run = null; this.recovery = null; return true;
    }
    // Many casts in one change: past BUFF_RUN_BUDGET_MS the rest waits for the next change, well before the timeout.
    if (now() - r.at > BUFF_RUN_BUDGET_MS) { r.queue = []; this.message = 'Restoring combat gear; the remaining buffs go in the next change.'; return true; }
    const q = r.queue[0];
    this.message = 'Equipping ' + q.set.name + ' for buffs.';
    if (!this.equip(q.set)) return true;
    const entry = q.buffs[0];
    if (!entry) { r.queue.shift(); return true; }
    if (entry.party ? !entry.due() : !this.due(entry.b, entry.auto ?? q.set.auto, entry.early || 0)) { this.drop(q, entry); return true; }
    entry.triedAt ??= now();
    if (now() - entry.triedAt > 3000) { this.drop(q, entry, 'the cast was not sent'); return true; }
    const shown = !entry.party && World.buffRemaining(entry.id) > 0;
    if (entry.party ? entry.cast() : Combat.cast(entry.id, World.skill(entry.id)?.targetRequired ? World.localGid() : 0)) {
      if (!entry.party) Combat.buffCastAt.set(entry.b.group, now());
      q.buffs.shift();
      r.cast = { id: entry.id, group: entry.party ? null : entry.b.group, party: !!entry.party, entry: entry.party ? entry : null, at: now(), until: now() + Math.max(1000, World.skill(entry.id)?.actionMs || (shown ? 1000 : 6000)) + 500, accepted: false, visible: false };
      this.message = 'Casting buff; waiting before changing weapons.';
    }
    return true;
  },
  unfit(id, refused = Combat.blocked(id)) {
    if (!id || !World.learned(id)) return 'not learned';
    if (refused) return 'the game refused it';
    if (World.cooldownLeft(id) > 0) return 'cooldown';
    if (!Combat.mpOk(id, World.me())) return 'not enough MP';
    return '';
  },
  drop(q, entry, fallback = '') {
    q.buffs.shift();
    if (entry.early) return;
    if (entry.party) {
      const why = entry.problem();
      if (why !== null && (why || fallback)) entry.hold(why || fallback);
      return;
    }
    const id = Combat.resolve(entry.b) || entry.id;
    if (World.buffRemaining(id) > (entry.b.refreshS ?? 3) * 1000) return;
    const why = this.unfit(id) || fallback;
    if (!why) return;
    const text = `it could not be cast after changing weapons (${why})`;
    this.skipped.set(entry.b.group, { signature: this.run.signature, until: now() + BUFF_HOLD_MS, why: text + ', trying again in two minutes' });
    Log.info(`Skipping ${World.skillName(id)} for two minutes: ${text}.`);
  },
  // The buffs assigned to a saved set or to the gear chosen under Combat that are on, with how long each has left.
  assigned() {
    const sets = this.cfg().buffSets;
    return this.cfg().buffs.filter(b => b.enabled && (BUFF_GEAR_KINDS.includes(b.gearSet) || Number(b.gearSet) && sets.some(s => s.id === Number(b.gearSet)))).map(b => {
      const id = Combat.resolve(b);
      return { name: World.skillName(id || b.id), left: id ? World.buffRemaining(id) : 0, learned: !!id && World.learned(id), skip: this.skipped.get(b.group) };
    });
  },
  // Enabled buffs the cycle wears a weapon for on its own, with the bag weapon it would pick.
  autoList() {
    if (!this.auto()) return [];
    const home = this.home();
    return this.cfg().buffs.filter(b => this.owns(b)).map(b => {
      const id = Combat.resolve(b), set = this.autoSet(id, home), missing = typeof set === 'string';
      return { name: World.skillName(id), left: World.buffRemaining(id), missing: missing ? set : '', weapon: missing ? null : set.name, skip: this.skipped.get(b.group) };
    });
  },
  status() {
    if (this.run || this.recovery) return this.message;
    if (!this.cfg().buffSwap) return 'Buff weapon swapping off.';
    const sets = this.cfg().buffSets, list = this.assigned(), auto = this.autoList();
    if (!auto.length && !list.length && !sets.length) return 'Buff weapon swapping is on, but no buff set is saved yet. Equip the buff weapon and press Save equipped buff set, or pick your primary or secondary weapon or shield in Gear for <skill>.' + (this.cfg().buffAuto ? ' Buffs that need a different weapon than yours are swapped automatically; none do right now.' : '');
    if (!auto.length && !list.length) return 'Buff weapon swapping is on, but no buff skill is assigned to a set yet. Use Gear for <skill> under your buffs.';
    const lines = [];
    for (const a of auto) {
      if (a.skip && a.skip.signature === this.signature() && now() < a.skip.until) lines.push(`${a.name}: skipped because ${a.skip.why}.`);
      else if (a.missing) lines.push(a.missing);
      else if (a.left > 0) lines.push(`${a.name}: active, ${Math.ceil(a.left / 1000)} s left; your ${a.weapon} is worn for it when it is about to end.`);
      else lines.push(`${a.name}: due now; your ${a.weapon} is worn for it.`);
    }
    for (const a of list) {
      if (!a.learned) lines.push(`${a.name}: not learned on this character, so it is never cast.`);
      else if (a.skip && a.skip.signature === this.signature() && now() < a.skip.until) lines.push(`${a.name}: skipped because ${a.skip.why}.`);
      else if (a.left > 0) lines.push(`${a.name}: active, ${Math.ceil(a.left / 1000)} s left; the swap happens when it is about to end.`);
      else lines.push(`${a.name}: due now.`);
    }
    return (this.waiting ? this.waiting + '\n' : '') + lines.join('\n');
  },
  draw(parent) {
    const box = UI.group('Buff weapon sets');
    box.append(UI.check('Swap weapons for buffs', () => this.cfg().buffSwap, v => this.cfg().buffSwap = v),
      UI.check('Wear the weapon each buff needs (from your bag)', () => this.cfg().buffAuto, v => this.cfg().buffAuto = v),
      el('p', 'With both on, a buff your weapon cannot cast is cast with a matching weapon from your bag, then your combat weapon and shield come back. A buff can also wear the primary or secondary weapon or the shield chosen above, or a saved set below. Keep one bag slot free. Buffs tied to the removed weapon may end.', 'muted'));
    const name = el('input'); name.type = 'text'; name.maxLength = 40; name.value = 'Buff set ' + (this.cfg().buffSets.length + 1);
    box.append(UI.field('New buff set name', name), UI.button('Save equipped buff set', () => this.save(name.value)));
    for (const set of this.cfg().buffSets) {
      const weapon = this.find(set.weapon), shield = this.find(set.shield);
      box.append(UI.row(el('span', set.name + ': ' + (weapon?.name || (weapon ? 'Weapon +' + (weapon.plus || 0) : 'weapon missing / ambiguous')) + (set.shield ? shield ? ' + shield' : ' + shield missing / ambiguous' : '')),
        UI.button('Remove ' + set.name, () => {
          if (this.run || this.recovery) return UI.toast('Restore combat gear before editing sets.', 'warn');
          this.cfg().buffSets = this.cfg().buffSets.filter(s => s.id !== set.id);
          for (const b of this.cfg().buffs) if (Number(b.gearSet) === set.id) b.gearSet = 0;
          Settings.saveProfile(); UI.draw();
        })));
    }
    box.append(UI.button('Restore combat gear', () => this.restore()), UI.button('Use current gear', () => {
      if (this.run || World.gp?.inventoryPending) return UI.toast('Wait for the current equipment move to settle.', 'warn');
      this.recovery = null; this.message = 'Current gear accepted. Review it before hunting.';
    }));
    this.note = el('p', this.status(), 'muted'); box.append(this.note); parent.append(box);
  },
};
const normalBuffs = Combat.buffs;
Combat.buffs = function (hunting) {
  // Assigned buffs are owned exclusively by the gear cycle, including when off.
  const original = Settings.profile.macro.buffs;
  Settings.profile.macro.buffs = original.filter(b => !b.gearSet && !BuffGear.owns(b));
  try { return normalBuffs.call(this, hunting); }
  finally { Settings.profile.macro.buffs = original; }
};
