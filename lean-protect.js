const PROTECT_WINDOW_MS = 6000;
const PROTECT_MAX_HITS = 200;
const Protect = {
  hits: new Map(), gid: 0, message: 'Protect party members off.',
  cfg() { return Settings.profile.party.protect; },
  reset() { this.hits.clear(); this.gid = 0; },
  range() { return clamp(Number(this.cfg().range) || 40, 5, 100) * 10; },
  key(name) { return String(name || '').trim().toLowerCase(); },
  chosen(name) {
    const c = this.cfg(), key = this.key(name);
    return !!key && (!!c.all || c.names.some(n => this.key(n) === key));
  },
  note(cast) {
    if (!this.cfg().enabled) return;
    const caster = World.ents.get(cast?.caster), social = World.gp?.social;
    if (caster?.kind !== 'monster' || !Array.isArray(social?.members)) return;
    const t = World.simNow() ?? now(), local = World.localGid();
    for (const gid of new Set([cast.target, ...(cast.results || []).map(r => r?.target)])) {
      const e = gid && gid !== local ? World.ents.get(gid) : null;
      if (e?.kind !== 'player' || !e.name || e.name === social.localName || !social.members.some(m => m?.name === e.name)) continue;
      this.hits.set(cast.caster, { at: t, name: e.name, gid });
    }
    if (this.hits.size > PROTECT_MAX_HITS) for (const [gid, hit] of this.hits) if (t - hit.at >= PROTECT_WINDOW_MS) this.hits.delete(gid);
  },
  memberHp(hit) {
    const e = World.ents.get(hit.gid), exact = e ? World.hpPctOf(e) : null;
    if (exact !== null && exact !== undefined) return exact;
    const m = World.gp?.social?.members?.find(x => x?.name === hit.name);
    return Number.isInteger(m?.status) ? Math.min(10, m.status & 15) * 10 : 100;
  },
  safe() {
    const P = Settings.profile.potion;
    if (!P.enabled) return true;
    const floor = Math.max(P.hp?.on ? Number(P.hp.pct) || 0 : 0, P.vigor?.on ? Number(P.vigor.hpPct) || 0 : 0);
    return World.me().hpPct >= floor;
  },
  blocked() {
    const c = this.cfg();
    if (!c.enabled) return 'Protect party members off.';
    if (Hunt.cfg().attack === false && !c.whileNoAttack) return 'Attack monsters is off; tick Also with Attack monsters off to protect.';
    if (Town.trip || Restock.trip) return 'Paused during the town trip.';
    if (!this.safe()) return 'Your HP is low: your own safety first.';
    return '';
  },
  valid(e, hit, sim, pose) {
    if (!e || !hit || sim - hit.at >= PROTECT_WINDOW_MS || !this.chosen(hit.name)) return false;
    if (!isAttackableMob(e) || Hunt.banned(Hunt.ban, e.gid)) return false;
    if (dist2D(pose, e) > this.range() || !Hunt.inArea(e)) return false;
    const name = String(e.name || '').toLowerCase();
    if (splitList(Hunt.cfg().exclude).some(s => name.includes(s))) return false;
    return !Hunt.ksAvoids(e, sim);
  },
  pick(current) {
    const why = this.blocked();
    if (why) { this.message = why; return null; }
    const sim = World.simNow() ?? 0, pose = World.pose();
    if (!pose) return null;
    if (current && this.valid(current, this.hits.get(current.gid), sim, pose)) return this.guard(current);
    let best = null, bestHp = Infinity, bestD = Infinity;
    for (const [gid, hit] of this.hits) {
      if (sim - hit.at >= PROTECT_WINDOW_MS) { this.hits.delete(gid); continue; }
      const e = World.ents.get(gid);
      if (!this.valid(e, hit, sim, pose)) continue;
      const hp = this.memberHp(hit), d = dist2D(pose, e);
      if (hp < bestHp || hp === bestHp && d < bestD) { best = e; bestHp = hp; bestD = d; }
    }
    if (!best) { this.message = 'No chosen party member is under attack.'; return null; }
    return this.guard(best);
  },
  guard(e) {
    const name = this.hits.get(e.gid)?.name || '';
    if (this.gid !== e.gid) {
      this.gid = e.gid;
      Log.info(`Protecting ${name}: attacking ${e.name || 'a monster'}, which is hitting them.`);
    }
    this.message = `Protecting ${name} from ${e.name || 'a monster'}.`;
    return e;
  },
  release(current) {
    if (!this.gid) return current;
    const gid = this.gid;
    this.gid = 0;
    if (!current || current.gid !== gid) return current;
    const sim = World.simNow() ?? 0;
    if (sim - (World.attackers.get(gid) ?? -Infinity) < PROTECT_WINDOW_MS) return current;
    Hunt.targetGid = 0;
    Log.info('Protection over: back to normal targeting.');
    return null;
  },
  status() { return this.cfg().enabled ? this.message : 'Protect party members off.'; },
  rows() {
    const social = World.gp?.social, c = this.cfg();
    const party = (Array.isArray(social?.members) ? social.members : []).filter(m => m?.name && m.name !== social.localName).map(m => m.name);
    const gone = c.names.filter(n => !party.some(p => this.key(p) === this.key(n)));
    return [...party.map(name => ({ name, here: true })), ...gone.map(name => ({ name, here: false }))];
  },
  toggle(name, on) {
    const c = this.cfg(), key = this.key(name);
    c.names = c.names.filter(n => this.key(n) !== key);
    if (on) c.names.push(String(name).trim());
  },
};
{
  const record = World.onCast;
  World.onCast = function (cast) {
    Controller.guard('Protect party members', () => Protect.note(cast));
    return record.call(this, cast);
  };
}
bus.on('despawn', e => { if (e) Protect.hits.delete(e.gid); });
bus.on('reset', () => Protect.reset());
bus.on('phase', phase => { if (phase !== 'world') Protect.reset(); });
bus.on('profile', () => Protect.reset());
