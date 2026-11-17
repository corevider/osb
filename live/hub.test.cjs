// Run: node hub.test.cjs   (starts a hub on a spare port with the tunnel off)
const assert = require('node:assert'), net = require('node:net'), fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 41730, base = 'http://127.0.0.1:' + PORT;
const hub = spawn(process.execPath, [path.join(__dirname, 'hub.js')], { env: { ...process.env, PORT: String(PORT), TUNNEL: 'off' }, stdio: ['ignore', 'pipe', 'inherit'] });
// fetch() refuses to send a malformed request target, so that one goes over a plain socket.
const raw = text => new Promise(done => {
  let out = '';
  const s = net.connect(PORT, '127.0.0.1', () => s.write(text));
  s.on('data', d => { out += d; }).on('close', () => done(out)).on('error', () => done(out));
  setTimeout(() => s.destroy(), 1000);
});

(async () => {
  await new Promise(ready => hub.stdout.once('data', ready));
  const auth = { 'X-Code': fs.readFileSync(path.join(__dirname, '.code'), 'utf8').trim() };
  const post = body => fetch(base + '/report', { method: 'POST', headers: auth, body });

  // Needs no code and can arrive through the tunnel: it must get 400 and leave the hub running.
  assert.match(await raw('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'), /^HTTP\/1\.1 400/);
  assert.equal((await fetch(base + '/')).status, 200);

  assert.equal((await fetch(base + '/state')).status, 403);
  assert.equal((await fetch(base + '/state', { headers: { 'X-Code': 'wrong' } })).status, 403);
  assert.equal((await post('garbage')).status, 400);
  assert.equal((await post(JSON.stringify({ name: 'Tester', at: 1, level: 7 }))).status, 204);
  assert.equal((await post(JSON.stringify({ name: 'Tester', level: 8 }))).status, 204);

  // A browser with no userscript manager posts from the game page: the preflight carries no code and must pass, for that origin only.
  const game = { Origin: 'https://opensro.online' };
  const pre = await fetch(base + '/report', { method: 'OPTIONS', headers: game });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), game.Origin);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-code/);
  assert.equal((await fetch(base + '/report', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(base + '/report', { method: 'POST', headers: { ...auth, ...game }, body: JSON.stringify({ name: 'Tester', level: 8 }) })).headers.get('access-control-allow-origin'), game.Origin);
  assert.equal((await fetch(base + '/state', { method: 'OPTIONS', headers: game })).status, 403); // nothing else is opened

  const script = await (await fetch(base + '/install/' + auth['X-Code'] + '/reporter.user.js')).text();
  assert.ok(script.startsWith('// ==UserScript==\n// @name         OSB live reporter\n') && script.includes('\n// @match        https://opensro.online/play*\n')); // the hub adds the header a userscript manager needs
  assert.ok(script.includes("const HUB = '" + base + "';") && !script.includes('__HUB__') && /const TOPIC = 'osblive-[0-9a-f]{32}';/.test(script)); // a local install reports to this machine

  const state = await (await fetch(base + '/state', { headers: auth })).json();
  assert.equal(state.reports.length, 1); // the same character is replaced, not added
  assert.equal(state.reports[0].level, 8);
  assert.ok(Math.abs(state.now - state.reports[0].at) < 5000); // stamped with hub time, and the hub's "now" sent alongside
  console.log('ok');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => hub.kill());
