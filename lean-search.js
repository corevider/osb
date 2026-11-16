const SEARCH_CARDINALS = [[0, 1], [1, 0], [-1, 0], [0, -1]];
function searchOffset(p, dx, dz) {
  if (!p) return null;
  if (p.regionId & DUNGEON) return { regionId: p.regionId, x: p.x + dx, z: p.z + dz, y: p.y };
  let X = (p.regionId & 255) * SECTOR + p.x + dx;
  let Z = (p.regionId >>> 8) * SECTOR + p.z + dz;
  X = clamp(X, 0, 255 * SECTOR + SECTOR - 1);
  Z = clamp(Z, 0, 127 * SECTOR + SECTOR - 1);
  const rx = Math.floor(X / SECTOR), rz = Math.floor(Z / SECTOR);
  return { regionId: (rz << 8) | rx, x: X - rx * SECTOR, z: Z - rz * SECTOR, y: p.y };
}
const Search = {
  step: 0, waypoint: null, last: null, key: '', shape: null,
  reset() { this.step = 0; this.waypoint = null; this.last = null; this.key = ''; this.shape = null; },
  on(H) { return !!H.search?.enabled && H.attack !== false && !!H.center && !HuntArea.aroundMember && !Lure.on(); },
  arrival(H) { return Math.max(40, Math.min(300, H.radius * 0.2)); },
  share(H) { return clamp(Number(H.search?.range) || 90, 20, 100) / 100; },
  range(H) { return H.radius * this.share(H); },
  exit(shape, from, dx, dz) {
    const c = regionDelta(shape.anchor, from), pts = shape.points;
    if (!c) return 0;
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[j], [bx, bz] = pts[i], ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (!den) continue;
      const t = ((ax - c[0]) * ez - (az - c[1]) * ex) / den, u = ((ax - c[0]) * dz - (az - c[1]) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return Number.isFinite(best) ? best : 0;
  },
  dest(H) {
    if (!H.center) return null;
    const [dx, dz] = SEARCH_CARDINALS[this.step >> 1];
    if (this.step % 2) return searchOffset(H.center, 0, 0);
    const shape = HuntArea.polygon(H);
    const d = shape ? (HuntArea.contains(shape, H.center) ? this.exit(shape, H.center, dx, dz) * this.share(H) : 0) : this.range(H);
    return searchOffset(H.center, dx * d, dz * d);
  },
  tick(hunt) {
    const H = hunt.cfg(), pose = World.pose(), center = H.center;
    if (!pose || !center) return;
    let dest = null;
    if (this.on(H) && !HuntArea.spotOutside(H)) {
      const shape = HuntArea.polygon(H), key = [center.regionId, center.x, center.z, H.radius, this.share(H)].join('|');
      if (key !== this.key || shape !== this.shape) { this.reset(); this.key = key; this.shape = shape; }
      this.waypoint ||= this.dest(H);
      if (dist2D(pose, this.waypoint) <= this.arrival(H)) {
        if (!this.last || dist2D(this.last, this.waypoint) > this.arrival(H)) AntiStuck.idleMs = 0;
        this.last = this.waypoint;
        this.step = (this.step + 1) % 8;
        this.waypoint = this.dest(H);
        return;
      }
      dest = this.waypoint;
    } else if (H.returnToCenter && HuntArea.strayed(H, pose)) dest = center;
    if (!dest) return;
    if (!(dist2D(pose, center) <= Math.max(H.radius * 1.5, 600)) && Controller.townReturn()) return;
    if (!Number.isFinite(dist2D(pose, center))) return hunt.stop('hunt area is in another region');
    if (Cmd.move(dest)) hunt.lastMoveAt = now();
    if (dest === center) hunt.state = 'return';
  },
};
