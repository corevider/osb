const DIAG_LIMIT = { inbox: 32, trail: 20, trailMs: 600000, frames: 16, fingerprintFrames: 5, perHour: 30, perDay: 200, batchEvents: 50, perfEntries: 2,
  eventBytes: 4096, cutBytes: 60 * 1024, maxBytes: 64 * 1024, terms: 2000, termMin: 3, sameFingerprintMs: 3600000, count: 100000, messageChars: 300, templateChars: 160, faults: 3 };
const DIAG_HOSTED = { events: 10, bytes: 12 * 1024, perfBytes: 2048, everyMs: 60000, batchType: 'osb-diagnostics-batch', perfType: 'osb-diagnostics-perf', switchType: 'osb-diagnostics' };
const DIAG_CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const DIAG_RESERVED_FP = '0000000000000000';
const DIAG_WIRE_TEXT = /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/;
const DIAG_FRAME = /^[A-Za-z_$<?][A-Za-z0-9_$<>.+-]{0,95}(@[0-9]{1,7}:[0-9]{1,5})?$/;
const DIAG_ENGINE_ERRORS = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'DOMException']);
const DIAG_ENGINE_WORDS = [
  'a', 'abort', 'aborted', 'about', 'access', 'accessed', 'accessor', 'accessors', 'activation', 'adapter', 'after', 'aggregateerror', 'all',
  'allocation', 'allowed', 'already', 'ambiguous', 'an', 'and', 'any', 'apply', 'are', 'argument', 'arguments', 'array', 'arraybuffer', 'arrays',
  'arrow', 'as', 'assign', 'assigned', 'assignment', 'async', 'at', 'atomics', 'attempt', 'attempting', 'attribute', 'audio', 'await', 'be',
  'because', 'been', 'before', 'between', 'bigint', 'binary', 'bind', 'binding', 'bindings', 'blocked', 'body', 'boolean', 'bounds', 'brace',
  'bracket', 'brand', 'break', 'buffer', 'but', 'by', 'byte', 'bytes', 'call', 'callable', 'callback', 'called', 'calling', 'can', 'cannot',
  'canvas', 'case', 'catch', 'chain', 'chaining', 'channel', 'character', 'characters', 'check', 'child', 'circle', 'circular', 'class', 'classes',
  'clone', 'cloned', 'closed', 'closes', 'coalescing', 'code', 'codec', 'colon', 'column', 'comma', 'compilation', 'compile', 'computed',
  'configurable', 'const', 'constant', 'constraint', 'construct', 'constructor', 'constructors', 'context', 'continue', 'conversion', 'conversions',
  'convert', 'converting', 'could', 'create', 'created', 'cross', 'currency', 'cyclic', 'data', 'database', 'dataview', 'date', 'decimal',
  'declaration', 'declare', 'declared', 'decode', 'decoding', 'default', 'define', 'defined', 'delete', 'deleted', 'denied', 'derived', 'descriptor',
  'descriptors', 'deserialize', 'destroyed', 'destructure', 'detached', 'device', 'did', 'different', 'digits', 'do', 'document', 'does',
  'domexception', 'duplicate', 'dynamic', 'each', 'element', 'elements', 'else', 'empty', 'enclosing', 'encode', 'encoding', 'end', 'enumerable',
  'enumerate', 'equal', 'error', 'errors', 'escape', 'evalerror', 'every', 'exceeded', 'exception', 'exclusive', 'execute', 'executed', 'expect',
  'expected', 'expects', 'explicit', 'exponent', 'export', 'exported', 'expression', 'expressions', 'extensible', 'fail', 'failed', 'failure',
  'false', 'fetch', 'few', 'field', 'fields', 'finally', 'finished', 'finite', 'first', 'flag', 'flags', 'for', 'format', 'found', 'frame', 'freeze',
  'from', 'frozen', 'fullscreen', 'function', 'functions', 'generator', 'generators', 'gesture', 'get', 'getter', 'global', 'gpu', 'greater',
  'group', 'had', 'hand', 'handled', 'handler', 'has', 'have', 'hexadecimal', 'hierarchy', 'how', 'identifier', 'if', 'illegal', 'implemented',
  'import', 'imported', 'in', 'inactive', 'inclusive', 'incompatible', 'index', 'indices', 'indirect', 'infinite', 'infinity', 'initial',
  'initialization', 'initialized', 'input', 'insecure', 'inside', 'instance', 'instanceof', 'instances', 'integer', 'intl', 'into', 'invalid',
  'invocation', 'invoke', 'invoked', 'is', 'it', 'iterable', 'iterator', 'iterators', 'its', 'itself', 'json', 'key', 'keys', 'kind', 'know',
  'label', 'large', 'last', 'left', 'left-hand', 'length', 'less', 'let', 'lexical', 'line', 'link', 'linking', 'list', 'literal', 'literals',
  'load', 'loaded', 'loading', 'locale', 'lock', 'long', 'lookup', 'loop', 'lost', 'malformed', 'many', 'map', 'math', 'maximum', 'may', 'media',
  'member', 'memory', 'message', 'method', 'methods', 'minimum', 'missing', 'mix', 'mode', 'module', 'modules', 'more', 'must', 'named', 'namespace',
  'namespaces', 'nan', 'negative', 'network', 'new', 'new.target', 'newline', 'next', 'no', 'node', 'none', 'not', 'null', 'nullish', 'number',
  'numbers', 'numeric', 'object', 'objects', 'octal', 'of', 'offset', 'old', 'on', 'one', 'only', 'open', 'opened', 'operand', 'operation',
  'operations', 'operator', 'option', 'optional', 'options', 'or', 'origin', 'other', 'out', 'outside', 'own', 'parameter', 'parameters', 'parent',
  'parenthesis', 'parse', 'parsed', 'parsing', 'pass', 'passed', 'paused', 'pending', 'per', 'permission', 'permitted', 'pipeline', 'play', 'point',
  'pointer', 'port', 'position', 'positive', 'postmessage', 'precision', 'previous', 'primitive', 'private', 'promise', 'promises', 'properties',
  'property', 'prototype', 'provide', 'provided', 'provides', 'proxy', 'quantifier', 'queue', 'quota', 'quote', 'radix', 'range', 'rangeerror',
  'read', 'read-only', 'reading', 'readonly', 'received', 'receiver', 'recursion', 'redeclaration', 'redefine', 'reduce', 'referenceerror',
  'reflect', 'regexp', 'regular', 'reject', 'rejected', 'rejection', 'request', 'requested', 'require', 'requires', 'resolution', 'resolve',
  'resolved', 'resolver', 'response', 'rest', 'result', 'return', 'revoked', 'right', 'right-hand', 'running', 'runtime', 'same', 'scope', 'sealed',
  'search', 'secure', 'security', 'selector', 'semicolon', 'separator', 'separators', 'sequence', 'serializable', 'serialize', 'set', 'setter',
  'setting', 'shader', 'sharedarraybuffer', 'short', 'should', 'side', 'size', 'slash', 'sloppy', 'small', 'so', 'some', 'source', 'spread', 'stack',
  'star', 'starting', 'state', 'statement', 'statements', 'static', 'storage', 'strict', 'string', 'stringify', 'strings', 'structure', 'submit',
  'such', 'super', 'supplied', 'supported', 'switch', 'symbol', 'symbols', 'syntax', 'syntaxerror', 'table', 'tagged', 'target', 'template',
  'texture', 'than', 'that', 'the', 'then', 'there', 'this', 'three', 'throw', 'thrown', 'time', 'timed', 'timeout', 'to', 'token', 'tokens', 'too',
  'track', 'trailing', 'transaction', 'transfer', 'transferable', 'trap', 'true', 'try', 'two', 'type', 'typedarray', 'typeerror', 'typeof', 'types',
  'undefined', 'unexpected', 'unhandled', 'uninitialized', 'unit', 'unknown', 'unreachable', 'unsupported', 'unterminated', 'upon', 'uri',
  'urierror', 'url', 'use', 'user', 'using', 'valid', 'validation', 'value', 'values', 'var', 'variable', 'variables', 'version', 'via', 'video',
  'was', 'wasm', 'weakmap', 'weakref', 'weakset', 'webassembly', 'webgl', 'webgpu', 'when', 'where', 'which', 'while', 'whitespace', 'whose', 'will',
  'window', 'with', 'within', 'without', 'worker', 'worklet', 'writable', 'yet', 'yield', 'zero', 'zone'
];
const DIAG_ENGINE_WORD_SET = new Set(DIAG_ENGINE_WORDS);
const DIAG_KNOWN_WORDS = new Set(DIAG_WORD_LIST);
const DIAG_TEMPLATE_WORD = /<(?:q|n|url|x|path)>|(?:[A-Za-z0-9_$]|[^\x00-\x7f])+/g;
const DIAG_PHASES = ['signed-out', 'listing-servers', 'loading-roster', 'authenticating', 'connecting', 'entering-world', 'world', 'reconnecting', 'disconnected'];
const DIAG_MODES = { idle: 'idle', fight: 'fight', loot: 'loot', resting: 'resting', standing: 'resting', 'town service': 'town', returning: 'returning', return: 'returning',
  travelling: 'travelling', quest: 'quest', resurrect: 'resurrect', 'party support': 'party-support', recording: 'recording', shopping: 'shopping', error: 'error',
  search: 'hunting', manual: 'hunting', player: 'hunting', buff: 'hunting', dead: 'hunting', 'support only': 'hunting' };
