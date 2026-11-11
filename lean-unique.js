const UNIQUE_SPOT_REACH = 50, UNIQUE_SPOT_MAX = 30, UNIQUE_SPOT_FAILS = 2;
const UNIQUE_SEEN_KEY = 'unique:seen', UNIQUE_SEEN_MAX = 200, UNIQUE_SEEN_SAME = 400;
const UNIQUE_OTHERS_MS = 8000, UNIQUE_HIT_MS = 20000, UNIQUE_GIVE_UP_MS = 10000, UNIQUE_GIVE_UP_RATIO = 1.5, UNIQUE_GIVE_UP_LOSS = 0.05;
const UNIQUE_COLLECT_MS = 40000, UNIQUE_COLLECT_SETTLE_MS = 3000, UNIQUE_OWN_DROP_MS = 8000, UNIQUE_OWN_DROP_DIST = 150;
const UNIQUE_REACH_FACTOR = 1.5, UNIQUE_TRACKS_MAX = 64;
const UNIQUE_SETTLE_MS = 2000, UNIQUE_SETTLE_QUIET_MS = 1000, UNIQUE_SETTLE_MAX_MS = 5000;
const UNIQUE_LOW_PCT = 20, UNIQUE_LOW_HIT_MS = 5000, UNIQUE_LOST_NOTICE_MS = 15000, UNIQUE_WAIT_CHECK_MS = 1000;
const UNIQUE_NOTICE_NAMES = { TIGER_GIRL: 'Tiger Girl', IYUTARU: 'Isyutaru', URRUCHI: 'Uruchi', BONELORD: 'Lord Yarkan', TAHOMET: 'Demon Shaitan' };
const UniqueHunt = {
  active: null, message: '', tracks: new Map(), hits: new Set(), seenGids: new Set(), spawnAt: -Infinity,
  cfg() { return Settings.profile.unique; },
  isUnique(e) {
    if (!e || e.kind !== 'monster') return false;
    const cls = monsterClass(e);
    return cls === 'unique' || cls === 'titan' && this.cfg().titans === true;
  },
  same(a, b) { const x = String(a || '').trim().toLowerCase(), y = String(b || '').trim().toLowerCase(); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); },
  huntCfg() {
    const a = this.active, base = Settings.profile.hunt;
    if (!a) return base;
    const U = this.cfg(), anchor = this.here();
    if (a.cfg && a.cfgBase === base && a.cfgAnchor === anchor && a.cfgKey === U.chase + ':' + U.titans) return a.cfg;
    const cfg = Object.create(base), chase = this.chase();
    Object.assign(cfg, {
      center: anchor ? { regionId: anchor.regionId, x: anchor.x, y: anchor.y, z: anchor.z } : null, radius: chase, chase,
      classes: { normal: false, champion: false, giant: false, party: false, elite: false, unique: true, titan: U.titans === true },
      levelMin: 0, levelMax: 0, include: '', exclude: '', avoidKs: false, priority: 'attackers', returnToCenter: false, attack: true,
      levelSpots: { on: false, list: [] }, polygon: { on: false, corners: [] }, playerAlert: { ...base.playerAlert, pause: false }, onDeath: 'stop',
    });
    a.cfg = cfg; a.cfgBase = base; a.cfgAnchor = anchor; a.cfgKey = U.chase + ':' + U.titans;
    return cfg;
  },
  chase() { return clamp(Number(this.cfg().chase) || 800, 100, 3000); },
  here() { const a = this.active; return a ? a.walk ? World.pose() : a.anchor || a.origin : null; },
  blocked() {
    if (!World.inWorld()) return 'Enter the game world first.';
    if (World.isDead()) return 'The character is dead.';
    if (Hunt.running) return 'Stop hunting first.';
    if (Town.trip) return 'Wait for the town trip to finish (or stop the bot).';
    if (Quest.trip) return 'Wait for the quest visit to finish (or stop the bot).';
    if (Trade.run) return 'Stop auto trade first.';
    if (Stall.run || World.gp?.stall?.phase && World.gp.stall.phase !== 'none') return 'Close the stall first.';
    if (Alchemy.run || Alchemy.pending) return 'Stop alchemy and wait for its result first.';
    if (SellStar.run) return 'Wait for Sell Star to finish.';
    if (BuffGear.run || BuffGear.recovery && !BuffGear.autoRestore) return 'Restore or review combat gear first.';
    if (WalkBack.active || Travel.active || Restock.trip || Resurrect.trip || Controller.resumeAfterRevive) return 'Wait for the current walk or trip to finish (or stop the bot).';
    if (Restock.recording) return 'Finish or cancel route recording first.';
    return '';
  },
  start() {
    if (this.active) return UI.toast('The unique hunt is already running.', 'warn');
    const why = this.blocked();
    if (why) return UI.toast(why, 'warn');
    Sound.unlock();
    RunIntent.set(false);
    AutoStart.cancel('');
    const pose = World.pose();
    this.tracks.clear(); this.hits.clear();
    this.active = { startedAt: now(), origin: { regionId: pose.regionId, x: pose.x, y: pose.y, z: pose.z }, anchor: null, index: -1, phase: 'patrol',
      waitUntil: 0, walk: null, away: false, loops: 0, fails: new Map(), priority: '', priorityCodes: [], priorityDone: new Set(), goal: null, kill: null, lost: null, waiting: '', cfg: null };
    this.message = '';
    if (UniqueNests.on()) UniqueNests.load();
    UniqueTracker.start();
    this.resume();
    Log.info('Unique hunt started: ' + this.plan() + '.');
    UI.toast('Unique hunt started.', 'info', 3000);
    this.next();
  },
  plan() {
    const spots = this.spots(), n = spots.length, nests = spots.filter(s => s.nest).length;
    if (!n) return 'waiting at the start point (' + this.noSpots() + ')';
    return 'patrolling ' + n + ' spot' + (n === 1 ? '' : 's') + (nests ? ', ' + nests + ' of them unique nests' : '') + (UniqueNests.on() && UniqueNests.pending ? '; loading the game\'s unique nests' : '');
  },
  noSpots() {
    if (!UniqueNests.on()) return 'no patrol spots saved';
    if (UniqueNests.pending) return 'loading the game\'s unique nests';
    if (UniqueNests.loaded) return 'no patrol spots saved and no chosen unique nest within ' + Math.round(UniqueNests.maxDistance() / 10) + ' m';
    return 'no patrol spots saved';
  },
  nestsReady() {
    if (!this.active) return;
    const n = this.spots().filter(s => s.nest).length;
    Log.info('Unique hunt: ' + (n ? n + ' unique nest' + (n === 1 ? '' : 's') + ' added to the patrol.' : 'no chosen unique nest within ' + Math.round(UniqueNests.maxDistance() / 10) + ' m of the start point.'));
  },
  resume() {
    const a = this.active;
    if (!a) return;
    a.away = false;
    Hunt.running = true; Hunt.paused = false; Hunt.state = 'start'; Hunt.targetGid = 0; Hunt.selTries = 0; Hunt.lootGid = 0;
    Hunt.revived = false; Hunt.deathAt = 0; Hunt.ban.clear(); Hunt.lootBan.clear();
    Loot.reset(); Lure.reset(); Stats.huntStart();
    bus.emit('hunt', true);
  },
  halt() {
    if (!Hunt.running) return;
    if (World.inWorld() && !World.isDead()) Cmd.move(World.pose());
    Restock.trip = null; Loot.suspend();
    Hunt.running = false; Hunt.state = 'idle'; Hunt.targetGid = 0;
    Stats.huntStop();
    bus.emit('hunt', false);
  },
  stop(reason = 'stopped') {
    const a = this.active;
    if (!a) return false;
    this.endWalk();
    this.active = null;
    const text = /^stopped\b/i.test(reason) ? 'S' + reason.slice(1) + '.' : 'Stopped: ' + reason + '.';
    this.message = text;
    Log.info('Unique hunt: ' + text);
    UI.toast('Unique hunt: ' + text, /killed|by you|from outside/.test(reason) ? 'info' : 'warn', 6000);
    Retry.note('unique hunt: ' + reason);
    this.halt();
    return true;
  },
  away() {
    const a = this.active;
    if (!a) return;
    a.away = true; a.walk = null;
    this.halt();
  },
  endWalk() {
    const a = this.active;
    if (!a?.walk) return;
    a.walk = null;
    if (Travel.active) Travel.cancel();
    if (WalkBack.active) WalkBack.cancel('', false);
  },
  spots() {
    const U = this.cfg(), own = (U.spots || []).filter(s => s && Number.isFinite(s.x)).map(s => ({ ...s }));
    const nests = UniqueNests.spots(this.active?.origin || World.pose(), own), before = nests.length ? [...own, ...nests] : own;
    if (!U.learned) return before;
    let raw = null;
    try { raw = W.localStorage.getItem(Store.prefix + UNIQUE_SEEN_KEY); } catch {}
    const memo = this.spotMemo;
    if (memo && memo.own === U.spots && memo.nests === nests && memo.raw === raw) return memo.list;
    const learned = this.seen().filter(s => !before.some(o => dist2D(o, s) <= UNIQUE_SEEN_SAME)).sort((x, y) => (y.at || 0) - (x.at || 0));
    const list = [...before, ...learned.map(s => ({ name: s.name, regionId: s.regionId, x: s.x, y: s.y, z: s.z, learned: true }))].slice(0, UNIQUE_SPOT_MAX * 2 + UNIQUE_NEST_MAX);
    this.spotMemo = { own: U.spots, nests, raw, list };
    return list;
  },
  matches(spot, name, codes) { return !!spot && (!!spot.codes && codes.some(c => spot.codes.includes(c)) || this.same(spot.name, name)); },
  mapNests() { return UniqueNests.on() && UniqueNests.loaded ? this.spots().filter(s => s.nest) : []; },
  addSpot(name = '') {
    const pose = World.pose();
    if (!World.inWorld() || !pose) return UI.toast('Enter the game world first.', 'warn');
    const U = this.cfg();
    if ((U.spots || []).length >= UNIQUE_SPOT_MAX) return UI.toast('At most ' + UNIQUE_SPOT_MAX + ' patrol spots.', 'warn');
    const spot = { name: String(name || '').trim().slice(0, 32), regionId: pose.regionId, x: pose.x, y: pose.y, z: pose.z };
    U.spots = [...(U.spots || []), spot];
    Settings.saveProfile();
    UI.toast('Patrol spot ' + U.spots.length + ' saved' + (spot.name ? ': ' + spot.name : '') + '.');
    return true;
  },
  removeSpot(i) { const U = this.cfg(); U.spots = U.spots.filter((_, j) => j !== i); Settings.saveProfile(); },
  moveSpot(i, by) {
    const U = this.cfg(), j = i + by;
    if (j < 0 || j >= U.spots.length) return;
    const list = [...U.spots];
    [list[i], list[j]] = [list[j], list[i]];
    U.spots = list; Settings.saveProfile();
  },
  seen() { const list = Store.get(UNIQUE_SEEN_KEY, []); return Array.isArray(list) ? list.filter(s => s && typeof s.name === 'string' && Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isInteger(s.regionId)) : []; },
  clearSeen() { Store.set(UNIQUE_SEEN_KEY, []); this.seenGids.clear(); UI.toast('Learned unique spots cleared.'); },
  learn(e) {
    if (!e || e.kind !== 'monster' || monsterClass(e) !== 'unique' || !e.name || !Number.isFinite(e.x) || !Number.isInteger(e.regionId) || this.seenGids.has(e.gid)) return;
    this.seenGids.add(e.gid);
    if (this.seenGids.size > 500) this.seenGids.delete(this.seenGids.values().next().value);
    const list = this.seen(), at = Date.now(), name = String(e.name).slice(0, 40);
    const old = list.find(s => s.name === name && dist2D(s, e) <= UNIQUE_SEEN_SAME);
    if (old) { old.at = at; old.count = (old.count || 1) + 1; }
    else {
      list.push({ name, regionId: e.regionId, x: Math.round(e.x), y: Math.round(e.y ?? 0), z: Math.round(e.z), at, count: 1 });
      Log.info('Unique seen: ' + name + '; its spot is remembered.');
    }
    list.sort((x, y) => (y.at || 0) - (x.at || 0));
    Store.set(UNIQUE_SEEN_KEY, list.slice(0, UNIQUE_SEEN_MAX));
  },
  track(e) {
    let t = this.tracks.get(e.gid);
    if (!t) {
      t = { gid: e.gid, name: e.name || 'a unique', ours: 0, others: new Map(), engagedAt: 0, engageHp: null, othersBefore: false, decision: '', logged: new Set(), wanted: false, dead: false, lastHp: null };
      this.tracks.set(e.gid, t);
      while (this.tracks.size > UNIQUE_TRACKS_MAX) this.tracks.delete(this.tracks.keys().next().value);
      this.learn(e);
    }
    return t;
  },
  note(t, kind, text) {
    if (t.logged.has(kind)) return;
    t.logged.add(kind);
    Log.info('Unique hunt: ' + text);
  },
  othersFighting(e, sim = World.simNow() ?? 0) { return sim - (World.hitByOthers.get(e.gid) ?? -Infinity) < UNIQUE_OTHERS_MS; },
  hitUs(e, sim = World.simNow() ?? 0) { return sim - (World.attackers.get(e.gid) ?? -Infinity) < 6000; },
  weHit(e, sim = World.simNow() ?? 0, t = this.tracks.get(e.gid)) {
    if (sim - (World.hitByUs.get(e.gid) ?? -Infinity) < UNIQUE_HIT_MS) { if (t) t.hitAt = now(); return true; }
    return !!t && (t.ours > 0 || now() - (t.hitAt ?? -Infinity) < UNIQUE_HIT_MS || now() - (t.targetAt ?? -Infinity) < UNIQUE_HIT_MS);
  },
  lowAtLastSight(t) { return Number.isFinite(t.lastPct) && t.lastPct <= UNIQUE_LOW_PCT && now() - (t.oursAt ?? -Infinity) <= UNIQUE_LOW_HIT_MS; },
  sight(e, t) {
    const hp = World.hpOf(e.gid), pct = World.hpPctOf(e), hitSim = World.hitByUs.get(e.gid);
    if (Number.isFinite(hp)) t.lastHp = hp;
    if (pct !== null) t.lastPct = pct;
    if (Number.isFinite(e.x)) t.pose = { regionId: e.regionId, x: e.x, y: e.y ?? 0, z: e.z };
    if (hitSim !== undefined) t.oursAt = Math.max(t.oursAt ?? -Infinity, now() - Math.max(0, (World.simNow() ?? hitSim) - hitSim));
  },
  playersNear(e) {
    const party = new Set((World.gp?.social?.members || []).map(m => m?.name));
    let n = 0;
    for (const p of World.ents.values()) if (p.kind === 'player' && p.gid !== World.localGid() && !party.has(p.name) && dist2D(p, e) <= 300) n++;
    return n;
  },
  maxHpOf(e) { return World.vitalsOf(e.gid)?.maxHp || effectiveMaxHp(e) || null; },
  pct(e) { const p = World.hpPctOf(e); return p === null ? null : Math.round(p); },
  judge(e) {
    const t = this.track(e), sim = World.simNow() ?? 0, U = this.cfg();
    if (t.decision === 'gave up') return false;
    if (this.weHit(e, sim)) { t.decision = 'take'; t.why = 'we are fighting it'; return true; }
    const pct = World.hpPctOf(e), others = this.othersFighting(e, sim), below = Number(U.skipBelow) || 0;
    const label = t.name + (pct === null ? '' : ' (' + Math.round(pct) + '% HP)');
    if (others && pct !== null && pct < below) {
      t.decision = 'skip';
      this.note(t, 'skip', 'skipping ' + label + ': other players are fighting it and it is below ' + below + '% HP, so its drop is out of reach. Players near it: ' + this.playersNear(e) + '.');
      return false;
    }
    t.decision = 'take';
    t.why = label + (others ? ': others are fighting it, but it is still above ' + below + '% HP.' : ': nobody else is fighting it.');
    return true;
  },
  outDamaged(e) {
    const t = this.tracks.get(e.gid);
    if (!t || !t.engagedAt || this.hitUs(e) || now() - t.engagedAt < UNIQUE_GIVE_UP_MS) return null;
    const max = this.maxHpOf(e), hp = World.hpOf(e.gid);
    if (!max || !Number.isFinite(hp) || !Number.isFinite(t.engageHp)) return null;
    const lost = t.engageHp - hp;
    if (lost < max * UNIQUE_GIVE_UP_LOSS || !t.ours && !t.others.size || !t.others.size && !this.othersFighting(e)) return null;
    let seen = 0, top = 0;
    for (const v of t.others.values()) { seen += v; top = Math.max(top, v); }
    const during = Math.max(seen, lost - t.ours), prior = t.othersBefore ? Math.max(0, max - t.engageHp) : 0;
    const rival = prior + top + Math.max(0, during - seen), rivalDuring = top + Math.max(0, during - seen);
    if (!(rival > 0)) return null;
    const ours = t.ours + hp * (t.ours / lost), theirs = rival + hp * (rivalDuring / lost);
    if (theirs <= ours * UNIQUE_GIVE_UP_RATIO) return null;
    return { ours: Math.round(t.ours / max * 100), theirs: Math.round(rival / max * 100) };
  },
  onCast(cast) {
    if (!this.active || !cast) return;
    const local = World.localGid(), caster = World.ents.get(cast.caster);
    const ours = cast.caster === local || caster?.kind === 'cos' && caster.ownerGid === local;
    const party = new Set((World.gp?.social?.members || []).map(m => m?.name));
    const owner = caster?.kind === 'cos' ? World.ents.get(caster.ownerGid) : caster;
    const friendly = ours || !!owner?.name && party.has(owner.name);
    const token = cast.token ?? cast.startedAtMs ?? cast.receivedAtMs ?? '';
    if (!(cast.results || []).length && cast.fatal) {
      const target = World.ents.get(cast.target);
      if (target && this.tracks.has(target.gid)) this.died(target, 'a fatal hit');
    }
    for (const result of cast.results || []) {
      const target = World.ents.get(result?.target);
      if (!target || !this.isUnique(target)) continue;
      const t = this.track(target);
      for (const [index, impact] of (result.impacts || []).entries()) {
        if (impact?.fatal) this.died(target, 'a fatal hit');
        if (!(impact?.damage > 0)) continue;
        const key = `${cast.caster}:${token}:${cast.skill}:${result.target}:${impact.stage ?? index}:${impact.damage}`;
        if (this.hits.has(key)) continue;
        this.hits.add(key);
        if (friendly) {
          t.oursAt = now(); t.lastPct = World.hpPctOf(target) ?? t.lastPct;
          if (!t.engagedAt) { t.engagedAt = now(); t.engageHp = (World.hpOf(target.gid) ?? 0) + impact.damage; t.othersBefore = this.othersFighting(target); }
          t.ours += impact.damage;
        } else t.others.set(cast.caster, (t.others.get(cast.caster) || 0) + impact.damage);
      }
    }
    while (this.hits.size > 1024) this.hits.delete(this.hits.values().next().value);
  },
  died(e, how, killer = '', t = this.tracks.get(e.gid)) {
    const a = this.active;
    if (!a || !t || t.dead) return;
    t.dead = true;
    const lost = a.lost?.gid === e.gid, goal = a.goal?.gid === e.gid || lost, hit = this.weHit(e, World.simNow() ?? 0, t);
    const ours = hit && (goal || !a.goal && a.phase !== 'collect');
    UniqueState.noteEntity(e, 'dead', ours ? 'kill' : 'seen');
    if (lost) a.lost = null;
    if (!t.wanted && !hit) return;
    if (this.cfg().chime !== false) Sound.play('uniqueKilled');
    Log.info('Unique killed: ' + t.name + (killer ? ' (by ' + killer + ')' : '') + '.');
    UI.toast('Unique killed: ' + t.name, 'info', 8000);
    if (ours) {
      Stats.session.uniques = (Stats.session.uniques || 0) + 1;
      const at = Number.isFinite(e.x) ? { regionId: e.regionId, x: e.x, y: e.y ?? 0, z: e.z } : t.pose || World.pose();
      a.kill = { name: t.name, at: now(), pose: at, drops: new Set(), how };
      Log.info('Unique hunt: ' + t.name + ' counts as our kill (' + how + ').');
      this.endWalk();
      a.goal = null; a.phase = 'collect'; a.anchor = at; a.waiting = '';
      Hunt.targetGid = 0;
      return;
    }
    if (goal) {
      Log.info('Unique hunt: ' + t.name + ' died before we could fight it; back to patrolling.');
      this.lose();
    }
  },
  lose(why = '') {
    const a = this.active;
    if (!a) return;
    if (why && a.goal) Log.info('Unique hunt: lost ' + a.goal.name + ' (' + why + '); back to patrolling.');
    if (a.goal && Hunt.targetGid === a.goal.gid) Hunt.targetGid = 0;
    a.goal = null;
    if (a.phase !== 'collect') { a.phase = 'patrol'; a.waitUntil = 0; a.resumeSpot = true; }
  },
  onDespawn(e) {
    const a = this.active, t = this.tracks.get(e?.gid);
    if (a?.kill && e?.kind === 'ground-item') a.kill.drops.delete(e.gid);
    if (!a || !t) return;
    if (!t.dead && (e.appearanceState?.[0] === 2 || t.lastHp === 0)) this.died(e, 'its death');
    if (!t.dead && a.goal?.gid === e.gid && this.lowAtLastSight(t)) this.died(e, 'it vanished at ' + Math.round(t.lastPct) + '% HP right after our hits');
    if (!t.dead && a.goal?.gid === e.gid) {
      a.lost = { gid: e.gid, name: t.name, at: now(), e: { gid: e.gid, kind: e.kind, name: e.name, refObjId: e.refObjId, ...(t.pose || {}) }, t };
      this.lose('out of view');
    }
    this.tracks.delete(e.gid);
  },
  onSpawn(e) {
    if (e?.kind === 'monster') this.spawnAt = now();
    if (e?.kind === 'monster' && monsterClass(e) === 'unique') { UniqueNests.seenRef(e); UniqueState.noteEntity(e, World.isAlive(e) ? 'alive' : 'dead', 'seen'); }
    this.learn(e);
    const k = this.active?.kill;
    if (k && e?.kind === 'ground-item' && now() - k.at <= UNIQUE_OWN_DROP_MS && dist2D(e, k.pose) <= UNIQUE_OWN_DROP_DIST) k.drops.add(e.gid);
  },
  notice(n) {
    const m = /^UIIT_MSG_(APPEAR|DEAD|ANYONE_DEAD)_([A-Z_]+)$/.exec(String(n?.key || ''));
    if (!m || !(m[2] in UNIQUE_NOTICE_NAMES || m[2] === 'UNIC')) return;
    const args = Array.isArray(n.arguments) ? n.arguments.map(x => String(x ?? '').trim()) : [];
    const killer = m[1] === 'ANYONE_DEAD' ? args[0] || '' : '';
    const name = UNIQUE_NOTICE_NAMES[m[2]] || (m[1] === 'ANYONE_DEAD' ? args[1] : args[0]) || n.name || '';
    if (m[2] === 'UNIC' && name) UniqueNests.announced(name);
    if (name) UniqueState.noteNotice(m[2], name, m[1] === 'APPEAR' ? 'alive' : 'dead');
    const a = this.active;
    if (!a || !name) return;
    const codes = UniqueNests.identity(m[2], name);
    if (m[1] === 'APPEAR') {
      const n = this.spots().filter(s => this.matches(s, name, codes)).length;
      a.priority = n ? name : ''; a.priorityCodes = n ? codes : []; a.priorityDone = new Set();
      Log.info('Unique hunt: the game says ' + name + ' appeared' + (n ? '; patrolling ' + (n === 1 ? 'its spot' : 'its ' + n + ' spots') + ' first.' : '; no saved spot has its name.'));
      if (n && a.phase === 'patrol' && !a.goal) { this.endWalk(); a.waitUntil = 0; }
      return;
    }
    if (a.priority && (this.same(a.priority, name) || codes.some(c => a.priorityCodes.includes(c)))) {
      a.priority = ''; a.priorityCodes = [];
      Log.info('Unique hunt: the game says ' + name + ' was killed' + (killer ? ' by ' + killer : '') + '; back to the normal patrol order.');
    }
    const lost = a.lost && now() - a.lost.at < UNIQUE_LOST_NOTICE_MS && this.same(a.lost.name, name) ? a.lost : null;
    if (lost) {
      if (killer && World.charName && killer === World.charName) lost.t.hitAt = now();
      return this.died(lost.e, 'a game notice after it left view', killer, lost.t);
    }
    const g = a.goal;
    if (!g || !this.same(g.name, name)) return;
    const e = World.ents.get(g.gid), t = this.tracks.get(g.gid);
    if (t && killer && World.charName && killer === World.charName) t.hitAt = now();
    if (!e) {
      if (t && this.weHit({ gid: g.gid }, World.simNow() ?? 0, t)) return this.died({ gid: g.gid, kind: 'monster', name: g.name, ...(t.pose || {}) }, 'a game notice', killer, t);
      return this.lose('the game says it was killed' + (killer ? ' by ' + killer : ''));
    }
    this.died(e, 'a game notice', killer);
  },
  hittingUs(pose, sim) {
    let best = null;
    for (const e of World.ents.values()) {
      if (!this.isUnique(e) || !isAttackableMob(e) || !this.hitUs(e, sim) || !(dist2D(pose, e) <= this.chase() * UNIQUE_REACH_FACTOR)) continue;
      if (!best || dist2D(pose, e) < dist2D(pose, best)) best = e;
    }
    return best;
  },
  defence(pose, sim) {
    if (this.cfg().selfDefence === false) return null;
    let best = null;
    for (const [gid, at] of World.attackers) {
      const e = World.ents.get(gid);
      if (sim - at >= 6000 || !isAttackableMob(e) || Hunt.banned(Hunt.ban, gid) || !(dist2D(pose, e) <= this.chase())) continue;
      if (!best || (World.hpPctOf(e) ?? 100) < (World.hpPctOf(best) ?? 100)) best = e;
    }
    return best;
  },
  pick() {
    const a = this.active, here = this.here(), chase = this.chase();
    if (!here) return null;
    const goal = a.goal && World.ents.get(a.goal.gid);
    if (goal && !World.isAlive(goal)) {
      this.died(goal, 'its death');
      if (a.goal?.gid === goal.gid) this.lose();
      return null;
    }
    if (goal && isAttackableMob(goal) && dist2D(here, goal) <= chase * UNIQUE_REACH_FACTOR) {
      if (this.judge(goal)) return goal;
      this.lose();
    } else if (a.goal) this.lose(goal ? 'out of reach' : 'out of view');
    let best = null;
    for (const e of World.ents.values()) {
      if (!this.isUnique(e) || !isAttackableMob(e) || Hunt.banned(Hunt.ban, e.gid) || !(dist2D(here, e) <= chase)) continue;
      if (!this.judge(e)) continue;
      if (!best || dist2D(here, e) < dist2D(here, best)) best = e;
    }
    return best;
  },
  chooseTarget() {
    const a = this.active, pose = World.pose(), sim = World.simNow() ?? 0;
    if (!a || !pose) return null;
    const attacker = this.hittingUs(pose, sim);
    if (attacker) { this.want(attacker); return attacker; }
    if (a.phase === 'collect') return this.defence(pose, sim);
    const goal = this.pick();
    if (goal) { this.want(goal); return goal; }
    return this.defence(pose, sim);
  },
  want(e) {
    const a = this.active, t = this.track(e);
    t.wanted = true;
    if (a.goal?.gid === e.gid) return;
    this.note(t, 'take', 'going for ' + (this.hitUs(e) ? t.name + ': it is hitting us.' : t.why || t.name + '.'));
    a.goal = { gid: e.gid, name: t.name, at: now() };
    if (a.walk) { this.endWalk(); a.anchor = { ...World.pose() }; a.resumeSpot = true; }
    a.phase = 'chase';
  },
  threats() {
    const a = this.active, pose = World.pose(), sim = World.simNow() ?? 0;
    if (!pose) return false;
    if (this.hittingUs(pose, sim) || this.defence(pose, sim)) return true;
    return !!this.pick();
  },
  giveUpCheck() {
    const a = this.active, e = a.goal && World.ents.get(a.goal.gid);
    if (!e) return;
    const t = this.track(e);
    this.sight(e, t);
    if (Hunt.targetGid === e.gid) t.targetAt = now();
    if (!World.isAlive(e)) return this.died(e, t.lastHp === 0 ? 'zero HP' : 'its death');
    const out = this.outDamaged(e);
    if (!out) return;
    t.decision = 'gave up'; t.wanted = false;
    this.note(t, 'gave up', 'giving up ' + t.name + ': others dealt about ' + out.theirs + '% of its HP and we ' + out.ours + '%; they will get the drop.');
    if (Hunt.targetGid === e.gid) { Hunt.targetGid = 0; if (World.inWorld() && !World.isDead()) Cmd.move(World.pose()); }
    a.goal = null;
    this.lose();
  },
  next() {
    const a = this.active, spots = this.spots();
    a.phase = 'patrol'; a.resumeSpot = false;
    if (!spots.length) { a.index = -1; a.anchor = a.origin; return this.go(a.origin, -1); }
    const dead = [];
    const open = j => (a.fails.get(this.key(spots[j])) || 0) < UNIQUE_SPOT_FAILS;
    const alive = j => { const d = UniqueState.spotDead(spots[j]); if (d) dead.push(d); return !d; };
    let i = -1;
    if (a.priority) {
      const pose = World.pose();
      for (const [j, s] of spots.entries()) {
        if (!this.matches(s, a.priority, a.priorityCodes) || a.priorityDone.has(this.key(s)) || !open(j) || !alive(j)) continue;
        if (i < 0 || dist2D(pose, s) < dist2D(pose, spots[i])) i = j;
      }
      if (i >= 0) a.priorityDone.add(this.key(spots[i]));
      else { a.priority = ''; a.priorityCodes = []; }
    }
    if (i < 0) {
      const reachable = spots.map((_, j) => j).filter(open);
      if (!reachable.length) return this.stop('no patrol spot can be reached');
      dead.length = 0;
      const usable = reachable.filter(alive);
      if (!usable.length) return this.wait(dead);
      i = usable.find(j => j > a.index) ?? usable[0];
      if (a.index >= 0 && i <= a.index) a.loops++;
    }
    if (a.waiting) Log.info('Unique hunt: a chosen unique may be up again; patrolling.');
    a.waiting = '';
    a.index = i;
    a.anchor = { regionId: spots[i].regionId, x: spots[i].x, y: spots[i].y, z: spots[i].z };
    this.go(a.anchor, i);
  },
  wait(dead) {
    const a = this.active, text = UniqueState.deadText(dead);
    if (!a.waiting) {
      Log.info('Unique hunt: waiting here, every chosen unique is dead: ' + text + '.');
      this.endWalk();
      a.anchor = { ...World.pose() };
    }
    a.waiting = text; a.resumeSpot = false;
    a.waitUntil = now() + UNIQUE_WAIT_CHECK_MS;
  },
  key(s) { return s.regionId + ':' + Math.round(s.x) + ':' + Math.round(s.z); },
  go(spot, i) {
    const a = this.active, pose = World.pose(), d = dist2D(pose, spot);
    if (d <= UNIQUE_SPOT_REACH) return this.arrived(i);
    if (!Number.isFinite(d)) {
      if (i < 0) return this.stop('the start point is in another world or dungeon');
      return this.failed(i, 'it is in another world or dungeon');
    }
    a.walk = { index: i, kind: 'walk', at: now() };
    const label = i < 0 ? 'the start point' : 'unique spot ' + (i + 1);
    if (Travel.on() && Travel.begin(pose, spot, false)) { a.walk.kind = 'travel'; return; }
    const walk = a.walk;
    const ok = WalkBack.startTo(spot, { label, stop: Math.round(UNIQUE_SPOT_REACH * 0.6),
      onDone: () => { if (this.active?.walk === walk) { this.active.walk = null; this.arrived(i); } },
      onFail: reason => {
        if (this.active?.walk !== walk) return;
        this.active.walk = null;
        if (/manual control/i.test(String(reason))) { this.active.resumeSpot = true; return; }
        this.failed(i, reason);
      } });
    if (!ok && a.walk === walk) { a.walk = null; this.failed(i, 'the walk did not start'); }
  },
  arrived(i) {
    const a = this.active;
    if (!a) return;
    a.phase = 'patrol'; a.walk = null;
    const spot = i >= 0 ? this.spots()[i] : null;
    if (i >= 0) a.fails.delete(this.key(spot || a.anchor));
    const own = !!spot && !spot.nest && !spot.learned, wait = own ? clamp(Number(this.cfg().waitS) || 0, 0, 3600) * 1000 : 0;
    a.waitUntil = now() + Math.max(UNIQUE_SETTLE_MS, wait); a.settleCap = now() + Math.max(UNIQUE_SETTLE_MAX_MS, wait);
  },
  settling() { const a = this.active; return now() - this.spawnAt < UNIQUE_SETTLE_QUIET_MS && now() < (a.settleCap ?? 0); },
  failed(i, reason) {
    const a = this.active;
    if (!a) return;
    a.walk = null;
    if (i < 0) return this.stop('could not walk back to the start point (' + reason + ')');
    const spot = this.spots()[i], key = spot ? this.key(spot) : '';
    a.fails.set(key, (a.fails.get(key) || 0) + 1);
    Log.warn('Unique hunt: spot ' + (i + 1) + (spot?.name ? ' (' + spot.name + ')' : '') + ' skipped: ' + String(reason || 'the walk gave up').replace(/\.$/, '') + '.');
    a.waitUntil = 0;
    this.next();
  },
  ownDrop(by) {
    const k = this.active?.kill;
    if (!k?.drops.size) return null;
    const pose = World.pose();
    let best = null;
    for (const gid of k.drops) {
      const e = World.ents.get(gid);
      if (!e || Loot.whyNot(e) || by && Loot.collector(e) !== by) continue;
      if (!best || dist2D(pose, e) < dist2D(pose, best)) best = e;
    }
    return best;
  },
  collect() {
    const a = this.active, k = a.kill;
    if (Hunt.running) Hunt.tick();
    if (!this.active) return;
    const waited = now() - k.at;
    if (waited >= UNIQUE_COLLECT_MS) return this.stop(k.name + ' killed; drops collected for ' + Math.round(UNIQUE_COLLECT_MS / 1000) + ' s');
    if (waited < UNIQUE_COLLECT_SETTLE_MS || Loot.active || Hunt.targetGid) return;
    const P = Hunt.cfg().pickup;
    if (P.enabled && (Loot.choose('character') || Loot.petMode() && Loot.choose('pet'))) return;
    this.stop(k.name + ' killed');
  },
  tick() {
    const a = this.active;
    if (!a || !World.inWorld()) return;
    if (World.isDead()) return this.stop('the character died');
    if (WalkBack.active && !a.walk) { WalkBack.tick(); return; }
    if (Travel.active && !a.walk) { Travel.tick(); return; }
    if (a.away || !Hunt.running) { this.resume(); a.resumeSpot = true; }
    if (UniqueNests.on() && !UniqueNests.loaded && !UniqueNests.pending) UniqueNests.load();
    UniqueTracker.tick();
    this.huntCfg();
    if (a.phase === 'collect') return this.collect();
    if (a.goal) this.giveUpCheck();
    if (a.phase === 'collect') return this.collect();
    const limit = clamp(Number(this.cfg().limitM) || 0, 0, 1440);
    if (!a.goal && limit && now() - a.startedAt >= limit * 60000) return this.stop('time limit of ' + limit + ' min reached');
    if (a.walk?.kind === 'walk' && !WalkBack.active) { a.walk = null; a.resumeSpot = true; }
    if (a.walk) {
      if (!this.threats() && this.active?.walk) {
        if (a.walk.kind === 'travel' && !Travel.active) {
          const w = a.walk; a.walk = null;
          const spot = w.index < 0 ? a.origin : this.spots()[w.index];
          if (spot && dist2D(World.pose(), spot) <= UNIQUE_SPOT_REACH * 3) this.arrived(w.index); else this.failed(w.index, 'the travel ended away from the spot');
          return;
        }
        if (WalkBack.active) WalkBack.tick(); else if (Travel.active) Travel.tick();
        return;
      }
      if (!this.active) return;
      if (a.walk) {
        if (a.walk.kind === 'travel' && Travel.active?.phase && Travel.active.phase !== 'walk') { if (WalkBack.active) WalkBack.tick(); else Travel.tick(); return; }
        this.endWalk(); a.anchor = { ...World.pose() }; a.resumeSpot = true;
      }
    }
    Hunt.tick();
    if (!this.active || a.goal || Hunt.targetGid || Loot.active || now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000) return;
    if (a.resumeSpot && a.waiting) { a.resumeSpot = false; a.anchor = { ...World.pose() }; }
    if (a.resumeSpot) {
      const spots = this.spots(), spot = a.index >= 0 ? spots[a.index] : a.origin;
      a.resumeSpot = false;
      if (spot && dist2D(World.pose(), spot) > UNIQUE_SPOT_REACH) { a.anchor = a.index >= 0 ? { regionId: spot.regionId, x: spot.x, y: spot.y, z: spot.z } : a.origin; return this.go(spot, a.index); }
      a.waitUntil = Math.max(a.waitUntil, now() + 2000);
    }
    if (!a.walk && now() >= a.waitUntil && (this.spots().length || a.index >= 0) && !this.settling()) this.next();
  },
  mode() { return 'unique hunt'; },
  status() {
    const a = this.active;
    if (!a) return this.message || 'Not running.';
    if (a.phase === 'collect' && a.kill) return a.kill.name + ' killed; collecting drops.';
    if (a.away) return WalkBack.active ? WalkBack.status() : Travel.active ? Travel.status() : 'Returning to the patrol.';
    if (WalkBack.active && !a.walk) return WalkBack.status();
    if (Town.trip) return Town.status();
    const goal = a.goal && World.ents.get(a.goal.gid);
    if (goal) { const pct = this.pct(goal); return 'Going for ' + a.goal.name + (pct === null ? '' : ' (' + pct + '%)') + '.'; }
    const target = Hunt.targetGid && World.ents.get(Hunt.targetGid);
    if (target) return 'Fighting ' + (target.name || 'a monster') + ' (hitting you).';
    if (a.waiting && !a.walk) return 'Waiting: ' + a.waiting + '.';
    const spots = this.spots();
    if (!spots.length) return 'Waiting at the start point: ' + this.noSpots() + '.';
    const i = Math.max(0, a.index), spot = spots[i], name = spot?.name ? ' (' + spot.name + ')' : '';
    const left = Math.max(0, Math.ceil((a.waitUntil - now()) / 1000));
    if (spot?.nest) return 'Patrolling: ' + (a.walk ? 'walking to ' + spot.name : spot.name + (left ? ', waiting ' + left + ' s' : '')) + '.';
    if (a.walk) return 'Patrolling: walking to spot ' + (i + 1) + ' of ' + spots.length + name + '.';
    return 'Patrolling: spot ' + (i + 1) + ' of ' + spots.length + name + (left ? ', waiting ' + left + ' s' : '') + '.';
  },
  spotText(s, i) {
    const d = dist2D(World.pose(), s);
    return (i + 1) + '. ' + (s.name || 'Unnamed spot') + ' · ' + (Number.isFinite(d) ? Math.round(d / 10) + ' m away' : 'another region');
  },
  card() {
    const status = el('p', this.status(), 'muted');
    UI.refreshers.push(() => { status.textContent = this.status(); });
    return UI.group('Unique hunt',
      el('p', 'Patrols your unique spots and fights only uniques, with your Unique rotation, berserk, buffs and potions. When the unique it went for dies it chimes, collects the drops and stops. Your hunting spot and settings stay as they are.', 'muted'),
      UI.row(UI.button('Start', () => this.start()), UI.button('Stop', () => { if (!this.stop('stopped by you')) UI.toast('The unique hunt is not running.'); }),
        UI.button('Settings', () => UI.show('Combat', 'Unique hunt'))),
      status);
  },
  draw(host) {
    const U = () => this.cfg();
    let name = '';
    const list = el('div', null, 'sx-rows');
    const fill = () => list.replaceChildren(...(U().spots.length ? U().spots.map((s, i) => {
      const row = el('div', null, 'row');
      row.append(el('span', this.spotText(s, i)), UI.button('Up', () => { this.moveSpot(i, -1); fill(); }), UI.button('Down', () => { this.moveSpot(i, 1); fill(); }), UI.button('Remove', () => { this.removeSpot(i); fill(); }));
      return row;
    }) : [el('p', 'No patrol spots yet. Stand where a unique appears and press Add this spot.', 'muted')]));
    fill();
    const learnedNote = el('p', '', 'muted');
    const waitField = UI.number('Wait at each spot (s)', () => U().waitS, v => { U().waitS = v; }, 0, 600, 5);
    waitField.title = 'Only for your own spots, where a unique may appear later. At the game\'s nests and learned spots the bot looks around for about 2 seconds and goes on when no unique is in view.';
    const trackerNote = el('p', 'Unique tracker: ' + UniqueTracker.status(), 'muted');
    UI.refreshers.push(() => { trackerNote.textContent = 'Unique tracker: ' + UniqueTracker.status(); });
    const learned = () => { const s = this.seen(); learnedNote.textContent = s.length ? 'Learned: ' + s.slice(0, 12).map(x => x.name + ' ×' + (x.count || 1)).join(', ') + (s.length > 12 ? ' and ' + (s.length - 12) + ' more' : '') + '.' : 'Learned: none yet.'; };
    learned();
    host.append(UI.group('Unique hunt',
      el('p', 'Started from the Unique hunt card on the Setup page. It patrols these spots in order, waits at each for Wait at each spot, and loops. At the game\'s nests and learned spots it only looks around for about 2 seconds and goes on when no unique is in view. Distances count from the spot it is at, or from where you started it with no spots; never from the hunting area.', 'muted'),
      list,
      UI.text('Spot name (optional)', () => name, v => { name = v; }, 'for example Tiger Girl'),
      UI.button('Add this spot', () => { if (this.addSpot(name)) fill(); }),
      waitField,
      UI.check('Also patrol learned spots', () => U().learned, v => { U().learned = v; }),
      el('p', 'Every unique the bot sees is remembered with its place, on this computer only. Learned spots come after yours.', 'muted'),
      learnedNote,
      UI.button('Clear learned spots', () => { this.clearSeen(); learned(); }),
      UI.number('Chase distance (m)', () => U().chase / 10, v => { U().chase = v * 10; }, 10, 300),
      UI.check('Titans too (they use the Unique rotation)', () => U().titans, v => { U().titans = v; }),
      UI.check('Fight monsters that hit me', () => U().selfDefence, v => { U().selfDefence = v; }),
      UI.number('Skip a unique others have brought below this % HP', () => U().skipBelow, v => { U().skipBelow = v; }, 0, 100, 5),
      el('p', 'The drop goes to whoever dealt the most damage. A unique others are fighting is skipped below this HP; during a fight the bot gives up when others clearly out-damage it. A unique that hits you is always fought back, and one nobody else fights is always taken.', 'muted'),
      UI.number('Stop after (min)', () => U().limitM, v => { U().limitM = v; }, 5, 1440, 5),
      UI.number('Trust a unique\'s death for (min)', () => Settings.profile.uniqueState.deadTrustM, v => { Settings.profile.uniqueState.deadTrustM = v; }, 5, 240, 5),
      UI.check('Use the game site\'s unique tracker', () => Settings.profile.uniqueState.tracker === true, v => { Settings.profile.uniqueState.tracker = v; }),
      trackerNote,
      el('p', 'The bot remembers which uniques are alive or dead from the game\'s announcements, what it sees, its own kills and, if you turn the tracker on (it is off by default), the game site\'s unique tracker (opensro.online/uniques). Nothing is requested until you turn it on; then the page is read only while the unique hunt runs or the Setup page is shown, at most every 2 minutes (a Refresh never within 30 s), without cookies and without any data about you. It patrols only for chosen uniques not known to be dead; when every chosen unique is dead it stands where it is and waits until one appears again. Without newer news a death is trusted this long, then the unique is patrolled again.', 'muted'),
      UI.check('Chime when a unique monster comes into view', () => Settings.profile.sounds.unique, v => { Settings.profile.sounds.unique = v; }),
      UI.button('Test in-view chime', () => Sound.test('unique')),
      UI.check('Chime when the hunted unique dies', () => U().chime, v => { U().chime = v; }),
      UI.button('Test kill chime', () => Sound.test('uniqueKilled'))));
    UniqueNests.draw(host);
  },
};
{
  const startBeforeUnique = Hunt.start, stopBeforeUnique = Hunt.stop, chooseBeforeUnique = Hunt.chooseTarget, threatBeforeUnique = Hunt.threat;
  const cfgBeforeUnique = Hunt.cfg, levelSpotTick = LevelSpot.tick, lureOn = Lure.on, protectPick = Protect.pick;
  const questBlocked = Quest.blocked, townReason = Town.reason, reconnectBusy = Reconnect.busy, antiStuckTick = AntiStuck.tick, lootChoose = Loot.choose;
  Hunt.cfg = function () { return UniqueHunt.active ? UniqueHunt.huntCfg() : cfgBeforeUnique.call(this); };
  Hunt.start = function (...args) {
    if (UniqueHunt.active) { if (!this.running) UniqueHunt.resume(); return; }
    return startBeforeUnique.apply(this, args);
  };
  Hunt.stop = function (reason) {
    if (UniqueHunt.active && this.running) {
      if (reason === 'walking back to the hunting spot') return UniqueHunt.away();
      return UniqueHunt.stop(reason || 'stopped');
    }
    return stopBeforeUnique.apply(this, arguments);
  };
  Hunt.chooseTarget = function (...args) { return UniqueHunt.active ? UniqueHunt.chooseTarget() : chooseBeforeUnique.apply(this, args); };
  Hunt.threat = function (current) {
    if (!UniqueHunt.active) return threatBeforeUnique.call(this, current);
    return UniqueHunt.cfg().selfDefence === false ? null : threatBeforeUnique.call(this, current);
  };
  LevelSpot.tick = function () { return UniqueHunt.active ? false : levelSpotTick.apply(this, arguments); };
  Lure.on = function () { return !UniqueHunt.active && lureOn.apply(this, arguments); };
  Protect.pick = function () { return UniqueHunt.active ? null : protectPick.apply(this, arguments); };
  Quest.blocked = function () { return UniqueHunt.active ? 'the unique hunt is running' : questBlocked.apply(this, arguments); };
  Town.reason = function () {
    const why = townReason.apply(this, arguments);
    return UniqueHunt.active && /^(no XP|every )/.test(why) ? '' : why;
  };
  Reconnect.busy = function () { return UniqueHunt.active ? false : reconnectBusy.apply(this, arguments); };
  AntiStuck.tick = function () {
    if (UniqueHunt.active && !Hunt.targetGid) { this.idleMs = 0; this.lastAt = now(); return; }
    return antiStuckTick.apply(this, arguments);
  };
  Loot.choose = function (by = null) {
    const chosen = lootChoose.call(this, by);
    if (!UniqueHunt.active?.kill || chosen && UniqueHunt.active.kill.drops.has(chosen.gid)) return chosen;
    return UniqueHunt.ownDrop(by) || chosen;
  };
}
bus.on('cast', cast => UniqueHunt.onCast(cast));
bus.on('spawn', e => UniqueHunt.onSpawn(e));
bus.on('despawn', e => UniqueHunt.onDespawn(e));
bus.on('death', e => {
  if (e?.kind !== 'monster') return;
  if (UniqueHunt.tracks.has(e.gid)) UniqueHunt.died(e, 'its death');
  if (monsterClass(e) === 'unique') UniqueState.noteEntity(e, 'dead', 'seen');
});
bus.on('notice', n => UniqueHunt.notice(n));
bus.on('reset', () => { UniqueHunt.tracks.clear(); UniqueHunt.hits.clear(); if (UniqueHunt.active) { UniqueHunt.active.goal = null; UniqueHunt.active.kill = null; UniqueHunt.active.lost = null; } });
