// Opt-in usage statistics and report delivery to api.osb.lol (protocol: docs/telemetry.md).
// Nothing here runs in Controller.tick or the 100 ms Ticker. A setTimeout chain wakes it, the payload is copied when the
// browser is idle, and every request is one at a time, uncredentialed, unredirected and aborted after 15 s.
const CONSENT_VERSION = 2;
const CONSENT_TEXT_VERSION = '2026-11-12.1';
const PRIVACY_URL = 'https://osb.lol/en/privacy/';
const KVKK_NOTICE_URL = 'https://osb.lol/kvkk/aydinlatma-metni/';
const KVKK_CONSENT_URL = 'https://osb.lol/kvkk/acik-riza-metni/';
const PRIVACY_CONTACT = 'privacy@osb.lol';
const LONG_MAX = 9223372036854775807n;
const Telemetry = {
  base: 'https://api.osb.lol/v1',
  timing: { startDelayMs: [60000, 180000], timeoutMs: 15000, minWaitMs: 60000, backoffBaseMs: 60000, backoffCapMs: 6 * 3600000, retryAfterMaxMs: 86400000,
    configEveryMs: 6 * 3600000, configStaleMs: 24 * 3600000, pauseMs: 24 * 3600000, resendMs: 3600000, disabledRecheckMs: 3600000,
    minIntervalS: 300, maxIntervalS: 86400, defaultIntervalS: 600, cutBytes: 60 * 1024,
    diagnostics: { minIntervalS: 600, maxIntervalS: 86400, defaultIntervalS: 600, minPerfIntervalS: 1800, maxPerfIntervalS: 86400, defaultPerfIntervalS: 1800 } },
  data: null, knownId: '', timer: 0, inFlight: false, lane: Promise.resolve(), gen: 0, failures: 0, errors: 0, off: false, halted: false,
  pausedUntil: 0, waitingForConfig: false, configDueAt: 0, configRetryAt: 0, reregistered: false, nextAfterS: 0,
  slots: new Map(), sessions: new Map(), sentSignature: '', sentSession: '', pendingDelete: null, view: null, usageDueAt: 0, current: null, changedNow: false,
  now() { return Date.now(); },
  random() { return Math.random(); },
  blank() { return { usage: 0, usageAt: 0, usageText: '', characters: false, charactersAt: 0, id: '', key: '', registered: false, attempted: false, synced: false, syncedUsage: 0, changedSeen: false, config: null, sentAt: 0, result: '' }; },
  load() {
    const saved = Store.get('telemetry', null), s = saved && typeof saved === 'object' ? saved : {}, d = this.blank();
    d.usage = Number.isInteger(s.usage) && s.usage > 0 ? s.usage : 0;
    d.id = typeof s.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.id) ? s.id : '';
    d.key = typeof s.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s.key) ? s.key : '';
    if (!d.id || !d.key) { d.id = ''; d.key = ''; d.usage = 0; }
    d.usageAt = d.usage > 0 && Number.isFinite(s.usageAt) ? s.usageAt : 0;
    d.usageText = d.usage > 0 && typeof s.usageText === 'string' ? s.usageText.slice(0, 32) : '';
    d.characters = d.usage >= CONSENT_VERSION && s.characters === true;
    d.charactersAt = d.characters && Number.isFinite(s.charactersAt) ? s.charactersAt : 0;
    d.registered = d.usage > 0 && s.registered === true;
    d.attempted = d.usage > 0 && s.attempted === true;
    d.synced = d.registered && s.synced === true;
    d.syncedUsage = d.registered ? Number.isInteger(s.syncedUsage) && s.syncedUsage > 0 ? s.syncedUsage : 1 : 0;
    d.changedSeen = d.usage > 0 && s.changedSeen === true;
    d.sentAt = Number.isFinite(s.sentAt) ? s.sentAt : 0;
    d.result = ['ok', 'unreachable', 'rejected', 'paused', 'disabled'].includes(s.result) ? s.result : '';
    d.config = this.storedConfig(s.config);
    this.knownId = d.id;
    this.data = d;
    Diag.sync();
    return d;
  },
  storedConfig(c) {
    const v = c?.value, t = this.timing;
    if (!c || !Number.isFinite(c.at) || !v?.telemetry || typeof v.telemetry.enabled !== 'boolean' || !Number.isFinite(v.telemetry.interval_s) || !v.reports || typeof v.reports.enabled !== 'boolean' || typeof v.reports.screenshots !== 'boolean') return null;
    return { at: c.at, value: { telemetry: { enabled: v.telemetry.enabled, interval_s: clamp(Math.round(v.telemetry.interval_s), t.minIntervalS, t.maxIntervalS) },
      reports: { enabled: v.reports.enabled, screenshots: v.reports.screenshots }, diagnostics: this.diagnosticsBlock(v.diagnostics, v.client_ok === true),
      client_ok: v.client_ok === true, message: typeof v.message === 'string' ? v.message.slice(0, 200) : null } };
  },
  get() { return this.data || this.load(); },
  write() {
    const d = this.get();
    this.knownId = d.id;
    if (!d.id && !d.usage && !d.config) { Store.remove('telemetry'); return; }
    Store.set('telemetry', d.usage ? d : { ...this.blank(), config: d.config });
  },
  // Another tab may have withdrawn consent: never write an identity back that is gone from storage.
  persist() {
    const stored = Store.get('telemetry', null);
    if ((stored?.id || '') !== this.knownId) { this.gen++; this.cancel(); this.load(); return false; }
    this.write();
    return true;
  },
  hosted() { return !!W.chrome?.webview; },
  supported() { return !!(W.crypto?.subtle && W.crypto.getRandomValues && W.fetch); },
  consented() { return this.get().usage >= CONSENT_VERSION; },
  outdated() { const usage = this.get().usage; return usage > 0 && usage < CONSENT_VERSION; },
  diagnosticsConfig() { const value = this.configUsable(); return value?.diagnostics?.enabled ? value.diagnostics : null; },
  active() { return this.consented() && !this.hosted() && !this.off && !this.halted && this.supported(); },
  os() {
    const platform = String(W.navigator?.userAgentData?.platform || W.navigator?.platform || '').toLowerCase();
    return /win/.test(platform) ? 'windows' : /mac|iphone|ipad/.test(platform) ? 'macos' : /linux|x11|android|cros/.test(platform) ? 'linux' : 'other';
  },
  locale() {
    const tag = String(W.navigator?.language || 'en').split('-')[0].toLowerCase();
    return /^[a-z]{2,3}$/.test(tag) ? tag : 'en';
  },
  bytes(n) { const out = new Uint8Array(n); W.crypto.getRandomValues(out); return out; },
  hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); },
  base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  fromBase64url(text) { return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); },
  uuid() {
    const b = this.bytes(16); b[6] = b[6] & 0x0f | 0x40; b[8] = b[8] & 0x3f | 0x80;
    const h = this.hex(b);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },
  newIdentity() {
    const d = this.get();
    d.id = this.uuid(); d.key = this.base64url(this.bytes(32));
    d.registered = false; d.attempted = false; d.synced = false; d.syncedUsage = 0;
    this.slots.clear();
  },
  resetRun() {
    this.failures = 0; this.halted = false; this.pausedUntil = 0; this.waitingForConfig = false; this.configDueAt = 0; this.configRetryAt = 0;
    this.reregistered = false; this.nextAfterS = 0; this.sentSignature = ''; this.sentSession = ''; this.sessions.clear(); this.slots.clear(); this.usageDueAt = 0;
  },
  // ---- Fail-safe: a bug here is counted, three of them switch the module off for this page, and the bot never notices.
  fault() {
    this.errors++;
    if (this.errors < 3 || this.off) return;
    this.off = true; this.cancel();
    Diag.silently(() => Log.warn('Usage statistics stopped for this page after repeated errors. Reload the game to try again.'));
  },
  guard(fn, fallback) { try { return fn(); } catch { this.fault(); return fallback; } },
  async guardAsync(fn, fallback) { try { return await fn(); } catch { this.fault(); return fallback; } },
  // ---- Consent
  start() {
    this.guard(() => {
      this.load();
      if (!this.active()) return;
      this.schedule(this.startDelay());
    });
  },
  startDelay() { const [low, high] = this.timing.startDelayMs; return low + this.random() * (high - low); },
  setUsage(on) {
    return on ? this.guard(() => this.enable(), false) : this.guardAsync(() => this.deleteData(), false);
  },
  enable() {
    if (!this.supported() || this.hosted() || this.consented()) return false;
    const d = this.get(), reuse = this.outdated() && !!d.id && !!d.key;
    this.gen++; this.cancel(); this.abortBackground(); this.resetRun(); Diag.reset();
    d.usage = CONSENT_VERSION; d.usageAt = this.now(); d.usageText = CONSENT_TEXT_VERSION; d.characters = false; d.charactersAt = 0; d.sentAt = 0; d.result = ''; this.pendingDelete = null;
    if (reuse) this.slots.clear(); else this.newIdentity();
    this.write(); Diag.sync();
    this.schedule(this.startDelay());
    return true;
  },
  setCharacters(on) {
    return this.guard(() => {
      const d = this.get();
      if (!this.consented() || d.characters === !!on) return false;
      d.characters = !!on; d.charactersAt = on ? this.now() : 0; this.write();
      void this.guardAsync(() => this.syncConsent(this.gen));
      return true;
    }, false);
  },
  credential() { const d = this.get(); return !this.hosted() && d.id && d.key ? `Bearer osb1.${d.id}.${d.key}` : ''; },
  auth() { return this.consented() && this.get().registered ? this.credential() : ''; },
  abortBackground() { this.current?.abort(); },
  // ---- Network: one request at a time, never throws.
  request(options) {
    const run = () => this.send(options);
    const next = this.lane.then(run, run);
    this.lane = next.then(() => {}, () => {});
    return next;
  },
  async send({ path, method = 'GET', body, auth = '', background = false }) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), this.timing.timeoutMs);
    this.inFlight = true; this.current = background ? abort : null;
    try {
      const init = { method, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: abort.signal };
      const headers = {};
      if (auth) headers.Authorization = auth;
      if (body !== undefined && typeof body === 'string') headers['Content-Type'] = 'application/json';
      if (Object.keys(headers).length) init.headers = headers;
      if (body !== undefined) init.body = body;
      const response = await W.fetch(this.base + path, init);
      const status = Number(response.status) || 0;
      if (status >= 300 && status < 400 || response.redirected || response.type === 'opaqueredirect') return { ok: false, status, network: true };
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      const header = response.headers?.get?.('Retry-After'), seconds = typeof header === 'string' && header.trim() !== '' ? Number(header) : NaN;
      return { ok: status >= 200 && status < 300, status, text, body: json && typeof json === 'object' ? json : null, code: typeof json?.code === 'string' ? json.code : '',
        retryAfterMs: Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null };
    } catch {
      return { ok: false, status: 0, network: true };
    } finally {
      clearTimeout(timer); this.inFlight = false; this.current = null;
    }
  },
  // ---- Scheduling
  schedule(ms) {
    this.cancel();
    if (this.off || this.halted || !this.active()) return;
    this.timer = setTimeout(() => { void this.guardAsync(() => this.cycle()); }, Math.max(0, ms));
  },
  cancel() { clearTimeout(this.timer); this.timer = 0; },
  jitter(ms) { return ms * (0.9 + 0.2 * this.random()); },
  interval() {
    const config = this.get().config?.value, t = this.timing;
    const seconds = Math.max(t.minIntervalS, config?.telemetry.interval_s ?? t.defaultIntervalS, this.nextAfterS);
    return this.jitter(seconds * 1000);
  },
  backoff() {
    const t = this.timing;
    this.failures++;
    return Math.max(t.minWaitMs, this.random() * Math.min(t.backoffCapMs, t.backoffBaseMs * 2 ** this.failures));
  },
  retryAfter(r) {
    const t = this.timing;
    return clamp(r.retryAfterMs ?? this.backoff(), t.minWaitMs, t.retryAfterMaxMs);
  },
  holdForConfig(r) {
    const t = this.timing;
    this.waitingForConfig = true;
    this.configDueAt = this.now() + Math.max(t.disabledRecheckMs, clamp(r.retryAfterMs ?? 0, t.minWaitMs, t.retryAfterMaxMs));
  },
  failureWait(r) {
    const d = this.get(), t = this.timing;
    if (r.network || r.malformed || r.status >= 500 && r.status !== 503) { d.result = 'unreachable'; return this.backoff(); }
    if (r.status === 429) return this.retryAfter(r);
    if (r.status === 503) {
      if (r.code === 'disabled') { d.result = 'disabled'; this.holdForConfig(r); }
      return this.retryAfter(r);
    }
    if (r.status === 403) { d.result = 'paused'; this.pausedUntil = this.now() + t.pauseMs; return t.pauseMs; }
    d.result = 'rejected';
    return this.interval();
  },
  async cycle() {
    this.timer = 0;
    if (!this.active()) return;
    if (this.inFlight) return this.schedule(this.timing.minWaitMs);
    const gen = this.gen;
    try {
      this.load();
      if (!this.active()) return;
      if (this.now() >= this.usageDueAt) {
        const wait = await this.step(gen);
        if (gen !== this.gen) return;
        this.usageDueAt = this.now() + wait;
      }
      if (this.active() && this.now() >= Diag.job.dueAt) {
        const wait = await this.diagStep(gen);
        if (gen !== this.gen) return;
        Diag.job.dueAt = this.now() + wait;
      }
    } catch {
      this.fault(); this.usageDueAt = this.now() + this.backoff();
    }
    if (gen !== this.gen || !this.active()) return;
    this.persist();
    this.schedule(Math.min(this.usageDueAt, Diag.job.dueAt) - this.now());
  },
  // One pass: config, registration, consent sync, then one snapshot. Returns the wait before the next pass.
  async step(gen) {
    const t = this.timing;
    if (this.now() < this.pausedUntil) return this.pausedUntil - this.now();
    if (this.waitingForConfig && this.now() < this.configDueAt) return this.configDueAt - this.now();
    if (this.needsConfig()) {
      const r = await this.readConfig();
      if (gen !== this.gen) return 0;
      if (!r.ok) {
        const wait = this.failureWait(r);
        this.configRetryAt = this.now() + wait;
        return this.configUsable() ? this.jitter(t.minWaitMs) : wait;
      }
    }
    const config = this.configUsable();
    if (!config || !config.telemetry.enabled) return this.jitter(Math.max(t.minWaitMs, this.configAge(t.configEveryMs)));
    if (!this.get().registered) {
      const r = await this.register(gen);
      if (gen !== this.gen) return 0;
      if (!r.ok) return this.registrationFailed(r);
    }
    if (this.unsynced()) {
      const r = await this.syncConsent(gen);
      if (gen !== this.gen) return 0;
      if (!r.ok) return r.status === 401 || r.status === 404 ? this.unauthorised() : this.failureWait(r);
    }
    const built = await this.compose();
    if (gen !== this.gen) return 0;
    if (!built) return this.interval();
    const r = await this.request({ path: '/telemetry', method: 'POST', body: built.text, auth: this.auth(), background: true });
    if (gen !== this.gen) return 0;
    if (r.ok) return this.delivered(built, r);
    if (r.status === 401) return this.unauthorised();
    return this.failureWait(r);
  },
  configAge(window) { return Math.max(0, (this.get().config?.at ?? 0) + window - this.now()); },
  needsConfig() {
    const d = this.get();
    if (this.now() < this.configRetryAt) return false;
    return !d.config || this.waitingForConfig || this.now() - d.config.at >= this.timing.configEveryMs;
  },
  configUsable() {
    const c = this.get().config;
    return c && this.now() - c.at < this.timing.configStaleMs ? c.value : null;
  },
  diagnosticsBlock(block, clientOk) {
    const t = this.timing.diagnostics, b = block && typeof block === 'object' ? block : null;
    const seconds = (value, low, high, fallback) => Number.isFinite(value) ? clamp(Math.round(value), low, high) : fallback;
    if (!b || typeof b.enabled !== 'boolean') return { enabled: false, perf: false, interval_s: t.defaultIntervalS, perf_interval_s: t.defaultPerfIntervalS, sample_pct: 100 };
    return { enabled: b.enabled && clientOk, perf: b.enabled && clientOk && b.perf === true,
      interval_s: seconds(b.interval_s, t.minIntervalS, t.maxIntervalS, t.defaultIntervalS),
      perf_interval_s: seconds(b.perf_interval_s, t.minPerfIntervalS, t.maxPerfIntervalS, t.defaultPerfIntervalS),
      sample_pct: Number.isFinite(b.sample_pct) ? clamp(Math.round(b.sample_pct), 0, 100) : 100 };
  },
  parseConfig(body) {
    if (!body || typeof body !== 'object' || body.schema !== 1) return null;
    const t = body.telemetry, r = body.reports;
    if (!t || typeof t.enabled !== 'boolean' || !r || typeof r.enabled !== 'boolean' || typeof body.client_ok !== 'boolean') return null;
    const seconds = Number.isFinite(t.interval_s) ? Math.round(t.interval_s) : this.timing.defaultIntervalS;
    const message = typeof body.message === 'string' ? Array.from(body.message).filter(c => { const n = c.codePointAt(0); return n >= 32 && n !== 127 && !(n >= 128 && n < 160); }).slice(0, 200).join('').trim() : '';
    return { telemetry: { enabled: t.enabled && body.client_ok, interval_s: clamp(seconds, this.timing.minIntervalS, this.timing.maxIntervalS) },
      reports: { enabled: r.enabled && body.client_ok, screenshots: r.enabled && body.client_ok && r.screenshots === true },
      diagnostics: this.diagnosticsBlock(body.diagnostics, body.client_ok), client_ok: body.client_ok, message: message || null };
  },
  async readConfig() {
    const r = await this.request({ path: '/config?app=osb&version=' + encodeURIComponent(VERSION), background: this.consented() });
    const value = r.ok ? this.parseConfig(r.body) : null;
    if (!value) return r.ok ? { ...r, ok: false, malformed: true } : r;
    this.get().config = { at: this.now(), value };
    this.waitingForConfig = false; this.configRetryAt = 0; Diag.job.waitingForConfig = false;
    Diag.sync();
    if (this.consented()) this.persist();
    return { ...r, config: value };
  },
  // The configuration a report needs: the cached one while it is fresh, else one read, else the cached one up to 24 h old.
  async reportConfig() {
    const d = this.get();
    if (d.config && this.now() - d.config.at < this.timing.configEveryMs) return d.config.value;
    const r = await this.readConfig();
    return r.ok ? r.config : this.configUsable();
  },
  async register(gen) {
    const d = this.get();
    d.attempted = true; this.persist();
    const body = JSON.stringify({ install_id: d.id, install_key: d.key, app: 'osb', app_version: VERSION, os: this.os(), locale: this.locale(),
      consent: { usage_version: d.usage, characters: d.characters } });
    const sent = d.characters, usage = d.usage;
    const r = await this.request({ path: '/installs', method: 'POST', body, background: true });
    if (r.ok && gen === this.gen) { const now = this.get(); now.registered = true; now.synced = sent; now.syncedUsage = usage; this.failures = 0; this.persist(); }
    return r;
  },
  registrationFailed(r) {
    const d = this.get();
    if (r.status === 409) { this.newIdentity(); this.persist(); return this.jitter(this.timing.minWaitMs); }
    if (r.status === 400) { d.result = 'rejected'; this.halted = true; return 0; }
    return this.failureWait(r);
  },
  unauthorised() {
    const d = this.get();
    if (this.reregistered) { this.halted = true; d.result = 'rejected'; return 0; }
    this.reregistered = true; d.registered = false;
    return this.jitter(this.timing.minWaitMs);
  },
  unsynced() { const d = this.get(); return d.synced !== d.characters || d.syncedUsage !== d.usage; },
  async syncConsent(gen) {
    const d = this.get();
    if (!d.registered || !this.unsynced()) return { ok: true };
    const sent = d.characters, usage = d.usage;
    const r = await this.request({ path: '/installs/me/consent', method: 'PUT', body: JSON.stringify({ usage_version: usage, characters: sent }), auth: this.auth(), background: true });
    if (r.ok && gen === this.gen) { const now = this.get(); now.synced = sent; now.syncedUsage = usage; this.persist(); }
    return r;
  },
  delivered(built, r) {
    const d = this.get(), next = Number(r.body?.next_after_s);
    this.nextAfterS = Number.isFinite(next) ? clamp(next, 0, this.timing.maxIntervalS) : 0;
    d.sentAt = this.now(); d.result = 'ok';
    this.failures = 0; this.reregistered = false;
    this.sentSignature = built.signature; this.sentSession = built.sessionSignature;
    return this.interval();
  },
  diagInterval(config) {
    const seconds = Math.max(config?.interval_s ?? this.timing.diagnostics.defaultIntervalS, Diag.job.nextAfterS);
    return this.jitter(seconds * 1000);
  },
  diagBackoff() {
    const t = this.timing, job = Diag.job;
    job.failures++;
    return Math.max(t.minWaitMs, this.random() * Math.min(t.backoffCapMs, t.backoffBaseMs * 2 ** job.failures));
  },
  async diagStep(gen) {
    const t = this.timing, job = Diag.job, d = this.get();
    if (Diag.off || job.halted) return Infinity;
    if (this.now() < job.pausedUntil) return job.pausedUntil - this.now();
    if (job.waitingForConfig) {
      if (this.now() < job.configDueAt) return job.configDueAt - this.now();
      const r = await this.readConfig();
      if (gen !== this.gen) return 0;
      if (!r.ok) return this.diagBackoff();
    }
    const config = this.diagnosticsConfig();
    if (!config) return this.jitter(Math.max(t.minWaitMs, this.configAge(t.configEveryMs)));
    if (!d.registered || this.unsynced()) return this.jitter(t.minWaitMs);
    const built = await Diag.compose(config);
    if (gen !== this.gen) return 0;
    if (!built) return this.diagInterval(config);
    const r = await this.request({ path: '/diagnostics', method: 'POST', body: built.text, auth: this.auth(), background: true });
    if (gen !== this.gen) return 0;
    if (r.ok) {
      const next = Number(r.body?.next_after_s);
      job.nextAfterS = Number.isFinite(next) ? clamp(next, 0, t.diagnostics.maxIntervalS) : 0;
      Diag.delivered(built); job.failures = 0; job.sentAt = this.now(); job.result = 'ok';
      return this.diagInterval(config);
    }
    if (r.status === 401) { this.usageDueAt = 0; return this.unauthorised(); }
    if (r.status === 403 && r.code === 'consent_required') {
      if (job.consentRetried) { job.halted = true; job.result = 'rejected'; return Infinity; }
      job.consentRetried = true;
      d.syncedUsage = 0;
      const sync = await this.syncConsent(gen);
      if (gen !== this.gen) return 0;
      return sync.ok ? this.diagInterval(config) : this.diagBackoff();
    }
    if (r.status === 403) { job.result = 'paused'; job.pausedUntil = this.now() + t.pauseMs; return t.pauseMs; }
    if (r.network || r.status >= 500 && r.status !== 503) { job.result = 'unreachable'; return this.diagBackoff(); }
    if (r.status === 429) return clamp(r.retryAfterMs ?? this.diagBackoff(), t.minWaitMs, t.retryAfterMaxMs);
    if (r.status === 503) {
      const wait = clamp(r.retryAfterMs ?? this.diagBackoff(), t.minWaitMs, t.retryAfterMaxMs);
      if (r.code !== 'disabled') return wait;
      job.result = 'disabled'; job.waitingForConfig = true; job.configDueAt = this.now() + Math.max(t.disabledRecheckMs, wait);
      return job.configDueAt - this.now();
    }
    Diag.delivered(built, { remember: false }); job.result = 'rejected';
    return this.diagInterval(config);
  },
  // ---- Payload
  idle(fn) {
    return new Promise((resolve, reject) => {
      const run = () => { try { resolve(fn()); } catch (e) { reject(e); } };
      if (typeof W.requestIdleCallback === 'function') W.requestIdleCallback(run, { timeout: 5000 });
      else setTimeout(run, 0);
    });
  },
  stateOf() {
    const phase = World.phase;
    if (['signed-out', 'listing-servers', 'loading-roster', 'authenticating'].includes(phase)) return 'login';
    if (['connecting', 'entering-world', 'reconnecting'].includes(phase)) return 'loading';
    if (phase === 'disconnected') return 'offline';
    if (phase !== 'world') return 'unknown';
    if (!World.inWorld()) return 'loading';
    if (World.isDead()) return 'dead';
    if (Town.trip || Restock.trip) return 'town';
    if (Hunt.running) return 'hunting';
    return RunIntent.stopped() ? 'stopped' : 'idle';
  },
  scrolls(type) { return World.items().filter(i => (i.typeFlags & 0xfffc) === type).reduce((n, i) => n + (i.quantity ?? 1), 0); },
  count(value, max = 10000000) { return Number.isFinite(value) ? clamp(Math.floor(value), 0, max) : null; },
  decimal(value) { return typeof value === 'bigint' && value >= 0n && value <= LONG_MAX ? value.toString() : null; },
  // Copies a few scalars from the live state. Runs in an idle callback and never writes to the game state.
  snapshot() {
    const gp = World.gp, inWorld = World.inWorld(), account = Settings.profileKey.slice('profile:'.length);
    const out = { account, state: this.stateOf() };
    const level = gp?.progression?.level;
    if (Number.isInteger(level) && level >= 1 && level <= 255) out.level = level;
    const gold = this.decimal(Stats.integer(gp?.progression?.gold));
    if (gold !== null) out.gold = gold;
    if (inWorld) {
      const me = World.me();
      if (me.maxHp > 0) out.hp_pct = Math.round(clamp(me.hpPct, 0, 100));
      if (me.maxMp > 0) out.mp_pct = Math.round(clamp(me.mpPct, 0, 100));
      if (Array.isArray(gp.inventory)) out.scrolls = { return: this.count(this.scrolls(0x09ec), 100000), reverse: this.count(this.scrolls(0x19ec), 100000) };
    }
    out.bot_version = VERSION;
    const name = World.charName;
    if (this.get().characters && typeof name === 'string' && name.length >= 1 && name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(name)) out.character = { name };
    const { session, signature } = this.sessionOf(account);
    if (session) out.session = session;
    out.sessionSignature = signature;
    return out;
  },
  sessionOf(account) {
    const s = Stats.session, running = !!Hunt.running;
    const ms = this.count(s.ms, 2592000000), kills = this.count(s.kills), deaths = this.count(s.deaths), sox = this.count(s.sox);
    const xp = Stats.xpKnown ? this.decimal(s.xp) : null, gold = Stats.goldKnown ? this.decimal(s.gold) : null;
    const signature = [ms, kills, deaths, xp, gold, sox].join('|');
    if (!running && !(ms > 0 && signature !== this.sentSession)) return { session: null, signature };
    let entry = this.sessions.get(account);
    if (!entry || ms < entry.ms || kills < entry.kills) { entry = { key: this.hex(this.bytes(8)), ms, kills }; this.sessions.set(account, entry); }
    entry.ms = ms; entry.kills = kills;
    return { session: { key: entry.key, ms, kills, deaths, ...(xp !== null ? { xp } : {}), ...(gold !== null ? { gold } : {}), sox }, signature };
  },
  async slot(account) {
    const cached = this.slots.get(account);
    if (cached) return cached;
    const key = await W.crypto.subtle.importKey('raw', this.fromBase64url(this.get().key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await W.crypto.subtle.sign('HMAC', key, new TextEncoder().encode('slot:' + account)));
    const slot = this.hex(mac.subarray(0, 8));
    this.slots.set(account, slot);
    return slot;
  },
  assemble(raw, slot) {
    const { account, session, sessionSignature, ...rest } = raw;
    return { schema: 1, app_version: VERSION, accounts: [{ slot, ...rest, ...(session ? { session } : {}) }] };
  },
  fit(payload) {
    const size = text => new TextEncoder().encode(text).length;
    let text = JSON.stringify(payload);
    while (size(text) > this.timing.cutBytes && payload.accounts.length) { payload.accounts.pop(); text = JSON.stringify(payload); }
    return payload.accounts.length ? text : null;
  },
  // The next body, or null when nothing changed and the hourly resend is not due.
  async compose() {
    const raw = await this.idle(() => this.snapshot());
    const payload = this.assemble(raw, await this.slot(raw.account));
    const { key, ...stable } = payload.accounts[0].session || {};
    const signature = JSON.stringify({ ...payload.accounts[0], session: payload.accounts[0].session ? stable : undefined });
    if (!Hunt.running && signature === this.sentSignature && this.now() - this.get().sentAt < this.timing.resendMs) return null;
    const text = this.fit(payload);
    return text ? { text, signature, sessionSignature: raw.sessionSignature } : null;
  },
  // What "Show what is sent" displays: the next body, built the same way and never sent.
  async preview() {
    return this.guardAsync(async () => {
      const raw = await this.idle(() => this.snapshot());
      const slot = this.get().key ? await this.slot(raw.account) : '0000000000000000';
      return JSON.stringify(this.assemble(raw, slot), null, 2);
    }, '');
  },
  // ---- Withdrawal and export
  async deleteData() {
    const d = this.get(), id = d.id, auth = d.registered || d.attempted ? this.credential() : '';
    const wasOn = d.usage > 0;
    this.gen++; this.cancel(); this.abortBackground(); this.resetRun(); Diag.reset();
    this.data = this.blank(); this.write(); Diag.sync();
    this.pendingDelete = null;
    if (!wasOn || !auth) return true;
    const r = await this.request({ path: '/installs/me', method: 'DELETE', auth });
    if (!(r.ok || r.status === 401 || r.status === 404)) this.pendingDelete = { id };
    this.refreshView();
    return true;
  },
  async download() {
    const d = this.get();
    if (!d.registered) return { ok: false, text: 'Nothing has been sent from this install, so there is no data to download.' };
    const r = await this.request({ path: '/installs/me/export', auth: this.credential() });
    if (r.ok) return { ok: true, id: d.id, data: r.text };
    return { ok: false, text: r.network ? 'The server could not be reached. Try again later.' : 'The server did not return your data. Try again later, or write to ' + PRIVACY_CONTACT + '.' };
  },
  status() {
    const d = this.get();
    return { hosted: this.hosted(), supported: this.supported(), usage: this.consented(), outdated: this.outdated(), characters: d.characters, id: d.id, sentAt: d.sentAt, result: d.result,
      message: d.config?.value.message || '', off: this.off, halted: this.halted, pendingDelete: this.pendingDelete, diagnostics: Diag.status() };
  },
  // ---- Settings section
  lastSentText() {
    const s = this.status();
    if (s.off) return 'Usage statistics stopped on this page after an error. Reload the game to try again.';
    const when = s.sentAt ? new Date(s.sentAt).toLocaleString() : 'not sent yet';
    return 'Last sent: ' + when + (s.result === 'unreachable' ? ' · server unreachable' : s.result === 'disabled' ? ' · switched off by the server for now' : s.result === 'rejected' ? ' · not accepted by the server' : '');
  },
  refreshView() {
    const v = this.view;
    if (!v || !v.box.isConnected) return;
    const s = this.status();
    v.id.textContent = s.id ? 'Install ID: ' + s.id : 'Install ID: none (nothing is sent while sharing is off).';
    v.copy.hidden = !s.id;
    v.sent.textContent = s.hosted ? '' : this.lastSentText();
    v.message.textContent = s.message;
    v.message.hidden = !s.message;
    v.failed.hidden = !s.pendingDelete;
    if (s.pendingDelete) v.failed.firstChild.textContent = `Your data was removed on this computer, but the server could not be reached. To have it deleted there, write to ${PRIVACY_CONTACT} with this install ID: ${s.pendingDelete.id}`;
    const characters = v.characters.querySelector('input');
    if (characters) characters.disabled = !s.usage;
  },
  link(text = 'Privacy policy', url = PRIVACY_URL) {
    const a = el('a', text);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  },
  links() { return UI.row(this.link(), this.link('KVKK notice (Turkish)', KVKK_NOTICE_URL), this.link('KVKK explicit consent (Turkish)', KVKK_CONSENT_URL)); },
  changed() {
    const d = this.get();
    if (!this.outdated()) return false;
    if (d.changedSeen) return this.changedNow;
    d.changedSeen = true; this.changedNow = true; this.write();
    return true;
  },
  // A consent can only be given or withdrawn by a real click: a script-made event changes nothing.
  toggle(title, get, set) {
    const input = el('input'); input.type = 'checkbox'; input.checked = !!get();
    input.addEventListener('change', event => {
      if (event?.isTrusted === true) set(input.checked);
      input.checked = !!get();
    });
    UI.refreshers.push(() => { if (UI.root?.activeElement !== input) input.checked = !!get(); });
    return UI.field(title, input);
  },
  updateSwitch() {
    const box = el('div');
    box.append(this.toggle('Check GitHub for OSB updates', () => Updates.enabled(), v => Updates.setEnabled(v)),
      el('p', 'OSB asks GitHub (api.github.com and raw.githubusercontent.com, corevider/osb) about every 15 minutes whether a newer version exists. It sends no data about you or your game. Turn it off to stop these requests; you then update by hand.', 'muted'),
      el('p', 'Only if you turn on "Use the game site\'s unique tracker" (Combat, Unique hunt, or the Setup page\'s Uniques list; it is off by default), OSB reads the game site\'s unique tracker (opensro.online/uniques) while the unique hunt runs or the Setup page is shown, at most every 2 minutes, without cookies and without any data about you. With it off OSB makes no such request.', 'muted'));
    return box;
  },
  helpText() {
    const box = el('div', null, 'muted'), list = el('ul');
    list.append(el('li', 'Usage: the app and bot version, operating system and language, and for each game account the bot state, level, gold, HP and MP percentage, scroll counts and the current session\'s kills, deaths, XP, gold and SoX drops.'),
      el('li', 'Errors: which part of OSB failed and how (the error type, a fixed message and the place in our code), why the bot stopped by itself, the game phase and what the bot did just before (fixed event codes, never the text of your log).'),
      el('li', 'Performance: how long the bot\'s steps take and the page\'s memory use, with the OSB version.'));
    box.append(el('p', 'When this is on, OSB sends data to our server, api.osb.lol, about every 10 minutes, so we can see how OSB is used and find and fix its errors:'), list,
      el('p', 'Unless you also turn on character names below, it contains no character, player or account names. It never contains chat, positions, passwords, login IDs, file paths, your computer\'s name, hardware IDs or memory dumps. It is kept under a random install ID that is not linked to your name, login ID or computer. We keep usage data for 45 days, error data for 30 days and performance data for 14 days, and the install record for 90 days after it was last seen. Daily totals without the install ID are kept for 13 months. Turn it off at any time; your data on our server is then deleted, except those daily totals, which cannot identify you. Details: osb.lol/privacy'));
    return box;
  },
  draw(host) {
    const note = text => el('p', text, 'muted');
    if (this.hosted()) {
      host.append(UI.group('Privacy', note('Usage statistics, error reports and performance data are handled by OSB Manager. OSB sends none itself.'), note('A report you send from OSB goes straight to api.osb.lol, and only when you press Send and confirm.'), this.updateSwitch(), this.links()));
      return;
    }
    const stop = el('div', null, 'row'); stop.hidden = true;
    stop.append(el('span', 'Stop sharing usage statistics, error reports and performance data, and delete them from api.osb.lol? Reports you already sent are deleted too.'),
      UI.button('Yes, stop and delete', event => { if (event?.isTrusted !== true) return; stop.hidden = true; void this.setUsage(false); UI.draw(); }),
      UI.button('Cancel', () => { stop.hidden = true; }));
    const usage = this.toggle('Share usage statistics, error reports and performance data', () => this.consented(), v => { if (v) { void this.setUsage(true); UI.draw(); } else stop.hidden = false; });
    const changed = el('p', null, 'muted'); changed.hidden = !this.changed();
    changed.append(el('strong', 'Changed'), el('span', ' The text of this switch changed: it now also covers error reports and performance data. Switch it on again if you want to share.'));
    const characters = this.toggle('Show my characters in the OSB dashboard', () => this.get().characters, v => { this.setCharacters(v); });
    const shown = el('textarea'); shown.readOnly = true; shown.rows = 10; shown.hidden = true; shown.setAttribute('aria-label', 'What is sent');
    const errors = el('textarea'); errors.readOnly = true; errors.rows = 10; errors.hidden = true; errors.setAttribute('aria-label', 'Error reports waiting to be sent');
    const show = UI.button('Show what is sent', async () => {
      if (!shown.hidden) { shown.hidden = true; errors.hidden = true; return; }
      shown.value = (this.consented() ? '' : 'Nothing is sent while sharing is off. This is what would be sent (the slot is a placeholder):\n') + await this.preview();
      const batch = await Diag.preview();
      errors.value = batch || (this.consented() ? 'No error reports are waiting to be sent.' : 'No error reports are recorded while sharing is off.');
      shown.hidden = false; errors.hidden = false;
    });
    const download = UI.button('Download my data', async () => {
      const r = await this.download();
      if (!r.ok) return UI.toast(r.text, 'warn');
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = 'osb-data-' + r.id + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const sure = el('div', null, 'row'); sure.hidden = true;
    const ask = UI.button('Delete my data', event => { if (event?.isTrusted === true) sure.hidden = false; });
    sure.append(el('span', 'Delete all data for this install from api.osb.lol, including linked reports, error reports and performance data? Sharing is turned off. This cannot be undone.'),
      UI.button('Yes, delete', event => { if (event?.isTrusted !== true) return; sure.hidden = true; void this.setUsage(false); UI.draw(); }),
      UI.button('Cancel', () => { sure.hidden = true; }));
    const id = el('span'), copy = UI.button('Copy install ID', async () => {
      try { await W.navigator.clipboard.writeText(this.get().id); UI.toast('Install ID copied.'); } catch { UI.toast('Clipboard unavailable. Select the ID and copy it.', 'warn'); }
    });
    const failed = el('p', '', 'muted'); failed.append(el('span'), UI.button('Dismiss', () => { this.pendingDelete = null; this.refreshView(); }));
    failed.hidden = true;
    const sent = el('p', '', 'muted'), message = el('p', '', 'muted');
    const box = UI.group('Privacy',
      usage, changed, stop, this.helpText(), this.links(),
      characters, note('Also sends your character names and server names, so the OSB team can see your characters by name in its private dashboard. Never shown publicly. Turning this off deletes the names at once.'),
      UI.row(show, download, ask), sure, shown, errors, failed, sent, message, UI.row(id, copy), this.updateSwitch());
    this.view = { box, id, copy, sent, message, failed, characters };
    host.append(box);
    UI.refreshers.push(() => this.refreshView());
    this.refreshView();
  },
};
