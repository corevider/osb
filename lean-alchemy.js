// Item enhancement (elixirs, for weapons, shields, armour and accessories) and the Luck / Steady / Immortal / Astral stones. Never resend an unconfirmed
// material-spending request.
// A stone adds 1 to the weapon's attribute count (at most 6): Luck raises the enhancement success chance, Steady
// protects the durability and Immortal the weapon itself when an enhancement fails. Stone items are one per weapon
// degree 1..12, in consecutive ids. The server takes these stones (item type 3,3,11,7) only in the request it calls
// "magic" (mode byte 3). The page's own attribute mode sends byte 2, which the server answers with refusal 0x10 for
// them, so the command here uses mode 'magic'. A fusion can fail: the stone is then used up and the answer is 0x23.
const STONES = {
  luck: { label: 'Luck', option: 'MATTR_LUCK', base: 6871 },
  steady: { label: 'Steady', option: 'MATTR_SOLID', base: 6859 },
  immortal: { label: 'Immortal', option: 'MATTR_ATHANASIA', base: 6847 },
  astral: { label: 'Astral', option: 'MATTR_ASTRAL', base: 6883 },
};
const STONE_MAX = 6;
// Enhancement attempts one run may make. A run also stops at the target, or when the elixirs, powder or stones run out.
const ALCHEMY_MAX_ATTEMPTS = 9999;
// The attributes an item's stat percentages come from, in the order the server keeps them (alchemy stones.go
// attributes()): the index is the item's 5-bit variance field. Durability has no stone.
const ATTRIBUTES = {
  weapon: ['NATTR_DUR', 'NATTR_PASTR', 'NATTR_MAINT', 'NATTR_HR', 'NATTR_PA', 'NATTR_MA', 'NATTR_CRITICAL'],
  armor: ['NATTR_DUR', 'NATTR_PDSTR', 'NATTR_MDINT', 'NATTR_PD', 'NATTR_MD', 'NATTR_ER'],
  shield: ['NATTR_DUR', 'NATTR_PDSTR', 'NATTR_MDINT', 'NATTR_BR', 'NATTR_PD', 'NATTR_MD'],
  accessory: ['NATTR_PAR', 'NATTR_MAR'],
};
const ATTRIBUTE_LABEL = {
  NATTR_PASTR: 'Phy. reinforce', NATTR_MAINT: 'Mag. reinforce', NATTR_PDSTR: 'Phy. reinforce', NATTR_MDINT: 'Mag. reinforce', NATTR_HR: 'Attack rating',
  NATTR_PA: 'Phy. attack power', NATTR_MA: 'Mag. attack power', NATTR_CRITICAL: 'Critical', NATTR_PD: 'Phy. defense', NATTR_MD: 'Mag. defense',
  NATTR_ER: 'Parry rate', NATTR_BR: 'Block rate', NATTR_PAR: 'Phy. absorption', NATTR_MAR: 'Mag. absorption',
};
// A fusion rolls a new value in six steps (alchemy stones.go varianceValue). The step is the lowest of four rolls (the
// item's own magic limit caps it), so the value is one of these; each step needs every roll to reach it.
const ATTRIBUTE_STEPS = [[7, 22], [13, 41], [19, 61], [25, 80], [31, 100]];
const STONE_FAILED = 0x23;
const ALCHEMY_SETTLE_MS = 5000;
const BLUE_LABEL = {
  MATTR_STR: 'Str', MATTR_INT: 'Int', MATTR_DUR: 'Durability', MATTR_HR: 'Attack rate', MATTR_EVADE_BLOCK: 'Ignore block',
  MATTR_EVADE_CRITICAL: 'Block critical', MATTR_ER: 'Parry rate', MATTR_HP: 'HP', MATTR_MP: 'MP', MATTR_RESIST_FROSTBITE: 'Freeze resistance',
  MATTR_RESIST_ESHOCK: 'Shock resistance', MATTR_RESIST_BURN: 'Burn resistance', MATTR_RESIST_POISON: 'Poison resistance', MATTR_RESIST_ZOMBIE: 'Zombie resistance',
};
const MAGIC_SLOT_EXTRA = ['MATTR_DEC_MAXDUR', 'MATTR_NOT_REPARABLE'];
const BLUE_SKIP_REFUSALS = [9, 0x22];
const QUEUE_STEPS = ['plus', 'white', 'blue'];
const STEP_LABEL = { plus: 'Plus', white: 'White', blue: 'Blue' };
const Alchemy = {
  windowOwner: null, selected: null, run: null, pending: null, result: null, message: 'Add an item from your bag to the queue to begin.', started: false,
  queue: null, editRow: 0, goalsTab: 'plus', rowStatus: new WeakMap(),
  cfg() { return Settings.profile.alchemy; },
  // The server's enhancement families (alchemy catalog.go category()): weapon, shield, accessory and armor. An elixir is
  // refused (0x09) for any other family.
  kind(i) {
    if (!i || i.slot < 13 || i.slot > 255 || (i.typeFlags & 0x7e) !== 0x2c || !Number.isInteger(i.plus) || i.plus < 0) return '';
    const t = (i.typeFlags >>> 7) & 15;
    return t === 6 ? 'weapon' : t === 4 ? 'shield' : t === 5 || t === 12 ? 'accessory' : [1, 2, 3, 9, 10, 11].includes(t) ? 'armor' : '';
  },
  gear(i) { return !!this.kind(i); },
  degree(i) { const n = i?.tooltip?.fields?.itemClass; return Number.isInteger(n) && n > 0 ? Math.floor((n - 1) / 3) + 1 : 0; },
  // Retail itemdata: weapon recipes 3675/3679 (param1 includes category 6).
  // Powder A 3683..3694 and B 3695..3706 have param1 = degree 1..12.
  // Reinforce elixirs (item data ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_<KIND>_A / _B), per gear kind.
  elixir(i, kind = 'weapon') { return i && !!ALCHEMY_DATA.kinds[kind]?.includes(i.refObjId) && (i.typeFlags & 0xfffe) === 0x0d6c && i.quantity > 0 && i.slot >= 13; },
  elixirChoice(kind, cfg = this.cfg()) { const pick = Number(cfg.elixir) || 0; return ALCHEMY_DATA.kinds[kind]?.includes(pick) ? pick : 0; },
  bagElixir(kind, cfg = this.cfg()) {
    const pick = this.elixirChoice(kind, cfg), all = World.items().filter(i => this.elixir(i, kind));
    return all.find(i => pick && i.refObjId === pick) || all[0];
  },
  powderDegree(i) {
    if (!i || (i.typeFlags & 0xfffe) !== 0x156c || !(i.quantity > 0) || i.slot < 13) return 0;
    return i.refObjId >= 3683 && i.refObjId <= 3694 ? i.refObjId - 3682 : i.refObjId >= 3695 && i.refObjId <= 3706 ? i.refObjId - 3694 : 0;
  },
  fingerprint(i) { return JSON.stringify([i.slot, i.refObjId, i.typeFlags, i.plus, i.durability, i.variance, i.magic]); },
  identity(i) { return JSON.stringify([i.slot, i.refObjId, i.typeFlags, i.variance]); },
  select(slot) {
    if (this.run || this.pending) return UI.toast('Stop alchemy and wait for the pending result before changing weapons.', 'warn');
    const item = World.items().find(i => i.slot === Number(slot));
    this.selected = this.gear(item) ? { slot: item.slot, fingerprint: this.fingerprint(item) } : null;
    this.message = this.selected ? 'Item selected. Set the target and attempt limit.' : 'Select an item from your bag to begin.';
  },
  item() { return World.items().find(i => i.slot === this.selected?.slot); },
  // The count of one attribute (Luck, Steady, Immortal) on a weapon, from its magic options; the option's amount is the count.
  attributeCount(item, option) {
    const refs = item?.magicReferences || [];
    return (item?.magic || []).reduce((n, encoded) => {
      const bits = toBigInt(encoded), ref = refs.find(r => r.paramId === Number(bits & 65535n));
      return ref?.optionName === option ? Math.max(n, Number(bits >> 32n) & 0xffffffff) : n;
    }, 0);
  },
  // Counts are readable only when every magic option has its reference loaded; otherwise they would read as zero.
  attributesKnown(item) {
    const refs = item?.magicReferences || [];
    return (item?.magic || []).every(encoded => refs.some(r => r.paramId === Number(toBigInt(encoded) & 65535n)));
  },
  // Attribute percentages. `index` is the attribute's place in the server's list, which is also its 5-bit slot in the item's variance.
  attributes(kind) { return (ATTRIBUTES[kind] || []).map((name, index) => ({ name, index })).filter(a => ALCHEMY_DATA.attrStones[a.name] && ATTRIBUTE_LABEL[a.name]); },
  attrValue(item, index) { return item?.variance === undefined ? 0 : Number((toBigInt(item.variance) >> BigInt(index * 5)) & 31n); },
  attrValues(item) { return Object.fromEntries(this.attributes(this.kind(item)).map(a => [a.name, this.attrValue(item, a.index)])); },
  attrTarget(name, cfg = this.cfg()) { return Math.min(31, Math.max(0, Math.floor(Number(cfg.attr?.targets?.[name])) || 0)); },
  attrPercent(value) { return Math.floor(value * 100 / 31); },
  // The first attribute below its wanted value that has a bag stone of the item's degree. Attributes without one are
  // passed over (`skipped`), so the others are still done; with none left to fuse, `missing` names the stones that ran out.
  nextAttr(item, cfg = this.cfg()) {
    const degree = this.degree(item), skipped = [];
    for (const a of this.attributes(this.kind(item))) {
      const target = this.attrTarget(a.name, cfg);
      if (!target || this.attrValue(item, a.index) >= target) continue;
      const ref = ALCHEMY_DATA.attrStones[a.name] + degree - 1;
      const stone = World.items().find(i => i.refObjId === ref && (i.typeFlags & 0xfffe) === 0x15ec && i.quantity > 0 && i.slot >= 13);
      if (stone) return { attr: a, item: stone, skipped };
      skipped.push(a.name);
    }
    if (!skipped.length) return null;
    const names = skipped.map(name => ATTRIBUTE_LABEL[name]);
    return { missing: `No ${names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names.at(-1) : names[0]} stone of degree ${degree} in the bag.`, skipped };
  },
  armorPart(i) { return { 1: 'helm', 3: 'mail', 4: 'pants' }[(i.typeFlags >>> 11) & 31] || ''; },
  blues(item) {
    const kind = this.kind(item), part = kind === 'armor' ? this.armorPart(item) : '';
    return Object.keys(BLUE_LABEL).filter(name => ALCHEMY_DATA.blues?.[name]?.cats.some(c => c === kind || part && c === part));
  },
  blueValues(name, degree) { return ALCHEMY_DATA.blues?.[name]?.values?.[degree] || []; },
  blueTarget(name, cfg = this.cfg(), degree = 0) {
    const want = Math.max(0, Math.floor(Number(cfg.blue?.targets?.[name])) || 0), values = this.blueValues(name, degree);
    return want && values.length ? Math.min(want, values.at(-1)) : want;
  },
  magicSlots(item) {
    const max = item?.tooltip?.fields?.maxMagicOptions51c, used = (item?.magic || []).length;
    if (!Number.isInteger(max)) return { used, limit: null };
    const extra = MAGIC_SLOT_EXTRA.reduce((n, option) => n + (this.attributeCount(item, option) > 0 ? 1 : 0), 0);
    return { used, limit: Math.min(12, max + extra) };
  },
  blueStone(name, degree) {
    const ref = ALCHEMY_DATA.magicStones?.[name] + degree - 1;
    return World.items().find(i => i.refObjId === ref && (i.typeFlags & 0xfffe) === 0x0dec && i.quantity > 0 && i.slot >= 13);
  },
  nextBlue(item, cfg = this.cfg(), skipped = []) {
    const degree = this.degree(item), slots = this.magicSlots(item), noStone = [], full = [];
    for (const name of this.blues(item)) {
      const target = this.blueTarget(name, cfg, degree);
      if (!target || skipped.includes(name) || this.attributeCount(item, name) >= target) continue;
      if (!this.attributeCount(item, name) && slots.limit !== null && slots.used >= slots.limit) { full.push(name); continue; }
      const stone = this.blueStone(name, degree);
      if (stone) return { name, item: stone, full };
      noStone.push(name);
    }
    if (!noStone.length && !full.length) return null;
    const list = names => names.map(n => BLUE_LABEL[n]).join(', ');
    return { missing: noStone.length ? `No ${list(noStone)} stone of degree ${degree} in the bag.` : `No free magic slot for ${list(full)}.`, full, noSlot: !noStone.length };
  },
  // About how many stones one wanted value takes: a fusion works half the time (the stone's own chance, before skill and
  // avatar bonuses) and then the new value reaches step k only when all four rolls do, ((6 - k) / 6)^4, if the item allows it.
  attrExpected(target) {
    const k = ATTRIBUTE_STEPS.findIndex(s => s[0] >= target) + 1;
    return k > 0 ? 1 / (.5 * Math.pow((6 - k) / 6, 4)) : 0;
  },
  // The helpers switched on, and how many charges of each to keep on the item (1 to 6).
  wanted(cfg = this.cfg()) { return Object.keys(STONES).filter(kind => !!cfg.use?.[kind]); },
  keep(kind, cfg = this.cfg()) { return Math.min(STONE_MAX, Math.max(1, Math.floor(Number(cfg.stones?.[kind])) || 1)); },
  // The plus from which a helper is used.
  from(kind, cfg = this.cfg()) { return Math.max(0, Number(cfg.from?.[kind]) || 0); },
  // The next stone to fuse: the first kind still below its wanted count, with a bag stone of the weapon's degree.
  // The game takes an Astral charge only while the weapon has more Immortal charges than Astral ones (refusal 0x24),
  // so an Immortal stone goes first when needed, even below Immortal's own plus or with Immortal not ticked.
  nextStone(item, cfg = this.cfg(), plus = Infinity) {
    const degree = this.degree(item);
    const bagStone = kind => World.items().find(i => i.refObjId === STONES[kind].base + degree - 1 && (i.typeFlags & 0xfffe) === 0x3dec && i.quantity > 0 && i.slot >= 13);
    for (const kind of this.wanted(cfg).filter(k => plus >= this.from(k, cfg))) {
      const want = this.keep(kind, cfg), have = this.attributeCount(item, STONES[kind].option);
      if (have >= want) continue;
      const immortal = this.attributeCount(item, STONES.immortal.option);
      if (kind === 'astral' && immortal <= have) {
        const stone = bagStone('immortal');
        return stone ? { kind: 'immortal', item: stone, count: immortal, forAstral: true } : { missing: 'immortal', forAstral: true };
      }
      const stone = bagStone(kind);
      return stone ? { kind, item: stone, count: have } : { missing: kind };
    }
    return null;
  },
  powderWanted(item, cfg = this.cfg()) { return !!cfg.powder && item.plus >= this.from('powder', cfg); },
  materials(item, cfg = this.cfg()) {
    const kind = this.kind(item), degree = this.degree(item);
    const elixir = this.bagElixir(kind, cfg);
    const wantPowder = this.powderWanted(item, cfg);
    const powder = wantPowder ? World.items().find(i => this.powderDegree(i) === degree && degree > 0) : null;
    return { elixir, powder, wantPowder };
  },
  // The server's odds for one attempt (reinforce.go): the elixir's chance at the plus (+11 holds above), plus the powder's
  // and the Luck bonus while the running chance is below 100, clamped to 10..100. Skill and avatar bonuses are not known here.
  chanceAt(plus, elixirRef, powderRef, luck) {
    const e = ALCHEMY_DATA.elixirs[elixirRef]; if (!e) return null;
    const at = Math.min(Math.max(0, plus), 11), p = powderRef && ALCHEMY_DATA.powders[powderRef];
    let c = e[at];
    if (p && c < 100) c += p.chances[at];
    if (luck && c < 100) c += 5;
    return Math.max(10, Math.min(100, c));
  },
  // Expected attempts to climb from plus `from` to `target` when a failure resets to +0 (no Astral), and the chance of
  // getting there without one failure. P[k] is the chance of climbing from +0 to +k in a row.
  expected(from, target, chance) {
    const P = [1]; for (let k = 0; k < target; k++) P[k + 1] = P[k] * chance(k) / 100;
    let all = 0, run = 0; for (let k = 0; k < target; k++) { all += P[k]; if (k >= from) run += P[k]; }
    const q = P[target] / P[from], first = all / P[target];
    return { attempts: run / P[from] + (1 - q) * first, clean: q };
  },
  // What the next attempts would use and how likely they are to work, from the bag and the settings.
  odds(item, cfg = this.cfg()) {
    const kind = this.kind(item); if (!kind) return null;
    const elixir = this.bagElixir(kind, cfg);
    if (!elixir) return null;
    const degree = this.degree(item), powder = cfg.powder && degree > 0 ? World.items().find(i => this.powderDegree(i) === degree) : null;
    const luck = !!cfg.use?.luck;
    const at = plus => this.chanceAt(plus, elixir.refObjId, powder && plus >= this.from('powder', cfg) ? powder.refObjId : 0, luck && plus >= this.from('luck', cfg));
    const target = Math.min(250, Math.max(item.plus + 1, Number(cfg.target) || 0));
    return { now: at(item.plus), plan: item.plus < target ? this.expected(item.plus, target, at) : null, target };
  },
  // The log and statistics shown under the settings: newest last, at most 60 lines.
  log: [],
  note(text) { this.log.push({ at: Date.now(), text }); if (this.log.length > 60) this.log.shift(); },
  blocked() {
    if (BuffGear.run || BuffGear.recovery) return 'Restore or review combat gear before alchemy.';
    const gp = World.gp;
    if (!World.inWorld() || !gp || !World.local()) return 'Enter the game world first.';
    if (World.isDead()) return 'Alchemy stopped: character died.';
    if (Hunt.running || Town.trip || WalkBack.active || Restock.trip || Restock.recording || Resurrect.trip || Controller.resumeAfterRevive) return 'Stop hunting, travel and route recording first.';
    if (Loot.active) return 'Stop collection and wait for its inventory transaction first.';
    if (World.isCasting() || Hunt.underAttack() || gp.returnScroll || gp.pendingMoves) return 'Wait for combat and movement to finish.';
    if (Restock.activeShop() || gp.storage || gp.exchange?.open || gp.exchange?.requesting || gp.stall?.phase && gp.stall.phase !== 'none') return 'Close shop, storage, trade and stall first.';
    return '';
  },
  goalsKey(cfg) { return JSON.stringify(['target', 'limit', 'elixir', 'powder', 'use', 'stones', 'stoneLimit', 'from', 'attr', 'blue'].map(f => cfg?.[f])); },
  begin(kind, item, cfg, { stonesOnly = false, goalsOf = () => this.cfg(), queued = false } = {}) {
    const error = this.blocked(), gp = World.gp, word = kind === 'plus' ? 'Weapon' : 'Item';
    if (error) return { error };
    if (gp.inventoryPending || !gp.alchemy || gp.alchemy.pending) return { error: 'Wait for known, settled inventory and alchemy state.', wait: true };
    if (kind === 'plus') {
      const wants = this.wanted(cfg);
      if (stonesOnly && !wants.length) return { error: 'Tick at least one stone type first (Use Luck, Steady, Immortal or Astral).' };
      if (wants.length && !this.degree(item)) return { error: 'Weapon degree is unknown; cannot choose matching stones.' };
      if (wants.length && !this.attributesKnown(item)) return { error: 'The weapon\'s attributes are not loaded yet. Try again in a moment.', wait: true };
      if (!stonesOnly) {
        if (!Number.isInteger(cfg.target) || cfg.target < 1 || cfg.target > 250 || !Number.isInteger(cfg.limit) || cfg.limit < 1 || cfg.limit > ALCHEMY_MAX_ATTEMPTS) return { error: `Set target + from 1 to 250 and attempts from 1 to ${ALCHEMY_MAX_ATTEMPTS}.` };
        if (item.plus >= cfg.target) return { error: 'Weapon already meets the target +.' };
        const materials = this.materials(item, cfg);
        if (!materials.elixir) return { error: `No selected ${this.kind(item)} elixirs in the bag.`, missing: true };
        if (materials.wantPowder && !this.degree(item)) return { error: 'Weapon degree is unknown; cannot choose compatible lucky powder.' };
        if (materials.wantPowder && !materials.powder) return { error: 'No lucky powder matching this weapon degree.', missing: true };
      }
    } else {
      if (!this.degree(item)) return { error: 'Item degree is unknown; cannot choose matching stones.' };
      if (kind === 'attr') {
        if (item.variance === undefined) return { error: 'The item\'s stats are not loaded yet. Try again in a moment.', wait: true };
        if (!this.attributes(this.kind(item)).some(a => this.attrTarget(a.name, cfg))) return { error: 'Pick at least one attribute percentage to aim for first.' };
        if (!this.nextAttr(item, cfg)) return { error: 'The item already has every wanted percentage.' };
      } else {
        if (!this.attributesKnown(item)) return { error: 'The item\'s blues are not loaded yet. Try again in a moment.', wait: true };
        if (!this.blues(item).some(name => this.blueTarget(name, cfg, this.degree(item)))) return { error: 'Pick at least one blue to aim for first.' };
        if (!this.nextBlue(item, cfg)) return { error: 'The item already has every wanted blue.' };
      }
    }
    this.run = { kind, slot: item.slot, identity: this.identity(item), shape: this.shape(item), fingerprint: this.fingerprint(item), stonesOnly,
      cfg: JSON.parse(JSON.stringify(cfg)), config: this.goalsKey(cfg), goalsOf, queued, manualAt: Manual.lastAt, character: World.charName,
      attempts: 0, successes: 0, failures: 0, destroyed: 0, highest: item.plus, elixirs: 0, powders: 0, stoneAttempts: 0, stoneFailures: 0, attrFused: 0, blueFused: 0,
      stonesUsed: { luck: 0, steady: 0, immortal: 0, astral: 0 }, nextAt: now(), opening: null, skipped: [] };
    if (!queued) this.result = this.run;
    const name = item.name || Items.name(item.refObjId);
    this.message = kind === 'plus' ? 'Preparing alchemy.' : kind === 'attr' ? 'Preparing attribute stones.' : 'Preparing blue stones.';
    this.note(kind === 'attr' ? `Started attribute stones on ${name}.` : kind === 'blue' ? `Started blue stones on ${name}.` : stonesOnly ? 'Started fusing stones.' : `Started: ${name} +${item.plus} to +${cfg.target}.`);
    return '';
  },
  shape(item) { return JSON.stringify([item.slot, item.refObjId, item.typeFlags]); },
  startSelected(kind, stonesOnly = false) {
    if (this.run || this.queue) return;
    this.settleStale();
    if (this.pending) { this.message = 'The last attempt is still waiting for its result. Try again in a few seconds.'; return UI.toast(this.message, 'warn'); }
    const item = this.item(), reject = text => { this.message = text; UI.toast(text, 'warn'); };
    const blocked = this.blocked(), gp = World.gp; if (blocked) return reject(blocked);
    if (gp.inventoryPending || !gp.alchemy || gp.alchemy.pending) return reject('Wait for known, settled inventory and alchemy state.');
    if (!this.gear(item) || this.fingerprint(item) !== this.selected?.fingerprint) return reject(kind === 'plus' ? 'Weapon changed or moved. Select it again.' : 'Item changed or moved. Select it again.');
    const result = this.begin(kind, item, this.cfg(), { stonesOnly });
    if (result) reject(result.error);
  },
  start(stonesOnly = false) { this.startSelected('plus', stonesOnly); },
  startAttributes() { this.startSelected('attr'); },
  startBlues() { this.startSelected('blue'); },
  end(reason, how = 'done') {
    const r = this.run;
    if (!r?.queued || !this.queue) return this.stop(reason);
    this.addTotals(this.queue.totals, r);
    this.note(reason); this.run = null; this.message = reason;
    this.queueStepEnded(reason, how);
  },
  delay() { return Math.min(10000, Math.max(500, Math.floor(Number(this.cfg().delay)) || 1000)); },
  stop(reason = 'Alchemy stopped. An attempt already sent may still finish.') {
    if (AlchemyBuy.run) AlchemyBuy.end('Buying stopped.');
    if (this.queue) {
      const q = this.queue; this.queue = null;
      if (this.run?.queued) this.addTotals(q.totals, this.run);
      if (q.row) this.rowStatus.set(q.row, 'Stopped');
      if (!this.run) { this.note(reason); this.message = reason; }
    }
    if (this.run) { this.note(reason); this.run = null; this.message = reason; }
    this.closeOwned();
  },
  closeOwned() {
    const owner = this.windowOwner;
    if (!owner || this.run || this.queue || AlchemyBuy.run) return;
    this.windowOwner = null;
    if (owner.character === World.charName && World.inWorld() && ['reinforce', 'magic', 'attribute'].includes(World.gp?.alchemy?.mode))
      Cmd.raw({ kind: 'alchemy-close' }, 'Close alchemy');
  },
  init() {
    if (this.started) return; this.started = true;
    // All manual native gameplay commands can interfere with the selected bag.
    // Our own Cmd.raw bypasses these observers, as with combat/manual pause.
    Hook.observers.push(command => { if (command.kind === 'gameplay' && (this.run || this.queue)) this.stop('Alchemy stopped by manual game control.'); });
    bus.on('game-error', text => { if ((this.run || this.queue) && /alchemy|inventory process/i.test(String(text))) this.stop('Alchemy stopped after a game refusal; wait for the inventory to settle.'); });
    bus.on('reset', () => { this.windowOwner = null; this.stop('Alchemy stopped after world reset.'); this.pending = null; this.selected = null; });
  },
  settleStale() {
    const p = this.pending, gp = World.gp;
    if (!p || this.run && this.run === p.run || now() - p.at < ALCHEMY_SETTLE_MS) return false;
    if (!gp || gp.inventoryPending || gp.alchemy?.pending) return false;
    const material = p.stone || p.elixir, used = !!material && Restock.count(material.ref) < material.before;
    this.pending = null;
    const text = used ? 'The last attempt was not confirmed, but its ' + (p.stone ? 'stone' : 'elixir') + ' was used: check the item before you start again.'
      : 'The last attempt was not carried out: nothing was used. You can start again.';
    this.note(text); this.message = text;
    return true;
  },
  observe() {
    const p = this.pending, gp = World.gp, a = gp?.alchemy;
    if (!p || !a || gp === p.state) return;
    if (a.pending) {
      if (a.mode !== (p.mode || (p.stone ? 'magic' : 'reinforce')) || a.slot !== p.run.slot) this.stop('Alchemy state changed unexpectedly. Wait for the outstanding result.');
      return;
    }
    if (a !== p.before && a.error !== null && a.error !== undefined) {
      // A failed stone fusion is answered like a refusal (0x23), but the stone is gone: it is a result, not a stop.
      if (p.stone && a.error === STONE_FAILED) return this.observeStone(p, gp, true);
      if (p.stone?.kind === 'blue' && BLUE_SKIP_REFUSALS.includes(a.error) && this.run === p.run) {
        this.pending = null; p.run.skipped.push(p.stone.blue); p.run.nextAt = now() + this.delay();
        this.note(`${BLUE_LABEL[p.stone.blue]} cannot go on this item (code ${a.error}); going on with the other blues.`); return;
      }
      this.pending = null; this.stop(p.stone ? this.stoneRefusal(a.error) : 'Alchemy refused by the game (code ' + a.error + ').'); return;
    }
    if (p.stone) return this.observeStone(p, gp);
    const outcome = a.flags & 0x70;
    if (a.mode !== 'reinforce' || a.slot !== p.run.slot || ![0x10, 0x20, 0x40].includes(outcome) || gp.inventoryPending) return;
    // The worker may publish the start and result between our ticks. Require
    // exactly one of each selected reagent consumed, not just a stale flag.
    if (Restock.count(p.elixir.ref) !== p.elixir.before - 1 || p.powder && Restock.count(p.powder.ref) !== p.powder.before - 1) return;
    const item = World.items().find(i => i.slot === p.run.slot);
    if (outcome !== 0x40 && (!this.gear(item) || this.identity(item) !== p.run.identity)) {
      this.stop('Weapon identity changed. Outstanding result requires manual review.'); return;
    }
    if (outcome === 0x40 && item) { this.stop('Unexpected destruction result. Outstanding result requires manual review.'); return; }
    if (outcome === 0x10 && item.plus !== p.plus + 1 || outcome === 0x20 && item.plus > p.plus) {
      this.stop('Unexpected enhancement level. Outstanding result requires manual review.'); return;
    }
    this.pending = null;
    p.run.elixirs++; if (p.powder) p.run.powders++;
    if (outcome === 0x10) p.run.successes++; else p.run.failures++;
    if (outcome === 0x40) p.run.destroyed++;
    this.note(outcome === 0x10 ? `Success: +${p.plus} → +${item.plus}` : outcome === 0x40 ? `Destroyed at +${p.plus}` : `Failed at +${p.plus}: now +${item.plus}`);
    if (outcome === 0x10 && this.cfg().sound === true && item.plus >= p.run.cfg.target) Sound.play('alchemy');
    if (item) p.run.highest = Math.max(p.run.highest, item.plus);
    if (outcome === 0x40) { this.selected = null; this.stop('Weapon destroyed; alchemy stopped.'); this.message = 'Weapon destroyed; alchemy stopped.'; return; }
    p.run.fingerprint = this.fingerprint(item); this.selected = { slot: item.slot, fingerprint: p.run.fingerprint };
    p.run.nextAt = now() + this.delay();
    if (this.run !== p.run) return;
    this.message = outcome === 0x10 ? 'Success: weapon is now +' + item.plus + '.' : 'Failed attempt: weapon is now +' + item.plus + '.';
    if (item.plus >= p.run.cfg.target) this.end('Target reached: +' + item.plus + '.');
    else if (p.run.attempts >= p.run.cfg.limit) this.end('Attempt limit reached.');
  },
  // A stone fusion is confirmed by exactly one stone leaving the bag with the inventory settled, not by a flag alone.
  stoneRefusal(code) {
    const why = { 0x10: 'the game does not accept this stone here', 0x12: 'the slots were not accepted', 6: 'an item or stone was missing',
      7: 'there was no stone', 9: 'this weapon cannot take that attribute', 0x21: 'the stone is not of the weapon\'s degree',
      0x22: 'the weapon is at 6 of that stone or has no free magic option slot', 0x24: 'an Astral stone needs more Immortal charges' }[code];
    return `Stone fusion refused by the game (code ${code}${why ? ': ' + why : ''}).`;
  },
  // An attribute fusion is confirmed the same way: one stone leaves the bag. The item's own percentages change, so only its shape is checked.
  observeAttribute(p, gp, failed = false) {
    if (gp.inventoryPending || Restock.count(p.stone.ref) !== p.stone.before - 1) return;
    const item = World.items().find(i => i.slot === p.run.slot);
    if (!this.gear(item) || this.shape(item) !== p.run.shape) { this.stop('Item changed. Outstanding result requires manual review.'); return; }
    const label = ATTRIBUTE_LABEL[p.stone.attr], before = p.stone.values, after = this.attrValues(item);
    this.pending = null; p.run.attrFused++; if (failed) p.run.stoneFailures++;
    const shown = n => this.attrPercent(n) + '%', others = Object.keys(after).filter(k => k !== p.stone.attr && after[k] !== before[k]).map(k => `${ATTRIBUTE_LABEL[k]} ${shown(before[k])} → ${shown(after[k])}`);
    this.note(failed ? `${label} stone failed and was used up` : `${label}: ${shown(before[p.stone.attr])} → ${shown(after[p.stone.attr])}` + (others.length ? ` (also changed: ${others.join(', ')})` : ''));
    p.run.fingerprint = this.fingerprint(item); p.run.identity = this.identity(item); this.selected = { slot: item.slot, fingerprint: p.run.fingerprint };
    p.run.nextAt = now() + this.delay();
    if (this.run !== p.run) return;
    this.message = failed ? `The ${label} fusion failed and the stone was used up.` : `${label} is now ${shown(after[p.stone.attr])}.`;
  },
  observeBlue(p, gp, failed = false) {
    if (gp.inventoryPending || Restock.count(p.stone.ref) !== p.stone.before - 1) return;
    const item = World.items().find(i => i.slot === p.run.slot);
    if (!this.gear(item) || this.shape(item) !== p.run.shape) { this.stop('Item changed. Outstanding result requires manual review.'); return; }
    const name = p.stone.blue, label = BLUE_LABEL[name], before = p.stone.value, after = this.attributeCount(item, name);
    this.pending = null; p.run.blueFused++; if (failed) p.run.stoneFailures++;
    const others = Object.keys(BLUE_LABEL).filter(n => n !== name && (p.stone.others[n] || 0) !== this.attributeCount(item, n))
      .map(n => `${BLUE_LABEL[n]} ${p.stone.others[n] || 0} → ${this.attributeCount(item, n)}`);
    this.note(failed ? `${label} stone failed and was used up` : `${label}: ${before} → ${after}` + (others.length ? ` (also changed: ${others.join(', ')})` : ''));
    p.run.fingerprint = this.fingerprint(item); p.run.identity = this.identity(item); this.selected = { slot: item.slot, fingerprint: p.run.fingerprint };
    p.run.nextAt = now() + this.delay();
    if (this.run !== p.run) return;
    this.message = failed ? `The ${label} fusion failed and the stone was used up.` : `${label} is now ${after}.`;
  },
  observeStone(p, gp, failed = false) {
    if (p.stone.kind === 'attr') return this.observeAttribute(p, gp, failed);
    if (p.stone.kind === 'blue') return this.observeBlue(p, gp, failed);
    if (gp.inventoryPending || Restock.count(p.stone.ref) !== p.stone.before - 1) return;
    const item = World.items().find(i => i.slot === p.run.slot), label = STONES[p.stone.kind].label;
    if (!this.gear(item) || this.shape(item) !== p.run.shape) { this.stop('Weapon identity changed. Outstanding result requires manual review.'); return; }
    const count = this.attributeCount(item, STONES[p.stone.kind].option);
    this.pending = null; p.run.stonesUsed[p.stone.kind]++; if (failed) p.run.stoneFailures++;
    this.note(failed ? `${label} stone failed and was used up` : `${label} stone fused: ${count} of ${STONE_MAX}`);
    p.run.fingerprint = this.fingerprint(item); p.run.identity = this.identity(item); this.selected = { slot: item.slot, fingerprint: p.run.fingerprint };
    p.run.nextAt = now() + this.delay();
    if (this.run !== p.run) return;
    this.message = failed ? `The ${label} fusion failed and the stone was used up (still ${count}).` : count > p.stone.count ? `${label} is now ${count} of ${STONE_MAX}.` : `A ${label} stone was used but the count did not rise (still ${count}).`;
  },
  tick() {
    this.observe();
    this.settleStale();
    if (AlchemyBuy.run && !this.run && !this.pending) { AlchemyBuy.tick(); return; }
    if (!this.run && this.queue && !this.pending) this.queueTick();
    const r = this.run, gp = World.gp;
    if (this.pending && now() - this.pending.at > 15000) this.stop('Result unconfirmed after 15 seconds. No further attempts; wait for settlement or reload.');
    if (!r || this.run !== r) return;
    const blocked = this.blocked();
    if (blocked || r.character !== World.charName || r.manualAt !== Manual.lastAt || r.config !== this.goalsKey(r.goalsOf())) return this.stop(blocked || 'Alchemy stopped: settings, character or manual control changed.');
    if (r.queued && (!this.queue || !this.cfg().queue.includes(this.queue.row))) return this.stop('Alchemy stopped: the queue changed.');
    if (this.pending) { this.message = 'Attempt ' + r.attempts + ': waiting for server result.'; return; }
    const item = World.items().find(i => i.slot === r.slot);
    if (!this.gear(item) || this.fingerprint(item) !== r.fingerprint) return this.stop('Weapon changed or moved. Select it again.');
    if (r.kind === 'plus' && !r.stonesOnly && (r.attempts >= r.cfg.limit || item.plus >= r.cfg.target)) return this.end('Target or attempt limit reached.');
    if (!gp.alchemy) return this.stop('Alchemy state unavailable.');
    if (gp.inventoryPending || gp.alchemy.pending || Loot.pressed()) { this.message = 'Alchemy waiting for inventory or potion use.'; return; }
    if (!gp.alchemy.visible) {
      if (r.opening !== null) { if (now() - r.opening > 5000) this.stop('Alchemy window did not open.'); return; }
      if (Cmd.spaced('alchemy-open') && Cmd.raw({ kind: 'alchemy-open' }, 'Open alchemy')) {
        r.opening = now(); this.windowOwner = { character: r.character };
      }
      return;
    }
    if (r.opening !== null) r.opening = null;
    if (now() < r.nextAt || !Cmd.spaced('alchemy-start')) return;
    if (r.kind === 'attr') {
      const next = this.nextAttr(item, r.cfg);
      if (!next) return this.end('Every wanted percentage is reached.');
      if (next.missing) return this.end(next.missing, 'missing');
      for (const name of next.skipped.filter(name => !(r.skipped ||= []).includes(name))) {
        r.skipped.push(name);
        this.note(`No ${ATTRIBUTE_LABEL[name]} stone of degree ${this.degree(item)} in the bag; going on with ${ATTRIBUTE_LABEL[next.attr.name]}.`);
      }
      const cap = Math.max(1, Math.floor(Number(r.cfg.attr?.limit) || 100));
      if (r.stoneAttempts >= cap) return this.end(`Stopped after ${cap} attribute stones (your limit).`);
      const slots = [item.slot, next.item.slot];
      if (slots.some(slot => !Number.isInteger(slot) || slot < 13 || slot > 255) || new Set(slots).size !== slots.length) return this.stop('Invalid material slots.');
      if (Cmd.raw({ kind: 'alchemy-start', mode: 'attribute', slots }, 'Alchemy: fuse a ' + ATTRIBUTE_LABEL[next.attr.name] + ' stone')) {
        this.windowOwner = { character: r.character };
        r.stoneAttempts++;
        this.pending = { run: r, state: gp, before: gp.alchemy, at: now(), plus: item.plus, mode: 'attribute',
          stone: { kind: 'attr', attr: next.attr.name, ref: next.item.refObjId, before: Restock.count(next.item.refObjId), values: this.attrValues(item) } };
        this.message = `Fusing a ${ATTRIBUTE_LABEL[next.attr.name]} stone: waiting for the server result.`;
      }
      return;
    }
    if (r.kind === 'blue') {
      const next = this.nextBlue(item, r.cfg, r.skipped);
      if (!next) return this.end('Every wanted blue is reached.');
      for (const name of next.full.filter(name => !r.skipped.includes(name))) { r.skipped.push(name); this.note(`No free magic slot for ${BLUE_LABEL[name]}; passing it over.`); }
      if (next.missing) return this.end(next.missing, next.noSlot ? 'done' : 'missing');
      const cap = Math.max(1, Math.floor(Number(r.cfg.blue?.limit) || 100));
      if (r.stoneAttempts >= cap) return this.end(`Stopped after ${cap} blue stones (your limit).`);
      const slots = [item.slot, next.item.slot];
      if (slots.some(slot => !Number.isInteger(slot) || slot < 13 || slot > 255) || new Set(slots).size !== slots.length) return this.stop('Invalid material slots.');
      if (Cmd.raw({ kind: 'alchemy-start', mode: 'magic', slots }, 'Alchemy: fuse a ' + BLUE_LABEL[next.name] + ' stone')) {
        this.windowOwner = { character: r.character };
        r.stoneAttempts++;
        this.pending = { run: r, state: gp, before: gp.alchemy, at: now(), plus: item.plus,
          stone: { kind: 'blue', blue: next.name, ref: next.item.refObjId, before: Restock.count(next.item.refObjId), value: this.attributeCount(item, next.name),
            others: Object.fromEntries(Object.keys(BLUE_LABEL).map(n => [n, this.attributeCount(item, n)])) } };
        this.message = `Fusing a ${BLUE_LABEL[next.name]} stone: waiting for the server result.`;
      }
      return;
    }
    const need = this.nextStone(item, r.cfg, r.stonesOnly ? Infinity : item.plus);
    if (need?.missing) return this.end(`No ${STONES[need.missing].label} stone of degree ${this.degree(item)} in the bag` + (need.forAstral ? '; each Astral charge needs an Immortal charge first.' : '.'), 'missing');
    if (need) {
      const cap = Math.max(0, Math.floor(Number(r.cfg.stoneLimit) || 0));
      if (cap && r.stoneAttempts >= cap) return this.end(`Stopped after ${cap} stone fusions (your limit).`);
      const slots = [item.slot, need.item.slot];
      if (slots.some(slot => !Number.isInteger(slot) || slot < 13 || slot > 255) || new Set(slots).size !== slots.length) return this.stop('Invalid material slots.');
      if (Cmd.raw({ kind: 'alchemy-start', mode: 'magic', slots }, 'Alchemy: fuse a ' + STONES[need.kind].label + ' stone')) {
        this.windowOwner = { character: r.character };
        r.stoneAttempts++;
        this.pending = { run: r, state: gp, before: gp.alchemy, at: now(), plus: item.plus,
          stone: { kind: need.kind, ref: need.item.refObjId, before: Restock.count(need.item.refObjId), count: need.count } };
        this.message = `Fusing a ${STONES[need.kind].label} stone${need.forAstral ? ' (the next Astral charge needs it)' : ''}: waiting for the server result.`;
      }
      return;
    }
    if (r.stonesOnly) return this.end('The weapon has the wanted stone counts.');
    const { elixir, powder, wantPowder } = this.materials(item, r.cfg);
    if (!elixir || wantPowder && !powder) return this.end('Selected elixirs or compatible lucky powder ran out.', 'missing');
    const slots = [item.slot, elixir.slot, ...(powder ? [powder.slot] : [])];
    if (slots.some(slot => !Number.isInteger(slot) || slot < 13 || slot > 255) || new Set(slots).size !== slots.length) return this.stop('Invalid material slots.');
    if (Cmd.raw({ kind: 'alchemy-start', mode: 'reinforce', slots }, 'Alchemy: enhance selected weapon')) {
      this.windowOwner = { character: r.character };
      r.attempts++;
      this.pending = { run: r, state: gp, before: gp.alchemy, at: now(), plus: item.plus,
        elixir: { ref: elixir.refObjId, before: Restock.count(elixir.refObjId) },
        powder: powder ? { ref: powder.refObjId, before: Restock.count(powder.refObjId) } : null };
      this.message = 'Attempt ' + r.attempts + ': waiting for server result.';
    }
  },
  protects(item) {
    if (!item) return false;
    if (this.selected && this.selected.slot === item.slot) return true;
    return this.rows().some(row => row.slot === item.slot && row.refObjId === item.refObjId);
  },
  active() { return !!(this.run || this.pending || this.queue || AlchemyBuy.run); },
  rows() { return this.cfg().queue; },
  rowItem(row) { const i = row && World.items().find(i => i.slot === row.slot); return i && i.refObjId === row.refObjId && this.gear(i) ? i : null; },
  rowName(row) { return this.rowItem(row)?.name || Items.name(row.refObjId); },
  addRow(slot) {
    const item = World.items().find(i => i.slot === Number(slot)), rows = this.rows();
    if (!this.gear(item)) return UI.toast('Pick an item from your bag first.', 'warn');
    if (rows.some(r => r.slot === item.slot && r.refObjId === item.refObjId)) return UI.toast('That item is already in the queue.', 'warn');
    if (rows.length >= 40) return UI.toast('The queue holds at most 40 items.', 'warn');
    const goals = alchemyGoals(this.cfg()); goals.elixir = 0;
    rows.push({ refObjId: item.refObjId, slot: item.slot, goals });
    this.rowStatus.set(rows.at(-1), 'Waiting'); this.editRow = rows.length - 1; Settings.saveProfile();
    if (!this.queue && !this.run) this.message = 'Item added. Set its goals below, then press Start queue.';
  },
  removeRow(index) {
    if (this.queue) return UI.toast('Stop the queue before removing items.', 'warn');
    if (!this.rows()[index]) return;
    this.rows().splice(index, 1); this.editRow = Math.max(0, Math.min(index, this.rows().length - 1)); Settings.saveProfile();
  },
  moveRow(index, by) {
    if (this.queue) return UI.toast('Stop the queue before reordering it.', 'warn');
    const rows = this.rows(), to = index + by;
    if (!rows[index] || !rows[to]) return;
    [rows[index], rows[to]] = [rows[to], rows[index]]; this.editRow = to; Settings.saveProfile();
  },
  stepWanted(step, item, goals) {
    if (step === 'plus') return Number.isInteger(goals.target) && goals.target >= 1 && item.plus < goals.target;
    if (step === 'white') return this.attributes(this.kind(item)).some(a => { const t = this.attrTarget(a.name, goals); return t && this.attrValue(item, a.index) < t; });
    const degree = this.degree(item);
    return this.blues(item).some(name => { const t = this.blueTarget(name, goals, degree); return t && this.attributeCount(item, name) < t; });
  },
  emptyTotals() {
    return { attempts: 0, successes: 0, failures: 0, destroyed: 0, highest: 0, elixirs: 0, powders: 0, stoneAttempts: 0, stoneFailures: 0, attrFused: 0, blueFused: 0,
      stonesUsed: { luck: 0, steady: 0, immortal: 0, astral: 0 } };
  },
  addTotals(total, r) {
    for (const k of Object.keys(total)) {
      if (k === 'stonesUsed') for (const s of Object.keys(total.stonesUsed)) total.stonesUsed[s] += r.stonesUsed?.[s] || 0;
      else if (k === 'highest') total.highest = Math.max(total.highest, r.highest || 0);
      else total[k] += r[k] || 0;
    }
  },
  stats() {
    const q = this.queue, r = this.result;
    if (!q || r !== q.totals || !this.run?.queued) return r;
    const total = JSON.parse(JSON.stringify(r)); this.addTotals(total, this.run); return total;
  },
  startQueue() {
    if (this.run || this.queue) return;
    this.settleStale();
    if (this.pending) { this.message = 'The last attempt is still waiting for its result. Try again in a few seconds.'; return UI.toast(this.message, 'warn'); }
    const reject = text => { this.message = text; UI.toast(text, 'warn'); }, rows = this.rows();
    const blocked = this.blocked(); if (blocked) return reject(blocked);
    if (!rows.length) return reject('Add an item from your bag to the queue first.');
    this.queue = { row: rows[0], step: 'plus', character: World.charName, manualAt: Manual.lastAt, done: 0, skipped: 0, totals: this.emptyTotals(), nextAt: 0, waitSince: 0,
      spent: 0n, lastBought: false };
    for (const row of rows) this.rowStatus.set(row, 'Waiting');
    this.result = this.queue.totals; this.message = 'Queue started.';
    this.note(`Queue started: ${rows.length} item${rows.length > 1 ? 's' : ''}.`);
    this.buyFor(rows);
  },
  buyFor(rows) {
    const q = this.queue;
    if (!this.cfg().buy?.on || !q) return false;
    const left = toBigInt(this.cfg().buy.spend) - q.spent;
    const error = AlchemyBuy.start(rows, done => {
      if (this.queue !== q) return;
      q.spent += done.spent; q.lastBought = done.bought > 0; q.nextAt = now() + this.delay();
    }, left > 0n ? left : 0n);
    if (error && error !== 'Nothing to buy.') this.note('Not buying: ' + error);
    return !error;
  },
  queueTick() {
    const q = this.queue, blocked = this.blocked();
    if (blocked && /^(Wait for combat and movement|Close shop)/.test(blocked) && !Hunt.underAttack()) {
      q.blockedSince ||= now(); this.message = blocked;
      if (now() - q.blockedSince < 10000) return;
    }
    q.blockedSince = 0;
    if (blocked || q.character !== World.charName || q.manualAt !== Manual.lastAt) return this.stop(blocked || 'Alchemy stopped: character or manual control changed.');
    if (!this.rows().includes(q.row)) return this.stop('Alchemy stopped: the queue changed.');
    if (now() < q.nextAt) return;
    const item = this.rowItem(q.row);
    if (!item) return this.queueMissing(`not in bag slot ${q.row.slot} any more`, false);
    for (let i = QUEUE_STEPS.indexOf(q.step); i < QUEUE_STEPS.length; i++) {
      const step = QUEUE_STEPS[i]; q.step = step;
      if (!this.stepWanted(step, item, q.row.goals)) continue;
      const row = q.row, result = this.begin(step === 'white' ? 'attr' : step, item, row.goals, { goalsOf: () => row.goals, queued: true });
      if (!result) { q.waitSince = 0; this.rowStatus.set(row, 'Running: ' + STEP_LABEL[step]); return; }
      if (result.wait) {
        q.waitSince ||= now(); this.message = result.error;
        if (now() - q.waitSince > 15000) { q.waitSince = 0; return this.queueMissing(result.error.replace(/ Try again in a moment\.$/, '')); }
        return;
      }
      if (result.missing) return this.queueMissing(result.error);
    }
    this.rowDone();
  },
  queueStepEnded(reason, how) {
    const q = this.queue;
    if (how === 'missing') return this.queueMissing(reason);
    const next = QUEUE_STEPS.indexOf(q.step) + 1;
    this.rowStatus.set(q.row, STEP_LABEL[q.step] + ' done'); q.nextAt = now() + this.delay();
    if (next < QUEUE_STEPS.length) q.step = QUEUE_STEPS[next]; else this.rowDone();
  },
  queueMissing(reason, buyable = true) {
    const q = this.queue, name = this.rowName(q.row), text = reason.charAt(0).toUpperCase() + reason.slice(1);
    if (buyable && (q.boughtFor !== q.row || q.lastBought)) {
      q.lastBought = false;
      q.boughtFor = q.row;
      const rows = this.rows();
      if (this.buyFor(rows.slice(rows.indexOf(q.row)))) { this.rowStatus.set(q.row, 'Buying materials'); this.note(`${name}: ${text} Buying more.`); return; }
    }
    if (this.cfg().onMissing === 'stop') return this.stop(`${name}: ${text}`);
    this.rowStatus.set(q.row, 'Skipped: ' + text); q.skipped++;
    this.note(`${name} skipped: ${text}`); this.nextRow();
  },
  rowDone() {
    const q = this.queue;
    this.rowStatus.set(q.row, 'Done'); q.done++;
    this.note(`${this.rowName(q.row)} is done.`); this.nextRow();
  },
  nextRow() {
    const q = this.queue, rows = this.rows(), next = rows[rows.indexOf(q.row) + 1];
    if (next) { q.row = next; q.step = 'plus'; q.nextAt = now() + this.delay(); return; }
    q.row = null;
    const text = `Queue finished: ${q.done} done` + (q.skipped ? `, ${q.skipped} skipped.` : '.');
    if (this.cfg().queueSound) Sound.play('alchemy');
    this.stop(text);
  },
  editing() { const row = this.rows()[this.editRow]; return row ? { row, goals: row.goals, item: this.rowItem(row) } : { row: null, goals: this.cfg(), item: null }; },
  draw() {
    const c = () => this.cfg(), g = () => this.editing().goals;
    const queued = i => this.rows().some(r => r.slot === i.slot && r.refObjId === i.refObjId);
    const bag = () => [[-1, 'Add from bag…'], ...World.items().filter(i => this.gear(i) && !queued(i)).map(i => [i.slot, `${i.name || Items.name(i.refObjId)} +${i.plus} · ${this.kind(i)}${this.degree(i) ? ' · degree ' + this.degree(i) : ''} · slot ${i.slot}`])];
    let pick = -1;
    const queue = UI.group('Alchemy queue');
    UI.queueTable = el('div', '', 'alchemy-queue');
    queue.append(UI.row(UI.select('Item', bag, () => pick, v => { pick = Number(v); }), UI.button('Add', () => { this.addRow(pick); pick = -1; UI.draw(); })),
      UI.queueTable,
      UI.row(UI.button('Up', () => { this.moveRow(this.editRow, -1); UI.draw(); }), UI.button('Down', () => { this.moveRow(this.editRow, 1); UI.draw(); }),
        UI.button('Remove', () => { this.removeRow(this.editRow); UI.draw(); })),
      UI.row(UI.button('Start queue', () => this.startQueue()), UI.button('Stop', () => this.stop())),
      UI.check('Out of materials: go to the next item', () => c().onMissing !== 'stop', v => c().onMissing = v ? 'next' : 'stop'),
      UI.number('Delay between attempts (ms)', () => c().delay, n => c().delay = n, 500, 10000, 100),
      UI.check('Play a sound when the queue is done', () => c().queueSound, v => c().queueSound = v),
      el('p', 'Each item gets Plus, then White, then Blue, then the next item starts. Blues come last because a white stone that works can roll a blue again. A step with no goal is passed over. Stop hunting and travel first; Stop prevents the next attempt, a sent one may still finish.', 'muted'));
    UI.alchemyNote = el('p', '', 'muted'); queue.append(UI.alchemyNote);
    UI.pane.append(queue);
    const b = () => c().buy, buy = UI.group('Buy at the Jangan alchemy merchant');
    UI.alchemyBuyList = el('p', '', 'muted');
    buy.append(UI.check('Buy what the queue needs (spends gold)', () => b().on, v => b().on = v),
      UI.number('Elixirs to have', () => b().stock.elixir, n => b().stock.elixir = n, 0, 1000),
      UI.number('Lucky powder to have', () => b().stock.powder, n => b().stock.powder = n, 0, 1000),
      UI.number('Each Luck / Steady / Immortal / Astral stone to have', () => b().stock.protect, n => b().stock.protect = n, 0, 1000),
      UI.number('Each white stone to have', () => b().stock.white, n => b().stock.white = n, 0, 1000),
      UI.number('Each blue stone to have', () => b().stock.blue, n => b().stock.blue = n, 0, 1000),
      UI.gold('Spend at most this much gold per queue run', () => b().spend, n => b().spend = n),
      UI.gold('Always keep this much gold', () => b().keep, n => b().keep = n),
      UI.alchemyBuyList,
      el('p', 'Off by default. With it on, the queue first visits "OpenSRO Alchemy" in Jangan and tops up what the queued items need, at the degree of each item, to the amounts above. When an item runs out on the way, it goes back as long as the last visit bought something. One queue run never spends more than the limit or goes below the gold to keep, and buying stops when a purchase is not confirmed. Start the queue in Jangan. Only what the merchant sells is bought.', 'muted'));
    UI.pane.append(buy);
    const goals = UI.group('Goals'), tabs = el('div', null, 'subtabs');
    UI.goalsTitle = el('p', '', 'muted');
    for (const [key, name] of [['plus', 'Plus'], ['white', 'Attribute'], ['blue', 'Blue']]) {
      const tab = UI.button(name, () => { this.goalsTab = key; UI.draw(); });
      tab.setAttribute('aria-selected', String(this.goalsTab === key)); tabs.append(tab);
    }
    goals.append(UI.goalsTitle, tabs);
    if (this.goalsTab === 'plus') {
      const elixirs = () => {
        const kind = this.kind(this.editing().item) || 'weapon';
        return [[0, 'Any compatible ' + kind + ' elixir'], ...[...new Map(World.items().filter(i => this.elixir(i, kind)).map(i => [i.refObjId, i.name || Items.name(i.refObjId)])).entries()]];
      };
      goals.append(UI.number('Target + (0 = leave the plus)', () => g().target, n => g().target = n, 0, 250),
        UI.number('Maximum attempts', () => g().limit, n => g().limit = n, 1, ALCHEMY_MAX_ATTEMPTS),
        UI.select('Elixir', elixirs, () => this.elixirChoice(this.kind(this.editing().item) || 'weapon', g()), value => g().elixir = Number(value)),
        UI.check('Use lucky powder of matching degree', () => g().powder, value => g().powder = value),
        UI.number('Lucky powder from +', () => g().from.powder, n => g().from.powder = n, 0, 250));
      for (const [kind, st] of Object.entries(STONES)) goals.append(UI.check('Use ' + st.label + ' stones while enhancing', () => g().use[kind], v => g().use[kind] = v),
        UI.number(st.label + ': keep this many charges on the item', () => g().stones[kind], n => g().stones[kind] = n, 1, STONE_MAX),
        UI.number(st.label + ': from +', () => g().from[kind], n => g().from[kind] = n, 0, 250));
      goals.append(UI.number('Stop after this many stone fusions (0 = no limit)', () => g().stoneLimit, n => g().stoneLimit = n, 0, 1000),
        el('p', 'Each attempt spends one elixir of the item\'s kind and, from the plus you set, one lucky powder of its degree. A failure resets the + to 0 (to +4 with an Astral charge); from +5 it can also destroy the item unless it has an Immortal charge, or damage it unless it has a Steady charge. Before an attempt at or above a stone\'s plus, a charge is fused when the item has fewer than you asked to keep. Luck adds 5% to the chance; each Astral charge needs an Immortal charge first. A stone fusion can fail and use up the stone.', 'muted'));
      UI.alchemyPlus = el('p', '', 'muted'); goals.append(UI.alchemyPlus);
    } else if (this.goalsTab === 'white') {
      UI.attrRows = el('div'); UI.attrNote = el('p', '', 'muted');
      goals.append(UI.attrRows, UI.attrNote, UI.number('Stop after this many attribute stones', () => g().attr.limit, n => g().attr.limit = n, 1, 1000),
        el('p', 'The lowest percentage you want for each stat. Stones of the item\'s degree are fused until every picked stat reaches it; a stat with no stones is passed over. A stone that works rolls the stat again (it can come out lower) and can roll another stat or a blue too. The chance is 50% per stone before bonuses; 80% and 100% can take hundreds of stones, so keep a limit.', 'muted'));
    } else {
      UI.blueSlots = el('p', '', 'muted'); UI.blueRows = el('div');
      goals.append(UI.blueSlots, UI.blueRows, UI.number('Stop after this many blue stones', () => g().blue.limit, n => g().blue.limit = n, 1, 1000),
        el('p', 'The lowest value you want for each blue. A blue already on the item is rolled again on success (it can come out lower), so "or more" goals can take many stones. A new blue needs a free magic slot, and Luck, Steady, Immortal and Astral charges use the same slots; a blue that does not fit is passed over.', 'muted'));
    }
    UI.pane.append(goals);
    const stock = UI.group('In bag'); UI.alchemyBag = el('p', '', 'muted'); stock.append(UI.alchemyBag); UI.pane.append(stock);
    const results = UI.group('Results');
    UI.alchemyStats = el('p', '', 'muted'); UI.alchemyLog = el('p', '', 'muted');
    results.append(UI.alchemyStats, UI.alchemyLog, UI.button('Clear results', () => { if (!this.queue) this.result = null; this.log.length = 0; this.refresh(); }));
    UI.pane.append(results);
    const sound = UI.group('Sound');
    sound.append(UI.check('Play a sound when the target + is reached', () => c().sound, value => c().sound = value),
      UI.row(UI.button('Test alchemy sound', () => Sound.test('alchemy'))),
      UI.soundPicker('alchemy', 'alchemy', 'Pick an audio file (at most 1 MB) to play instead of the built-in chime when the target + is reached. Choosing one also ticks the switch above. It is checked by playing it, kept only in this browser and never sent anywhere. It is not part of your settings, share codes or backups.', () => { c().sound = true; Settings.saveProfile(); }),
      el('p', 'Off by default. The sound plays once, when a confirmed success reaches the target + you set; earlier successes and failures stay silent. A sound of your own (at most 1 MB) replaces the chime. A click in the game unlocks the sound when the browser blocked it.', 'muted'));
    UI.pane.append(sound);
    this.drawQueue(); this.drawAttributes(); this.drawBlues();
    this.refresh();
  },
  drawQueue() {
    if (!UI.queueTable) return;
    UI.queueTable.replaceChildren();
    const rows = this.rows(), q = this.queue;
    if (!rows.length) { UI.queueTable.append(el('p', 'The queue is empty. Pick an item above and press Add.', 'muted')); return; }
    rows.forEach((row, index) => {
      const item = this.rowItem(row), line = el('button', '', 'queue-row');
      line.type = 'button'; line.setAttribute('aria-pressed', String(index === this.editRow));
      const icon = el('span', '', 'skill-icon'); Icons.paint(icon, item?.icon || Items.iconDdj(row.refObjId));
      const steps = el('span', '', 'queue-steps');
      for (const step of QUEUE_STEPS) {
        const want = item && this.stepWanted(step, item, row.goals), running = q?.row === row && q.step === step && this.run?.queued;
        steps.append(el('i', STEP_LABEL[step], running ? 'now' : item && !want ? 'ok' : ''));
      }
      const plus = item ? `+${item.plus}` + (row.goals.target ? ` → +${row.goals.target}` : '') : '';
      line.append(el('span', String(index + 1), 'queue-n'), icon, el('span', `${this.rowName(row)} ${plus}`, 'queue-name'), steps,
        el('span', item ? this.rowStatus.get(row) || 'Waiting' : 'Not in its bag slot', 'queue-status'));
      line.addEventListener('click', () => { this.editRow = index; UI.draw(); });
      UI.queueTable.append(line);
    });
  },
  drawAttributes() {
    const { item, goals: c } = this.editing();
    if (!UI.attrRows || this.goalsTab !== 'white') return;
    UI.attrRows.replaceChildren();
    if (!this.gear(item)) { UI.attrRows.append(el('p', 'Add an item to the queue and select it to choose its percentages.', 'muted')); return; }
    for (const a of this.attributes(this.kind(item))) {
      const options = [[0, 'Leave alone'], ...ATTRIBUTE_STEPS.map(([value, percent]) => [value, `${percent}% or better`])];
      UI.attrRows.append(UI.select(`${ATTRIBUTE_LABEL[a.name]} (now ${this.attrPercent(this.attrValue(item, a.index))}%)`, options, () => this.attrTarget(a.name, c), v => { c.attr.targets[a.name] = Number(v); this.refresh(); }));
    }
  },
  drawBlues() {
    const { item, goals: c } = this.editing();
    if (!UI.blueRows || this.goalsTab !== 'blue') return;
    UI.blueRows.replaceChildren();
    if (!this.gear(item)) { UI.blueRows.append(el('p', 'Add an item to the queue and select it to choose its blues.', 'muted')); return; }
    const degree = this.degree(item);
    for (const name of this.blues(item)) {
      const values = this.blueValues(name, degree), stone = ALCHEMY_DATA.magicStones?.[name] + degree - 1;
      const inBag = World.items().filter(i => i.refObjId === stone && i.quantity > 0 && i.slot >= 13).reduce((n, i) => n + i.quantity, 0);
      const options = [[0, 'Leave alone'], ...values.map((v, k) => [v, k === 0 ? 'Add it (any value)' : k === values.length - 1 ? `Max (${v})` : `${v} or more`])];
      UI.blueRows.append(UI.select(`${BLUE_LABEL[name]} (now ${this.attributeCount(item, name) || '–'}, ${inBag} in bag)`, options, () => this.blueTarget(name, c, degree), v => { c.blue.targets[name] = Number(v); this.refresh(); }));
    }
  },
  refresh() {
    if (!UI.is('Alchemy') || !UI.alchemyNote) return;
    const { row, item, goals: c } = this.editing(), r = this.stats(), q = this.queue;
    const fmt = n => !Number.isFinite(n) ? 'a huge number of' : n < 100 ? n.toFixed(n < 10 ? 1 : 0) : n < 1e6 ? Math.round(n).toLocaleString('en-US') : n.toExponential(1);
    if (UI.alchemyBuyList?.isConnected) {
      const list = AlchemyBuy.shortfall(this.rows());
      UI.alchemyBuyList.textContent = AlchemyBuy.run ? AlchemyBuy.message : list.length ? 'Would buy now: ' + list.map(n => `${n.missing} ${n.label}`).join(', ') + '.' : 'Nothing to buy for the queue right now.';
    }
    UI.alchemyNote.textContent = (AlchemyBuy.run ? AlchemyBuy.message : this.message) + (q?.row ? `\nQueue: item ${this.rows().indexOf(q.row) + 1} of ${this.rows().length} · ${STEP_LABEL[q.step]} · ${q.done} done` + (q.skipped ? ` · ${q.skipped} skipped` : '') : '');
    const queueKey = JSON.stringify([this.editRow, q?.step, this.rows().indexOf(q?.row), !!this.run, ...this.rows().map(x => { const i = this.rowItem(x); return [x.slot, x.refObjId, i?.plus, i?.variance, i?.magic, x.goals.target, this.rowStatus.get(x)]; })]);
    if (UI.queueTable && UI.queueTable.dataset.key !== queueKey) { UI.queueTable.dataset.key = queueKey; this.drawQueue(); }
    if (UI.goalsTitle) UI.goalsTitle.textContent = row ? `Goals for ${this.rowName(row)}` + (item ? ` · ${this.kind(item)}${this.degree(item) ? ' · degree ' + this.degree(item) : ''}` : ' · not in its bag slot') : 'The queue is empty: these are the goals new items start with.';
    if (UI.alchemyPlus?.isConnected) {
      const stones = item ? 'Stones on the item: ' + Object.values(STONES).map(st => `${st.label} ${this.attributesKnown(item) ? this.attributeCount(item, st.option) : '?'}/${STONE_MAX}`).join(' · ') : '';
      const odds = item ? this.odds(item, c) : null;
      UI.alchemyPlus.textContent = stones + (odds ? `\nNext attempt at +${item.plus}: ${odds.now}% to succeed.` + (odds.plan ? ` To reach +${odds.target} expect about ${fmt(odds.plan.attempts)} elixirs; the chance of getting there without a single failure is ${(odds.plan.clean * 100).toFixed(odds.plan.clean < .1 ? 2 : 0)}%.` : '') : '');
    }
    const statKey = item ? JSON.stringify([this.editRow, item.slot, item.refObjId, item.variance, item.magic]) : String(this.editRow);
    if (UI.attrRows?.isConnected && UI.attrRows.dataset.key !== statKey) { UI.attrRows.dataset.key = statKey; this.drawAttributes(); }
    if (UI.blueRows?.isConnected && UI.blueRows.dataset.key !== statKey) { UI.blueRows.dataset.key = statKey; this.drawBlues(); }
    if (UI.attrNote?.isConnected) {
      const wanted = item ? this.attributes(this.kind(item)).filter(a => this.attrTarget(a.name, c)) : [];
      UI.attrNote.textContent = wanted.length ? 'Aiming for: ' + wanted.map(a => `${ATTRIBUTE_LABEL[a.name]} ${this.attrPercent(this.attrTarget(a.name, c))}%+ (about ${Math.round(this.attrExpected(this.attrTarget(a.name, c)))} stones)`).join(' · ') : '';
    }
    if (UI.blueSlots?.isConnected) {
      const slots = item ? this.magicSlots(item) : null, protect = item ? Object.values(STONES).filter(st => this.attributeCount(item, st.option) > 0).length : 0;
      UI.blueSlots.textContent = !item ? '' : slots.limit === null ? `Magic slots used: ${slots.used}.` : `Magic slots: ${slots.used} of ${slots.limit} used (${protect} by Luck/Steady/Immortal/Astral), ${Math.max(0, slots.limit - slots.used)} free.`;
    }
    if (UI.alchemyBag) {
      const degree = this.degree(item), kind = this.kind(item) || 'weapon', count = test => World.items().filter(i => i.quantity > 0 && i.slot >= 13 && test(i)).reduce((n, i) => n + i.quantity, 0);
      const parts = [`${kind} elixirs ${count(i => this.elixir(i, kind))}`];
      if (degree) {
        parts.push(`lucky powder ${count(i => this.powderDegree(i) === degree)}`,
          ...Object.values(STONES).map(st => `${st.label} ${count(i => i.refObjId === st.base + degree - 1)}`),
          `white stones ${count(i => (i.typeFlags & 0xfffe) === 0x15ec && Object.values(ALCHEMY_DATA.attrStones).includes(i.refObjId - degree + 1))}`,
          `blue stones ${count(i => (i.typeFlags & 0xfffe) === 0x0dec && Object.values(ALCHEMY_DATA.magicStones || {}).includes(i.refObjId - degree + 1))}`);
      }
      UI.alchemyBag.textContent = (degree ? `For degree ${degree}: ` : '') + parts.join(' · ');
    }
    if (UI.alchemyStats) {
      UI.alchemyStats.textContent = r
        ? `Attempts ${r.attempts} · Success ${r.successes} · Failed ${r.failures} · Destroyed ${r.destroyed || 0} · Highest + ${r.highest ?? 0}` + (r.attempts ? ` · Success rate ${Math.round(r.successes / r.attempts * 100)}%` : '') +
          `\nUsed: elixirs ${r.elixirs} · powder ${r.powders} · white stones ${r.attrFused || 0} · blue stones ${r.blueFused || 0} · stones ${Object.entries(STONES).map(([k, st]) => `${st.label} ${r.stonesUsed?.[k] || 0}`).join(' / ')}`
        : 'No results yet.';
      UI.alchemyLog.textContent = this.log.slice(-12).map(l => new Date(l.at).toLocaleTimeString('en-GB') + '  ' + l.text).join('\n');
    }
  },
};
