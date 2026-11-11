const EMERGENCY_RETRY_MS = 3000, EMERGENCY_LOG_MS = 10000;
const Emergency = {
  sentAt: new Map(), loggedAt: new Map(),
  list() { return Settings.profile.macro.emergency; },
  running() { return !!(Hunt.running || UniqueHunt.active || WalkBack.active); },
  key(entry, index) { return index + ':' + entry.group; },
  newEntry(skill) {
    return { id: skill.id, group: skill.group ?? skill.id, trigger: 'hp', value: EMERGENCY_DEFAULT.hp, enabled: true };
  },
  holds(entry, me, attackers) {
    if (entry.trigger === 'hp') return me.hpPct < entry.value ? `HP ${Math.round(me.hpPct)}% < ${entry.value}%` : '';
    if (entry.trigger === 'mp') return me.mpPct < entry.value ? `MP ${Math.round(me.mpPct)}% < ${entry.value}%` : '';
    if (entry.trigger === 'attackers') return attackers >= entry.value ? `${attackers} monsters attack, at least ${entry.value}` : '';
    return '';
  },
  castTarget(id) {
    const info = World.skill(id);
    if (info && !info.targetRequired) return 0;
    const target = World.target();
    return target && isAttackableMob(target) ? target.gid : null;
  },
  log(entry, index, id, why) {
    const key = this.key(entry, index);
    if (now() - (this.loggedAt.get(key) ?? -Infinity) < EMERGENCY_LOG_MS) return;
    this.loggedAt.set(key, now());
    Log.info(`Emergency: ${World.skillName(id)} (${why})`);
  },
  tick() {
    const list = this.list();
    if (!list.length || !this.running() || !World.inWorld() || World.isDead() || World.isSitting() || Town.trip || Combat.busy()) return false;
    const me = World.me(), attackers = Combat.attackerCount();
    for (const [index, entry] of list.entries()) {
      if (!entry.enabled) continue;
      const why = this.holds(entry, me, attackers);
      if (!why) continue;
      const key = this.key(entry, index);
      if (now() - (this.sentAt.get(key) ?? -Infinity) < EMERGENCY_RETRY_MS) continue;
      const id = Combat.resolve(entry);
      if (!id || Combat.blocked(id) || !Cmd.canCast(id) || !Combat.mpOk(id, me)) continue;
      const gid = this.castTarget(id);
      if (gid === null) continue;
      if (!Combat.cast(id, gid)) continue;
      this.sentAt.set(key, now());
      this.log(entry, index, id, why);
      return true;
    }
    return false;
  },
  reset() { this.sentAt.clear(); this.loggedAt.clear(); },
};
bus.on('profile', () => Emergency.reset());
bus.on('reset', () => Emergency.reset());
