const ALCHEMY_BUY_STEP_MS = 12000;
const ALCHEMY_BUY_OPEN_MS = 15000;
const ALCHEMY_BUY_NEAR = 200;
const ALCHEMY_BUY_STOP = 120;
const fmtGold = n => goldText(n);
const AlchemyBuy = {
  run: null, message: '',
  cfg() { return Settings.profile.alchemy.buy; },
  gold() { try { return toBigInt(World.gp?.progression?.gold ?? 0); } catch { return 0n; } },
  needs(rows = Alchemy.rows()) {
    const list = new Map(), stock = this.cfg().stock;
    const add = (key, label, refs, kind) => { if (!list.has(key)) list.set(key, { key, label, refs, kind, stock: stock[kind] }); };
    for (const row of rows) {
      const item = Alchemy.rowItem(row), g = row.goals;
      if (!item) continue;
      const degree = Alchemy.degree(item), kind = Alchemy.kind(item);
      if (!degree) continue;
      if (Alchemy.stepWanted('plus', item, g)) {
        const pick = Alchemy.elixirChoice(kind, g), elixirs = ALCHEMY_DATA.kinds[kind] || [];
        if (elixirs.length) add('elixir:' + kind + ':' + pick, `${kind} elixir`, pick ? [pick] : elixirs, 'elixir');
        if (g.powder) add('powder:' + degree, `lucky powder (degree ${degree})`, [3682 + degree, 3694 + degree], 'powder');
        const helpers = Object.keys(STONES).filter(k => g.use?.[k]);
        if (helpers.includes('astral') && !helpers.includes('immortal')) helpers.push('immortal');
        for (const k of helpers) add(k + ':' + degree, `${STONES[k].label} stone (degree ${degree})`, [STONES[k].base + degree - 1], 'protect');
      }
      if (Alchemy.stepWanted('white', item, g)) for (const a of Alchemy.attributes(kind)) {
        const target = Alchemy.attrTarget(a.name, g);
        if (target && Alchemy.attrValue(item, a.index) < target) add(a.name + ':' + degree, `${ATTRIBUTE_LABEL[a.name]} stone (degree ${degree})`, [ALCHEMY_DATA.attrStones[a.name] + degree - 1], 'white');
      }
      if (Alchemy.stepWanted('blue', item, g)) for (const name of Alchemy.blues(item)) {
        const target = Alchemy.blueTarget(name, g, degree);
        if (target && Alchemy.attributeCount(item, name) < target) add(name + ':' + degree, `${BLUE_LABEL[name]} stone (degree ${degree})`, [ALCHEMY_DATA.magicStones[name] + degree - 1], 'blue');
      }
    }
    return [...list.values()].filter(n => n.stock > 0);
  },
  have(need) { return need.refs.reduce((n, ref) => n + Restock.count(ref), 0); },
  shortfall(rows) { return this.needs(rows).map(n => ({ ...n, missing: Math.max(0, n.stock - this.have(n)) })).filter(n => n.missing > 0); },
  merchant() {
    const pose = World.pose(), known = this.cfg().merchant?.refObjId || ALCHEMY_MERCHANT.refObjId;
    const near = [...World.ents.values()].filter(e => e.kind === 'npc' && (known ? e.refObjId === known : ALCHEMY_MERCHANT.name.test(e.name || '')))
      .sort((a, b) => dist2D(pose, a) - dist2D(pose, b))[0];
    if (near) {
      const spot = { refObjId: near.refObjId, regionId: near.regionId, x: near.x, y: near.y, z: near.z }, saved = this.cfg().merchant;
      if (!saved || saved.refObjId !== spot.refObjId || dist2D(saved, spot) > 5) { this.cfg().merchant = spot; Settings.saveProfile(); }
      return spot;
    }
    const saved = this.cfg().merchant;
    return saved?.refObjId ? saved : ALCHEMY_MERCHANT.regionId ? ALCHEMY_MERCHANT : null;
  },
  budget(limit = toBigInt(this.cfg().spend)) { const free = this.gold() - toBigInt(this.cfg().keep), cap = free < limit ? free : limit; return cap < 1n ? 0n : cap; },
  start(rows, onDone, limit = toBigInt(this.cfg().spend)) {
    if (this.run) return 'A purchase is already running.';
    if (!this.cfg().on) return 'Buying is off.';
    const list = this.shortfall(rows);
    if (!list.length) return 'Nothing to buy.';
    const spec = this.merchant();
    if (!spec) return 'The alchemy merchant is not known here; stand in Jangan near "OpenSRO Alchemy".';
    if (!(dist2D(World.pose(), spec) <= 3000)) return 'Too far from the Jangan alchemy merchant; go to Jangan first.';
    if (limit < 1n) return `The gold limit of this queue (${fmtGold(this.cfg().spend)}) is used up.`;
    if (this.budget(limit) < 1n) return 'Not enough gold above the amount to keep.';
    this.run = { stage: 'prep', rows, spec, list, onDone, at: now(), manualAt: Manual.lastAt, character: World.charName, pend: null, open: null,
      startGold: this.gold(), budget: this.budget(limit), got: {}, skipped: [] };
    Alchemy.note(`Buying: ${list.map(n => `${n.missing} ${n.label}`).join(', ')} (up to ${fmtGold(this.run.budget)} gold).`);
    this.message = 'Going to the alchemy merchant.';
    return '';
  },
  end(reason, ok = false) {
    const r = this.run; if (!r) return;
    if (WalkBack.active) WalkBack.cancel('', true);
    if (!r.final && (Restock.activeShop() || World.gp?.shop) && World.inWorld()) { r.final = { reason, ok }; r.stage = 'close'; r.closeAt = now(); return; }
    this.run = null;
    const bought = Object.entries(r.got).map(([label, n]) => `${n} ${label}`), spent = r.startGold - this.gold();
    const text = reason + (bought.length ? ` Bought ${bought.join(', ')} for ${fmtGold(spent > 0n ? spent : 0n)} gold.` : '') +
      (r.skipped.length ? ` Not bought: ${r.skipped.join(', ')}.` : '');
    this.message = text; Alchemy.note(text);
    if (!ok) { Log.warn('Alchemy: ' + text); UI.toast(text, 'warn', 6000); }
    r.onDone?.({ text, spent: spent > 0n ? spent : 0n, bought: Object.values(r.got).reduce((n, k) => n + k, 0) });
  },
  tick() {
    const r = this.run;
    if (!r) return false;
    if (!World.inWorld() || !World.gp || !World.local()) return true;
    if (World.isDead()) { this.end('Buying stopped: the character died.'); return true; }
    if (Manual.lastAt !== r.manualAt || r.character !== World.charName) { this.end('Buying stopped by manual control.'); return true; }
    if (WalkBack.active) { WalkBack.tick(); return true; }
    this[r.stage + 'Stage']();
    return true;
  },
  closeStage() {
    const r = this.run, gp = World.gp;
    if ((Restock.activeShop() || gp.shop) && now() - r.closeAt < 5000) { if (!gp.inventoryPending && Cmd.spaced('npc-close')) Cmd.raw({ kind: 'npc-close' }, 'Alchemy: close the merchant'); return; }
    const f = r.final; this.end(f.reason, f.ok);
  },
  prepStage() {
    const r = this.run, a = World.gp.alchemy;
    if (World.gp.inventoryPending || a?.pending) return;
    if (a?.visible) { if (Cmd.spaced('alchemy-close')) Cmd.raw({ kind: 'alchemy-close' }, 'Alchemy: close the window to shop'); if (now() - r.at > 10000) this.end('Buying stopped: the alchemy window did not close.'); return; }
    r.stage = 'buy';
  },
  visit() {
    const r = this.run, spec = r.spec, d = dist2D(World.pose(), spec);
    if (d > ALCHEMY_BUY_NEAR) {
      r.open = null; this.message = 'Walking to the alchemy merchant.';
      if (!WalkBack.startTo(spec, { label: 'the alchemy merchant', stop: ALCHEMY_BUY_STOP, onDone: () => {}, onFail: reason => this.end('Buying stopped: ' + reason) }) && this.run) this.end('Buying stopped: cannot walk to the alchemy merchant.');
      return null;
    }
    const gp = World.gp;
    r.open ||= { at: now(), sent: false, revision: 0, ready: false };
    const o = r.open;
    if (!o.ready && now() - o.at > ALCHEMY_BUY_OPEN_MS) { this.end('Buying stopped: the alchemy merchant did not open the shop.'); return null; }
    const npc = [...World.ents.values()].filter(e => e.kind === 'npc' && e.refObjId === spec.refObjId && dist2D(e, spec) < ALCHEMY_BUY_NEAR)
      .sort((a, b) => dist2D(World.pose(), a) - dist2D(World.pose(), b))[0];
    if (!npc || gp.targetPending) return null;
    if (gp.target !== npc.gid) { if (Cmd.spaced('select')) Cmd.select(npc.gid); return null; }
    if (!o.sent && !gp.inventoryPending && Cmd.raw({ kind: 'shop-open', gid: npc.gid }, 'Alchemy: open the merchant')) { o.sent = true; o.revision = gp.shopCompletionRevision; }
    if (!o.sent || gp.inventoryPending || gp.shop?.npc !== npc.gid || (!o.ready && gp.shopCompletionRevision === o.revision)) return null;
    const shop = Restock.activeShop();
    if (!shop) return null;
    if (shop.error) { this.end('Buying stopped: ' + shop.error); return null; }
    o.ready = true;
    return shop;
  },
  room(offer) {
    const max = offer.maxStack || 1;
    return World.items().filter(i => i.refObjId === offer.refObjId && i.slot >= 13).reduce((n, i) => n + Math.max(0, max - (i.quantity ?? 1)), 0) + World.freeBagSlots() * max;
  },
  buyStage() {
    const r = this.run, shop = this.visit();
    if (!shop || !this.run) return;
    const gp = World.gp, p = r.pend;
    if (p) {
      if (now() - p.at > ALCHEMY_BUY_STEP_MS) return this.end(`Buying stopped: ${p.label} was not confirmed${gp.error ? ' (' + gp.error + ')' : ''}; nothing was repeated.`);
      if (gp.inventoryPending || now() - p.at < 500 || this.have(p.need) <= p.before) return;
      r.pend = null; r.got[p.label] = (r.got[p.label] || 0) + this.have(p.need) - p.before;
    }
    if (gp.inventoryPending || !Cmd.spaced('shop-buy')) return;
    const need = r.list.find(n => !r.skipped.some(s => s.startsWith(n.label + ' (')) && this.have(n) < n.stock);
    if (!need) return this.end(r.skipped.length ? 'Done buying.' : 'Bought what the queue needs.', true);
    const offer = need.refs.map(ref => shop.offers.find(o => o.refObjId === ref && (o.currency === undefined || o.currency === 1))).find(Boolean);
    if (!offer) { r.skipped.push(need.label + ' (not sold here)'); return; }
    const price = toBigInt(offer.price) || 1n, left = r.budget - (r.startGold - this.gold());
    const quantity = Math.min(need.stock - this.have(need), offer.purchaseLimit ?? offer.maxStack ?? 1, 65535, this.room(offer), Number(left / price));
    if (quantity < 1) { r.skipped.push(need.label + (this.room(offer) < 1 ? ' (bag full)' : ' (gold limit)')); return; }
    if (Cmd.raw({ kind: 'shop-buy', tab: offer.tab, slot: offer.slot, quantity }, `Alchemy: buy ${quantity} ${need.label}`)) {
      r.pend = { need, label: need.label, before: this.have(need), at: now() };
      this.message = `Buying ${quantity} ${need.label}.`;
    }
  },
};
const ALCHEMY_MERCHANT = { name: /alchemy/i, refObjId: 0, regionId: 0, x: 0, y: 0, z: 0 };
