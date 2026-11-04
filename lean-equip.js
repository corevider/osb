// Auto-equip, phBot-style but scored on the game's own stat model: on a town trip, a carried equipment piece
// whose real stats beat the worn one in the same slot family is worn there, and the piece it replaces is
// deposited in the warehouse. Stats are computed the way the client tooltip does it: every stat rolls inside a
// [min, max] field pair (the roll is 5 bits of the item's variance bitfield), plus adds its per-plus share, and
// known blues add a bounded nudge on top — so a well-rolled ordinary piece can beat a low-rolled Seal one.
// Weapons are compared on the dominant attack of the worn weapon (a physical build never swaps to a magical
// blade, however good); armour and shields on physical + magical defence; accessories on reinforcement.
// Never touched: the chosen primary/secondary/shield, buff-set gear, the alchemy item, items with a Keep rule,
// pieces with an incomplete tooltip, an unknown level requirement or an unknown slot, and anything the game
// refuses to equip, which also stays in the bag unsold.
const EQUIP_MARGIN = 1.02;
// Blue weights are a judgment call, kept small so real stats dominate the comparison: half a point per build
// stat (STR on a physical weapon, INT on a magical one), a quarter per hit-ratio point, a tenth per raw HP.
const Equip = {
  bad: new Set(), out: new Set(), outOwner: '', message: 'Auto-equip off.',
  reset() { this.bad.clear(); this.out.clear(); this.outOwner = ''; this.message = 'Auto-equip off.'; },
  on() { return !!Settings.profile.items.autoEquip; },
  family(item) { return (item.typeFlags >>> 7) & 15; },
  // The worn slots a piece can go to, by the client's rule on type ids 3 and 4: armour by body part, weapon 6, shield 7,
  // earring 9, necklace 10, rings 11 and 12. Empty when the part is unknown: a destination is never guessed.
  slots(item) {
    const family = this.family(item), part = (item.typeFlags >>> 11) & 31;
    if (family === 6) return [6];
    if (family === 4) return part === 1 || part === 2 ? [7] : [];
    if (family === 5 || family === 12) return part === 3 ? [11, 12] : part === 1 ? [9] : part === 2 ? [10] : [];
    const slot = [0, 2, 1, 4, 3, 5][part - 1];
    return slot === undefined ? [] : [slot];
  },
  // The stats an item really carries, or null when its tooltip does not hold them all (never guessed).
  stats(item) {
    const f = item.tooltip?.fields;
    if (!f || item.variance === undefined || item.variance === null) return null;
    let bits; try { bits = BigInt(item.variance); } catch { return null; }
    const roll = i => Number(bits >> BigInt(i * 5) & 31n);
    const real = (lo, hi, i, perPlus) => {
      if (!Number.isFinite(f[lo]) || !Number.isFinite(f[hi]) || !Number.isFinite(f[perPlus])) return null;
      return (f[hi] - f[lo]) * roll(i) / 31 + f[lo] + f[perPlus] * (item.plus ?? 0);
    };
    const tid = this.family(item);
    if (tid === 6) {
      const paMin = real('varianceIntMin240', 'varianceIntMax244', 4, 'varianceFloatPerPlus250');
      const paMax = real('varianceIntMin248', 'varianceIntMax24c', 4, 'varianceFloatPerPlus250');
      const maMin = real('varianceIntMin254', 'varianceIntMax258', 5, 'varianceFloatPerPlus264');
      const maMax = real('varianceIntMin25c', 'varianceIntMax260', 5, 'varianceFloatPerPlus264');
      if (paMin === null || paMax === null || maMin === null || maMax === null) return null;
      return { weapon: true, pa: (paMin + paMax) / 2, ma: (maMin + maMax) / 2 };
    }
    if (tid === 5 || tid === 12) {
      const pr = real('varianceFloatMin1e0', 'varianceFloatMax1e4', 0, 'varianceFloatPerPlus1e8');
      const mr = real('varianceFloatMin200', 'varianceFloatMax204', 1, 'varianceFloatPerPlus208');
      if (pr === null || mr === null) return null;
      return { accessory: true, pr, mr };
    }
    if ([1, 2, 3, 4, 9, 10, 11].includes(tid)) {
      const shield = tid === 4;
      const pd = real('varianceFloatMin1c8', 'varianceFloatMax1cc', shield ? 4 : 3, 'varianceFloatPerPlus1d0');
      const md = real('varianceFloatMin1f4', 'varianceFloatMax1f8', shield ? 5 : 4, 'varianceFloatPerPlus1fc');
      if (pd === null || md === null) return null;
      return { armour: true, pd, md };
    }
    return null;
  },
  // Blues decoded as the client does: paramId in the low 16 bits, amount in the high 32.
  blues(item, phys) {
    let bonus = 0;
    for (const encoded of item.magic || []) {
      let bits; try { bits = BigInt(encoded); } catch { continue; }
      const ref = (item.magicReferences || []).find(r => r.paramId === Number(bits & 65535n));
      if (!ref) continue;
      const amount = Number(bits >> 32n) & 0xffffffff;
      if (ref.optionName === 'MATTR_STR') bonus += amount * (phys === false ? 0 : 0.5);
      else if (ref.optionName === 'MATTR_INT') bonus += amount * (phys === true ? 0 : 0.5);
      else if (ref.optionName === 'MATTR_HR') bonus += amount * 0.25;
      else if (ref.optionName === 'MATTR_HP') bonus += amount * 0.1;
    }
    return bonus;
  },
  score(item, stats, phys) {
    if (stats.weapon) { const attack = phys === undefined ? stats.pa >= stats.ma : phys; return (attack ? stats.pa : stats.ma) + this.blues(item, attack); }
    if (stats.armour) return stats.pd + stats.md + this.blues(item);
    return (stats.pr + stats.mr) * 100 + this.blues(item);
  },
  protected(item) {
    if (ItemRules.guarded(item)) return true;
    const key = BuffGear.key(item);
    if (Settings.profile.macro.buffSets?.some(s => s.weapon === key || s.shield === key)) return true;
    if (Alchemy.selected && Alchemy.item()?.slot === item.slot) return true;
    return ItemRules.get(item.refObjId)?.act === 'keep';
  },
  worn() {
    const equipped = World.gp.equipmentSlotCount || 13;
    return (World.gp.inventory || []).filter(i => i.slot < equipped && this.stats(i) && !this.protected(i));
  },
  carried() {
    const equipped = World.gp.equipmentSlotCount || 13;
    return World.items().filter(i => i.slot >= equipped && ItemType.isEquipment(i.typeFlags) && (i.durability ?? 1) > 0);
  },
  // The swap that wears this carried piece, or null. It competes only for its own slots, against the worn pieces of
  // its family there: rings and earrings are never compared with a necklace, nor boots with gloves. With two ring
  // slots the weaker worn ring is the target, so a better ring replaces it instead of being measured against the stronger one.
  swap(item, worn, level) {
    if (this.protected(item) || this.bad.has(BuffGear.key(item))) return null;
    const stats = this.stats(item), slots = this.slots(item);
    if (!stats || !slots.length) return null;
    const need = Town.requiredLevel(item);
    if (!Number.isInteger(need) || need > level || !Town.masteriesMet(item)) return null;
    const family = worn.filter(w => this.family(w) === this.family(item) && slots.includes(w.slot));
    if (!family.length) return null;
    let target = null, targetStats = null, targetScore = 0;
    for (const w of family) {
      const ws = this.stats(w), s = this.score(w, ws, stats.weapon ? ws.pa >= ws.ma : undefined);
      if (!target || s < targetScore) { target = w; targetStats = ws; targetScore = s; }
    }
    const score = this.score(item, stats, stats.weapon ? targetStats.pa >= targetStats.ma : undefined);
    if (targetScore <= 0 || score < targetScore * EQUIP_MARGIN) return null;
    return { item, worn: target, score, targetScore };
  },
  // The next swap worth making: the carried piece that gains the most over what it replaces.
  pick() {
    const level = World.gp.progression?.level;
    if (!Number.isInteger(level)) return null;
    const worn = this.worn();
    if (!worn.length) return null;
    let best = null;
    for (const item of this.carried()) {
      const swap = this.swap(item, worn, level);
      if (swap && (!best || swap.score - swap.targetScore > best.score - best.targetScore)) best = swap;
    }
    return best;
  },
  // A carried piece the next warehouse visit would wear: a sale before it must leave it alone.
  wanted(item) {
    const level = World.gp?.progression?.level;
    return this.on() && World.inWorld() && Number.isInteger(level) && ItemType.isEquipment(item.typeFlags) && !!this.swap(item, this.worn(), level);
  },
  // A piece the game would not wear, or never confirmed: kept in the bag, not tried again, until the user decides.
  refused(item) { return this.bad.has(BuffGear.key(item)); },
  remember(key) {
    const owner = Settings.profileKey + '|' + World.charName;
    if (owner !== this.outOwner) { this.outOwner = owner; this.out.clear(); }
    this.out.add(key);
  },
  // Replaced pieces are never sold from the bag, even on later trips, until they are stored.
  replaced(item) { return this.outOwner === Settings.profileKey + '|' + World.charName && this.out.has(BuffGear.key(item)); },
  refuse(t, p, why) {
    this.bad.add(p.key); t.pending = null;
    this.message = 'Could not wear ' + (p.name || 'the piece') + ' (' + why + '). It stays in your bag, unsold, and is not tried again this session.';
    Log.warn('Equip: ' + this.message);
  },
  // Runs from Town.store() while the warehouse is open: one swap at a time, each confirmed by the game state
  // before the next. A swap the game refuses (or never confirms) is skipped for the session; nothing here can
  // fail the town trip.
  step(t) {
    if (!this.on() || !World.inWorld()) return false;
    const p = t.pending, gp = World.gp;
    // A warehouse transaction still in flight owns the trip — an equip move is never sent beside it — and a
    // busy game inventory admits no new one either: the same one-confirmed-transaction-at-a-time rule as Town.
    if (p && p.kind !== 'equip') return false;
    if (!p && gp.inventoryPending) return false;
    if (p?.kind === 'equip') {
      // A swap counts only once the worn slot really holds the new piece — matched by its full key, not just the
      // item number, because the case this feature is built around is the same base item with a better roll.
      // Before that, and for the first 500 ms like every town transaction, nothing is trusted and nothing re-sent.
      if (now() - p.at >= 500 && !gp.inventoryPending && BuffGear.key(gp.inventory?.find(i => i.slot === p.slot)) === p.key) {
        t.pending = null;
        (t.equippedOut ||= []).push(p.oldKey);
        this.remember(p.oldKey);
        this.message = 'Wore ' + (p.name || 'better gear') + '; the replaced piece goes to the warehouse.';
        Log.info('Equip: ' + this.message); UI.toast(this.message, 'info', 4000);
        return true;
      }
      if (gp.error && !gp.inventoryPending && now() - p.at >= 500) this.refuse(t, p, 'the game refused it: ' + gp.error);
      else if (now() - p.at > 15000) this.refuse(t, p, 'the game did not confirm it within 15 seconds');
      return true;
    }
    const pick = this.pick();
    if (!pick) return false;
    const name = Items.name(pick.item.refObjId);
    if (Cmd.raw({ kind: 'inventory-move', source: pick.item.slot, destination: pick.worn.slot, quantity: 0 }, 'Equip: wear ' + name)) {
      t.pending = { kind: 'equip', slot: pick.worn.slot, ref: pick.item.refObjId, key: BuffGear.key(pick.item), oldKey: BuffGear.key(pick.worn), name, at: now() };
      this.message = 'Wearing ' + name + '.';
    }
    return true;
  },
};
