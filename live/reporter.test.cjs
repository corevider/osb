const assert = require('node:assert');
const { snapshot } = require('./reporter.js');

const bot = (over = {}) => ({
  version: '1.2.261',
  world: {
    charName: 'Tester', gp: { progression: { level: 42, experience: '250', gold: '9' } },
    me: () => ({ hpPct: 87.6, mpPct: 40.2 }), pose: () => ({ regionId: 25000, x: 10.7, z: -3.2 }),
    inWorld: () => true, isDead: () => false, ...over.world,
  },
  hunt: { running: true, state: 'fight' },
  stats: { levels: { 42: { expRequired: '1000' } }, display: () => ({ kills: '12', gold: '+3,400' }) },
  reconnect: { message: '' },
  activity: { userMessage: e => e.userText || e.text },
  ...over.top,
  log: over.log || { lines: [{ at: 1, level: 'cmd', text: 'hidden' }, ...Array.from({ length: 20 }, (_, i) => ({ at: i, level: 'info', text: 'line ' + i }))] },
});

const s = snapshot(bot());
assert.equal(s.name, 'Tester');
assert.equal(s.level, 42);
assert.equal(s.xpPct, 25);
assert.equal(s.hp, 88);
assert.deepEqual(s.pos, { region: 25000, x: 11, z: -3 });
assert.equal(s.log.length, 12);
assert.ok(s.log.every(e => e.level !== 'cmd'));
assert.equal(s.log.at(-1).text, 'line 19');
JSON.stringify(s);

assert.equal(snapshot(bot({ world: { charName: '' } })), null);
const out = snapshot(bot({ world: { gp: null, pose: () => null } }));
assert.equal(out.level, null);
assert.equal(out.xpPct, null);
assert.equal(out.pos, null);

const lines = { lines: [
  { at: 1, level: 'info', code: 'target-selected', text: 'Selected target 1112907 by attackers priority.', userText: 'Targeting Yeti.' },
  { at: 2, lastAt: 9, level: 'info', code: 'pickup-confirmed', text: 'Inventory gain observed for pickup 366883.', userText: 'Picked up Dagger.', repeatCount: 3 },
  { at: 3, level: 'warn', code: 'target-selected', text: 'raw', userText: 'Targeting Yeti, it is attacking you.' },
  { at: 4, level: 'info', text: 'Hunting started.' },
] };
assert.deepEqual(snapshot(bot({ log: lines })).log, [
  { at: 9, level: 'info', text: 'Picked up Dagger. ×3' },
  { at: 3, level: 'warn', text: 'Targeting Yeti, it is attacking you.' },
  { at: 4, level: 'info', text: 'Hunting started.' },
]);
const broken = snapshot(bot({ log: lines, top: { activity: { userMessage() { throw Error('renamed'); } } } }));
assert.equal(broken.log[0].text, 'Inventory gain observed for pickup 366883. ×3');
const line = (sequence, text) => ({ sequence, channel: 7, text });
const withChat = (lines, notices) => bot({ world: { gp: { chat: { lines }, notices } } });
const old = line(1, 'Tester has dropped Old Hat (Seal Of Moon) from Yeti');
assert.deepEqual(snapshot(withChat([old], [])).drops, []);
const found = snapshot(withChat([old,
  line(2, 'Tester has dropped Gale Alette (Seal Of Moon) from Wing Tribe Chaser'),
  line(3, 'Tester has dropped Leopard Hose (Seal Of Star) from Wing Tribe Attacker'),
  line(4, 'Other has dropped Gem Ring (Seal Of Moon) from Wing Tribe Attacker'),
], [{ sequence: 1, text: 'SEAL OF SUN: tester has dropped Girin Horn Coronet from Wing Tribe Chaser' }])).drops;
assert.deepEqual(found.map(d => [d.seal, d.item, d.from]), [['Moon', 'Gale Alette', 'Wing Tribe Chaser'], ['Sun', 'Girin Horn Coronet', 'Wing Tribe Chaser']]);
assert.equal(snapshot(withChat([line(2, 'Tester has dropped Gale Alette (Seal Of Moon) from Wing Tribe Chaser')], [])).drops.length, 2);

const signed = (url, code = 'code') => url + ' ' + require('node:crypto').createHmac('sha256', code).update(url).digest('hex');
const posts = [], timers = [], flush = () => new Promise(r => setTimeout(r, 5));
const fakeFetch = (url, o) => {
  posts.push([url, o]);
  if (url.startsWith('https://ntfy.sh/')) return Promise.resolve({ text: async () => [signed('https://old-one.trycloudflare.com'), signed('https://new-one.trycloudflare.com'),
    'https://unsigned.trycloudflare.com', 'https://forged.trycloudflare.com ' + 'ab'.repeat(32), signed('https://other-code.trycloudflare.com', 'another code'), ''].join('\n') });
  return url.startsWith('https://new-one.') ? Promise.resolve({ ok: true }) : Promise.reject(Error('gone'));
};
new Function('window', 'unsafeWindow', 'fetch', 'Worker', 'setInterval', require('node:fs').readFileSync(__dirname + '/reporter.js', 'utf8')
  .replace('__CODE__', 'code').replace('__HUB__', 'https://dead-one.trycloudflare.com').replace('__TOPIC__', 'osblive-topic'))(
  {}, { SROLean: bot() }, fakeFetch, undefined, f => timers.push(f));
(async () => {
  timers[0](); await flush(); timers[0](); await flush();
  assert.deepEqual(posts.map(p => p[0]), ['https://dead-one.trycloudflare.com/report', 'https://ntfy.sh/osblive-topic/raw?poll=1&since=12h', 'https://new-one.trycloudflare.com/report']);
  assert.equal(posts[2][1].headers['X-Code'], 'code');
  assert.equal(JSON.parse(posts[2][1].body).name, 'Tester');
  console.log('ok');
})();
