// Optional read-only comparison against locally built game navigation assets.
// Usage: node lean.navigation.native.test.mjs C:\sroserver\opensro
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const game = path.resolve(process.argv[2]);
const moduleAt = p => pathToFileURL(path.join(game, p)).href;
await import(moduleAt('apps/client-next/tests/helpers/native-source-loader.mjs'));
const { CLIENT_PUBLIC_ROOT } = await import(moduleAt('scripts/lib/generatedRoot.mjs'));
const { createNavigationResources } = await import(moduleAt('apps/client-next/src/engine/runtime/assets/worker/navigation/navigation.ts'));
const { createNavigation } = await import(moduleAt('apps/client-next/src/engine/runtime/simulation/worker/session/world/gameplay/movement/navigation/navigation.ts'));
const read = async url => {
  const file = path.resolve(CLIENT_PUBLIC_ROOT, '.' + url);
  assert.ok(file.startsWith(CLIENT_PUBLIC_ROOT + path.sep));
  return new Uint8Array(fs.readFileSync(file));
};
const json = async url => JSON.parse(new TextDecoder().decode(await read(url)));
const npcs = (await json('/assets/data/npcpos.json')).rows.map(row => row.split('\t').map(Number));
const poseOf = id => {
  const row = npcs.find(row => row[0] === id);
  return { regionId: row[1], x: row[2], y: row[3], z: row[4] };
};
const warehouse = poseOf(2083), manina = poseOf(2074);
const catalog = await json('/assets/world/world-region-catalog.json');
const entry = catalog.regionsById['0x' + warehouse.regionId.toString(16).padStart(4, '0')].find(row => row.area === 'outdoor');
const product = await createNavigationResources().resolve(await read(entry.bundlePublicPath), warehouse.regionId, read);
const native = createNavigation(); native.install(product.regionId, product);
const source = fs.readFileSync(new URL('osb.user.js', import.meta.url), 'utf8');
const context = { window: { addEventListener() {} }, performance: { now: () => 100000 }, console, atob,
  setTimeout() {}, clearTimeout() {}, setInterval() {}, Map, Set, ArrayBuffer, DataView };
vm.createContext(context);
vm.runInContext(source.slice(0, source.lastIndexOf('installWorkerHook();')) + 'globalThis.bot = { Navigation, World };\n})();', context);
const { Navigation, World } = context.bot;
Navigation.install(product);
// Test several reachable standing positions instead of assuming an NPC centre
// is traversable. Native clipping supplies the reference for each route chord.
const approaches = npc => {
  const rows = [];
  for (const [dx, dz] of [[-60,0],[60,0],[0,-60],[0,60],[-100,-100],[100,100]]) {
    const p = { ...npc, x: npc.x + dx, z: npc.z + dz };
    if (Navigation.open(Navigation.local(p).x, Navigation.local(p).z)) rows.push(p);
  }
  return rows;
};
let routes = 0, failed = 0, pursuitRoutes = 0;
const failures = [];
for (const from of approaches(warehouse)) for (const to of approaches(manina)) {
  World.gp = { pose: from };
  const route = Navigation.plan(from, to, 60);
  if (!route?.length) { failed++; failures.push({ from, to }); continue; }
  let previous = from;
  for (const point of route) {
    const clipped = native.clip(previous, point);
    assert.ok(clipped, 'Native collision coverage missing on bot route');
    const remaining = Math.hypot(clipped.x - point.x + ((clipped.regionId & 255) - (point.regionId & 255)) * 1920,
      clipped.z - point.z + ((clipped.regionId >>> 8) - (point.regionId >>> 8)) * 1920);
    assert.ok(remaining < 2, 'Bot route crosses a native obstacle: ' + JSON.stringify({ previous, point, clipped }));
    previous = clipped;
  }
  routes++;
  const query = Navigation.query(from, to);
  if (query.status === 'direct' || query.status === 'route') {
    let pose = from;
    for (const point of query.route) {
      const clipped = native.clip(pose, point);
      assert.ok(clipped, 'Native coverage missing on pursuit route');
      assert.ok(Math.hypot(clipped.x - point.x + ((clipped.regionId & 255) - (point.regionId & 255)) * 1920,
        clipped.z - point.z + ((clipped.regionId >>> 8) - (point.regionId >>> 8)) * 1920) < 2,
      'Pursuit chord crosses native collision');
      pose = clipped;
    }
    pursuitRoutes++;
  }
}
// One synthetic sample lies behind the warehouse structure. Verify that the
// native clipper's grid traversal is also confined there, rather than hiding
// it as a successful route. The other 30 approach pairs must route safely.
assert.ok(routes >= 30, 'Warehouse-to-Manina routing regressed');
assert.ok(pursuitRoutes >= 24, 'Bounded pursuit routing lost ordinary town approaches');
assert.ok(failures.every(pair => pair.from.x === warehouse.x && Math.abs(pair.from.z - (warehouse.z - 60)) < 0.01));
if (failures.length) {
  const from = failures[0].from, queue = [from], seen = new Set();
  for (let at = 0; at < queue.length; at++) {
    const p = queue[at];
    assert.ok(queue.length < 1000, 'Native comparison unexpectedly escaped the enclosed sample');
    assert.ok(Math.hypot(p.x - (warehouse.x - 60), p.z - warehouse.z) >= 30, 'Native traversal found an exit that the bot missed');
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const to = { ...p, x: (Math.floor(p.x / 20) + dx) * 20 + 10, z: (Math.floor(p.z / 20) + dz) * 20 + 10 };
      const key = to.x + ',' + to.z;
      if (seen.has(key)) continue;
      const clipped = native.clip(p, to);
      if (clipped && Math.hypot(clipped.x - to.x, clipped.z - to.z) < 2) { seen.add(key); queue.push(clipped); }
    }
  }
}
console.log(JSON.stringify({ routes, pursuitRoutes, nativeEnclosedPairs: failed, objects: product.objects.length, regions: product.navmesh.regions.length }));
