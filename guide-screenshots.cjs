// Takes the panel screenshots used by the setup guide, from the bot's own simulated game page.
// Usage: node guide-screenshots.cjs <folder containing playwright's node_modules> <output folder> [game Media_extracted folder]
// With the game's extracted media, the page icons and the town trip pictures are the real ones instead of letters.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { chromium } = require(path.join(process.argv[2], 'playwright'));
const out = path.resolve(process.argv[3] || path.join(__dirname, 'guide-shots'));
fs.mkdirSync(out, { recursive: true });
const script = fs.readFileSync(__dirname + '/osb.user.js', 'utf8');
const skin = JSON.parse(script.match(/const LEAN_SKIN = (\{[^\n]+\});/)[1]);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const images = ['ic_attack', 'ic_recovery', 'ic_autoget', 'ic_sit'].map((key, i) => {
  const raw = Buffer.from(skin[key].split(',')[1], 'base64'), compressed = zlib.gzipSync(raw);
  return { raw, compressed, path: `/assets/images/Media_extracted/icon/skill/test/skill${i}.png`, transport: `/assets/test-icons/skill${i}.png.gz` };
});
const media = process.argv[4];
if (media) for (const name of ['action/icon_cha_auto_attack', 'action/icon_cha_autoget', 'action/icon_cha_recovery', 'action/icon_cha_alchemy', 'action/icon_cha_shop',
  'action/icon_cha_helper', 'action/icon_cha_party', 'action/icon_cha_camp', 'action/icon_cha_sit', 'action/cos_cmd_inventory', 'item/etc/mall_return_scroll', 'item/etc/mall_warehouse_ticket', 'item/etc/all_potion_03', 'item/etc/mall_repair_hammer',
  'item/etc/mall_reverse_return_scroll', '../interface/minimap/mm_map_button']) {
  const raw = fs.readFileSync(path.join(media, 'icon', name + '.png'));
  images.push({ raw, compressed: zlib.gzipSync(raw), path: path.posix.normalize(`/assets/images/Media_extracted/icon/${name}.png`), transport: `/assets/test-icons/real-${images.length}.png.gz` });
}
let offset = 0;
const manifest = { groups: [], assets: images.map((image, i) => {
  const row = { path: image.path, packPath: '/assets/test-icons/icons.pack', offset, length: image.raw.length, sha256: sha(image.raw), mime: 'image/png',
    transport: { path: image.transport, sha256: sha(image.compressed) } };
  offset += image.raw.length;
  return row;
}) };
const server = http.createServer((req, res) => {
  if (req.url === '/assets/packs/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return; }
  const image = images.find(i => i.transport === req.url);
  if (image) { res.setHeader('Content-Type', 'application/octet-stream'); res.end(image.compressed); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><title>Guide</title></head><body style="background:#0d1420;margin:0"></body></html>');
});
const skills = [
  [5, 'Power Strike', true, 12], [6, 'War Cry', false, 25], [7, 'Sweeping Blow', true, 30], [8, 'Weapon Imbue', false, 18],
  [9, 'Spirit Slash', true, 40], [10, 'Iron Guard', false, 22], [11, 'Crushing Wave', true, 55], [12, 'Swift Step', false, 10],
].map(([id, name, target, mp], i) => ({ id, group: id, name, icon: `skill\\test\\skill${i % 4}.ddj`, level: 1 + (i % 3), targetRequired: target,
  ...(target ? { targets: 4 } : {}), mp, cooldownMs: 1500 + i * 500 }));
// Skills you can cast on a party member, for the Party page.
skills.push({ id: 13, group: 13, name: 'Holy Guard', icon: 'skill\\test\\skill1.ddj', level: 2, targetRequired: true, targets: 1 | 16 | 32, mp: 30, cooldownMs: 2000 },
  { id: 14, group: 14, name: 'Mending Light', icon: 'skill\\test\\skill3.ddj', level: 3, targetRequired: true, targets: 1 | 16 | 32, mp: 45, cooldownMs: 1500 });
const potion = (slot, ref, tf, quantity, name, heal) => ({ slot, refObjId: ref, typeFlags: tf, quantity, name, tooltip: { fields: { itemParam1_29c: heal } } });
const gameplay = { localGid: 1, target: 0, targetPending: false, inventoryPending: false, pendingMoves: 0,
  pose: { regionId: 1, x: 100, y: 0, z: 100 },
  progression: { gold: '2480000', level: 62, experience: '1200', skillPoints: 48000, stats: { maxHp: 3200, maxMp: 1800, strength: 120, intellect: 80 },
    masteries: [{ id: 257, level: 52 }, { id: 273, level: 38 }, { id: 274, level: 20 }] },
  inventory: [
    { slot: 6, refObjId: 10, typeFlags: (2 << 11) | (6 << 7) | 44, plus: 7, name: 'Main weapon' },
    potion(13, 8, 2284, 187, 'HP potion (X-Large)', 900), potion(14, 15, 4332, 342, 'MP potion (X-Large)', 600),
    potion(15, 22, (3 << 11) | 236, 64, 'Vigor potion (X-Large)', 900),
    { slot: 18, refObjId: 300, typeFlags: 44 | (6 << 7), plus: 4, durability: 100, variance: String(19n << 20n | 7n << 5n), magic: [], quantity: 1, name: 'Dragon Blade', tooltip: { fields: { itemClass: 25 } } },
    { slot: 16, refObjId: 200, typeFlags: 0x09ec, quantity: 5, name: 'Return scroll' }, { slot: 17, refObjId: 201, typeFlags: 0x19ec, quantity: 5, name: 'Reverse return scroll' },
  ],
  inventorySlotCount: 45, equipmentSlotCount: 13, skills: skills.map(s => s.id), vitals: [{ gid: 1, hp: 2900, mp: 1500, maxHp: 3200, maxMp: 1800 }],
  social: { localName: 'Hunter', self: 10, leader: 10, options: 1, members: [{ id: 10, name: 'Hunter', status: 0 }, { id: 11, name: 'Healer', level: 61, status: 0x8a }, { id: 12, name: 'Archer', level: 63, status: 0x56 }] },
  cosRecords: [{ gid: 50, refObjId: 500, band: 4, hp: 800, mp: 0, status: 20, dead: false, commandMode: 0x147, inventory: [] }],
  skillCatalog: skills };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'guide-shots-'));
  const browser = await chromium.launchPersistentContext(profile, { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, viewport: { width: 760, height: 1010 } });
  try {
    const page = await browser.newPage();
    await page.route('https://api.github.com/**', route => route.abort());
    // A bot that has already shown this version's patch notes does not open them over the panel.
    const version = script.match(/const VERSION = '([\d.]+)'/)[1];
    await page.addInitScript(v => { try { localStorage.setItem('sroBotLean:v1:seenVersion', JSON.stringify(v)); } catch {} }, version);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: script });
    await page.getByText(/^OSB 2\./).waitFor();
    await page.evaluate(game => {
      const code = `onmessage = e => { if (e.data.kind === 'fixture') postMessage(e.data.message); };`;
      window.testSim = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { name: 'sro-simulation' });
      testSim.postMessage({ kind: 'fixture', message: { kind: 'session', state: { phase: 'world', character: 'Hunter' } } });
      testSim.postMessage({ kind: 'fixture', message: { kind: 'world', batch: { events: [
        { kind: 'spawn', entity: { gid: 1, kind: 'local-player', refObjId: 123, regionId: 1, x: 100, y: 0, z: 100, appearanceState: [0], movementMode: 0 } },
        { kind: 'spawn', entity: { gid: 2, kind: 'player', name: 'Healer', regionId: 1, x: 160, y: 0, z: 100, appearanceState: [0] } },
        { kind: 'spawn', entity: { gid: 3, kind: 'player', name: 'Archer', regionId: 1, x: 220, y: 0, z: 120, appearanceState: [0] } },
        { kind: 'gameplay', state: game }] } } });
    }, gameplay);
    await page.waitForFunction(() => window.SROLean?.world.inWorld());
    // A realistic setup: spot saved, rotation and buffs chosen, pet pickup, town cycle on.
    await page.evaluate(() => {
      const p = SROLean.settings.profile;
      SROLean.hunt.setCenter();
      p.macro.rotations.normal = [{ id: 7, group: 7 }, { id: 5, group: 5 }];
      p.macro.rotations.champion = [{ id: 11, group: 11 }, { id: 9, group: 9 }, { id: 7, group: 7 }];
      p.macro.buffs = [{ id: 6, group: 6, enabled: true, mode: 'hunt', refreshS: 3 }, { id: 10, group: 10, enabled: true, mode: 'hunt', refreshS: 3 }];
      p.macro.imbue = { id: 8, group: 8 };
      p.hunt.pickup.collector = 'pet'; p.hunt.pickup.elixirs = true;
      p.potion.restock.town.enabled = true; p.potion.restock.hp.on = true; p.potion.restock.mp.on = true;
      p.potion.speedScroll = true;
      p.mastery.enabled = true; p.mastery.ids = [257, 273]; p.mastery.gap = 2;
      p.party.autoAcceptMatching = true; p.party.acceptRes = true;
      Object.assign(p.party.support, { enabled: true, heal: { id: 14, group: 14, pct: 60, self: false }, buffs: [{ id: 13, group: 13, only: '' }] });
    });
    await page.waitForFunction(() => [...document.getElementById('sro-bot-lean').shadowRoot.querySelectorAll('.slot')].every(s => s.dataset.iconLoaded === 'true') || true);
    const host = () => page.locator('#sro-bot-lean');
    const snap = async name => {
      await page.waitForTimeout(500);
      const box = await host().boundingBox();
      await page.screenshot({ path: path.join(out, name + '.png'), clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 } });
      console.log('saved', name);
    };
    const jump = legend => page.evaluate(text => {
      const root = document.getElementById('sro-bot-lean').shadowRoot, pane = root.querySelector('.pane');
      const field = [...root.querySelectorAll('legend')].find(l => l.textContent.includes(text));
      if (field) pane.scrollTop = field.parentElement.offsetTop - pane.offsetTop - 6;
    }, legend);
    const tab = async name => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(200); };
    await snap('01-panel');
    await tab('Setup'); await snap('00-setup'); await tab('Combat');
    await tab('Hunt area'); await snap('02-hunt-area');
    await tab('Buffs & imbue'); await snap('04-buffs');
    await tab('Loot'); await snap('05-loot');
    await tab('Supplies'); await snap('06-potions');
    await jump('Potion restock'); await snap('07-restock');
    await tab('Town'); await snap('08-town-triggers');
    await jump('Scroll town cycle'); await snap('08-town-cycle');
    await tab('Alchemy'); await page.locator('#sro-bot-lean select').first().selectOption({ index: 1 }); await page.waitForTimeout(300); await snap('09-alchemy'); await jump('Stones that help and protect'); await snap('09b-alchemy-stones'); await jump('Item attributes'); await snap('09c-alchemy-attributes');
    await tab('Party'); await snap('13-party'); await jump('Follow a party member'); await snap('13b-follow');
    await tab('Settings'); await snap('10-settings');
    await jump('Share and import settings'); await snap('10b-share'); await jump('Anti-stuck'); await snap('11-anti-stuck');
    await jump('Auto mastery and skills'); await snap('12-mastery');
    // The wide window lays each page out in two columns; short boxes must not leave gaps under them.
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.evaluate(() => SROLean.ui.setWide(true));
    await tab('Party'); await snap('15-wide-party'); await tab('Settings'); await snap('15-wide-settings'); await tab('Alchemy'); await snap('15-wide-alchemy');
    await page.evaluate(() => SROLean.ui.setWide(false)); await page.setViewportSize({ width: 760, height: 1010 });
    // The easy guide: one step per picture, with numbered red rings on what to press.
    // A target is a button's exact text, 'panel' for the whole window, or { sel } for any element in the panel.
    const mark = targets => page.evaluate(list => {
      const root = document.getElementById('sro-bot-lean').shadowRoot;
      list.forEach((target, i) => {
        const node = target === 'panel' ? root.host : typeof target === 'string' ? [...root.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === target) : root.querySelector(target.sel);
        if (!node) throw new Error('easy guide: nothing to mark for ' + JSON.stringify(target));
        const r = node.getBoundingClientRect(), ring = document.createElement('div'), badge = document.createElement('div');
        ring.className = badge.className = 'easy-mark';
        Object.assign(ring.style, { position: 'fixed', left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px',
          border: '4px solid #ff3b30', borderRadius: '8px', boxShadow: '0 0 0 2px #fff, 0 0 14px #ff3b30', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box' });
        Object.assign(badge.style, { position: 'fixed', left: Math.max(2, r.left - 18) + 'px', top: Math.max(2, r.top - 18) + 'px', width: '28px', height: '28px', borderRadius: '50%',
          background: '#ff3b30', color: '#fff', font: '700 17px/28px system-ui, sans-serif', textAlign: 'center', border: '2px solid #fff', zIndex: 2147483647, pointerEvents: 'none' });
        if (list.length > 1) badge.textContent = i + 1; else badge.remove();
        document.body.append(ring); if (list.length > 1) document.body.append(badge);
      });
    }, targets);
    const unmark = () => page.evaluate(() => document.querySelectorAll('.easy-mark').forEach(n => n.remove()));
    const easy = async (name, targets) => { await page.waitForTimeout(300); await mark(targets); await snap(name); await unmark(); };
    await tab('Combat'); await tab('Skills');
    await easy('easy-1-panel', ['panel']);
    await tab('Hunt area'); await easy('easy-2-spot', ['Combat', 'Hunt area', 'Set hunting spot here']);
    await tab('Skills'); await easy('easy-3-skills', ['Skills', { sel: '[aria-label="Attack skill icons"]' }]);
    await tab('Setup'); await easy('easy-4-check', ['Setup', 'Fix the next thing']);
    await easy('easy-5-start', ['Start / stop · F8']);
    // The Classic window (SBot layout, screens at least 900 px wide); the website shows its Skills tab.
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.evaluate(() => SROLean.ui.setClassic(true));
    const classicTab = async name => { await page.locator('#sro-bot-lean nav').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(200); };
    await classicTab('Skills'); await snap('16-classic-skills'); await classicTab('Party/Autores'); await snap('16-classic-party');
    await page.evaluate(() => SROLean.ui.setClassic(false)); await page.setViewportSize({ width: 1280, height: 900 }); await tab('Settings');
    await page.getByRole('button', { name: 'Send bug report', exact: true }).click();
    await page.getByRole('textbox', { name: 'Report preview', exact: true }).waitFor();
    await page.setViewportSize({ width: 1000, height: 1010 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, '14-bug-report.png') });
    console.log('saved 14-bug-report');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
