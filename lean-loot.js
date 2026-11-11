// One pickup intent at a time. Progress, inventory changes and failures own its lifetime.
const PET_GAP_MS = 800;
const PLAYER_INV_HOLD_MS = 2500;
const PLAYER_MALL_HOLD_MS = 60000;
const PET_LOCK_LINK_MS = 1500;
const PET_LOCK_WINDOW_MS = 60000;
const PET_GIVE_UP_ATTEMPTS = 6;
const PET_LOCK_BUDGET_MS = 15000;
const PLAYER_INV_KINDS = new Set(['item-use', 'item-drop', 'inventory-move', 'avatar-move', 'equip', 'pickup', 'cos-pickup', 'cos-transfer', 'cos-drop', 'immortal', 'attr']);
const PLAYER_INV_PREFIXES = /^(?:mall|shop|cos-shop|storage|stall|exchange|alchemy|gear)-/;
const Loot = {
  active: null,
  skips: new Map(),
  failureCounts: new Map(),
  petSetup: null,
  fullAlert: null,
  playerInvAt: -Infinity,
  playerMallAt: -Infinity,
  petSentAt: -Infinity,
  petEndAt: -Infinity,
  lock: null,
  petLocks: [],
  spent: new Map(),
  lastFullChimeAt: -Infinity,
  checkPetFull() {
    const P = Hunt.cfg().pickup;
    // The visible warning is independent of the chime: silencing the sound must not hide the full pet bag.
    if (!Hunt.running || !World.inWorld() || World.isDead() || !P.enabled || !this.petMode()) return;
    const pet = this.pet();
    if (!pet || pet.rec.inventory.length < pet.rec.status) { this.fullAlert = null; return; }
    let alert = this.fullAlert;
    if (!alert || alert.gid !== pet.rec.gid) {
      alert = this.fullAlert = { gid: pet.rec.gid, sounded: false };
      UI.toast('Pickup pet bag is full. ' + (Town.cfg().enabled ? 'Town service will take priority over hunting.' : 'Scroll town cycle is off; enable it in Supplies for automatic return.'), 'warn', 6000);
    }
    if (P.petFullSound && !alert.sounded && now() - this.lastFullChimeAt >= 30000) {
      this.lastFullChimeAt = now();
      alert.sounded = Sound.play('pet-full');
    }
  },
  pet() {
    for (const rec of World.gp?.cosRecords || []) {
      const ent = World.ents.get(rec.gid);
      if (rec.band === 4 && !rec.dead && rec.hp > 0 && rec.status > 0 && Array.isArray(rec.inventory) &&
          ent?.kind === 'cos' && ent.ownerGid === World.localGid() && ent.refObjId === rec.refObjId) return { rec, ent };
    }
    return null;
  },
  // Who collects a kind of drop: its own choice (pickup.by), else the default collector. A pet is in use when it is the
  // default or when any wanted kind is given to it; the character can collect other kinds meanwhile.
  collectorFor(category) { const P = Hunt.cfg().pickup, by = P.by?.[category]; return by === 'pet' || by === 'character' ? by : P.collector === 'pet' ? 'pet' : 'character'; },
  collector(e) { return this.collectorFor(this.category(e.groundItem?.typeFlags ?? e.tidWord ?? 0)); },
  petMode() { const P = Hunt.cfg().pickup; return P.collector === 'pet' || this.categories.some(k => P[k] && P.by?.[k] === 'pet'); },
  preparePet() {
    if (!this.petMode() || !Hunt.cfg().pickup.enabled || World.isDead()) return false;
    const pet = this.pet();
    if (!pet || !Number.isInteger(pet.rec.commandMode)) return false;
    if (!(pet.rec.commandMode & 128)) { this.petSetup = null; return true; }
    // Native auto-grab has only gold/equipment/other categories. Disable it and
    // wait for the live server-confirmed mode before submitting selective requests.
    let setup = this.petSetup;
    if (!setup || setup.gid !== pet.rec.gid) setup = this.petSetup = { gid: pet.rec.gid, attempts: 0, at: -Infinity };
    if (setup.attempts < 3 && now() - setup.at >= 5000 && !World.gp.inventoryPending && Cmd.spaced('cos-behavior') &&
        Cmd.raw({ kind: 'cos-behavior', gid: pet.rec.gid, mode: (pet.rec.commandMode & ~128) >>> 0 }, 'Disable broad pet auto-grab')) {
      setup.attempts++; setup.at = now();
    }
    return false;
  },
  petStatus() {
    const pet = this.pet();
    if (!pet) return 'Summon a pickup pet to collect into its bag.';
    if (!Number.isInteger(pet.rec.commandMode)) return 'Waiting for pet settings.';
    if (pet.rec.commandMode & 128) return this.petSetup?.attempts >= 3 && now() - this.petSetup.at >= 5000
      ? 'Auto-grab was not disabled. Turn it off in the game pet settings, then retry.' : 'Waiting for broad auto-grab to turn off.';
    const share = this.lockNote();
    if (Hunt.running && World.gp.inventoryPending) return 'Pet waiting for pickup / inventory transaction to finish.' + share;
    if (Hunt.running && this.pressed()) return 'Pet waiting briefly for potion use.' + share;
    const yielding = this.playerFirst();
    if (yielding) return 'Pet waiting: ' + yielding + share;
    if (this.active?.petGid === pet.rec.gid) return 'Pet collecting: ' + (this.active.name || this.active.gid) + (this.active.retryAt ? ' (retry pending).' : '.') + share;
    return `Pet ready: ${Math.max(0, pet.rec.status - pet.rec.inventory.length)} empty slots. Collects while hunting and while the bot is stopped.` + share;
  },
  petWhileManual() { const P = Hunt.cfg().pickup; return P.petWhileManual !== false && P.enabled && this.petMode(); },
  notePlayer(kind) {
    if (typeof kind !== 'string' || !(PLAYER_INV_KINDS.has(kind) || PLAYER_INV_PREFIXES.test(kind))) return;
    this.playerInvAt = now();
    if (kind.startsWith('mall-')) this.playerMallAt = now();
  },
  playerFirst() {
    const gp = World.gp, t = now();
    if (t - this.playerMallAt < PLAYER_MALL_HOLD_MS) return 'you are using the Item Mall.';
    if (gp?.exchange?.open || gp?.exchange?.requesting) return 'a trade window is open.';
    if (gp?.stall?.phase && gp.stall.phase !== 'none') return 'a stall window is open.';
    if (gp?.alchemy?.visible) return 'the alchemy window is open.';
    if (t - this.playerInvAt < PLAYER_INV_HOLD_MS) return 'you are using the inventory.';
    return '';
  },
  petBlocked() { return this.pressed() || !!this.lock?.pet || now() - this.petEndAt < PET_GAP_MS || !!this.playerFirst(); },
  watchLock() {
    const pending = !!World.gp?.inventoryPending, t = now(), w = this.lock;
    if (pending && !w) {
      const a = this.active;
      this.lock = { at: t, pet: !!a?.petGid && t - this.petSentAt < PET_LOCK_LINK_MS, gid: a?.gid ?? 0 };
    } else if (!pending && w) {
      this.lock = null;
      if (!w.pet) return;
      const ms = t - w.at;
      this.petEndAt = t;
      this.petLocks.push({ at: w.at, end: t });
      while (this.petLocks.length && (this.petLocks[0].end < t - PET_LOCK_WINDOW_MS || this.petLocks.length > 300)) this.petLocks.shift();
      const spent = this.spent.get(w.gid);
      if (spent) spent.lockMs += ms;
      Activity.emit({ category: 'loot', code: 'pet-lock-held', level: 'cmd', outcome: 'summary',
        text: 'Pet pickup held the inventory for ' + Math.round(ms) + ' ms.', details: { durationMs: Math.round(ms) } });
    }
  },
  lockShare() {
    const t = now(), from = t - PET_LOCK_WINDOW_MS;
    let held = this.lock?.pet ? t - Math.max(from, this.lock.at) : 0;
    for (const l of this.petLocks) if (l.end > from) held += l.end - Math.max(from, l.at);
    return clamp(held / PET_LOCK_WINDOW_MS, 0, 1);
  },
  lockNote() {
    const share = this.lockShare();
    return share > 0 ? ` Inventory held by pet pickups: ${Math.round(share * 100)}% of the last minute.` : '';
  },
  items(petGid = 0) { return petGid ? World.gp?.cosRecords?.find(r => r.gid === petGid)?.inventory || [] : World.items(); },
  pickup(gid, petGid = 0) {
    if (!petGid) return Cmd.pickup(gid);
    this.watchLock();
    if (this.petBlocked() || !Cmd.spaced('cos-pickup') || !Cmd.raw({ kind: 'cos-pickup', gid: petGid, target: gid }, 'Pet pickup')) return false;
    this.petSentAt = now();
    if (!this.spent.has(gid)) this.spent.set(gid, { attempts: 0, lockMs: 0 });
    return true;
  },
  pressed() {
    // Controller runs potions first. Reserve only a short window after an
    // actual send, including the gap before inventoryPending reaches our mirror.
    // A threshold margin can otherwise block the pet indefinitely.
    return Potion.lastUse > 0 && now() - Potion.lastUse < 350;
  },
  categories: ['gold', 'potions', 'equipment', 'elixirs', 'powders', 'magicStones', 'attrStones', 'alchemy', 'others'],
  category(tf) {
    if (ItemType.isGold(tf)) return 'gold';
    if (ItemType.isPotion(tf) || ItemType.isCure(tf)) return 'potions';
    if (ItemType.isEquipment(tf)) return 'equipment';
    // Native alchemy item words: (TID1,TID2,TID3,TID4), also used by reinforce.go.
    const consumable = (tf & 126) === 108, t3 = (tf >>> 7) & 15, t4 = (tf >>> 11) & 31;
    if (consumable && t3 === 10 && t4 === 1) return 'elixirs';
    if (consumable && t3 === 10 && t4 === 2) return 'powders';
    // Magic stones also cover the Astral, Luck, Steady and Immortal stones; tablets stay under other alchemy items.
    if (consumable && t3 === 11 && (t4 === 1 || t4 === 7)) return 'magicStones';
    if (consumable && t3 === 11 && t4 === 2) return 'attrStones';
    if (consumable && (t3 === 10 || t3 === 11)) return 'alchemy';
    return 'others';
  },
  preset(mode) {
    const p = Hunt.cfg().pickup;
    for (const key of this.categories) p[key] = mode === 'all' || key === 'elixirs' || (mode === 'elixirs-gold' && key === 'gold');
    p.enabled = true; p.include = '';
    Settings.saveProfile();
  },
  count(ref, petGid = 0) { return this.items(petGid).filter(i => i.refObjId === ref).reduce((n, i) => n + (i.quantity ?? 1), 0); },
  bagSignature(e) { const pet = (e ? this.collector(e) === 'pet' : this.petMode()) && this.pet(); return `${pet ? pet.rec.gid : 0}:` + this.items(pet ? pet.rec.gid : 0).map(i => `${i.slot}:${i.refObjId}:${i.quantity ?? 1}`).join('|'); },
  owned(e) {
    const gi = e.groundItem;
    if (!gi) return false;
    const local = World.localGid();
    if (gi.claimantGid !== undefined && gi.claimantGid !== local) return false;
    const party = World.gp?.social?.members || [];
    return gi.ownerJid === undefined || gi.ownerJid === local || party.some(m => m.id === gi.ownerJid);
  },
  soxLoadAt: 0,
  // Unknown until the item catalogue loads, so unconfirmed items are never taken.
  ensureCatalogue() {
    if (Items.filesLoaded || now() < this.soxLoadAt) return;
    this.soxLoadAt = now() + 30000; Items.ready().catch(() => {});
  },
  sox(e) {
    this.ensureCatalogue();
    return Items.filesLoaded || Items.filesMissing ? Items.sox(e.refObjId) : 0;
  },
  // "Don't pick up Star gear": Star equipment only; Moon and Sun still drop in. Unknown until the catalogue is loaded, so it waits.
  starSkipped(e, P, tf) { return !!P.skipStar && ItemType.isEquipment(tf) && (this.sox(e) === 1 || !Items.data.has(e.refObjId)); },
  allowed(e) {
    if (!e || e.kind !== 'ground-item' || !this.owned(e)) return false;
    const P = Hunt.cfg().pickup, tf = e.groundItem.typeFlags ?? e.tidWord ?? 0;
    const name = (e.name || '').toLowerCase();
    // An item rule decides first: never (or drop) skips it, always skips the category and name filters.
    const rule = ItemRules.get(e.refObjId);
    if (rule && (rule.pick === 'no' || rule.act === 'drop')) return false;
    const gold = ItemType.isGold(tf);
    if (rule?.pick !== 'yes') {
      if (splitList(P.exclude).some(s => name.includes(s)) || this.starSkipped(e, P, tf)) return false;
      const included = splitList(P.include).some(s => name.includes(s));
      // SoX-only narrows equipment to Star/Moon/Sun gear; every other category keeps its own switch.
      if (P.soxOnly && ItemType.isEquipment(tf)) { if (!this.sox(e)) return false; }
      else if (!included && !P[this.category(tf)]) return false;
    }
    const byPet = this.collector(e) === 'pet', pet = byPet ? this.pet() : null;
    if (byPet && (!pet || !Number.isInteger(pet.rec.commandMode) || (pet.rec.commandMode & 128) || dist2D(pet.ent, e) > 500)) return false;
    if (gold || (pet ? pet.rec.status > pet.rec.inventory.length : World.freeBagSlots() > 0)) return true;
    // Ground drops omit quantity/stack ceiling. Permit an existing stack to merge;
    // a server capacity refusal suppresses this drop until inventory changes.
    if (!ItemType.isStackable(tf)) return false;
    return this.items(pet ? pet.rec.gid : 0).some(i => i.refObjId === e.refObjId &&
      (!i.tooltip?.fields?.maxStack || (i.quantity ?? 1) < i.tooltip.fields.maxStack));
  },
  // The first reason a drop in view is not collected, or '' when it is eligible. Follows choose() and allowed().
  whyNot(e) {
    const H = Hunt.cfg(), P = H.pickup, skip = this.skips.get(e.gid);
    if (skip && (skip.bag !== null ? skip.bag === this.bagSignature(e) : skip.until > now())) return 'failed';
    if (!(dist2D(World.pose(), e) <= P.radius)) return 'far';
    if (Hunt.running && H.center && dist2D(H.center, e) > H.radius + P.radius) return 'area';
    if (!this.owned(e)) return 'owner';
    const tf = e.groundItem.typeFlags ?? e.tidWord ?? 0, name = (e.name || '').toLowerCase(), rule = ItemRules.get(e.refObjId);
    if (rule && (rule.pick === 'no' || rule.act === 'drop')) return 'rule';
    const included = splitList(P.include).some(s => name.includes(s));
    const filtered = rule?.pick !== 'yes' && (splitList(P.exclude).some(s => name.includes(s)) || this.starSkipped(e, P, tf) ||
      (P.soxOnly && ItemType.isEquipment(tf) ? !this.sox(e) : !included && !P[this.category(tf)]));
    if (filtered) return 'filter';
    if (this.collector(e) === 'pet') {
      const pet = this.pet();
      if (!pet || !Number.isInteger(pet.rec.commandMode) || (pet.rec.commandMode & 128)) return 'pet';
      if (dist2D(pet.ent, e) > 500) return 'petFar';
    }
    return this.allowed(e) ? '' : 'full';
  },
  // Which switch kept a drop out, for the status line: 'name' (excluded name), 'sox' (SoX only) or its item kind.
  filterWhy(e) {
    const P = Hunt.cfg().pickup, tf = e.groundItem.typeFlags ?? e.tidWord ?? 0, name = (e.name || '').toLowerCase();
    if (splitList(P.exclude).some(s => name.includes(s))) return 'name';
    if (this.starSkipped(e, P, tf)) return 'star';
    return P.soxOnly && ItemType.isEquipment(tf) ? 'sox' : this.category(tf);
  },
  filterLabel(key) {
    return { name: 'excluded by name', sox: 'not Star/Moon/Sun gear (SoX only)', star: 'Star gear (skipped by choice)', gold: 'gold', potions: 'potions', equipment: 'equipment', elixirs: 'elixirs',
      powders: 'lucky powders', magicStones: 'magic stones', attrStones: 'attribute stones', alchemy: 'other alchemy items', others: 'other items' }[key] || key;
  },
  skip(e, reason, inventoryBound = false, forGood = false) {
    const n = Math.min(6, (this.failureCounts.get(e.gid) || 0) + 1);
    this.failureCounts.set(e.gid, n);
    this.skips.set(e.gid, { until: forGood ? Infinity : now() + Math.min(60000, 5000 * 2 ** (n - 1)), bag: inventoryBound ? this.bagSignature(e) : null });
    if (this.active?.petGid) this.petEndAt = Math.max(this.petEndAt, now());
    Log.warn(`Loot skipped (${e.name || e.gid}): ${reason}`);
    this.active = null;
    Hunt.lootGid = 0;
  },
  // The drop worth taking next; `by` ('pet' or 'character') limits it to that collector's drops.
  // Star/Moon/Sun gear goes before everything else: a higher seal tier outranks distance,
  // and the nearest drop only wins within the same tier. Without the catalogue every
  // tier reads 0, so the choice falls back to nearest-first.
  choose(by = null) {
    const H = Hunt.cfg(), P = H.pickup, pose = World.pose();
    if (!P.enabled || !pose) return null;
    let chosen = null, best = Infinity, tier = 0;
    for (const e of World.ents.values()) {
      if (e.kind !== 'ground-item') continue;
      const skip = this.skips.get(e.gid);
      if (skip) {
        if (skip.bag !== null ? skip.bag === this.bagSignature(e) : skip.until > now()) continue;
        this.skips.delete(e.gid);
      }
      const d = dist2D(pose, e);
      if (!Number.isFinite(d) || d > P.radius || Hunt.running && H.center && dist2D(H.center, e) > H.radius + P.radius || !this.allowed(e)) continue;
      const who = this.collector(e);
      if (by && who !== by) continue;
      const travel = dist2D(who === 'pet' ? this.pet()?.ent : pose, e);
      const seal = this.sox(e);
      if (seal > tier || (seal === tier && travel < best)) { chosen = e; best = travel; tier = seal; }
    }
    return chosen;
  },
  begin(e) {
    const byPet = this.collector(e) === 'pet';
    if (!this.allowed(e) || World.gp?.inventoryPending || !byPet && World.isCasting()) return false;
    const petGid = byPet ? this.pet()?.rec.gid : 0;
    if (byPet && !petGid || !this.pickup(e.gid, petGid)) return false;
    const gold = ItemType.isGold(e.groundItem.typeFlags);
    this.active = { gid: e.gid, ref: e.refObjId, name: e.name, gold, petGid,
      before: gold ? toBigInt(World.gp?.progression?.gold) : this.count(e.refObjId, petGid),
      at: now(), progressAt: now(), best: dist2D(petGid ? this.pet().ent : World.pose(), e), attempts: 1,
      retryAt: 0, goneAt: null, failure: '' };
    Hunt.lootGid = e.gid;
    return true;
  },
  gained(a) {
    return a.gold ? toBigInt(World.gp?.progression?.gold) > a.before : this.count(a.ref, a.petGid) > a.before;
  },
  tick() {
    const a = this.active;
    if (!a) return false;
    const e = World.ents.get(a.gid);
    if (!!a.petGid !== (e ? this.collector(e) === 'pet' : !!a.petGid) || a.petGid && this.pet()?.rec.gid !== a.petGid) { this.suspend(); return false; }
    if (!a.petGid) Hunt.state = 'loot';
    if (this.gained(a)) {
      Stats.pickup(a);
      if (a.petGid) { this.petEndAt = Math.max(this.petEndAt, now()); this.spent.delete(a.gid); }
      // If inventory updates precede despawn, don't request this same drop again.
      this.skips.set(a.gid, { until: now() + 3000, bag: null });
      this.failureCounts.delete(a.gid);
      this.active = null; Hunt.lootGid = 0;
      return true;
    }
    if (!e) {
      a.goneAt ??= now();
      if (now() - a.goneAt < 1500) return true; // allow a delayed inventory/gold update
      Log.info(`Drop disappeared without a matching inventory gain: ${a.name || a.gid}`);
      this.active = null; Hunt.lootGid = 0;
      return false;
    }
    if (!this.allowed(e) || !Hunt.cfg().pickup.enabled) {
      if (!a.petGid && !Cmd.move(World.pose())) return true;
      this.suspend(); return false;
    }
    const d = dist2D(a.petGid ? this.pet().ent : World.pose(), e);
    if (d < a.best - 2) { a.best = d; a.progressAt = now(); }
    if (World.gp?.inventoryPending) return true;
    if (a.retryAt) {
      if (now() < a.retryAt) return true;
      if (this.pickup(a.gid, a.petGid)) {
        a.attempts++; a.retryAt = 0; a.at = now(); a.progressAt = now(); a.best = d; a.failure = '';
      }
      return true;
    }
    // Keep the approach alive while moving; don't expire it after a fixed 4.5 seconds.
    if (!a.failure && now() - a.progressAt < 8000 && now() - a.at < 45000) return true;
    const reason = a.failure || 'no approach/pickup progress';
    const capacity = /full|capacity|(?:not enough|no|out of) (?:free |inventory |bag )?space|envanter.*dolu/i.test(reason);
    const spent = a.petGid && !capacity ? this.spent.get(a.gid) : null;
    if (spent && reason !== 'Inventory command unavailable') spent.attempts++;
    if (spent && (spent.attempts >= PET_GIVE_UP_ATTEMPTS || spent.lockMs >= PET_LOCK_BUDGET_MS)) { this.skip(e, reason + '; the pet gives up on this drop', false, true); return false; }
    if (capacity || a.attempts > Hunt.cfg().pickup.retries) { this.skip(e, reason, capacity); return false; }
    // Movement cancels the outstanding worker pickup intent. Resubmit on a later tick.
    if (a.petGid || Cmd.move(World.pose())) { a.retryAt = now() + (a.petGid ? PET_GAP_MS : 700); a.failure = ''; }
    return true;
  },
  // The pet keeps collecting while the bot is stopped. Pet settings are left alone: with auto-grab on the game collects
  // natively (allowed() refuses), otherwise selective requests go out as during hunting. Character pickups stay bot-only.
  idleTick() {
    if (Hunt.running || !this.petMode() || !Hunt.cfg().pickup.enabled || World.isDead() || World.gp?.storage || Restock.activeShop() ||
        now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000 && !this.petWhileManual()) {
      if (this.active?.petGid) this.suspend();
      return;
    }
    this.petTick();
  },
  petTick() {
    if (this.active) { if (this.active.petGid) this.tick(); else this.suspend(); return; }
    const drop = this.choose('pet');
    if (drop) this.begin(drop);
  },
  suspend() { this.active = null; Hunt.lootGid = 0; },
  reset() {
    this.suspend(); this.skips.clear(); this.failureCounts.clear(); this.spent.clear(); this.petSetup = null; this.fullAlert = null;
    this.lock = null; this.petLocks = []; this.petEndAt = this.petSentAt = -Infinity;
  },
  init() {
    Hook.observers.push(command => { if (command?.kind === 'gameplay') this.notePlayer(command.command?.kind); });
    bus.on('gameplay', () => this.watchLock());
    bus.on('game-error', message => {
      if (!this.active) return;
      const reason = String(message);
      // The shared error field also contains combat and item-use failures.
      // Only native COS-ground/transaction refusals can fail a pet request;
      // generic inventory refusals are transient, never proof its bag is full.
      if (this.active.petGid && !/^(?:Inventory (?:command unavailable|rejected: \d+)|No owned COS ground authority|Invalid COS ground request|Unmatched COS ground result)$/.test(reason)) return;
      this.active.failure = reason;
    });
    bus.on('despawn', e => {
      this.skips.delete(e.gid); this.failureCounts.delete(e.gid); this.spent.delete(e.gid);
    });
  },
};
