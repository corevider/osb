const SAFETY_IDLE_MS = 3000, SAFETY_PARTY_WAIT_MS = 10000, SAFETY_TOWN_WAIT_MS = 90000, SAFETY_PREFIX = 'safety: ';
const SAFETY_TRIP_END = ['leave', 'reverse', 'mall-reverse'];
const Safety = {
  session: null, idleAt: 0, smallSince: 0, townReason: '', townAt: 0, deathLimitHit: false, playerHit: '',
  cfg() { return Settings.profile.hunt.safety; },
  busy() { return !!(Hunt.running || UniqueHunt.active || WalkBack.active || Travel.active || Town.trip || Controller.resumeAfterRevive); },
  begin() {
    const members = World.gp?.social?.members;
    this.session = { deaths: 0, partyAtStart: Array.isArray(members) ? members.filter(Boolean).length > 0 : null };
    this.smallSince = 0; this.deathLimitHit = false; this.playerHit = '';
  },
  sync() {
    if (this.busy()) {
      this.idleAt = 0;
      if (!this.session) this.begin();
      return !!this.session;
    }
    if (!this.session) { this.townReason = ''; return false; }
    this.idleAt ||= now();
    if (now() - this.idleAt >= SAFETY_IDLE_MS) { this.session = null; this.townReason = ''; this.smallSince = 0; }
    return false;
  },
  isSafetyTrip(trip) { return String(trip?.why || '').startsWith(SAFETY_PREFIX); },
  townReady() {
    return Hunt.running && Town.cfg().enabled && !Town.validate();
  },
  fire(text, action) {
    if (this.townReason) return;
    const reason = SAFETY_PREFIX + text;
    Log.warn('Safety: ' + text + '.');
    UI.toast('Safety: ' + text + '.', 'warn', 10000);
    if (action === 'town' && this.townReady()) {
      this.townReason = reason; this.townAt = now();
      Log.info('Safety: going to town, then stopping.');
      return;
    }
    userStop(reason);
  },
  seal(reason) {
    RunIntent.set(false);
    AutoStart.cancel('Auto-start cancelled.');
    Reconnect.forgetHunting();
    Retry.note(reason);
  },
  onDeath(entity) {
    if (!this.session || entity?.gid !== World.localGid() || !this.busy()) return;
    this.session.deaths++;
    const limit = Number(this.cfg().deaths) || 0;
    if (limit > 0 && this.session.deaths >= limit) this.deathLimitHit = true;
  },
  partyText(min) {
    const social = World.gp?.social, s = this.session;
    if (!(min > 0) || !Array.isArray(social?.members)) { this.smallSince = 0; return ''; }
    const size = social.members.filter(Boolean).length;
    if (s.partyAtStart === null) s.partyAtStart = size > 0;
    if (size >= min || !(size > 0 || s.partyAtStart)) { this.smallSince = 0; return ''; }
    this.smallSince ||= now();
    if (now() - this.smallSince < SAFETY_PARTY_WAIT_MS) return '';
    return `the party has ${size} ${size === 1 ? 'member' : 'members'}, fewer than ${min}`;
  },
  attacker(cast) {
    const caster = World.ents.get(cast?.caster), local = World.localGid();
    if (!caster || cast.caster === local) return null;
    const owner = caster.kind === 'cos' ? World.ents.get(caster.ownerGid) : caster;
    if (!owner || owner.kind !== 'player' || owner.gid === local || caster.ownerGid === local) return null;
    const social = World.gp?.social, name = owner.name || '';
    if (name && (name === social?.localName || Array.isArray(social?.members) && social.members.some(m => m?.name === name))) return null;
    return name || 'a player';
  },
  harmsLocal(cast) {
    const local = World.localGid();
    return (cast.results || []).some(r => r?.target === local && (r.impacts || []).some(i => i?.damage > 0));
  },
  onCast(cast) {
    if (!this.session || this.playerHit || !this.cfg().player.on || !this.busy() || !this.harmsLocal(cast)) return;
    const who = this.attacker(cast);
    if (who) this.playerHit = who;
  },
  uniqueText(meters) {
    const pose = World.pose();
    if (!pose || UniqueHunt.active || Settings.profile.hunt.classes.unique) return '';
    for (const e of World.ents.values()) {
      if (e.kind !== 'monster' || monsterClass(e) !== 'unique' || !World.isAlive(e) || dist2D(pose, e) > meters * 10) continue;
      return `a unique${e.name ? ' (' + e.name + ')' : ''} is within ${meters} m`;
    }
    return '';
  },
  tick() {
    if (!this.sync() || !World.inWorld()) return;
    if (this.townReason) {
      if (Town.trip) this.townReason = '';
      else if (now() - this.townAt > SAFETY_TOWN_WAIT_MS) userStop(this.townReason + ' (the town trip could not start)');
      return;
    }
    const c = this.cfg();
    if (this.deathLimitHit) return this.fire(`${this.session.deaths} deaths this session`, 'stop');
    if (this.playerHit) { const who = this.playerHit; this.playerHit = ''; return this.fire(who === 'a player' ? 'a player attacked the character' : 'a player attacked the character (' + who + ')', c.player.action); }
    const party = this.partyText(c.party.min);
    if (party) return this.fire(party, c.party.action);
    if (!c.unique.on) return;
    const unique = this.uniqueText(c.unique.meters);
    if (unique) this.fire(unique, c.unique.action);
  },
  finishTrip(trip) {
    Town.trip = null;
    Town.message = 'Town service complete; stopped by a safety trigger.';
    userStop(trip.why);
  },
};
{
  const startHunting = Hunt.start, townReason = Town.reason, townTick = Town.tick, townFail = Town.fail;
  Hunt.start = function (...args) {
    Safety.sync();
    return startHunting.apply(this, args);
  };
  Town.reason = function () { return Safety.townReason || townReason.apply(this, arguments); };
  Town.tick = function () {
    const trip = this.trip;
    if (trip && Safety.isSafetyTrip(trip) && SAFETY_TRIP_END.includes(trip.phase)) { Safety.finishTrip(trip); return true; }
    return townTick.apply(this, arguments);
  };
  Town.fail = function (reason) {
    const safe = Safety.isSafetyTrip(this.trip) ? this.trip.why : Safety.townReason;
    Safety.townReason = '';
    const result = townFail.apply(this, arguments);
    if (safe) Safety.seal(safe);
    return result;
  };
}
bus.on('death', entity => Safety.onDeath(entity));
bus.on('cast', cast => Safety.onCast(cast));