const DIAG_DETAIL_NUMBERS = ['durationMs', 'distance', 'attempt', 'quantity', 'hpPct', 'mpPct', 'delayMs', 'kills', 'deaths', 'potions', 'items', 'revision', 'visited', 'progressAgeMs', 'skillId', 'leg', 'legs'];
const DIAG_DETAIL_FLAGS = ['attackingPlayer', 'choice'];
const DIAG_OUTCOMES = ['requested', 'confirmed', 'refused', 'unconfirmed', 'cancelled', 'waiting', 'summary'];
const DIAG_REFUSAL_SOURCES = ['cast', 'inventory', 'unknown'];
const DIAG_REFUSAL_REASONS = ['cooldown-or-action-recovery', 'unmapped-error', 'unclassified-error'];
const DIAG_QUIET_STOPS = new Set(['player-stop', 'walk-back-start', 'quest-visit']);
const STOP_CODES = [
  [/^stopped (by you|from outside)/i, 'player-stop'],
  [/^internal error/i, 'internal-error'],
  [/^settings changed/i, 'settings-changed'],
  [/^character changed/i, 'character-changed'],
  [/^world change/i, 'world-change'],
  [/^game connection failed/i, 'connection-failed'],
  [/^all activities stopped/i, 'stop-all'],
  [/^safety: .*deaths?\b/i, 'safety-death'],
  [/^safety: .*player attacked/i, 'safety-player-alert'],
  [/^safety: .*party/i, 'safety-party'],
  [/^safety: .*unique/i, 'safety-unique'],
  [/^safety: /i, 'safety-stop'],
  [/^stuck: no progress/i, 'stuck-no-progress'],
  [/^character cannot move/i, 'trapped'],
  [/^out of HP potions/i, 'out-of-hp-potions'],
  [/^inventory full/i, 'inventory-full'],
  [/^(the )?character died/i, 'character-died'],
  [/^hunt area is in another region/i, 'hunt-area-other-region'],
  [/No saved hunting (spot|point)|save a hunting spot first/i, 'no-hunting-spot'],
  [/^Town cycle stopped: /i, 'town-trip-failed'],
  [/^Recovery town services completed/i, 'town-recovery-done'],
  [/^Travel stopped: /i, 'travel-failed'],
  [/^(Walk back (stopped|interrupted)|Manual control: walk back|Cannot walk to the saved hunting spot|The hunting spot is )/i, 'walk-back-cancelled'],
  [/^walking back to the hunting spot/i, 'walk-back-start'],
  [/^Potion restock: /i, 'restock-failed'],
  [/^Lure: /i, 'lure-stopped'],
  [/^unique hunt: stopped by you|^unique hunt: stopped from outside/i, 'player-stop'],
  [/^unique hunt: .*killed/i, 'unique-hunt-done'],
  [/^unique hunt: time limit/i, 'unique-time-limit'],
  [/^unique hunt: /i, 'unique-hunt-stopped'],
  [/^visiting a quest NPC/i, 'quest-visit'],
  [/^Resurrection return/i, 'resurrect-return-failed'],
];
const StopCodes = {
  code(source, reason) {
    if (source === 'town') return 'town-trip-failed';
    const text = String(reason || '');
    for (const [pattern, code] of STOP_CODES) if (pattern.test(text)) return code;
    return 'other';
  },
};
const Diag = {
  inbox: [], pending: new Map(), sentAt: new Map(), trailed: new Set(), terms: new Map(), perf: [], admitted: [], dayStart: -Infinity, dayCount: 0,
  dropped: { rate_limited: 0, oversize: 0, sampled_out: 0 }, run: '', startMono: 0, since: Infinity, selfUrl: '', draw: -1, gen: 0, errors: 0, off: false, busy: false, quiet: 0, started: false,
  scheduled: false, processing: null,
  lastStop: { code: '', at: -Infinity },
  job: { dueAt: 0, failures: 0, nextAfterS: 0, pausedUntil: 0, waitingForConfig: false, configDueAt: 0, consentRetried: false, halted: false, sentAt: 0, result: '' },
  enabled: false, hostOn: false, hostPerf: false, hostTimer: 0, hostSending: false,
  recording() { return this.enabled && !this.off; },
  sync() {
    const was = this.enabled;
    if (Telemetry.hosted()) this.enabled = this.hostOn && Telemetry.supported();
    else {
      const config = Telemetry.consented() && Telemetry.supported() ? Telemetry.diagnosticsConfig() : null;
      if (config && this.draw < 0) this.draw = Math.floor(Telemetry.random() * 100);
      this.enabled = !!config && this.draw < config.sample_pct;
    }
    if (!this.enabled) this.wipe();
    else if (!was) this.since = now();
    Perf.sync();
    this.hostJob();
  },
  hostMessage(data) {
    if (!data || data.type !== DIAG_HOSTED.switchType || typeof data.on !== 'boolean' || !Telemetry.hosted()) return;
    if (data.perf !== undefined && typeof data.perf !== 'boolean') return;
    try {
      const perf = data.on && data.perf === true;
      if (this.hostOn === data.on && this.hostPerf === perf) return;
      this.hostOn = data.on; this.hostPerf = perf;
      this.sync();
    } catch { this.fault(); }
  },
  hostedPerfConfig() {
    return this.hostPerf && this.recording() && Telemetry.hosted() ? { perf: true, perf_interval_s: Telemetry.timing.diagnostics.defaultPerfIntervalS } : null;
  },
  hostPerfDone(entry) {
    this.hostPerf = false;
    Perf.sync();
    if (!entry || !this.wire(entry) || !this.recording()) return;
    const message = { type: DIAG_HOSTED.perfType, perf: entry };
    if (this.hostSize(JSON.stringify(message)) > DIAG_HOSTED.perfBytes) return;
    try { W.chrome.webview.postMessage(message); } catch { this.fault(); }
  },
  hostJob() {
    if (!(this.recording() && Telemetry.hosted())) {
      if (this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = 0; }
      return;
    }
    if (this.hostTimer) return;
    this.hostTimer = setTimeout(() => { this.hostTimer = 0; void this.hostSend().finally(() => this.hostJob()); }, DIAG_HOSTED.everyMs);
  },
  async hostSend() {
    if (this.hostSending) return;
    this.hostSending = true;
    try {
      const gen = this.gen;
      await this.process();
      if (gen !== this.gen || !this.recording()) return;
      const built = await Telemetry.idle(() => this.recording() && gen === this.gen ? this.assemble(null, { hosted: true }) : null);
      if (!built || gen !== this.gen || !this.recording()) return;
      W.chrome.webview.postMessage(built.message);
      this.delivered(built);
    } catch { this.fault(); } finally { this.hostSending = false; }
  },
  start() {
    if (this.started) return;
    this.started = true;
    this.startMono = now();
    this.selfUrl = this.firstUrl(new Error('self').stack);
    W.addEventListener?.('error', event => this.error('', event?.error ?? event?.message, 'window', false));
    W.addEventListener?.('unhandledrejection', event => this.error('', event?.reason, 'rejection', false));
    bus.on('log', entry => this.warn(entry));
    bus.on('spawn', e => { if (e?.kind === 'player' && this.recording()) this.addTerm(e.name); });
    bus.on('chat', line => { if (this.recording()) for (const key of ['sender', 'name', 'from', 'character', 'player']) this.addTerm(line?.[key]); });
    if (Telemetry.hosted()) W.chrome.webview.addEventListener?.('message', event => this.hostMessage(event?.data));
  },
  firstUrl(stack) {
    for (const line of String(stack || '').split('\n')) { const frame = this.parseFrame(line); if (frame) return frame.url; }
    return '';
  },
  fault() {
    this.errors++;
    if (this.errors < DIAG_LIMIT.faults || this.off) return;
    this.off = true; this.wipe();
  },
  silently(fn) { this.quiet++; try { return fn(); } finally { this.quiet--; } },
  context() {
    const out = { phase: '', mode: '', running: false, dead: false, townPhase: '', mono: now() };
    try {
      out.phase = String(World.phase || ''); out.mode = String(Controller.mode || ''); out.running = !!Hunt.running;
      out.townPhase = String(Town.trip?.phase || ''); out.dead = World.inWorld() && !!World.isDead();
    } catch {}
    return out;
  },
  same(a, b) {
    return a.kind === b.kind && a.module === b.module && a.origin === b.origin && a.name === b.name && a.message === b.message && a.stack === b.stack &&
      a.category === b.category && a.code === b.code && a.text === b.text && a.source === b.source;
  },
  queue(item) {
    const last = this.inbox[this.inbox.length - 1];
    if (last && this.same(last, item)) { last.repeat++; return; }
    if (this.inbox.length >= DIAG_LIMIT.inbox) { this.dropped.rate_limited++; return; }
    item.repeat = 1; item.at = Date.now(); item.context = this.context(); item.mono = item.context.mono; item.seq = Number(Activity.sequence) || 0;
    this.inbox.push(item);
    this.later();
  },
  later() {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => { this.scheduled = false; void this.process(); };
    if (typeof W.requestIdleCallback === 'function') W.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 0);
  },
  error(module, e, origin = 'guard', handled = true) {
    if (this.busy || !this.recording()) return;
    this.busy = true;
    try {
      const object = e !== null && typeof e === 'object';
      this.queue({ kind: 'js_error', module: String(module || ''), origin, handled: !!handled, name: object ? String(e.name ?? '') : '',
        message: object ? String(e.message ?? '') : String(e ?? ''), stack: object && typeof e.stack === 'string' ? e.stack : '' });
    } catch { this.fault(); } finally { this.busy = false; }
  },
  warn(entry) {
    if (this.quiet || this.busy || !entry || entry.level !== 'warn' && entry.level !== 'error' || !this.recording()) return;
    this.busy = true;
    try {
      const failure = entry.failure;
      this.queue({ kind: 'warn', category: String(entry.category || ''), code: String(entry.code || ''), text: String(entry.text || ''),
        refusal: failure ? { source: failure.source, reason: failure.reason, native: failure.nativeErrorCode } : null });
    } catch { this.fault(); } finally { this.busy = false; }
  },
  stop(source, reason) {
    if (this.busy || !this.recording()) return;
    this.busy = true;
    try {
      const code = StopCodes.code(source, reason);
      if (DIAG_QUIET_STOPS.has(code) || code === this.lastStop.code && now() - this.lastStop.at < 1000) return;
      this.lastStop = { code, at: now() };
      this.queue({ kind: 'bot_stop', source, code });
    } catch { this.fault(); } finally { this.busy = false; }
  },
  addTerm(value) {
    if (typeof value !== 'string') return;
    const term = value.trim().toLowerCase();
    if (term.length < DIAG_LIMIT.termMin || term.length > 64) return;
    this.terms.delete(term); this.terms.set(term, true);
    if (this.terms.size > DIAG_LIMIT.terms) this.terms.delete(this.terms.keys().next().value);
  },
  collectTerms(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 3) return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') { if (/name|sender|leader|from|player|character|caster|member/i.test(key)) this.addTerm(item); }
      else if (item && typeof item === 'object') this.collectTerms(item, depth + 1);
    }
  },
  refreshTerms() {
    this.addTerm(World.charName);
    this.addTerm(String(Settings.profileKey || '').replace(/^profile:/, ''));
    for (const e of World.ents.values()) if (e?.kind === 'player') this.addTerm(e.name);
    const gp = World.gp;
    for (const key of ['social', 'partyMatching', 'guild', 'union', 'exchange']) this.collectTerms(gp?.[key]);
  },
  leaks(text) {
    const lower = String(text).toLowerCase();
    for (const term of this.terms.keys()) if (lower.includes(term)) return true;
    return false;
  },
  clean(text) { return this.leaks(text) ? '<x>' : text; },
  code(value) { return typeof value === 'string' && DIAG_CODE.test(value) && !this.leaks(value) ? value : null; },
  slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); },
  ours(url) {
    const u = String(url || '');
    return !!u && (u === this.selfUrl || /userscript\.html\?name=OSB(?:\.user\.js)?(?:&|$)/i.test(u) || /(?:^|[/\\])OSB\.user\.js(?:[?#]|$)/i.test(u));
  },
  parseFrame(line) {
    const v8 = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (v8) return { fn: v8[1] || '', url: v8[2], line: v8[3], column: v8[4] };
    const gecko = /^\s*([^@\s]*)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    return gecko ? { fn: gecko[1], url: gecko[2], line: gecko[3], column: gecko[4] } : null;
  },
  frames(stack) {
    const out = [];
    let first = null;
    for (const line of String(stack || '').split('\n')) {
      if (out.length >= DIAG_LIMIT.frames) break;
      const frame = this.parseFrame(line);
      if (!frame) continue;
      const mine = this.ours(frame.url);
      if (first === null) first = mine;
      if (!mine) { if (out[out.length - 1] !== 'ext') out.push('ext'); continue; }
      const name = frame.fn.replace(/^(new|async) /, '').replace(/ \[as [^\]]*\]$/, '');
      const fn = /^[A-Za-z_$][A-Za-z0-9_$.<>]{0,63}$/.test(name) ? name : '?';
      const place = frame.line.length <= 7 && frame.column.length <= 5 ? '@' + frame.line + ':' + frame.column : '';
      const text = fn + place;
      out.push(DIAG_FRAME.test(text) ? this.clean(text) : 'ext');
    }
    return { frames: out, firstOurs: first === true };
  },
  template(message) {
    let t = String(message || '').slice(0, DIAG_LIMIT.messageChars);
    t = t.replace(/'[^']*'|"[^"]*"|`[^`]*`|«[^»]*»/g, '<q>');
    t = t.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');
    t = t.replace(/[A-Za-z]:\\\S*|\\\\\S+|(?:\/[^\s/]+){2,}\/?/g, '<path>');
    t = t.replace(/\S+@\S+/g, '<x>');
    t = t.replace(/\b0x[0-9a-f]+\b|\d{2,}/gi, '<n>');
    t = t.replace(/[\p{L}\p{N}_]{3,}/gu, word => this.terms.has(word.toLowerCase()) ? '<x>' : word);
    t = t.replace(DIAG_TEMPLATE_WORD, word => word[0] === '<' || this.knownWord(word) ? word : '<x>');
    t = t.replace(/[^A-Za-z0-9 .,:;()<>'_/-]/g, '').replace(/\s+/g, ' ').trim();
    t = t.replace(DIAG_TEMPLATE_WORD, word => word[0] === '<' || this.knownWord(word) ? word : '<x>').slice(0, DIAG_LIMIT.templateChars);
    return this.clean(t);
  },
  knownWord(word) {
    return /^[0-9]+$/.test(word) || /^[A-Za-z0-9_]+$/.test(word) && (DIAG_ENGINE_WORD_SET.has(word.toLowerCase()) || DIAG_KNOWN_WORDS.has(word));
  },
  mapContext(c) {
    const out = { phase: DIAG_PHASES.includes(c.phase) ? c.phase : 'other', mode: DIAG_MODES[c.mode] || (c.running ? 'hunting' : 'other') };
    if (TOWN_PHASES.includes(c.townPhase)) out.town_phase = c.townPhase;
    out.dead = !!c.dead;
    out.uptime_s = clamp(Math.round((c.mono - this.startMono) / 60000) * 60, 0, 2592000);
    return out;
  },
  detail(details) {
    const out = {};
    for (const key of DIAG_DETAIL_NUMBERS) { const v = details?.[key]; if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9) out[key] = this.tenth(v); }
    for (const key of DIAG_DETAIL_FLAGS) if (typeof details?.[key] === 'boolean') out[key] = details[key];
    return out;
  },
  trail(mono, seq = Infinity) {
    const rows = [...Log.lines, ...(Activity.refusals || [])].filter(e => Number.isFinite(e?.mono) && e.mono >= this.since && e.mono <= mono && mono - e.mono <= DIAG_LIMIT.trailMs && (e.id ?? 0) <= seq)
      .sort((a, b) => a.mono - b.mono || (a.id ?? 0) - (b.id ?? 0)).slice(-DIAG_LIMIT.trail);
    const out = [];
    for (const e of rows) {
      const structured = this.code(e.code) && e.code !== 'legacy-message';
      const entry = { s: clamp(Math.round((e.mono - mono) / 1000), -86400, 0), l: ['info', 'warn', 'error', 'cmd'].includes(e.level) ? e.level : 'info',
        c: ACTIVITY_CATEGORIES.includes(e.category) ? e.category : 'engine', k: structured ? e.code : 'legacy' };
      if (!structured) entry.e = Diagnostics.errorCode(e.text);
      if (DIAG_OUTCOMES.includes(e.outcome)) entry.o = e.outcome;
      if (Number.isInteger(e.repeatCount) && e.repeatCount > 1) entry.n = Math.min(e.repeatCount, DIAG_LIMIT.count);
      const d = this.detail(e.details);
      if (Object.keys(d).length) entry.d = d;
      out.push(entry);
    }
    return out;
  },
  build(raw) {
    const kind = raw.kind;
    let body, key;
    if (kind === 'js_error') {
      const type = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.name) && !this.leaks(raw.name) ? raw.name : 'Error';
      const { frames, firstOurs } = this.frames(raw.stack);
      if ((raw.origin === 'window' || raw.origin === 'rejection') && !firstOurs) return null;
      const error = { type };
      if (DIAG_ENGINE_ERRORS.has(type)) error.template = this.template(raw.message);
      const module = this.code(this.slug(raw.module));
      if (module) error.module = module;
      Object.assign(error, { handled: raw.handled, origin: raw.origin, frames });
      body = { error };
      key = [type, module || '', frames.filter(f => f !== 'ext').slice(0, DIAG_LIMIT.fingerprintFrames).map(f => f.replace(/@.*$/, '')).join(','), error.template || ''].join('|');
    } else if (kind === 'warn') {
      const category = ACTIVITY_CATEGORIES.includes(raw.category) ? raw.category : 'engine';
      const structured = this.code(raw.code) && raw.code !== 'legacy-message';
      const warn = { category, code: structured ? raw.code : 'legacy' };
      if (!structured) warn.error_class = Diagnostics.errorCode(raw.text);
      const native = raw.refusal?.native;
      if (raw.refusal && Number.isInteger(native) && native >= 0 && native <= 65535) {
        warn.refusal = { source: DIAG_REFUSAL_SOURCES.includes(raw.refusal.source) ? raw.refusal.source : 'unknown',
          reason: DIAG_REFUSAL_REASONS.includes(raw.refusal.reason) ? raw.refusal.reason : 'unclassified-error', native };
      }
      body = { warn };
      key = [category, warn.code, warn.error_class || '', warn.refusal ? [warn.refusal.source, warn.refusal.reason, warn.refusal.native].join(':') : ''].join('|');
    } else if (kind === 'bot_stop') {
      const code = this.code(raw.code) || 'other', source = ['stop', 'town', 'stop_all'].includes(raw.source) ? raw.source : 'stop';
      body = { stop: { code, source } };
      key = [code, source].join('|');
    } else return null;
    return { kind, body, key: 'osb|' + kind + '|' + key, context: this.mapContext(raw.context), at: raw.at, mono: raw.mono, seq: raw.seq, repeat: raw.repeat || 1 };
  },
  minute(ms) { return new Date(Math.floor(ms / 60000) * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'); },
  async fingerprint(text) {
    const digest = new Uint8Array(await W.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    const fp = Telemetry.hex(digest.subarray(0, 8));
    return fp === DIAG_RESERVED_FP ? '0000000000000001' : fp;
  },
  tenth(value) { return Number.isInteger(value) ? value : Math.round(value * 10) / 10; },
  wire(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value) && this.tenth(value) === value;
    if (typeof value === 'string') return !DIAG_WIRE_TEXT.test(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.every(item => this.wire(item));
    if (typeof value === 'object') return Object.values(value).every(item => this.wire(item));
    return false;
  },
  admit(fp, built) {
    const known = this.pending.get(fp);
    if (known) { known.count = Math.min(known.count + built.repeat, DIAG_LIMIT.count); return; }
    const t = Date.now();
    this.admitted = this.admitted.filter(at => t - at < 3600000);
    if (t - this.dayStart >= 86400000) { this.dayStart = t; this.dayCount = 0; }
    if (this.admitted.length >= DIAG_LIMIT.perHour || this.dayCount >= DIAG_LIMIT.perDay) { this.dropped.rate_limited++; return; }
    this.admitted.push(t); this.dayCount++;
    const count = Math.min(built.repeat, DIAG_LIMIT.count);
    const event = { kind: built.kind, source: 'osb', fp, at: this.minute(built.at), count, ...built.body, context: built.context };
    if (!this.trailed.has(fp) && this.trailed.size < 1000) {
      this.trailed.add(fp);
      const trail = this.trail(built.mono, built.seq);
      if (trail.length) event.trail = trail;
    }
    this.pending.set(fp, { event, mono: built.mono, count });
  },
  process() {
    if (!this.processing) this.processing = this.drain().finally(() => { this.processing = null; });
    return this.processing;
  },
  async drain() {
    try {
      while (this.inbox.length && this.recording()) {
        const gen = this.gen;
        const built = await Telemetry.idle(() => {
          this.refreshTerms();
          return this.inbox.splice(0).map(raw => this.build(raw)).filter(Boolean);
        });
        for (const item of built) {
          const fp = await this.fingerprint(item.key);
          if (gen !== this.gen) return;
          this.admit(fp, item);
        }
      }
    } catch { this.fault(); }
  },
  size(value) { return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length; },
  hostSize(text) { return this.size(text) + 5 * (text.match(/[<>&']/g)?.length || 0); },
  safe(event) { return !this.leaks(JSON.stringify(event)); },
  assemble(config, { preview = false, hosted = false } = {}) {
    const t = Date.now(), chosen = [];
    const limit = hosted ? { events: DIAG_HOSTED.events, bytes: DIAG_HOSTED.bytes } : { events: DIAG_LIMIT.batchEvents, bytes: DIAG_LIMIT.cutBytes };
    const measure = text => hosted ? this.hostSize(text) : this.size(text);
    for (const [fp, p] of [...this.pending].sort((a, b) => a[1].mono - b[1].mono)) {
      if (chosen.length >= limit.events) break;
      if (!preview && t - (this.sentAt.get(fp) ?? -Infinity) < DIAG_LIMIT.sameFingerprintMs) continue;
      let event = { ...p.event, count: p.count };
      if (this.size(event) > DIAG_LIMIT.eventBytes) { const { trail, ...rest } = event; event = rest; }
      if (this.size(event) > DIAG_LIMIT.eventBytes || !this.safe(event) || !this.wire(event) || event.fp === DIAG_RESERVED_FP) { if (!preview) { this.pending.delete(fp); this.dropped.oversize++; } continue; }
      chosen.push({ fp, event });
    }
    if (!preview) for (let i = this.perf.length - 1; i >= 0; i--) if (!this.wire(this.perf[i])) this.perf.splice(i, 1);
    const queued = !hosted && config?.perf ? this.perf.filter(entry => this.wire(entry)).slice(0, DIAG_LIMIT.perfEntries) : [];
    const perf = !hosted && preview && config?.perf && queued.length < DIAG_LIMIT.perfEntries ? [...queued, ...Perf.peek()] : queued;
    if (!chosen.length && !perf.length) return null;
    if (hosted) {
      const message = { type: DIAG_HOSTED.batchType, events: chosen.map(c => c.event) };
      let text = JSON.stringify(message);
      for (let i = message.events.length - 1; i >= 0 && measure(text) > limit.bytes; i--) {
        if (message.events[i].trail) { const { trail, ...rest } = message.events[i]; message.events[i] = rest; text = JSON.stringify(message); }
      }
      const dropped = { rate_limited: 0, oversize: 0, sampled_out: 0 };
      while (measure(text) > limit.bytes && message.events.length) {
        message.events.shift(); const cut = chosen.shift();
        dropped.oversize++;
        if (!preview) { this.pending.delete(cut.fp); this.dropped.oversize++; }
        text = JSON.stringify(message);
      }
      if (!message.events.length) return null;
      return { text, sent: chosen.map(c => ({ fp: c.fp, count: c.event.count })), perf: 0, dropped, message };
    }
    const payload = { schema: 1, app: 'osb', app_version: VERSION, run: this.run || (this.run = Telemetry.hex(Telemetry.bytes(8))), env: {}, events: chosen.map(c => c.event) };
    if (perf.length) payload.perf = perf;
    const dropped = { ...this.dropped };
    const withDropped = () => { if (dropped.rate_limited || dropped.oversize || dropped.sampled_out) payload.dropped = dropped; else delete payload.dropped; return JSON.stringify(payload); };
    let text = withDropped();
    for (let i = payload.events.length - 1; i >= 0 && measure(text) > limit.bytes; i--) {
      if (payload.events[i].trail) { const { trail, ...rest } = payload.events[i]; payload.events[i] = rest; text = withDropped(); }
    }
    while (measure(text) > limit.bytes && payload.events.length) {
      payload.events.shift(); const cut = chosen.shift();
      dropped.oversize = Math.min(dropped.oversize + 1, 100000);
      if (!preview) { this.pending.delete(cut.fp); this.dropped.oversize++; }
      text = withDropped();
    }
    while (measure(text) > limit.bytes && payload.perf?.length) { payload.perf.pop(); if (!payload.perf.length) delete payload.perf; text = withDropped(); }
    if (!payload.events.length && !payload.perf) return null;
    return { text, sent: chosen.map(c => ({ fp: c.fp, count: c.event.count })), perf: payload.perf?.length || 0, dropped, payload };
  },
  async compose(config, options) {
    await this.process();
    return this.assemble(config, options);
  },
  delivered(built, { remember = true } = {}) {
    const t = Date.now();
    for (const { fp, count } of built.sent) {
      const p = this.pending.get(fp);
      if (remember) this.sentAt.set(fp, t);
      if (!p) continue;
      p.count -= count;
      if (p.count <= 0) this.pending.delete(fp);
      else { delete p.event.trail; p.event.at = this.minute(t); }
    }
    this.perf.splice(0, built.perf);
    for (const key of Object.keys(this.dropped)) this.dropped[key] = Math.max(0, this.dropped[key] - (built.dropped[key] || 0));
  },
  async preview() {
    try {
      if (!Telemetry.consented()) return '';
      const built = await this.compose(Telemetry.diagnosticsConfig(), { preview: true });
      return built ? JSON.stringify(built.payload, null, 2) : '';
    } catch { this.fault(); return ''; }
  },
  wipe() {
    this.gen++;
    Perf.stop();
    this.inbox.length = 0; this.pending.clear(); this.sentAt.clear(); this.trailed.clear(); this.terms.clear(); this.perf.length = 0; this.admitted.length = 0;
    this.dayStart = -Infinity; this.dayCount = 0; this.run = ''; this.lastStop = { code: '', at: -Infinity };
    for (const key of Object.keys(this.dropped)) this.dropped[key] = 0;
  },
  reset() {
    this.wipe();
    this.job = { dueAt: 0, failures: 0, nextAfterS: 0, pausedUntil: 0, waitingForConfig: false, configDueAt: 0, consentRetried: false, halted: false, sentAt: 0, result: '' };
  },
  status() {
    return { recording: this.recording(), pending: this.pending.size, queued: this.inbox.length, off: this.off, halted: this.job.halted, sentAt: this.job.sentAt, result: this.job.result };
  },
};
