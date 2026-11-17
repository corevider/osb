const HUB = '__HUB__';
const TOPIC = '__TOPIC__';
const CODE = '__CODE__';
const EVERY_MS = 5000;

function snapshot(B) {
  const w = B.world, name = w.charName;
  if (!name) return null;
  const p = w.gp?.progression || {}, me = w.me(), pose = w.pose();
  const need = B.stats.levels?.[p.level]?.expRequired;
  return {
    name, bot: B.version,
    level: p.level ?? null,
    xpPct: need && p.experience != null ? Math.floor(Number(p.experience) / Number(need) * 1000) / 10 : null,
    hp: Math.round(me.hpPct), mp: Math.round(me.mpPct),
    inWorld: w.inWorld(), dead: w.isDead(), running: !!B.hunt.running, state: String(B.hunt.state || ''),
    note: String(B.reconnect?.message || '').slice(0, 120),
    pos: pose ? { region: pose.regionId, x: Math.round(pose.x), z: Math.round(pose.z) } : null,
    stats: B.stats.display(),
    drops: readDrops(w),
    log: B.log.lines.filter(e => e.level !== 'cmd' && !(e.level === 'info' && QUIET.includes(e.code))).slice(-12)
      .map(e => ({ at: e.lastAt || e.at, level: e.level, text: say(B, e).slice(0, 200) + (e.repeatCount > 1 ? ' ×' + e.repeatCount : '') })),
  };
}

const DROP = /^(SEAL OF SUN: )?(?:\(Notice\):\s*)?(.+?) has dropped (.+?)(?: \(Seal Of (Star|Moon|Sun)\))?(?: from (.+?))?\.?$/i;
const drops = [], seen = { chat: null, notices: null };
function readDrops(w) {
  for (const [kind, items] of [['chat', w.gp?.chat?.lines], ['notices', w.gp?.notices]]) {
    if (!Array.isArray(items)) continue;
    const before = seen[kind];
    for (const line of items) {
      if (typeof line?.sequence !== 'number' || before !== null && line.sequence <= before) continue;
      seen[kind] = Math.max(seen[kind] ?? -1, line.sequence);
      const m = before !== null && DROP.exec(String(line.text || ''));
      if (!m || m[2].toLowerCase() !== String(w.charName).toLowerCase()) continue;
      const seal = m[1] || line.sunDrop === true || /sun/i.test(m[4]) ? 'Sun' : /moon/i.test(m[4]) ? 'Moon' : '';
      if (seal && !drops.some(d => d.seal === seal && d.item === m[3] && Date.now() - d.at < 10000)) drops.push({ at: Date.now(), seal, item: m[3].slice(0, 80), from: (m[5] || '').slice(0, 80) });
    }
    seen[kind] ??= -1;
  }
  if (drops.length > 20) drops.splice(0, drops.length - 20);
  return drops;
}

const QUIET = ['target-selected', 'target-search'];
function say(B, e) {
  try { return String(B.activity.userMessage(e)); } catch { return String(e.text); }
}

function send() {
  const B = unsafeWindow.SROLean;
  if (!B) return;
  let snap;
  try { snap = snapshot(B); } catch (e) { console.warn('[OSB live] bot layout changed:', e); return; }
  if (!snap) return;
  const url = hub + '/report', headers = { 'Content-Type': 'application/json', 'X-Code': CODE }, body = JSON.stringify(snap);
  if (typeof GM_xmlhttpRequest === 'function') GM_xmlhttpRequest({ method: 'POST', url, headers, data: body });
  else fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) }).catch(relocate);
}

let hub = HUB, lookedAt = 0;
function relocate() {
  if (Date.now() - lookedAt < 120000) return;
  lookedAt = Date.now();
  fetch('https://ntfy.sh/' + TOPIC + '/raw?poll=1&since=12h').then(r => r.text()).then(text => {
    const found = text.trim().split('\n').pop();
    if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(found)) hub = found;
  }).catch(() => {});
}

if (typeof window === 'undefined') module.exports = { snapshot };
else if (CODE.startsWith('__')) console.warn('[OSB live] not configured: install this script from the hub\'s "Install reporter" link.');
else {
  try {
    const src = 'setInterval(()=>postMessage(0),' + EVERY_MS + ')';
    new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))).onmessage = send;
  } catch { setInterval(send, EVERY_MS); }
}
