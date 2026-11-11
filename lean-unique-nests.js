const UNIQUE_NEST_SAME = 400, UNIQUE_NEST_MAX = 40, UNIQUE_NEST_RETRY_MS = 600000, UNIQUE_KNOWN_KEY = 'unique:known', UNIQUE_KNOWN_MAX = 100;
const UNIQUE_SYMBOL_CODES = { TIGER_GIRL: 'MOB_CH_TIGERWOMAN', IYUTARU: 'MOB_KK_ISYUTARU', URRUCHI: 'MOB_OA_URUCHI', BONELORD: 'MOB_TK_BONELORD', TAHOMET: 'MOB_RM_TAHOMET' };
const UNIQUE_SYMBOL_REFS = { TIGER_GIRL: 1954, IYUTARU: 2002, URRUCHI: 1982, BONELORD: 3810, TAHOMET: 3875 };
const UNIQUE_TABLE = Object.freeze({ 1954: 20, 5871: 24, 14778: 30, 1982: 40, 2002: 60, 3810: 80, 3875: 90, 14833: 98, 14834: 98, 14835: 99, 14836: 99, 14839: 100, 14838: 100 });
const UNIQUE_EXTRA_NESTS = Object.freeze({ 3810: Object.freeze([Object.freeze({ regionId: 26247, x: 84, y: -40, z: 1004 })]) });
const UNIQUE_NO_NESTS = Object.freeze([]);
const UniqueNests = {
  pending: null, loaded: false, failed: false, failedAt: 0, rev: 0, names: new Map(), byName: new Map(), grouped: new Map(), cache: null, memo: null,
  cfg() { return Settings.profile.uniqueNests; },
  on() { return this.cfg()?.on === true; },
  maxDistance() { return clamp(Number(this.cfg().maxM) || 1000, 100, 5000) * 10; },
  load() {
    if (this.loaded || this.pending) return this.pending;
    if (this.failed && now() - this.failedAt < UNIQUE_NEST_RETRY_MS) return null;
    this.failed = false;
    this.pending = Promise.all([SpawnData.load(), Assets.texts()]).then(([, texts]) => {
      this.index(texts);
      this.loaded = true; this.pending = null;
      this.migrate();
      UniqueHunt.nestsReady();
    }).catch(e => {
      this.pending = null; this.failed = true; this.failedAt = now();
      Log.warn('Unique hunt: the game\'s unique nests could not be loaded (' + String(e?.message || e).slice(0, 120) + '); patrolling your spots and learned spots only.');
    });
    return this.pending;
  },
  index(texts) {
    const names = new Map(), byName = new Map();
    for (const info of SpawnData.codes.values()) {
      const code = info.code;
      if (names.has(code) || !SpawnData.isMonster(info)) continue;
      const name = String(texts?.['SN_' + code] || '').trim() || code;
      names.set(code, name);
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(code);
    }
    this.names = names; this.byName = byName; this.grouped.clear(); this.cache = null; this.rev++;
  },
  name(code) { return this.names.get(code) || code; },
  known() {
    if (!this.memo) {
      const saved = Store.get(UNIQUE_KNOWN_KEY, null), list = v => Array.isArray(v) ? v : [];
      this.memo = { refs: list(saved?.refs).filter(Number.isInteger).slice(0, UNIQUE_KNOWN_MAX),
        names: list(saved?.names).filter(n => typeof n === 'string' && n.trim()).map(n => n.trim().slice(0, 40)).slice(0, UNIQUE_KNOWN_MAX), rev: 0 };
    }
    return this.memo;
  },
  remember(kind, value) {
    const m = this.known(), list = m[kind];
    if (list.some(v => kind === 'names' ? v.toLowerCase() === value.toLowerCase() : v === value)) return false;
    list.unshift(value);
    if (list.length > UNIQUE_KNOWN_MAX) list.length = UNIQUE_KNOWN_MAX;
    m.rev++; this.cache = null;
    Store.set(UNIQUE_KNOWN_KEY, { refs: m.refs, names: m.names });
    return true;
  },
  seenRef(e) { if (Number.isInteger(e?.refObjId) && e.refObjId > 0) this.remember('refs', e.refObjId); },
  announced(name) { const n = String(name || '').trim().slice(0, 40); if (n) this.remember('names', n); },
  codesByName(name) { return this.byName.get(String(name || '').trim().toLowerCase()) || []; },
  refsOf(code) { return SpawnData.refsByCode.get(code) || []; },
  tableRefs(code) { return this.refsOf(code).filter(ref => ref in UNIQUE_TABLE); },
  knownLevel(code) {
    const ref = this.tableRefs(code)[0] ?? Object.entries(UNIQUE_SYMBOL_CODES).map(([symbol, c]) => c === code ? UNIQUE_SYMBOL_REFS[symbol] : 0).find(Boolean);
    return UNIQUE_TABLE[ref] || 0;
  },
  symbolCode(symbol) { return UNIQUE_SYMBOL_REFS[symbol] ? SpawnData.code(UNIQUE_SYMBOL_REFS[symbol]) || UNIQUE_SYMBOL_CODES[symbol] : ''; },
  pick(codes) {
    const first = code => Math.min(...this.refsOf(code), Infinity), seen = new Set(this.known().refs);
    const sorted = [...codes].sort((a, b) => first(a) - first(b));
    return sorted.find(code => this.tableRefs(code).length) || sorted.find(code => this.refsOf(code).some(ref => seen.has(ref))) || sorted[0];
  },
  resolveName(name) {
    const codes = this.codesByName(name);
    return codes.length ? [this.pick(codes)] : [];
  },
  canon(code) {
    if (!this.loaded || !code) return code;
    const symbol = Object.keys(UNIQUE_SYMBOL_CODES).find(s => UNIQUE_SYMBOL_CODES[s] === code);
    if (symbol && SpawnData.code(UNIQUE_SYMBOL_REFS[symbol])) return this.symbolCode(symbol);
    const codes = this.codesByName(this.names.get(code));
    return codes.length > 1 ? this.pick(codes) : code;
  },
  identity(symbol, name) {
    const symbolic = this.symbolCode(symbol);
    return symbolic ? [symbolic] : this.resolveName(name);
  },
  migrate() {
    const C = this.cfg(), picks = [...new Set((C.picks || []).map(code => this.canon(code)))];
    if (picks.join() !== (C.picks || []).join()) { C.picks = picks; Settings.saveProfile(); }
    UniqueState.migrate(code => this.canon(code));
  },
  uniques() {
    const out = new Map(), add = (code, source) => {
      if (!code || !this.names.has(code)) return;
      if (!out.has(code)) out.set(code, { code, name: this.name(code), sources: [] });
      if (!out.get(code).sources.includes(source)) out.get(code).sources.push(source);
    };
    if (!this.loaded) return [];
    for (const symbol of Object.keys(UNIQUE_SYMBOL_CODES)) add(this.symbolCode(symbol), 'announced');
    for (const ref of Object.keys(UNIQUE_TABLE)) add(SpawnData.code(ref), 'built-in');
    const m = this.known();
    for (const name of m.names) for (const code of this.resolveName(name)) add(code, 'notice');
    for (const ref of m.refs) add(this.canon(SpawnData.code(ref)), 'seen');
    return [...out.values()].map(u => ({ ...u, nests: this.nestsOf(u.code).length })).sort((a, b) => a.name.localeCompare(b.name));
  },
  chosen() {
    const picks = this.cfg().picks || [];
    return picks.length ? [...new Set(picks.map(c => this.canon(c)).filter(c => this.names.has(c)))] : this.uniques().map(u => u.code);
  },
  toggle(code, on) {
    const C = this.cfg(), picks = new Set((C.picks || []).map(c => this.canon(c)));
    if (on) picks.add(this.canon(code)); else picks.delete(this.canon(code));
    C.picks = [...picks]; Settings.saveProfile();
  },
  nestsOf(code) {
    if (this.grouped.has(code)) return this.grouped.get(code);
    const groups = [], refs = this.tableRefs(code);
    const extra = this.refsOf(code).flatMap(ref => UNIQUE_EXTRA_NESTS[ref] || []);
    for (const p of [...SpawnData.points(code, refs.length ? refs : null), ...extra]) if (!groups.some(g => dist2D(g, p) <= UNIQUE_NEST_SAME)) groups.push(p);
    this.grouped.set(code, groups);
    return groups;
  },
  spots(origin, taken = []) {
    if (!this.on() || !this.loaded || !origin) return UNIQUE_NO_NESTS;
    const C = this.cfg(), key = [this.rev, this.known().rev, (C.picks || []).join(','), C.maxM, origin.regionId, Math.round(origin.x), Math.round(origin.z),
      taken.map(s => s.regionId + ':' + Math.round(s.x) + ':' + Math.round(s.z)).join(',')].join('|');
    if (this.cache?.key === key) return this.cache.list;
    const max = this.maxDistance(), found = [];
    for (const code of this.chosen()) {
      for (const p of this.nestsOf(code)) {
        const d = dist2D(origin, p);
        if (!Number.isFinite(d) || d > max || taken.some(s => dist2D(s, p) <= UNIQUE_NEST_SAME)) continue;
        const near = found.find(s => dist2D(s, p) <= UNIQUE_NEST_SAME);
        if (near) { if (!near.codes.includes(code)) near.codes.push(code); continue; }
        found.push({ regionId: p.regionId, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), nest: true, code, codes: [code] });
      }
    }
    const list = [];
    let here = origin;
    while (found.length && list.length < UNIQUE_NEST_MAX) {
      let best = 0;
      for (let i = 1; i < found.length; i++) if (dist2D(here, found[i]) < dist2D(here, found[best])) best = i;
      here = found.splice(best, 1)[0];
      list.push(here);
    }
    const counts = new Map();
    for (const s of list) counts.set(s.code, (counts.get(s.code) || 0) + 1);
    const seen = new Map();
    for (const s of list) {
      const n = (seen.get(s.code) || 0) + 1;
      seen.set(s.code, n);
      s.name = this.name(s.code) + ' nest ' + n + ' of ' + counts.get(s.code);
    }
    this.cache = { key, list };
    return list;
  },
  label(u) {
    const state = UniqueState.label(u.code);
    return u.name + ' · ' + (u.nests ? u.nests + ' nest' + (u.nests === 1 ? '' : 's') : 'no nest in the game data') + (state ? ' · ' + state : '');
  },
  state() {
    if (this.loaded) return 'loaded';
    if (this.pending) return 'loading';
    return this.failed ? 'failed' : 'idle';
  },
  draw(host) {
    const C = () => this.cfg(), picker = el('div', null, 'sx-rows');
    let drawn = '';
    const fill = () => {
      const sig = this.state() + ':' + this.rev + ':' + this.known().rev + ':' + C().on + ':' + UniqueState.rev + ':' + Math.floor(now() / 60000);
      if (sig === drawn) return;
      drawn = sig;
      if (!C().on) return picker.replaceChildren();
      if (!this.loaded) {
        this.load();
        return picker.replaceChildren(el('p', this.state() === 'failed' ? 'The game\'s unique list could not be loaded. Your spots and learned spots are still patrolled.' : 'Loading the unique list from the game…', 'muted'));
      }
      const list = this.uniques(), picks = new Set(C().picks || []);
      if (!list.length) return picker.replaceChildren(el('p', 'No unique is known yet.', 'muted'));
      picker.replaceChildren(...list.map(u => {
        const input = el('input'); input.type = 'checkbox'; input.checked = picks.has(u.code);
        input.addEventListener('change', () => this.toggle(u.code, input.checked));
        return UI.field(this.label(u), input);
      }), el('p', 'None ticked: every unique in the list.', 'muted'));
    };
    fill();
    UI.refreshers.push(fill);
    host.append(UI.group('Unique nests',
      UI.check('Patrol the game\'s unique nests', () => C().on, v => { C().on = v; if (v) this.load(); fill(); }),
      el('p', 'Reads where each unique spawns from the game\'s own data. Your spots come first, then the chosen nests nearest to where you start, then learned spots.', 'muted'),
      UI.number('Furthest nest from the start point (m)', () => C().maxM, v => { C().maxM = v; }, 100, 5000, 100),
      picker));
  },
};
