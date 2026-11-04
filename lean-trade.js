// Automatic trading. Buys specialty goods into the summoned transport at one town's trade merchant, walks to another
// town (the long-range route graph of WalkBack) and sells them there. The rules are the server's: a trader job suit,
// a summoned transport within 100 m of the merchant and goods bought by this character. This module only drives them
// and stops with a plain message when one is not met. Potions keep working on the road because Potion.tick runs in
// every Controller mode; at each town the potion merchant tops up the Supplies page targets first.
const TRADE_NEAR = 200;           // merchant service range, game units
const TRADE_STOP = 120;           // walk until this close, well inside the service range
const TRADE_STEP_MS = 12000;      // an unconfirmed purchase or sale ends the run, nothing is repeated
const TRADE_OPEN_MS = 15000;
const TRADE_SUMMON_MS = 15000;
const TRADE_VEHICLE_BAND = 2;     // cos record band of a transport (type word TID4 2)
const TRADE_JOB_SLOT = 8;         // inventory slot of the job suit
const TRADE_GOODS_MASK = 0x7fe, TRADE_GOODS_TYPE = 0x46c; // TID 3/3/8, as the server's inventory.IsTradeGoods
const TRADE_VEHICLE_NAME = /horse|donkey|mule|camel|ostrich|pegasus|unicorn|transport|wagon|cart/i;
const isTradeGoods = tf => ((tf >>> 0) & TRADE_GOODS_MASK) === TRADE_GOODS_TYPE;

