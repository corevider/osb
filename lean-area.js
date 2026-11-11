const HUNT_POLYGON = { min: 3, max: HUNT_POLYGON_MAX };
const HuntArea = {
  cache: null, aroundMember: 0, spotWarned: '',
  cfg(H = Settings.profile.hunt) {
    if (!H.polygon || typeof H.polygon !== 'object' || !Array.isArray(H.polygon.corners)) H.polygon = huntPolygon(H.polygon);
    return H.polygon;
  },
  shape(corners) {
    const c = this.cache;
    if (c && c.corners === corners && c.count === corners.length) return c;
    const shape = { corners, count: corners.length, anchor: corners[0] || null, points: [], valid: false, reason: '' };
    this.cache = shape;
    if (corners.length < HUNT_POLYGON.min) { shape.reason = `Needs at least ${HUNT_POLYGON.min} corners.`; return shape; }
    for (const p of corners) {
      const d = regionDelta(shape.anchor, p);
      if (!d) { shape.reason = 'The corners are in different dungeon areas.'; return shape; }
      shape.points.push(d);
    }
    if (this.crosses(shape.points)) { shape.reason = 'The edges cross each other.'; return shape; }
    let area = 0;
    for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) area += shape.points[j][0] * shape.points[i][1] - shape.points[i][0] * shape.points[j][1];
    if (Math.abs(area) < 2) { shape.reason = 'The corners lie on one line.'; return shape; }
    shape.xs = Float64Array.from(shape.points, p => p[0]); shape.zs = Float64Array.from(shape.points, p => p[1]);
    shape.minX = Math.min(...shape.xs); shape.maxX = Math.max(...shape.xs);
    shape.minZ = Math.min(...shape.zs); shape.maxZ = Math.max(...shape.zs);
    shape.valid = true;
    return shape;
  },
  crosses(points) {
    const n = points.length, side = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const on = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
    const meet = (a, b, c, d) => {
      const s1 = side(a, b, c), s2 = side(a, b, d), s3 = side(c, d, a), s4 = side(c, d, b);
      if (s1 * s2 < 0 && s3 * s4 < 0) return true;
      return !s1 && on(a, b, c) || !s2 && on(a, b, d) || !s3 && on(c, d, a) || !s4 && on(c, d, b);
    };
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if (a[0] === b[0] && a[1] === b[1]) return true;
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (j + 1) % n === i) {
          const far = j === i + 1 ? points[(j + 1) % n] : points[j];
          if (!side(a, b, far) && on(a, b, far)) return true;
          continue;
        }
        if (meet(a, b, points[j], points[(j + 1) % n])) return true;
      }
    }
    return false;
  },
  spotsMove(H) { return !!(H.levelSpots?.on && H.levelSpots.list?.length) || Leveling.spotsOn(); },
  polygon(H) {
    const P = H?.polygon;
    if (!P || P.on !== true || !Array.isArray(P.corners) || this.aroundMember || this.spotsMove(H)) return null;
    const shape = this.shape(P.corners);
    return shape.valid ? shape : null;
  },
  contains(shape, p) {
    const d = p && regionDelta(shape.anchor, p);
    if (!d) return false;
    const x = d[0], z = d[1];
    if (x < shape.minX || x > shape.maxX || z < shape.minZ || z > shape.maxZ) return false;
    const xs = shape.xs, zs = shape.zs, n = xs.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = zs[i], zj = zs[j];
      if (zi > z !== zj > z && x < (xs[j] - xs[i]) * (z - zi) / (zj - zi) + xs[i]) inside = !inside;
    }
    return inside;
  },
  edgeDistance(shape, p) {
    const d = p && regionDelta(shape.anchor, p);
    if (!d) return Infinity;
    const pts = shape.points;
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[j], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
      const t = len ? clamp(((d[0] - ax) * dx + (d[1] - az) * dz) / len, 0, 1) : 0;
      best = Math.min(best, Math.hypot(d[0] - ax - t * dx, d[1] - az - t * dz));
    }
    return best;
  },
  within(H, p, margin = 0) {
    const shape = this.polygon(H);
    if (shape) return this.contains(shape, p) || margin > 0 && this.edgeDistance(shape, p) <= margin;
    if (!H.center) return true;
    return dist2D(H.center, p) <= H.radius + margin;
  },
  strayed(H, pose) {
    const shape = this.polygon(H), d = dist2D(pose, H.center);
    if (shape) return !this.contains(shape, pose) && !(d <= 40);
    return !(d <= Math.max(40, H.radius * 0.5));
  },
  spotOutside(H = Settings.profile.hunt) {
    const shape = this.polygon(H);
    return !!(shape && H.center && !this.contains(shape, H.center));
  },
  status(H = Settings.profile.hunt) {
    const P = this.cfg(H), n = P.corners.length, shape = this.shape(P.corners);
    const count = `${n} corner${n === 1 ? '' : 's'}`;
    if (!P.on) return { level: 'info', text: n ? `Polygon off (${count} saved). The circle is used.` : 'Polygon off. The circle is used.' };
    if (!shape.valid) return { level: 'warn', text: `Polygon invalid: ${shape.reason} The circle is used.` };
    if (this.spotsMove(H)) return { level: 'warn', text: 'Spot by level or leveling spots are on: the circle is used.' };
    if (this.spotOutside(H)) return { level: 'warn', text: `Polygon in use (${count}). The hunting spot is outside it: walking back still goes to the spot.` };
    return { level: 'ok', text: `Polygon in use (${count}).` };
  },
  save() { Settings.saveProfile(); bus.emit('area'); },
  add(point) {
    const P = this.cfg(), c = huntCorner(point);
    if (!c) return 'No position for a corner.';
    if (P.corners.length >= HUNT_POLYGON.max) return `At most ${HUNT_POLYGON.max} corners.`;
    P.corners = [...P.corners, c];
    this.save();
    return '';
  },
  addHere() {
    const pose = World.inWorld() ? World.pose() : null;
    return pose ? this.add(pose) : 'Enter the game world first.';
  },
  removeLast() {
    const P = this.cfg();
    if (!P.corners.length) return false;
    P.corners = P.corners.slice(0, -1);
    this.save();
    return true;
  },
  clear() {
    const P = this.cfg();
    if (!P.corners.length) return false;
    P.corners = [];
    this.save();
    return true;
  },
  warnSpot() {
    const H = Hunt.cfg();
    if (!this.spotOutside(H)) { this.spotWarned = ''; return; }
    const key = JSON.stringify(H.center) + ':' + H.polygon.corners.length;
    if (this.spotWarned === key) return;
    this.spotWarned = key;
    Log.warn('The hunting spot is outside the polygon hunting area. Walking back still goes to the spot.');
  },
};
Hunt.inArea = function (e) { return HuntArea.within(this.cfg(), e); };
{
  const startBeforeArea = Hunt.start;
  Hunt.start = function (...args) {
    const result = startBeforeArea.apply(this, args);
    if (this.running) HuntArea.warnSpot();
    return result;
  };
}
