const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 4173;
const GAME = 'https://opensro.online';
const file = name => path.join(__dirname, name);

let CODE = '';
try { CODE = fs.readFileSync(file('.code'), 'utf8').trim(); } catch {}
if (!CODE) { CODE = crypto.randomBytes(18).toString('base64url'); fs.writeFileSync(file('.code'), CODE + '\n', { mode: 0o600 }); }
const allowed = given => {
  const a = Buffer.from(String(given ?? '')), b = Buffer.from(CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

let tunnelUrl = '';
const TOPIC = 'osblive-' + crypto.createHash('sha256').update(CODE).digest('hex').slice(0, 32);
const sign = url => crypto.createHmac('sha256', CODE).update(url).digest('hex');
function announce() {
  fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', body: tunnelUrl + ' ' + sign(tunnelUrl) }).then(r => { if (!r.ok) throw Error(r.status); })
    .catch(() => console.log('  Could not reach ntfy.sh: OSB Manager will not find the new address by itself until the next try in 6 hours.'));
}
const HEADER = ['==UserScript==', '@name         OSB live reporter', '@namespace    osb-live', '@version      1.6.0',
  '@description  Sends the bot\'s live stats to the OSB live hub on this machine. Read-only: never sends game commands.',
  '@match        https://opensro.online/play*', '@run-at       document-idle', '@grant        GM_xmlhttpRequest', '@grant        unsafeWindow',
  '@connect      127.0.0.1', '@connect      trycloudflare.com', '@connect      ntfy.sh', '@noframes', '==/UserScript==']
  .map(line => '// ' + line + '\n').join('') + '\n';
const last = new Map();
const FORGET_MS = 24 * 3600 * 1000;

function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://hub'); } catch { return res.writeHead(400).end(); }
  const page = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...page, 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(file('dashboard/index.html')));
  }
  const install = url.pathname.match(/^\/install\/([^/]+)\/reporter\.user\.js$/);
  if (req.method === 'GET' && install && allowed(install[1])) {
    res.writeHead(200, { ...page, 'Content-Type': 'text/javascript; charset=utf-8' });
    const hub = tunnelUrl && req.headers.host === tunnelUrl.slice(8) ? tunnelUrl : 'http://127.0.0.1:' + PORT;
    return res.end(HEADER + fs.readFileSync(file('reporter.js'), 'utf8').replace('__CODE__', CODE).replace('__HUB__', hub).replace('__TOPIC__', TOPIC));
  }
  const cors = req.headers.origin === GAME ? { 'Access-Control-Allow-Origin': GAME } : {};
  if (req.method === 'OPTIONS' && url.pathname === '/report') {
    return res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type, x-code',
      'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' }).end();
  }
  if (!allowed(req.headers['x-code'])) return res.writeHead(403, cors).end();

  if (req.method === 'GET' && url.pathname === '/state') {
    res.writeHead(200, { ...page, 'Content-Type': 'application/json' });
    for (const [name, report] of last) if (Date.now() - report.at > FORGET_MS) last.delete(name);
    return res.end(JSON.stringify({ now: Date.now(), reports: [...last.values()] }));
  }
  if (req.method === 'POST' && url.pathname === '/report') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
    return req.on('end', () => {
      let report;
      try { report = JSON.parse(body); } catch {}
      if (!report || typeof report.name !== 'string' || !report.name || report.name.length > 40) return res.writeHead(400).end();
      report.at = Date.now();
      last.set(report.name, report);
      res.writeHead(204, cors).end();
    });
  }
  res.writeHead(404).end();
}

http.createServer((req, res) => {
  try { handle(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
}).on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is in use: the hub is probably already running in another window.' : e);
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => {
  const base = 'http://127.0.0.1:' + PORT;
  const phone = process.argv.includes('--phone');
  console.log('OSB live hub running. Keep this window open; Ctrl-C stops it.\n  Dashboard:        ' + base + '/#' + CODE + '\n  Install reporter: ' + base + '/install/' + CODE + '/reporter.user.js'
    + (phone ? '' : '\n  Local only: nothing leaves this machine. For a phone link, start the hub with --phone (see README.md).'));
  if (phone) tunnel();
});

function tunnel() {
  console.log('  Phone link on: your reports and the dashboard page pass through a Cloudflare quick tunnel (trycloudflare.com),\n'
    + '  the tunnel address, signed with your code, is posted to ntfy.sh, and its name is looked up on 1.1.1.1.');
  const t = require('node:child_process').spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:' + PORT], { stdio: ['ignore', 'ignore', 'pipe'] });
  let linked = false;
  t.on('error', () => console.log('  Phone link:       not available, cloudflared is not installed (see README.md)'));
  t.on('exit', () => { if (linked) console.log('The tunnel stopped. Restart the hub to get a new phone link.'); });
  require('node:readline').createInterface({ input: t.stderr }).on('line', line => {
    const url = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url && !linked) {
      linked = true; tunnelUrl = url[0];
      inDns(url[0].slice(8)).then(() => {
        console.log('  Phone link:       ' + url[0] + '/#' + CODE + '\n  For OSB Manager:  ' + url[0] + '/install/' + CODE + '/reporter.user.js\n'
          + '                    (once: Scripts, Add from URL, then reload the game windows)');
        announce(); setInterval(announce, 6 * 3600 * 1000);
      });
    }
    else if (/\bERR\b/.test(line)) console.log(line);
  });
  process.on('exit', () => t.kill());
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit());
}

async function inDns(host) {
  const dns = new (require('node:dns').promises.Resolver)();
  dns.setServers(['1.1.1.1']);
  for (let i = 0; i < 30; i++) {
    try { await dns.resolve4(host); return; } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
}
