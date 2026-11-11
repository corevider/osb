const UNIQUE_SOURCE_TEXT = { tracker: 'unique tracker', notice: 'game announcement', seen: 'seen by the bot', kill: 'our kill' };
const UNIQUE_PILL = { alive: { text: 'Alive', cls: 'unique-alive' }, dead: { text: 'Slain', cls: 'unique-dead' }, 'not up': { text: 'Not up', cls: 'unique-notup' }, unknown: { text: 'Unknown', cls: 'unique-unknown' } };
const UNIQUE_TICK_TIP = 'Look for this unique in the Unique hunt';
const UNIQUE_TICK_NOTE = 'The Hunt ticks choose which uniques the Unique hunt looks for; with none ticked it looks for all of them.';
const UNIQUE_MAP_W = 300, UNIQUE_MAP_H = 200, UNIQUE_MAP_MAX_UPP = 30;
const UniqueList = {
  list: null, header: null, refreshNote: null, refreshRow: null, box: null, canvas: null, mapInfo: null, open: '', key: '',
  visible() { return UI.is('Setup') && !document?.hidden && !UI.minimised && !UI.root?.host?.hidden && !UI.body?.hidden; },
  rows() {
    if (!UniqueNests.loaded) return [];
    const codes = new Set(UniqueNests.uniques().map(u => u.code));
    for (const code of UniqueTracker.info.keys()) if (UniqueNests.names.has(code)) codes.add(code);
    const picks = new Set(UniqueNests.cfg().picks || []);
    return [...codes].map(code => {
      const v = UniqueState.ofCode(code), t = UniqueTracker.info.get(code);
      const state = v ? v.state : t && t.state !== 'alive' && t.state !== 'slain' ? 'not up' : 'unknown';
      return { code, name: UniqueNests.name(code), level: t?.level || UniqueNests.knownLevel(code) || UniqueState.levelOf(code), map: t?.map || '', state, pill: UNIQUE_PILL[state].text, cls: UNIQUE_PILL[state].cls,
        detail: v && state === 'dead' ? UniqueState.label(code) : '', source: v ? UNIQUE_SOURCE_TEXT[v.source] : t ? UNIQUE_SOURCE_TEXT.tracker : '',
        nests: UniqueNests.nestsOf(code).length, ticked: picks.has(code) };
    }).sort((a, b) => (a.level ? 0 : 1) - (b.level ? 0 : 1) || a.level - b.level || a.name.localeCompare(b.name));
  },
  nestText(r) { return r.nests ? r.nests + ' nest' + (r.nests === 1 ? '' : 's') : 'no nest in the game data'; },
  meta(r) { return [r.level ? 'Lv ' + r.level : '', r.map, r.detail].filter(Boolean).join(' · '); },
  text(r) {
    return [r.name, r.pill, this.meta(r), this.nestText(r)].filter(Boolean).join(' · ') + (r.source ? ' (' + r.source + ')' : '');
  },
  ago(at) { const s = Math.max(0, Math.round((now() - at) / 1000)); return s < 60 ? s + ' s ago' : UniqueState.ago(at); },
  updated() {
    const T = UniqueTracker;
    if (!T.on()) return 'The unique tracker is off: states come from the game\'s announcements and what the bot saw. Nothing is requested from the game site.';
    if (T.lastAt !== null) return 'Updated ' + this.ago(T.lastAt) + ' from the unique tracker, with the game\'s announcements and what the bot saw.';
    return T.failures ? 'The unique tracker could not be read; showing the game\'s announcements and what the bot saw.' : 'Reading the unique tracker…';
  },
  toggle(code, on) {
    const C = UniqueNests.cfg(), turnedOn = on && C.on !== true;
    if (turnedOn) { C.on = true; UniqueNests.load(); }
    UniqueNests.toggle(code, on);
    this.key = '';
    if (turnedOn) UI.toast('Patrol the game\'s unique nests is now on, because you ticked a unique to hunt.', 'info', 6000);
  },
  head() {
    const head = el('div', null, 'unique-head'), tick = el('span', 'Hunt', 'unique-tick'), name = el('span', 'Unique, lowest level first', 'unique-title'), side = el('span', 'State', 'unique-side');
    tick.title = UNIQUE_TICK_TIP;
    head.append(tick, name, side);
    return head;
  },
  card() {
    this.list = el('div', null, 'sx-rows'); this.header = el('p', '', 'muted'); this.refreshNote = el('p', '', 'muted');
    this.box = el('div', null, 'unique-map'); this.box.hidden = true; this.open = ''; this.key = '';
    this.refreshRow = UI.row(UI.button('Refresh', () => { this.refreshNote.textContent = UniqueTracker.refresh(); }));
    const trackerSwitch = UI.check('Check the game site\'s unique tracker (every 2 minutes while this page is open or the Unique hunt runs)', () => UniqueTracker.on(), v => { Settings.profile.uniqueState.tracker = v; this.refresh(); });
    const group = UI.group('Uniques', trackerSwitch, this.header, this.refreshRow, this.refreshNote, this.head(), this.list, this.box,
      el('p', UNIQUE_TICK_NOTE, 'muted'),
      el('p', 'Ticking a unique also turns on Patrol the game\'s unique nests (Combat, Unique hunt) when it is off; unticking never turns it off. Click a name for a small map of its nests.', 'muted'));
    UI.refreshers.push(() => this.refresh());
    this.refresh();
    return group;
  },
  refresh() {
    if (!this.list) return;
    if (this.visible()) { if (!UniqueNests.loaded && !UniqueNests.pending) UniqueNests.load(); UniqueTracker.onSetup(); }
    this.header.textContent = this.updated();
    this.refreshRow.hidden = !UniqueTracker.on();
    if (!UniqueTracker.on()) this.refreshNote.textContent = 'Refresh needs the unique tracker switch above.';
    else if (this.refreshNote.textContent === 'Refresh needs the unique tracker switch above.') this.refreshNote.textContent = '';
    const key = [UniqueNests.state(), UniqueNests.rev, UniqueNests.known().rev, UniqueState.rev, UniqueTracker.lastAt, (UniqueNests.cfg().picks || []).join(','), Math.floor(now() / 60000)].join('|');
    if (key !== this.key) { this.key = key; this.fill(); }
    if (this.open) this.paint();
  },
  fill() {
    if (!UniqueNests.loaded) return this.list.replaceChildren(el('p', UniqueNests.state() === 'failed' ? 'The game\'s unique list could not be loaded.' : 'Loading the unique list from the game…', 'muted'));
    const rows = this.rows();
    if (!rows.length) return this.list.replaceChildren(el('p', 'No unique is known yet.', 'muted'));
    this.list.replaceChildren(...rows.map(r => {
      const row = el('div', null, 'sx-row unique-row'), tick = el('input'), cell = el('span', null, 'unique-tick');
      tick.type = 'checkbox'; tick.checked = r.ticked; tick.setAttribute('aria-label', 'Hunt ' + r.name); tick.title = UNIQUE_TICK_TIP;
      tick.addEventListener('change', () => this.toggle(r.code, tick.checked));
      cell.append(tick);
      const name = UI.button('', () => this.show(r.code));
      name.setAttribute('aria-label', this.text(r));
      name.setAttribute('aria-expanded', String(this.open === r.code));
      name.append(el('span', r.name, 'unique-title'), ...(this.meta(r) ? [el('span', this.meta(r), 'unique-meta')] : []));
      const side = el('span', null, 'unique-side'), pill = el('span', r.pill, 'unique-pill ' + r.cls);
      pill.title = r.source ? r.pill + ' (' + r.source + ')' : r.pill;
      side.append(pill, el('span', this.nestText(r), 'unique-nests'));
      row.append(cell, name, side);
      return row;
    }));
  },
  show(code) {
    this.open = this.open === code ? '' : code;
    this.key = '';
    if (!this.open) { this.box.hidden = true; this.box.replaceChildren(); this.refresh(); return; }
    this.canvas = el('canvas'); this.canvas.width = UNIQUE_MAP_W; this.canvas.height = UNIQUE_MAP_H;
    this.canvas.style.cssText = 'display:block;width:' + UNIQUE_MAP_W + 'px;max-width:100%;height:' + UNIQUE_MAP_H + 'px;background:#0b0d0a';
    this.canvas.setAttribute('aria-label', 'Nests of ' + UniqueNests.name(code));
    this.mapInfo = el('p', '', 'muted');
    this.box.replaceChildren(el('strong', 'Nests of ' + UniqueNests.name(code)), this.canvas, this.mapInfo, UI.button('Close map', () => this.show(code)));
    this.box.hidden = false;
    this.refresh();
  },
  plan(code) {
    const all = UniqueNests.nestsOf(code), pose = World.inWorld() ? World.pose() : null, me = LeanMap.space(pose);
    const outdoor = all.map(p => LeanMap.space(p)).filter(Boolean), near = pose ? all.map(p => dist2D(pose, p)).filter(Number.isFinite) : [];
    return { code, name: UniqueNests.name(code), nests: all.length, outdoor, dungeon: all.length - outdoor.length, me, inDungeon: !!pose && !me,
      nearestM: near.length ? Math.round(Math.min(...near) / 10) : null };
  },
  planText(p) {
    if (!p.nests) return 'No nest of ' + p.name + ' in the game data.';
    if (!p.outdoor.length) return p.name + ' spawns only in a dungeon; there is no map for dungeons.' + (p.nearestM !== null ? ' Nearest nest: ' + p.nearestM + ' m.' : '');
    return p.outdoor.length + ' nest' + (p.outdoor.length === 1 ? '' : 's') + ' on the map' + (p.dungeon ? ', ' + p.dungeon + ' in a dungeon, not shown' : '') + '. ' +
      (p.nearestM !== null ? 'Nearest nest: ' + p.nearestM + ' m.' : p.inDungeon ? 'You are in a dungeon, so your position is not shown.' : p.me ? 'No nest can be reached from where you are.' : 'Your position is not known.');
  },
  view(p) {
    const xs = p.outdoor.map(s => s.X), zs = p.outdoor.map(s => s.Z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const need = Math.max((maxX - minX) / (UNIQUE_MAP_W - 40), (maxZ - minZ) / (UNIQUE_MAP_H - 40), 1.5);
    if (need <= UNIQUE_MAP_MAX_UPP) return { X: (minX + maxX) / 2, Z: (minZ + maxZ) / 2, upp: need, cut: false };
    const first = p.me ? p.outdoor.reduce((a, b) => Math.hypot(a.X - p.me.X, a.Z - p.me.Z) <= Math.hypot(b.X - p.me.X, b.Z - p.me.Z) ? a : b) : p.outdoor[0];
    return { X: first.X, Z: first.Z, upp: UNIQUE_MAP_MAX_UPP, cut: true };
  },
  paint() {
    const c = this.canvas, p = this.plan(this.open);
    if (!c?.isConnected) return;
    const v = p.outdoor.length ? this.view(p) : null;
    this.mapInfo.textContent = this.planText(p) + (v?.cut ? ' Some nests are outside this small map; the nearest are shown.' : '');
    const ctx = c.getContext?.('2d');
    if (!ctx) return;
    const w = UNIQUE_MAP_W, h = UNIQUE_MAP_H;
    ctx.fillStyle = '#0b0d0a'; ctx.fillRect(0, 0, w, h);
    if (!v) return LeanMap.note(ctx, w, h, p.nests ? 'There is no map for dungeons.' : 'No nest in the game data.');
    const sx = X => w / 2 + (X - v.X) / v.upp, sy = Z => h / 2 - (Z - v.Z) / v.upp;
    const x0 = v.X - w / 2 * v.upp, x1 = v.X + w / 2 * v.upp, z0 = v.Z - h / 2 * v.upp, z1 = v.Z + h / 2 * v.upp;
    for (let rx = Math.max(0, Math.floor(x0 / SECTOR)); rx <= Math.min(255, Math.floor(x1 / SECTOR)); rx++)
      for (let rz = Math.max(0, Math.floor(z0 / SECTOR)); rz <= Math.min(127, Math.floor(z1 / SECTOR)); rz++) {
        const img = LeanMap.image(LeanMap.tiles, `${MAP_ART}minimap/${rx}x${rz}`);
        if (!img) continue;
        const l = Math.floor(sx(rx * SECTOR)), t = Math.floor(sy((rz + 1) * SECTOR));
        ctx.drawImage(img, l, t, Math.ceil(sx((rx + 1) * SECTOR)) - l, Math.ceil(sy(rz * SECTOR)) - t);
      }
    ctx.strokeStyle = MAP_CLASS_COLOR.unique; ctx.lineWidth = 2;
    for (const s of p.outdoor) { ctx.beginPath(); ctx.arc(sx(s.X), sy(s.Z), 6, 0, Math.PI * 2); ctx.stroke(); }
    if (p.me) {
      const mx = clamp(sx(p.me.X), 6, w - 6), my = clamp(sy(p.me.Z), 6, h - 6);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const metres = [10, 20, 50, 100, 200, 500, 1000].find(m => m * 10 / v.upp >= 50) || 1000, bar = metres * 10 / v.upp;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(w - bar - 18, h - 22, bar + 12, 16);
    ctx.fillStyle = '#efdaa4'; ctx.fillRect(w - bar - 12, h - 12, bar, 2); LeanMap.label(ctx, metres + ' m', w - bar - 12, h - 15, '#efdaa4');
  },
};
