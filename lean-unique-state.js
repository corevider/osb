const UNIQUE_STATE_KEY = 'unique:state', UNIQUE_STATE_MAX = 100, UNIQUE_STATE_FRESH_MS = 60000, UNIQUE_STATE_TRUST_M = 30;
const UNIQUE_LEVELS_KEY = 'unique:levels', UNIQUE_LEVELS_MAX = 200;
const UNIQUE_STATE_SOURCES = ['notice', 'seen', 'kill', 'tracker'];
const UNIQUE_CODE_NAMES = Object.fromEntries(Object.entries(UNIQUE_SYMBOL_CODES).map(([symbol, code]) => [code, UNIQUE_NOTICE_NAMES[symbol]]));
const UniqueState = {
  memo: null, levels: null, rev: 0,
  cfg() { return Settings.profile.uniqueState; },
  trustMs() { return clamp(Number(this.cfg()?.deadTrustM) || UNIQUE_STATE_TRUST_M, 5, 240) * 60000; },
  validKey(key) { return /^[A-Za-z0-9_]{1,64}$/.test(key) || /^name:\S.{0,39}$/.test(key); },
  entries() {
    if (this.memo) return this.memo;
    const saved = Store.get(UNIQUE_STATE_KEY, null), list = new Map(), wall = Date.now(), t = now();
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [key, v] of Object.entries(saved).slice(0, UNIQUE_STATE_MAX)) {
        if (!this.validKey(key) || !['alive', 'dead'].includes(v?.state) || !UNIQUE_STATE_SOURCES.includes(v.source) || !Number.isFinite(v.at)) continue;
        const at = t - Math.max(0, wall - v.at), checked = Number.isFinite(v.checked) ? t - Math.max(0, wall - v.checked) : at;
        list.set(key, { state: v.state, at, checked: Math.max(at, checked), source: v.source });
      }
    }
    return this.memo = list;
  },
  save() {
    const wall = Date.now(), t = now(), out = {}, wallOf = ms => Math.round(wall - (t - ms));
    for (const [key, v] of [...this.entries()].sort((a, b) => b[1].checked - a[1].checked).slice(0, UNIQUE_STATE_MAX)) {
      out[key] = { state: v.state, at: wallOf(v.at), checked: wallOf(v.checked), source: v.source };
    }
    Store.set(UNIQUE_STATE_KEY, out);
  },
  levelMap() {
    if (this.levels) return this.levels;
    const saved = Store.get(UNIQUE_LEVELS_KEY, null), map = new Map();
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [code, level] of Object.entries(saved).slice(0, UNIQUE_LEVELS_MAX)) if (/^[A-Za-z0-9_]{1,64}$/.test(code) && Number.isInteger(level) && level >= 1 && level <= 255) map.set(code, level);
    }
    return this.levels = map;
  },
  levelOf(code) { return this.levelMap().get(code) || 0; },
  noteLevel(code, level) {
    const value = Math.round(Number(level));
    if (!/^[A-Za-z0-9_]{1,64}$/.test(code || '') || !(value >= 1 && value <= 255) || this.levelOf(code) === value) return false;
    const map = this.levelMap();
    map.set(code, value);
    while (map.size > UNIQUE_LEVELS_MAX) map.delete(map.keys().next().value);
    Store.set(UNIQUE_LEVELS_KEY, Object.fromEntries(map));
    this.rev++;
    return true;
  },
  expired(v) { return v.state === 'dead' && now() - v.checked > this.trustMs(); },
  apply(key, state, source, at) {
    const list = this.entries(), old = list.get(key), stale = !old || this.expired(old);
    if (!stale && old.state === state) {
      if (source === 'tracker' || state === 'alive' || at - old.at < UNIQUE_STATE_FRESH_MS) { old.checked = Math.max(old.checked, at); return false; }
    } else if (!stale && (at < old.checked || source === 'tracker' && old.source !== 'tracker' && at - old.checked < UNIQUE_STATE_FRESH_MS)) return false;
    list.set(key, { state, at, checked: at, source });
    return true;
  },
  note(keys, state, source, at = now()) {
    let changed = false;
    for (const key of new Set(keys)) if (this.validKey(key) && this.apply(key, state, source, at)) changed = true;
    while (this.entries().size > UNIQUE_STATE_MAX) this.entries().delete([...this.entries()].sort((a, b) => a[1].checked - b[1].checked)[0][0]);
    this.rev++;
    this.save();
    return changed;
  },
  nameKey(name) { const n = String(name || '').trim().slice(0, 40); return n ? 'name:' + n : ''; },
  keysOf(codes, name) {
    const keys = (codes || []).filter(Boolean);
    return keys.length ? keys : [this.nameKey(name)].filter(Boolean);
  },
  entityCodes(e) {
    const code = SpawnData.code(e?.refObjId);
    return code ? [UniqueNests.canon(code)] : UniqueNests.resolveName(e?.name);
  },
  noteEntity(e, state, source) {
    if (!e) return;
    const own = SpawnData.code(e.refObjId);
    if (own && UniqueNests.canon(own) !== own) return;
    const codes = this.entityCodes(e);
    if (codes.length === 1) this.noteLevel(codes[0], e.level);
    this.note(this.keysOf(codes, e.name), state, source);
  },
  noteNotice(symbol, name, state) { this.note(this.keysOf(UniqueNests.identity(symbol, name), name), state, 'notice'); },
  nameOf(key) { return key.startsWith('name:') ? key.slice(5) : UniqueNests.names.get(key) || UNIQUE_CODE_NAMES[key] || key; },
  live(key) { const v = this.entries().get(key); return v && !this.expired(v) ? v : null; },
  newest(keys) {
    let best = null;
    for (const key of keys) { const v = this.live(key); if (v && (!best || v.at > best.at)) best = { ...v, key }; }
    return best;
  },
  ofCode(code) { return this.newest([code, this.nameKey(this.nameOf(code))]); },
  ofName(name) {
    if (!String(name || '').trim()) return null;
    return this.newest([...this.entries().keys()].filter(key => UniqueHunt.same(this.nameOf(key), name)));
  },
  spotDead(s) {
    if (!s) return null;
    if (s.codes?.length) {
      const states = s.codes.map(c => this.ofCode(c));
      return states.every(v => v?.state === 'dead') ? states.sort((a, b) => b.at - a.at)[0] : null;
    }
    const v = this.ofName(s.name);
    return v?.state === 'dead' ? v : null;
  },
  ago(at) {
    const m = Math.floor(Math.max(0, now() - at) / 60000);
    if (m < 1) return 'less than a minute ago';
    return m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago';
  },
  label(code) {
    const v = this.ofCode(code);
    if (!v) return '';
    if (v.state === 'alive') return 'alive';
    return v.source === 'tracker' ? 'slain on the unique tracker (first seen ' + this.ago(v.at) + ')' : 'killed ' + this.ago(v.at);
  },
  deadText(list) {
    const seen = new Set(), parts = [];
    for (const v of list.sort((a, b) => b.at - a.at)) {
      const name = this.nameOf(v.key);
      if (seen.has(name)) continue;
      seen.add(name);
      parts.push(v.source === 'tracker' ? name + ' is slain on the unique tracker (first seen ' + this.ago(v.at) + ')' : name + ' was killed ' + this.ago(v.at));
    }
    return parts.join('; ');
  },
  migrate(canon) {
    const list = this.entries(), levels = this.levelMap();
    let moved = false, leveled = false;
    for (const [key, v] of [...list]) {
      const to = key.startsWith('name:') ? key : canon(key);
      if (to === key) continue;
      list.delete(key); moved = true;
      if (!list.get(to) || v.checked > list.get(to).checked) list.set(to, v);
    }
    for (const [code, level] of [...levels]) {
      const to = canon(code);
      if (to === code) continue;
      levels.delete(code); leveled = true;
      if (!levels.has(to)) levels.set(to, level);
    }
    if (leveled) Store.set(UNIQUE_LEVELS_KEY, Object.fromEntries(levels));
    if (moved || leveled) this.rev++;
    if (moved) this.save();
  },
  clear() { this.memo = new Map(); this.rev++; this.save(); },
};
