const PERF_BINS = 32;
const PERF_TICK = { low: 0.05, high: 1000, lateMs: 50 };
const PERF_GAP = { low: 10, high: 10000, lateMs: 250 };
const PERF_SAMPLE_MS = 60000;
const PERF_MAX_MS = 600000;
const PERF_MAX_LONG_MS = 86400000;
const PERF_MAX_MB = 262144;
const Perf = {
  on: false, last: -1, intervalMs: 0, epoch: 0, timer: 0, observer: null,
  tickBins: new Uint32Array(PERF_BINS), gapBins: new Uint32Array(PERF_BINS),
  ticks: 0, gaps: 0, tickMin: Infinity, tickMax: 0, gapMin: Infinity, gapMax: 0, lateTicks: 0, lateGaps: 0,
  tasks: 0, taskMs: 0, heap: null, samples: 0, spanMono: 0, spanEpoch: 0,
  tickScale: PERF_BINS / Math.log(PERF_TICK.high / PERF_TICK.low),
  gapScale: PERF_BINS / Math.log(PERF_GAP.high / PERF_GAP.low),
  step() {
    const started = this.begin();
    Controller.tick();
    this.end(started);
  },
  begin() {
    if (!this.on) return -1;
    const t = now();
    if (this.last >= 0) {
      const gap = t - this.last;
      const bin = gap > PERF_GAP.low ? Math.floor(Math.log(gap / PERF_GAP.low) * this.gapScale) : 0;
      this.gapBins[bin > 31 ? 31 : bin]++;
      this.gaps++;
      if (gap > this.gapMax) this.gapMax = gap;
      if (gap < this.gapMin) this.gapMin = gap;
      if (gap > PERF_GAP.lateMs) this.lateGaps++;
    }
    this.last = t;
    return t;
  },
  end(started) {
    if (started < 0 || !this.on) return;
    const duration = now() - started;
    const bin = duration > PERF_TICK.low ? Math.floor(Math.log(duration / PERF_TICK.low) * this.tickScale) : 0;
    this.tickBins[bin > 31 ? 31 : bin]++;
    this.ticks++;
    if (duration > this.tickMax) this.tickMax = duration;
    if (duration < this.tickMin) this.tickMin = duration;
    if (duration > PERF_TICK.lateMs) this.lateTicks++;
  },
  sync() {
    const config = !Diag.recording() ? null : Telemetry.hosted() ? Diag.hostedPerfConfig() : Telemetry.diagnosticsConfig();
    const wanted = !!config?.perf;
    this.intervalMs = wanted ? config.perf_interval_s * 1000 : 0;
    if (wanted === this.on) return;
    if (wanted) this.start();
    else this.stop();
  },
  start() {
    this.on = true;
    this.clear();
    this.observe();
    this.schedule();
  },
  stop() {
    this.on = false; this.epoch++; this.last = -1;
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    try { this.observer?.disconnect(); } catch {}
    this.observer = null;
    this.clear();
    this.heap = null;
  },
  clear() {
    this.tickBins.fill(0); this.gapBins.fill(0);
    this.ticks = 0; this.gaps = 0; this.tickMin = Infinity; this.tickMax = 0; this.gapMin = Infinity; this.gapMax = 0; this.lateTicks = 0; this.lateGaps = 0;
    this.tasks = 0; this.taskMs = 0; this.samples = 0;
    this.spanMono = now(); this.spanEpoch = Date.now();
  },
  observe() {
    const Observer = W.PerformanceObserver;
    if (typeof Observer !== 'function' || !Observer.supportedEntryTypes?.includes?.('longtask')) return;
    try {
      this.observer = new Observer(list => this.longTasks(list.getEntries()));
      this.observer.observe({ type: 'longtask' });
    } catch { this.observer = null; }
  },
  longTasks(entries) {
    if (!this.on) return;
    for (const entry of entries) {
      const duration = Number(entry?.duration);
      if (!Number.isFinite(duration) || duration < 0) continue;
      this.tasks++; this.taskMs += duration;
    }
  },
  schedule() {
    if (this.timer) return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => { this.timer = 0; void this.sample(epoch); }, PERF_SAMPLE_MS);
  },
  async sample(epoch) {
    try {
      await Telemetry.idle(() => { if (epoch === this.epoch && this.on) this.take(); });
    } catch { Diag.fault(); }
    if (epoch === this.epoch && this.on) this.schedule();
  },
  take() {
    this.heap = this.readHeap() || this.heap;
    this.samples++;
    if (now() - this.spanMono >= this.intervalMs) this.close();
  },
  readHeap() {
    const memory = typeof performance !== 'undefined' ? performance.memory : null;
    const mb = bytes => Math.min(PERF_MAX_MB, Math.max(0, Math.round(Number(bytes) / 1048576)));
    if (!memory || !Number.isFinite(Number(memory.usedJSHeapSize)) || !Number.isFinite(Number(memory.totalJSHeapSize))) return null;
    return { used: mb(memory.usedJSHeapSize), total: mb(memory.totalJSHeapSize) };
  },
  close() {
    const entry = this.entry({ preview: false });
    this.clear();
    if (Telemetry.hosted()) { Diag.hostPerfDone(entry); return; }
    if (!entry || !Diag.wire(entry)) return;
    Diag.perf.push(entry);
    while (Diag.perf.length > DIAG_LIMIT.perfEntries) Diag.perf.shift();
  },
  peek() {
    if (!this.on) return [];
    const entry = this.entry({ preview: true });
    return entry && Diag.wire(entry) ? [entry] : [];
  },
  entry({ preview }) {
    const heap = this.heap || (preview ? this.readHeap() : null);
    const tick = this.summary(this.tickBins, this.ticks, this.tickMin, this.tickMax, this.lateTicks, PERF_TICK, this.tickScale);
    const gap = this.summary(this.gapBins, this.gaps, this.gapMin, this.gapMax, this.lateGaps, PERF_GAP, this.gapScale);
    const tasks = this.observer ? { count: Math.min(this.tasks, DIAG_LIMIT.count), total_ms: Diag.tenth(Math.min(this.taskMs, PERF_MAX_LONG_MS)) } : null;
    if (!heap && !tick && !gap && !tasks) return null;
    const seconds = Math.round((now() - this.spanMono) / 1000);
    const entry = { at: Diag.minute(this.spanEpoch), span_s: Math.min(86400, Math.max(60, seconds)), samples: Math.min(1440, Math.max(1, this.samples)) };
    if (heap) entry.js_heap_mb = heap;
    if (tick) entry.tick_ms = tick;
    if (gap) entry.gap_ms = gap;
    if (tasks) entry.long_tasks = tasks;
    return entry;
  },
  summary(bins, total, min, max, late, range, scale) {
    if (!total) return null;
    const round = value => Math.round(Math.min(PERF_MAX_MS, Math.max(0, value)) * 10) / 10;
    const quantile = q => {
      const rank = q * total;
      let below = 0;
      for (let i = 0; i < PERF_BINS; i++) {
        if (!bins[i]) continue;
        if (below + bins[i] >= rank) {
          const value = range.low * Math.exp((i + (rank - below) / bins[i]) / scale);
          return Math.min(max, Math.max(min, value));
        }
        below += bins[i];
      }
      return max;
    };
    return { p50: round(quantile(0.5)), p95: round(quantile(0.95)), p99: round(quantile(0.99)), max: round(max), late_pct: Math.round(Math.min(100, late / total * 100) * 10) / 10 };
  },
};
