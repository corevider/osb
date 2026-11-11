const SPAWN_POS_PATH = '/assets/data/npcpos.json', SPAWN_MANIFEST_PATH = '/assets/npc/manifest.json';
const SpawnData = {
  npcs: new Map(), mobs: new Map(), codes: new Map(), refsByCode: new Map(), pending: null, loaded: false, rows: 0,
  load() {
    if (this.loaded) return Promise.resolve(this);
    if (this.pending) return this.pending;
    this.pending = Promise.all([Assets.json(SPAWN_POS_PATH), Assets.json(SPAWN_MANIFEST_PATH)]).then(([pos, manifest]) => {
      this.parse(pos, manifest);
      this.loaded = true; this.pending = null;
      return this;
    }, e => { this.pending = null; throw e; });
    return this.pending;
  },
  parse(pos, manifest) {
    const codes = new Map(), npcs = new Map(), points = new Map(), refsByCode = new Map();
    for (const v of Object.values(manifest?.models || {})) {
      const ref = Number(v?.refObjId);
      if (v?.refObjId == null || !Number.isInteger(ref) || !v.codename) continue;
      const code = String(v.codename), kind = String(v.kind || '');
      codes.set(ref, { code, kind });
      if (!refsByCode.has(code)) refsByCode.set(code, []);
      refsByCode.get(code).push(ref);
    }
    let rows = 0;
    for (const row of pos?.rows || []) {
      const [r, region, x, y, z] = String(row).split('\t'), ref = Number(r), info = codes.get(ref);
      if (!info) continue;
      const rid = Number(region), p = { regionId: rid & 0xffff, x: Number(x), y: Number(y), z: Number(z) };
      if (!Number.isInteger(rid) || ![p.x, p.y, p.z].every(Number.isFinite)) continue;
      rows++;
      if (!npcs.has(info.code)) npcs.set(info.code, { refObjId: ref, ...p });
      if (!this.isMonster(info)) continue;
      if (!points.has(ref)) points.set(ref, []);
      points.get(ref).push(p.regionId, p.x, p.y, p.z);
    }
    this.codes = codes; this.npcs = npcs; this.refsByCode = refsByCode; this.rows = rows;
    this.mobs = new Map([...points].map(([ref, list]) => [ref, Float32Array.from(list)]));
  },
  isMonster(info) { return info.kind === 'monster' || info.code.startsWith('MOB_'); },
  code(ref) { return this.codes.get(Number(ref))?.code || ''; },
  points(code) {
    const out = [];
    for (const ref of this.refsByCode.get(code) || []) {
      const list = this.mobs.get(ref);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 4) out.push({ regionId: list[i], x: list[i + 1], y: list[i + 2], z: list[i + 3] });
    }
    return out;
  },
};
