const UNIQUE_TRACKER_PATH = '/uniques', UNIQUE_TRACKER_EVERY_MS = 120000, UNIQUE_TRACKER_TIMEOUT_MS = 15000, UNIQUE_TRACKER_BACKOFF_MAX_MS = 1800000;
const UNIQUE_TRACKER_REFRESH_MS = 30000, UNIQUE_TRACKER_SHOWN_MS = 1500;
const UniqueTracker = {
  busy: false, nextAt: 0, failures: 0, said: new Set(), lastAt: null, lastText: '', askedAt: -Infinity, setupAt: -Infinity, info: new Map(),
  on() { return Settings.profile.uniqueState?.tracker === true; },
  wanted() { return this.on() && (!!UniqueHunt.active || now() - this.setupAt < UNIQUE_TRACKER_SHOWN_MS); },
  start() {
    this.said = new Set();
    if (now() - this.askedAt >= UNIQUE_TRACKER_EVERY_MS) { this.nextAt = 0; this.failures = 0; }
  },
  onSetup() { this.setupAt = now(); this.tick(); },
  tick() {
    if (!this.wanted() || this.busy || now() < this.nextAt) return;
    this.busy = true;
    setTimeout(() => { if (this.wanted()) this.read(); else this.busy = false; }, 0);
  },
  refresh() {
    if (!this.on()) return 'The unique tracker is off (Combat, Unique hunt).';
    if (this.busy) return 'Reading the unique tracker…';
    const wait = this.askedAt + UNIQUE_TRACKER_REFRESH_MS - now();
    if (wait > 0) return 'Asked moments ago; try again in ' + Math.ceil(wait / 1000) + ' s.';
    this.setupAt = now(); this.nextAt = 0; this.tick();
    return 'Reading the unique tracker…';
  },
  say(key, text, warn = false) {
    if (this.said.has(key)) return;
    this.said.add(key);
    (warn ? Log.warn : Log.info).call(Log, 'Unique tracker: ' + text);
  },
  async read() {
    this.askedAt = now();
    const startedAt = now(), controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), UNIQUE_TRACKER_TIMEOUT_MS);
    try {
      if (typeof W.fetch !== 'function') throw new Error('this browser cannot fetch');
      const response = await W.fetch(UNIQUE_TRACKER_PATH, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller?.signal });
      if (!response?.ok) throw new Error('HTTP ' + (response?.status ?? 'error'));
      const html = await response.text();
      const rows = this.parse(html);
      if (!rows) {
        this.say('structure', 'the page did not look as expected, so it is ignored; the game\'s announcements are still used.', true);
        this.failed();
        return;
      }
      if (!SpawnData.loaded) await SpawnData.load();
      this.apply(rows, startedAt);
      this.failures = 0; this.nextAt = now() + UNIQUE_TRACKER_EVERY_MS;
    } catch (e) {
      this.say('fetch', 'the game site\'s unique list could not be read (' + String(e?.message || e).slice(0, 80) + '); the game\'s announcements are still used.', true);
      this.failed();
    } finally {
      clearTimeout(timer);
      this.busy = false;
    }
  },
  failed() {
    this.failures++;
    this.nextAt = now() + Math.min(UNIQUE_TRACKER_BACKOFF_MAX_MS, UNIQUE_TRACKER_EVERY_MS * 2 ** this.failures);
  },
  parse(html) {
    if (typeof W.DOMParser !== 'function') return null;
    const doc = new W.DOMParser().parseFromString(String(html || ''), 'text/html'), rows = [];
    for (const li of doc.querySelectorAll('li[data-state]')) {
      const m = /^\/monsters\/(\d{1,9})$/.exec(li.querySelector('a[href^="/monsters/"]')?.getAttribute('href') || '');
      if (!m) continue;
      const state = String(li.getAttribute('data-state') || '').trim().toLowerCase().slice(0, 20);
      const known = state === 'alive' || state === 'slain';
      const label = known ? '' : String(li.querySelector('[data-state]')?.textContent || state).trim().replace(/\s+/g, ' ').slice(0, 20);
      const line = li.querySelector('p'), level = Number(/Lv\s*(\d{1,3})\b/.exec(line?.textContent || '')?.[1]) || 0;
      const map = String(line?.querySelector('span')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      rows.push({ ref: Number(m[1]), state, label, level, map: /^slain by/i.test(map) ? '' : map });
    }
    return rows.length ? rows : null;
  },
  apply(rows, at) {
    const counts = { alive: 0, slain: 0, unknown: 0 }, labels = new Set();
    let unmatched = 0;
    const info = new Map();
    for (const r of rows) {
      const code = UniqueNests.canon(SpawnData.code(r.ref));
      if (code) info.set(code, { level: r.level, map: r.map, state: r.state, label: r.label });
      if (code && r.level) UniqueState.noteLevel(code, r.level);
      if (r.state !== 'alive' && r.state !== 'slain') { counts.unknown++; labels.add(r.label || r.state || 'none'); continue; }
      if (!code) { unmatched++; continue; }
      counts[r.state]++;
      const state = r.state === 'alive' ? 'alive' : 'dead';
      if (UniqueState.note([code], state, 'tracker', at) && this.lastAt !== null) Log.info('Unique tracker: ' + UniqueState.nameOf(code) + (state === 'alive' ? ' is alive.' : ' is slain.'));
    }
    this.lastAt = now(); this.info = info;
    this.lastText = counts.alive + ' alive, ' + counts.slain + ' slain' + (counts.unknown ? ', ' + counts.unknown + ' unknown' : '');
    this.say('read', 'read ' + rows.length + ' uniques: ' + this.lastText + '.');
    if (labels.size) this.say('labels:' + [...labels].sort().join('|'), 'states other than alive or slain are read as unknown: ' + [...labels].sort().join(', ') + '.');
    if (unmatched) this.say('unmatched', unmatched + ' unique' + (unmatched === 1 ? '' : 's') + ' not in the game data were left out.');
  },
  status() {
    if (!this.on()) return 'Off.';
    if (this.lastAt === null) return this.failures ? 'Could not be read; trying again later.' : 'Not read yet; it is read while the unique hunt runs or the Setup page is shown.';
    return 'Last read ' + UniqueState.ago(this.lastAt) + ': ' + this.lastText + '.';
  },
};
