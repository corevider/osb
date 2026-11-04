// A manual report: the player previews exactly what would be sent, then copies it, saves it, or presses Send.
// Nothing is sent before Send, nothing is saved, and a failed send is tried at most three times in this page session.
const REPORT_DESCRIPTION_MAX = 1000;
const REPORT_SCREENSHOT_MAX = 768 * 1024;
const REPORT_DELAYS_MS = [0, 60000, 300000];
const Reports = {
  draft: null,
  open() {
    if (!this.draft) {
      const base = JSON.parse(Diagnostics.report());
      this.draft = { base, diagnostics: this.fitDiagnostics(base), description: '', kind: 'bug', image: null, url: '', sending: false, confirming: false, capturing: false, sent: false, cancelled: false, cancel: null, stream: null };
    }
    UI.showReport();
    this.render();
  },
  // The server accepts at most 600 keys, 32 KB, depth 5, 50 array items and 300-character strings. Older recent states are dropped
  // first, so the newest ones still fit. The preview shows this exact object.
  shape(value, depth, budget) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !/e/i.test(String(value)) && String(value).length <= 20 && Math.abs(value) <= 1e15 ? value : null;
    if (typeof value === 'string') return Array.from(value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')).slice(0, 300).join('');
    if (depth > 5 || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) return value.slice(0, 50).map(item => this.shape(item, depth + 1, budget) ?? null);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || item === undefined) continue;
      if (++budget.keys > 600) break;
      const shaped = this.shape(item, depth + 1, budget);
      if (shaped !== undefined) out[key] = shaped;
    }
    return out;
  },
  fitDiagnostics(base) {
    const states = Array.isArray(base.recentStates) ? base.recentStates : [];
    for (let keep = states.length; keep >= 0; keep--) {
      const budget = { keys: 0 }, shaped = this.shape({ ...base, recentStates: states.slice(states.length - keep) }, 1, budget);
      if (budget.keys <= 600 && new Blob([JSON.stringify(shaped)]).size <= 30 * 1024 && new Blob([JSON.stringify(shaped, null, 2)]).size <= 40 * 1024) return shaped;
    }
    return { app: base.app, version: base.version };
  },
  payload() {
    const d = this.draft, description = d.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    return { schema: 1, kind: d.kind, app: 'osb', app_version: VERSION, os: Telemetry.os(), locale: Telemetry.locale(),
      ...(description ? { description } : {}), ...(d.kind === 'bug' ? { diagnostics: d.diagnostics } : {}) };
  },
  text() {
    return this.draft ? JSON.stringify(this.payload(), null, 2) : '';
  },
  describe(value) {
    if (!this.draft || this.draft.sending || this.draft.sent || this.draft.confirming) return;
    this.draft.description = String(value).slice(0, REPORT_DESCRIPTION_MAX);
    this.render();
  },
  setKind(kind) {
    if (!this.draft || this.draft.sending || this.draft.sent || this.draft.confirming || !['bug', 'feature'].includes(kind)) return;
    this.draft.kind = kind;
    this.render();
  },
  notice(text) { if (UI.reportStatus) UI.reportStatus.textContent = text; },
  render() {
    const d = this.draft;
    if (!UI.reportBox || !d) return;
    const text = this.text(), busy = d.sending || d.capturing, locked = d.sending || d.sent || d.confirming;
    if (UI.reportText.value !== text) UI.reportText.value = text;
    if (UI.reportDescription) UI.reportDescription.disabled = locked;
    if (UI.reportKind) { UI.reportKind.disabled = locked; if (UI.reportKind.value !== d.kind) UI.reportKind.value = d.kind; }
    if (UI.reportConfirm) UI.reportConfirm.hidden = !d.confirming;
    if (UI.reportAsk) { UI.reportAsk.disabled = busy || d.sent || d.confirming; UI.reportAsk.textContent = d.sending ? 'Sending…' : d.sent ? 'Sent' : 'Send'; }
    if (UI.reportSend) { UI.reportSend.disabled = busy || d.sent; }
    if (UI.reportCapture) UI.reportCapture.disabled = busy || d.sent || !W.navigator?.mediaDevices?.getDisplayMedia;
    if (UI.reportRemove) UI.reportRemove.disabled = busy || !d.image || d.sent;
    if (UI.reportImage) { UI.reportImage.hidden = !d.url; if (d.url) UI.reportImage.src = d.url; else UI.reportImage.removeAttribute('src'); }
    if (UI.reportNote) UI.reportNote.textContent = Telemetry.auth() ? 'Usage statistics are on: this report is linked to your install ID.' : Telemetry.consented() ? 'Your install is not registered yet, so this report is anonymous. Keep the report code if you want it deleted later.' : 'Usage statistics are off, so this report is anonymous. Keep the report code if you want it deleted later.';
  },
  dropImage(d) {
    if (d.url) URL.revokeObjectURL(d.url);
    d.image = null; d.url = '';
  },
  removeImage() {
    const d = this.draft;
    if (!d || d.sending || d.capturing || d.sent) return;
    this.dropImage(d);
    this.render();
  },
  close() {
    const d = this.draft;
    if (d) {
      d.cancelled = true; d.cancel?.();
      this.dropImage(d);
      d.stream?.getTracks().forEach(track => track.stop());
    }
    this.draft = null;
    if (UI.reportText) UI.reportText.value = '';
    if (UI.reportDescription) UI.reportDescription.value = '';
    if (UI.reportImage) UI.reportImage.removeAttribute('src');
    if (UI.reportBox) UI.reportBox.hidden = true;
  },
  async copy() {
    if (!this.draft) return;
    try {
      await W.navigator.clipboard.writeText(this.text());
      this.notice('Report copied. Paste it into a GitHub issue or send it to the OSB maintainers.');
    } catch {
      this.notice('Clipboard unavailable. Select the text above and copy it, or save the report as a file.');
    }
  },
  save() {
    if (!this.draft) return;
    const url = URL.createObjectURL(new Blob([this.text()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'osb-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notice('Report saved as osb-report.json. Attach it to a GitHub issue.');
  },
  // One frame of the tab the player picks in the browser's own prompt: at most 1280 px, JPEG, 768 KB. It is shown before sending.
  async frame(stream) {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    let timer, frameId;
    try {
      return await Promise.race([
        (async () => {
          await video.play();
          if (video.requestVideoFrameCallback) await new Promise(resolve => { frameId = video.requestVideoFrameCallback(resolve); });
          if (!video.videoWidth || !video.videoHeight) throw Error('empty frame');
          for (const [limit, quality] of [[1280, 0.85], [1280, 0.7], [960, 0.7], [800, 0.55]]) {
            const scale = Math.min(1, limit / video.videoWidth, limit / video.videoHeight);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (blob && blob.type === 'image/jpeg' && blob.size > 0 && blob.size <= REPORT_SCREENSHOT_MAX) return blob;
          }
          throw Error('capture too large');
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('capture timeout')), 10000); }),
      ]);
    } finally {
      clearTimeout(timer);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      video.pause(); video.srcObject = null;
    }
  },
  async capture() {
    const d = this.draft;
    if (!d || d.sending || d.capturing || d.sent) return;
    if (!W.navigator?.mediaDevices?.getDisplayMedia) { this.notice('Screenshots are not available in this browser. You can send the report without one.'); return; }
    let stream;
    d.capturing = true; this.render();
    this.notice('Your browser asks which tab to capture. OSB takes one picture of it and shows it here before anything is sent.');
    try {
      stream = await W.navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true });
      if (this.draft !== d) return;
      d.stream = stream;
      const image = await this.frame(stream);
      if (this.draft !== d) return;
      this.dropImage(d);
      d.image = image; d.url = URL.createObjectURL(image);
      this.notice('Screenshot added. Check it below; Remove screenshot takes it out.');
    } catch {
      if (this.draft === d) this.notice('Screenshot cancelled or unavailable. You can still send the report without one.');
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      if (d.stream === stream) d.stream = null;
      d.capturing = false; this.render();
    }
  },
  // ---- Sending
  pause(d, ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      d.cancel = () => { clearTimeout(timer); resolve(); };
    });
  },
  // Only a real click or key press can start a send: a script cannot press Send for the player.
  ask(event) {
    const d = this.draft;
    if (event?.isTrusted !== true || !d || d.sending || d.capturing || d.sent) return;
    if (d.kind === 'feature' && !d.description.trim()) { this.notice('Describe your idea before sending.'); return; }
    d.confirming = true; this.render();
    this.notice('Send this report to the OSB team at api.osb.lol? The text above is exactly what is sent.');
  },
  cancelAsk() {
    const d = this.draft;
    if (!d || d.sending) return;
    d.confirming = false; this.render();
    this.notice('Nothing was sent.');
  },
  async send(event) {
    const d = this.draft;
    if (event?.isTrusted !== true || !d || !d.confirming || d.sending || d.capturing || d.sent) return;
    d.confirming = false;
    d.sending = true; d.cancelled = false; this.render(); this.notice('Sending…');
    let result;
    try { result = await this.deliver(d); } catch { result = { sent: false }; }
    d.sending = false; d.cancel = null;
    if (this.draft !== d) return;
    if (result.sent) {
      d.sent = true; this.dropImage(d);
      this.notice((result.code ? `Sent. Your report code is ${result.code}. Keep it if you want the report deleted later.` : 'Sent.') + (result.note ? ' ' + result.note : ''));
    } else if (!d.cancelled) this.notice('Not sent. Copy or save the report and try later.');
    this.render();
  },
  async deliver(d) {
    let wait = 0;
    for (let attempt = 0; attempt < REPORT_DELAYS_MS.length; attempt++) {
      if (attempt) {
        wait = Math.max(Telemetry.timing.minWaitMs, Telemetry.jitter(REPORT_DELAYS_MS[attempt]), wait);
        this.notice(`Sending… will try again in ${Math.round(wait / 1000)} s (attempt ${attempt + 1} of ${REPORT_DELAYS_MS.length}). Close this window to cancel.`);
        await this.pause(d, wait);
        if (d.cancelled || this.draft !== d) return { sent: false };
        this.notice(`Sending… (attempt ${attempt + 1} of ${REPORT_DELAYS_MS.length})`);
      }
      const r = await this.attempt(d);
      if (r.sent || r.final) return r;
      wait = r.retryAfterMs ?? 0;
    }
    return { sent: false };
  },
  async attempt(d) {
    const config = await Telemetry.reportConfig();
    if (!config) return { retry: true };
    if (!config.reports.enabled) return { final: true };
    const text = this.text(), withImage = !!d.image && config.reports.screenshots;
    const form = () => {
      const body = new FormData();
      body.append('report', new Blob([text], { type: 'application/json' }), 'report.json');
      if (withImage) body.append('screenshot', d.image, d.image.type === 'image/png' ? 'screenshot.png' : 'screenshot.jpg');
      return body;
    };
    const auth = Telemetry.auth();
    let r = await Telemetry.request({ path: '/reports', method: 'POST', body: form(), auth });
    if (r.status === 401 && auth) r = await Telemetry.request({ path: '/reports', method: 'POST', body: form() });
    if (r.ok) {
      const code = typeof r.body?.code === 'string' && /^R-[0-9A-HJKMNP-TV-Z]{8}$/.test(r.body.code) ? r.body.code : '';
      const note = d.image && !withImage ? 'The screenshot was not sent: the server is not taking screenshots right now.' : r.body?.screenshot === 'dropped' ? 'The server did not keep the screenshot.' : '';
      return { sent: true, code, note };
    }
    if (r.network || r.status === 429 || r.status >= 500 && r.code !== 'disabled') return { retry: true, retryAfterMs: r.retryAfterMs };
    return { final: true };
  },
};
