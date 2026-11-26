// Keep buff scrolls from the bag active while the bot works. Each kind lists the live items that give that buff,
// best first; the kind counts as active while any of their buffs shows (the same effect from two scrolls is never
// stacked on purpose). Items -> skills from the live world references (2026-11):
//   20% damage increase:  23275 GNGWC Damage Increase Scroll -> 30537 (2 min), 3767 Item Mall 20% -> 3109 (30 min)
//   20% damage absorption: 23276 GNGWC Damage Absorption Scroll -> 30538 (2 min), 3768 Item Mall 20% -> 3110 (30 min)
//   HP increase: 23277 HP 1000 -> 30539 (2 min), 6102 500 HP -> 3968 (30 min); MP the same: 23278 -> 30540, 6103 -> 3969
//   Hit 6099 -> 3965, Dodging 6098 -> 3964 (60 min)
// The GNGWC scrolls carry their own 2-minute item cooldown (group 0: per item), so they never block each other.
// Only bag stock is used here; buying more is the Item Mall buyer's business. Like the speed scroll: never infer
// consumption from a local dispatch, one request at a time, and the same blocked-while-travelling guards.
const ScrollBuff = {
  pending: null, attempts: {}, nextAt: {}, message: 'Battle scrolls off.',
  kinds: {
    damageInc: { label: 'damage increase', uses: [{ item: 23275, skill: 30537 }, { item: 3767, skill: 3109 }] },
    damageAbs: { label: 'damage absorption', uses: [{ item: 23276, skill: 30538 }, { item: 3768, skill: 3110 }] },
    hpUp: { label: 'HP increase', uses: [{ item: 23277, skill: 30539 }, { item: 6102, skill: 3968 }] },
    mpUp: { label: 'MP increase', uses: [{ item: 23278, skill: 30540 }, { item: 6103, skill: 3969 }] },
    hit: { label: 'hit', uses: [{ item: 6099, skill: 3965 }] },
    dodge: { label: 'dodging', uses: [{ item: 6098, skill: 3964 }] },
  },
  reset() { this.pending = null; this.attempts = {}; this.nextAt = {}; this.message = 'Waiting for automation.'; },
  active(k) { return this.kinds[k].uses.some(u => World.buffRemaining(u.skill) > 0); },
  enabled() { const c = Settings.profile.scroll; return Object.keys(this.kinds).filter(k => c[k]); },
  tick() {
    const wanted = this.enabled();
    if (!wanted.length) { this.message = 'Battle scrolls off.'; return false; }
    if (!World.inWorld() || World.isDead()) { this.message = 'Waiting for a living character in the world.'; return false; }
    if (!Hunt.running) { this.message = 'Start the bot to keep the scrolls active.'; return false; }
    const missing = wanted.filter(k => !this.active(k));
    if (!missing.length) { this.pending = null; this.attempts = {}; this.message = 'Battle scrolls active.'; return false; }
    if (Town.trip) { this.message = 'Waiting for town services to finish.'; return false; }
    const blocked = World.gp.inventoryPending ? 'Waiting for the inventory transaction to finish.' :
      World.gp.returnScroll ? 'Waiting for return-scroll travel.' :
      World.isSitting() ? 'Waiting for the character to stand.' :
      World.local()?.mountedOn ? 'Waiting for the character to dismount.' :
      Restock.activeShop() || World.gp.storage ? 'Waiting for the shop or storage to close.' :
      now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000 ? 'Waiting for the manual-control pause.' : '';
    if (blocked) { this.message = blocked; return false; }
    if (this.pending) {
      // Only the kind that was sent owns this window: another scroll may still be missing.
      const k = this.pending.kind;
      if (this.active(k)) { this.pending = null; this.attempts[k] = 0; }
      else if (now() - this.pending.at < 8000) { this.message = 'Waiting for the scroll buff.'; return false; }
      else {
        this.pending = null; this.nextAt[k] = now() + 30000 * (this.attempts[k] || 1);
        this.message = 'The ' + this.kinds[k].label + ' scroll buff was not confirmed. Backing off before retrying.';
        Log.warn(this.message);
      }
    }
    let note = '';
    for (const k of missing) {
      const def = this.kinds[k];
      if ((this.attempts[k] || 0) >= 3) { note ||= 'The ' + def.label + ' scroll was not confirmed after 3 attempts. Check the game and toggle the option to retry.'; continue; }
      if (now() < (this.nextAt[k] || 0)) continue;
      let item = null;
      for (const u of def.uses) { item = World.items().find(i => i.refObjId === u.item && (i.quantity ?? 1) > 0); if (item) break; }
      if (!item) { note ||= 'No ' + def.label + ' scroll in your bag.'; continue; }
      if (!Cmd.itemUse(item.slot)) { this.message = 'Waiting for item-use availability (potions have priority).'; return false; }
      this.attempts[k] = (this.attempts[k] || 0) + 1; this.pending = { kind: k, at: now() };
      this.message = 'The ' + def.label + ' scroll requested; waiting for its buff.';
      return true;
    }
    if (note) this.message = note;
    return false;
  },
};
