const ASSIST_WINDOW_MS = 6000;
const ASSIST_SETTLE_MS = 3000;
const ASSIST_MAX_HITS = 50;
const ASSIST_SHARE_TIER = 1e5;
const ASSIST_SHARE_MAX = 2;
const Assist = {
  hits: new Map(), gid: 0, open: false, mates: { at: -Infinity, list: [] }, acting: '', wanted: '', wantedAt: -Infinity, message: 'Party assist off.',
  cfg() { return Settings.profile.party.assist; },
  reset() { this.hits.clear(); this.gid = 0; this.acting = this.wanted = ''; this.wantedAt = -Infinity; },
  clock() { return World.simNow() ?? now(); },
  key(name) { return String(name || '').trim().toLowerCase(); },
  range() { return clamp(Number(this.cfg().range) || 40, 5, 100) * 10; },
  leaderRange() { return clamp(Number(this.cfg().leaderRange) || 100, 10, 500) * 10; },
  mayLead(name) {
    const key = this.key(name);
    return !Settings.profile.party.protect.names.some(n => this.key(n) === key);
  },
  party() {
    const social = World.gp?.social;
    if (!Array.isArray(social?.members)) return null;
    const members = social.members.filter(m => m?.name);
    return members.length > 1 && members.some(m => m.name === social.localName) ? { social, members } : null;
  },
  order(social, members) {
    const head = members.find(m => social.leader && m.id === social.leader);
    return head ? [head, ...members.filter(m => m !== head)] : members;
  },
  seen() {
    const out = new Map();
    for (const e of World.ents.values()) if (e.kind === 'player' && e.name) out.set(e.name, e);
    return out;
  },
  place(m, e) {
    if (e) return e;
    if (m.region === undefined || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return null;
    if (m.war !== undefined && m.war !== (World.gp?.fortress?.worldId ?? 65537)) return null;
    return { regionId: m.region, x: m.x, z: m.z };
  },
  alive(m, e) {
    if (e?.appearanceState?.[0] === 2) return false;
    return !Number.isInteger(m.status) || (m.status & 15) !== 0;
  },
  elect() {
    const party = this.party(), pose = World.pose();
    if (!party || !pose) return '';
    const me = party.social.localName, seen = this.seen(), reach = this.leaderRange();
    for (const m of this.order(party.social, party.members)) {
      if (!this.mayLead(m.name)) continue;
      if (m.name === me) { if (!World.isDead()) return me; continue; }
      const e = seen.get(m.name);
      if (this.alive(m, e) && dist2D(pose, this.place(m, e)) <= reach) return m.name;
    }
    return '';
  },
  fallen(name) {
    const party = this.party();
    if (!party) return true;
    if (name === party.social.localName) return World.isDead();
    const m = party.members.find(x => x.name === name);
    return !m || !this.mayLead(name) || !this.alive(m, this.seen().get(name));
  },
  leader() {
    const next = this.elect();
    if (next === this.acting) { this.wanted = ''; return this.acting; }
    if (!next || !this.acting || this.fallen(this.acting)) return this.lead(next);
    if (this.wanted !== next) { this.wanted = next; this.wantedAt = now(); }
    return now() - this.wantedAt >= ASSIST_SETTLE_MS ? this.lead(next) : this.acting;
  },
  lead(name) {
    if (name && this.acting && name !== this.acting) Log.info(`Party assist: ${name} leads now.`);
    this.acting = name; this.wanted = '';
    return name;
  },
  note(cast) {
    if (!this.cfg().enabled) return;
    const social = World.gp?.social, caster = World.ents.get(cast?.caster);
    if (!Array.isArray(social?.members) || !caster) return;
    const owner = caster.kind === 'cos' ? World.ents.get(caster.ownerGid) : caster;
    const name = owner?.name || (caster.kind === 'cos' ? caster.ownerName : '');
    if (!name || name === social.localName || owner && owner.kind !== 'player' || !social.members.some(m => m?.name === name)) return;
    const t = this.clock(), key = this.key(name);
    let mine = this.hits.get(key);
    for (const gid of new Set([cast.target, ...(cast.results || []).map(r => r?.target)])) {
      if (World.ents.get(gid)?.kind !== 'monster') continue;
      if (!mine) this.hits.set(key, mine = new Map());
      mine.set(gid, gid === cast.target ? t : Math.max(mine.get(gid) ?? -Infinity, t - 1));
    }
    if (mine && mine.size > ASSIST_MAX_HITS) for (const [gid, at] of mine) if (t - at >= ASSIST_WINDOW_MS) mine.delete(gid);
  },
  blocked() {
    if (!this.cfg().enabled) return 'Party assist off.';
    if (Hunt.cfg().attack === false) return 'Attack monsters is off.';
    if (Town.trip || Restock.trip) return 'Paused during the town trip.';
    if (!Protect.safe()) return 'Your HP is low: your own safety first.';
    return '';
  },
  valid(e, sim, pose) {
    if (!isAttackableMob(e) || Hunt.banned(Hunt.ban, e.gid) || !this.cfg().classes?.[MonsterClasses.of(e)]) return false;
    if (dist2D(pose, e) > this.range() || !Hunt.inArea(e)) return false;
    const name = String(e.name || '').toLowerCase();
    if (splitList(Hunt.cfg().exclude).some(s => name.includes(s))) return false;
    return !Hunt.ksAvoids(e, sim);
  },
  taken(e) {
    if (this.open || !this.cfg().enabled || !e || this.cfg().classes?.[MonsterClasses.of(e)]) return false;
    const t = this.clock();
    if (t - (World.attackers.get(e.gid) ?? -Infinity) < ASSIST_WINDOW_MS || t - (World.hitByUs.get(e.gid) ?? -Infinity) < ASSIST_WINDOW_MS) return false;
    const social = World.gp?.social;
    if (!Array.isArray(social?.members)) return false;
    return social.members.some(m => m?.name && m.name !== social.localName && t - (this.hits.get(this.key(m.name))?.get(e.gid) ?? -Infinity) < ASSIST_WINDOW_MS);
  },
  matesInView() {
    if (this.mates.at === now()) return this.mates.list;
    const social = World.gp?.social, members = Array.isArray(social?.members) ? social.members : [], seen = members.length > 1 ? this.seen() : new Map();
    const list = members.filter(m => m?.name && m.name !== social.localName && this.alive(m, seen.get(m.name)) && seen.has(m.name)).map(m => seen.get(m.name));
    this.mates = { at: now(), list };
    return list;
  },
  share(e) {
    if (!this.cfg().enabled || this.cfg().classes?.[MonsterClasses.of(e)]) return 0;
    const mine = dist2D(World.pose(), e), me = World.gp?.social?.localName || '';
    let closer = 0;
    for (const mate of this.matesInView()) {
      const theirs = dist2D(mate, e);
      if (theirs < mine || theirs === mine && mate.name < me) closer++;
    }
    return Math.min(closer, ASSIST_SHARE_MAX) * ASSIST_SHARE_TIER;
  },
  focus(names, sim, pose, current) {
    let best = null, bestAt = -Infinity, by = '';
    for (const name of names) {
      const mine = this.hits.get(this.key(name));
      if (!mine) continue;
      for (const [gid, at] of mine) {
        if (sim - at >= ASSIST_WINDOW_MS) { mine.delete(gid); continue; }
        const e = World.ents.get(gid);
        if ((at > bestAt || at === bestAt && gid === current?.gid) && e && this.valid(e, sim, pose)) { best = e; bestAt = at; by = name; }
      }
    }
    return best ? { e: best, by } : null;
  },
  pick(current) {
    const why = this.blocked();
    if (why) { this.message = why; this.gid = 0; return null; }
    const party = this.party(), pose = World.pose();
    if (!party) { this.reset(); this.message = 'Not in a party.'; return null; }
    const leader = pose ? this.leader() : '';
    if (!leader) { this.gid = 0; this.message = 'Waiting for the party leader.'; return null; }
    const me = party.social.localName, leading = leader === me, sim = this.clock();
    const found = leading ? (current ? null : this.focus(party.members.map(m => m.name).filter(n => n !== me), sim, pose)) : this.focus([leader], sim, pose, current);
    if (!found) { this.gid = 0; this.message = leading ? 'You lead: the party follows your target.' : `Leader: ${leader}. No ticked monster to assist on.`; return null; }
    const e = found.e;
    if (current && current.gid !== e.gid && (World.isCasting() || (World.hpPctOf(current) ?? 100) < THREAT_FINISH_PCT)) return null;
    if (this.gid !== e.gid) {
      this.gid = e.gid;
      Log.info(`Party assist: attacking ${e.name || 'a monster'} with ${found.by}.`);
    }
    this.message = leading ? `You lead: joining ${found.by} on ${e.name || 'a monster'}.` : `Assisting ${leader} on ${e.name || 'a monster'}.`;
    return e;
  },
  status() { return !this.cfg().enabled ? 'Party assist off.' : Hunt.running ? this.message : 'Starts with the bot.'; },
};
{
  const record = World.onCast;
  World.onCast = function (cast) {
    Controller.guard('Party assist', () => Assist.note(cast));
    return record.call(this, cast);
  };
}
{
  const avoids = Hunt.ksAvoids;
  Hunt.ksAvoids = function (e, ...rest) { return avoids.call(this, e, ...rest) || Assist.taken(e); };
  const classOffset = Hunt.classOffset;
  Hunt.classOffset = function (e, attacking) { return classOffset.call(this, e, attacking) + (attacking ? 0 : Controller.guard('Party assist', () => Assist.share(e)) || 0); };
  const valid = Protect.valid;
  Protect.valid = function (...args) {
    Assist.open = true;
    try { return valid.apply(this, args); } finally { Assist.open = false; }
  };
}
bus.on('despawn', e => { if (e) for (const mine of Assist.hits.values()) mine.delete(e.gid); });
bus.on('reset', () => Assist.reset());
bus.on('phase', phase => { if (phase !== 'world') Assist.reset(); });
bus.on('profile', () => Assist.reset());