const Trade = {
  run: null, message: 'Auto trade off.', note: null,
  cfg() { return Settings.profile.trade; },
  towns() { return TOWN_TABLE.filter(t => t.services.trade); },
  town(key) { return TOWN_TABLE.find(t => t.key === key && t.services.trade) || null; },
  vehicle() { return (World.gp?.cosRecords || []).find(r => r && r.band === TRADE_VEHICLE_BAND && !r.dead && r.hp > 0) || null; },
  goods(rec) { return (rec?.inventory || []).filter(i => isTradeGoods(i.typeFlags)); },
  held(ref) { return (this.vehicle()?.inventory || []).filter(i => i.refObjId === ref).reduce((n, i) => n + (i.quantity ?? 1), 0); },
  jobSuit() {
    const item = World.gp?.inventory?.find(i => i.slot === TRADE_JOB_SLOT);
    return !!item && wdJobMode(item.typeFlags) && wdTid4(item.typeFlags) === 1;
  },
  // The transport's summon item: a ITEM_COS_C_ codename, or by name until the item catalogue has loaded.
  scroll() {
    return World.gp?.inventory?.find(i => {
      const code = i.codename || Items.data?.get(i.refObjId)?.code || '';
      return code ? /^ITEM_COS_C_/.test(code) : /summon/i.test(i.name || '') && TRADE_VEHICLE_NAME.test(i.name || '');
    }) || null;
  },
  supplies() { return Restock.supplies().filter(s => s.refObjId && s.target > 0); },
  gold() { try { return toBigInt(World.gp?.progression?.gold ?? 0); } catch { return 0n; } },
  tell(text) { this.message = text; UI.toast(text, 'info', 5000); this.refresh(); },

  start() {
    if (this.run) return;
    const c = this.cfg(), from = this.town(c.from), to = this.town(c.to);
    if (!from || !to || from.key === to.key) return this.tell('Choose two different towns that have a trade merchant.');
    if (Hunt.running || Town.trip || WalkBack.active || Restock.trip || Restock.recording || Alchemy.run || Alchemy.pending || BuffGear.run) {
      return this.tell('Stop hunting and any other trip first.');
    }
    if (!World.inWorld() || World.isDead() || !World.local()) return this.tell('Enter the world with a living character first.');
    Items.ready?.()?.catch?.(() => {});
    this.run = { stage: 'prep', src: from.key, dst: to.key, here: from.key, trips: 0, deliveries: 0, at: now(), manualAt: Manual.lastAt,
      pend: null, open: null, summonAt: 0, followed: false, startGold: 0n, booked: false, skip: new Set() };
    Log.info('Auto trade: ' + from.name + ' to ' + to.name + '.');
    this.message = 'Auto trade: checking the transport.';
    this.refresh();
  },
  cancel(reason = '') {
    if (!this.run) return;
    this.run = null;
    if (WalkBack.active?.onDone) WalkBack.cancel('', true);
    if (Restock.activeShop() || World.gp?.storage) Cmd.raw({ kind: 'npc-close' }, 'Auto trade: close merchant');
    if (World.inWorld() && !World.isDead()) Cmd.move(World.pose());
    this.message = reason || 'Auto trade stopped.';
    this.refresh();
  },
  fail(reason) {
    const run = this.run;
    if (!run) return;
    Log.warn('Auto trade: ' + reason);
    this.cancel('Auto trade stopped: ' + reason);
    UI.toast('Auto trade stopped: ' + reason, 'warn', 6000);
  },
  finish() {
    const r = this.run;
    this.cancel('Auto trade finished: ' + r.deliveries + (r.deliveries === 1 ? ' delivery' : ' deliveries') + '.');
    UI.toast(this.message, 'info', 6000);
  },

  // Walk to a merchant and open its shop. Returns the open shop once the merchant has answered, otherwise null:
  // the run is still walking or waiting. A failure ends the run.
  visit(spec, label) {
    const r = this.run, d = dist2D(World.pose(), spec);
    if (!Number.isFinite(d)) { this.fail('The ' + label + ' is in another world.'); return null; }
    if (d > TRADE_NEAR) {
      r.open = null;
      this.message = 'Auto trade: walking to the ' + label + '.';
      if (!WalkBack.startTo(spec, { label: 'the ' + label, stop: TRADE_STOP, onDone: () => {}, onFail: reason => this.fail(reason) }) && this.run) this.fail('Cannot walk to the ' + label + '.');
      return null;
    }
    const gp = World.gp;
    if (!r.open || r.open.ref !== spec.refObjId) r.open = { ref: spec.refObjId, at: now(), sent: false, revision: 0, ready: false };
    const o = r.open;
    if (!o.ready && now() - o.at > TRADE_OPEN_MS) { this.fail('The ' + label + ' did not open the shop.'); return null; }
    const npc = [...World.ents.values()].filter(e => e.kind === 'npc' && e.refObjId === spec.refObjId && dist2D(e, spec) < TRADE_NEAR)
      .sort((a, b) => dist2D(World.pose(), a) - dist2D(World.pose(), b))[0];
    if (!npc || gp.targetPending) return null;
    if (gp.target !== npc.gid) { Cmd.select(npc.gid); return null; }
    if (!o.sent && !gp.inventoryPending && Cmd.raw({ kind: 'shop-open', gid: npc.gid }, 'Auto trade: open merchant')) { o.sent = true; o.revision = gp.shopCompletionRevision; }
    // A cached catalogue must not count as a fresh shop-open acknowledgement.
    if (!o.sent || gp.inventoryPending || gp.shop?.npc !== npc.gid || (!o.ready && gp.shopCompletionRevision === o.revision)) return null;
    const shop = Restock.activeShop();
    if (!shop) return null;
    if (shop.error || gp.error && !o.ready) { this.fail(shop.error || gp.error); return null; }
    o.ready = true;
    this.message = 'Auto trade: at the ' + label + '.';
    return shop;
  },
  closeShop(next) {
    const r = this.run;
    if (Restock.activeShop() && !Cmd.raw({ kind: 'npc-close' }, 'Auto trade: close merchant')) return;
    r.open = null; r.stage = next;
  },
  // A sent purchase or sale is only settled by the inventory change it should cause. Never resend before that.
  settle() {
    const p = this.run.pend, gp = World.gp;
    if (!p) return false;
    if (now() - p.at > TRADE_STEP_MS) { this.fail(p.what + ' was not confirmed' + (gp.error ? ' (' + gp.error + ')' : '') + '; nothing was repeated.'); return true; }
    if (gp.inventoryPending || now() - p.at < 500 || !p.done()) return true;
    this.run.pend = null;
    return false;
  },
  offerGoods(o) {
    const rows = o.items || o.previews || [];
    const item = rows.find(i => i.refObjId === o.refObjId);
    return isTradeGoods(item?.typeFlags ?? 0) && (o.currency === undefined || o.currency === 1);
  },
  // The goods that earn the most per transport slot: the dearest offer the purse can pay for at least once.
  pickOffer(shop) {
    const gold = this.gold(), c = this.cfg();
    const offers = shop.offers.filter(o => this.offerGoods(o) && toBigInt(o.price) <= gold);
    return offers.find(o => o.refObjId === c.goods) || offers.sort((a, b) => Number(toBigInt(b.price) - toBigInt(a.price)))[0] || null;
  },

  tick() {
    const r = this.run;
    if (!r) return false;
    if (!World.inWorld() || !World.gp || !World.local()) return true;
    if (World.isDead()) { this.fail('the character died.'); return true; }
    if (Manual.lastAt !== r.manualAt) { this.fail('manual control interrupted the run.'); return true; }
    if (WalkBack.active) { WalkBack.tick(); return true; }
    if (World.gp.inventoryPending && r.stage === 'prep') return true;
    if (this[r.stage + 'Stage']) this[r.stage + 'Stage']();
    return true;
  },

  // Job suit and transport. A missing transport is summoned from its scroll and told to follow.
  prepStage() {
    const r = this.run, gp = World.gp;
    if (!this.jobSuit()) return this.fail('wear your trader job suit first.');
    const v = this.vehicle();
    if (!v) {
      if (!r.summonAt) {
        const s = this.scroll();
        if (!s) return this.fail('no transport is summoned and no transport scroll was found in the bag.');
        if (Cmd.itemUse(s.slot)) { r.summonAt = now(); this.message = 'Auto trade: summoning the transport.'; }
      } else if (now() - r.summonAt > TRADE_SUMMON_MS) this.fail('the transport did not appear.');
      return;
    }
    if (!r.followed && !gp.inventoryPending) { if (Cmd.raw({ kind: 'cos-follow', gid: v.gid }, 'Auto trade: transport follows')) r.followed = true; return; }
    r.stage = 'potions';
  },
  // The potion merchant of the town the run stands in, only while something on the Supplies page is short.
  potionsStage() {
    const r = this.run, town = this.town(r.here);
    const short = this.cfg().potions ? this.supplies().filter(s => !r.skip.has(s.kind) && Restock.count(s.refObjId) < s.target) : [];
    if (!town || !short.length) return this.closeShop('buy');
    const shop = this.visit(town.services.vendor, 'potion merchant');
    if (!shop || this.settle() || !this.run) return;
    const gp = World.gp;
    if (gp.inventoryPending) return;
    const s = short[0], offer = shop.offers.find(o => o.refObjId === s.refObjId && Restock.offerKind(o) === s.kind);
    const before = Restock.count(s.refObjId);
    const room = World.items().filter(i => i.refObjId === s.refObjId).reduce((n, i) => n + Math.max(0, (offer?.maxStack ?? 0) - (i.quantity ?? 1)), 0);
    const quantity = offer ? Math.min(s.target - before, offer.purchaseLimit ?? offer.maxStack, 65535, room + World.freeBagSlots() * offer.maxStack,
      Number(this.gold() / (toBigInt(offer.price) || 1n))) : 0;
    if (quantity < 1) { r.skip.add(s.kind); Log.warn('Auto trade: cannot buy ' + s.kind + ' potions here (not sold, no room or no gold).'); return; }
    if (Cmd.raw({ kind: 'shop-buy', tab: offer.tab, slot: offer.slot, quantity }, `Auto trade: ${offer.name} x${quantity}`)) {
      r.pend = { what: 'Potion purchase', at: now(), done: () => Restock.count(s.refObjId) > before };
    }
  },
  // Fill the transport with the dearest goods, one stack per purchase.
  buyStage() {
    const r = this.run, town = this.town(r.src);
    r.here = r.src;
    const shop = this.visit(town.services.trade, town.name + ' trade merchant');
    if (!shop || this.settle() || !this.run) return;
    const gp = World.gp, v = this.vehicle();
    if (!v) return this.fail('the transport is gone.');
    if (shop.cosGid !== v.gid) return this.fail('the merchant is not linked to your transport. Summon it next to you.');
    if (gp.inventoryPending) return;
    const offer = this.pickOffer(shop), used = v.inventory.length, free = v.status - used;
    const room = offer ? v.inventory.filter(i => i.refObjId === offer.refObjId).reduce((n, i) => n + Math.max(0, offer.maxStack - (i.quantity ?? 1)), 0) : 0;
    const quantity = offer ? Math.min(offer.purchaseLimit ?? offer.maxStack, 65535, room + free * offer.maxStack, Number(this.gold() / (toBigInt(offer.price) || 1n))) : 0;
    if (quantity < 1) {
      if (!this.goods(v).length) return this.fail(offer ? 'the transport has no room.' : 'not enough gold for any goods.');
      return this.closeShop('carry');
    }
    const before = this.held(offer.refObjId);
    if (!r.booked) { r.startGold = this.gold(); r.booked = true; }
    if (Cmd.raw({ kind: 'cos-shop-buy', gid: v.gid, tab: offer.tab, slot: offer.slot, quantity }, `Auto trade: ${offer.name} x${quantity}`)) {
      r.pend = { what: 'Goods purchase', at: now(), done: () => this.held(offer.refObjId) > before };
    }
  },
  // Deliver: walk to the other town and sell every trade item in the transport.
  carryStage() {
    const r = this.run, town = this.town(r.dst);
    const shop = this.visit(town.services.trade, town.name + ' trade merchant');
    if (!shop || this.settle() || !this.run) return;
    const gp = World.gp, v = this.vehicle();
    if (!v) return this.fail('the transport is gone.');
    if (shop.cosGid !== v.gid) return this.fail('the merchant is not linked to your transport. Summon it next to you.');
    if (gp.inventoryPending) return;
    r.here = r.dst;
    const item = this.goods(v)[0];
    if (!item) {
      r.deliveries++;
      const gain = this.gold() - r.startGold;
      Log.info('Auto trade: delivery ' + r.deliveries + ' sold, gold change ' + gain + '.');
      this.message = 'Auto trade: delivery ' + r.deliveries + ' done (' + (gain >= 0n ? '+' : '') + gain + ' gold).';
      const trips = this.cfg().trips;
      if (trips > 0 && r.deliveries >= trips) return this.finish();
      // Round trip: buy the local goods here and carry them back.
      [r.src, r.dst] = [r.dst, r.src];
      r.booked = false; r.skip.clear();
      return this.closeShop('potions');
    }
    const slot = item.slot, quantity = item.quantity ?? 1;
    if (Cmd.raw({ kind: 'cos-shop-sell', gid: v.gid, slot, quantity }, `Auto trade: sell ${item.name || item.refObjId} x${quantity}`)) {
      r.pend = { what: 'Sale', at: now(), done: () => { const row = this.vehicle()?.inventory.find(i => i.slot === slot && i.refObjId === item.refObjId); return !row || (row.quantity ?? 1) < quantity; } };
    }
  },

  refresh() {
    if (this.note) this.note.textContent = this.message;
  },
  draw() {
    const c = () => this.cfg(), towns = () => this.towns().map(t => [t.key, t.name]);
    const group = UI.group('Auto trade',
      UI.select('Buy goods in', towns, () => c().from, v => c().from = v),
      UI.select('Sell goods in', towns, () => c().to, v => c().to = v),
      UI.number('Deliveries (0 = until stopped)', () => c().trips, n => c().trips = n, 0, 999),
      UI.check('Refill potions at each town first', () => c().potions, v => c().potions = v),
      UI.row(UI.button('Start trading', () => this.start()), UI.button('Stop trading', () => this.cancel())));
    this.note = el('p', this.message, 'muted');
    group.append(this.note, el('p', 'Fully automatic: wear your trader job suit, keep a transport scroll in the bag (or summon the transport yourself) and carry enough gold. The bot summons the transport, buys the dearest goods it can afford at the first town\'s trade merchant, walks to the second town, sells them, and with more than one delivery buys the second town\'s goods and carries them back. Potions are used on the road as usual and refilled at each town from the Supplies page targets. Walking only, no teleports. Bandits are not fought; the run stops if the character dies.', 'muted'));
    UI.pane.append(group);
  },
};
