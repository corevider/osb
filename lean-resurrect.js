// Auto-resurrect dead party members with a learned corpse-targeted skill.
// The sim worker replaces a skill press's gid with the newest selection intent
// (core.ts), so the corpse is selected immediately before the press. The server
// proposes the revival, which the dead member answers inside a 30 second window.
// Only in-range corpses are considered when authored range is available.
// After a teleport or walking back into view the game can draw a dead player standing. The party list (HP in tenths)
// then still says 0, so a standing member at 0 counts as dead unless the server's own HP for the body says otherwise
// (sent when a player comes into view). The server does not send HP for a selected player, so it decides by taking or
// refusing the Rebirth; a refusal (nearly dead, not dead) waits for the answer window like an unanswered offer.
const RES_ALIVE_MS = 30000; // a standing member the server reports alive is checked again after this
const RES_REFUSED_MS = 10 * 60000;
const RES_REFUSAL_MS = 3000;
const RES_NAMES_MAX = 20;
const RES_WAIT_MIN_S = 31, RES_WAIT_MAX_S = 300, RES_TRIES_MAX = 99;
const Resurrect = {
  sent: {},           // member id -> time of the unanswered proposal
  checked: {},        // member id -> time until which a standing member counts as alive
  refused: {},
  tries: {},
  usedUp: {},
  lastCast: null,
  nextAt: -Infinity,  // earliest next attempt
  holdUntil: 0,
  trip: null,
  message: 'No fallen party member.',
  reset() {
    this.cancelTrip('', true); this.sent = {}; this.checked = {}; this.refused = {}; this.tries = {}; this.usedUp = {}; this.lastCast = null;
    this.nextAt = -Infinity; this.holdUntil = 0; this.message = 'No fallen party member.';
  },
  names() { return Party.names(Settings.profile.party.resNames).slice(0, RES_NAMES_MAX); },
  waitMs() { return clamp(Math.round(Number(Settings.profile.party.resWaitS) || RES_WAIT_MIN_S), RES_WAIT_MIN_S, RES_WAIT_MAX_S) * 1000; },
  maxTries() { return clamp(Math.round(Number(Settings.profile.party.resMax) || 0), 0, RES_TRIES_MAX); },
  spent(w) {
    const max = this.maxTries();
    if (!max || (this.tries[w.key] || 0) < max) return false;
    if (!this.usedUp[w.key]) {
      this.usedUp[w.key] = true;
      Log.info(this.usedUpText(w.name + (w.outsider ? ' (not in the party)' : ''), max));
    }
    return true;
  },
  usedUpText(label, max) { return 'Resurrection attempts used up for ' + label + ' (' + max + '); no more Rebirth until they are alive again.'; },
  newRun() { this.tries = {}; this.usedUp = {}; },
  lower(name) { return String(name || '').trim().toLowerCase(); },
  key(name) { return 'name:' + this.lower(name); },
  outsiderDead(e) { return e.appearanceState?.[0] === 2 || World.hpOf(e.gid) === 0; },
  outsiders(social, names) {
    if (!names.length) return [];
    const party = new Set(social.members.map(m => this.lower(m?.name)).filter(Boolean)), me = this.lower(social.localName), out = [];
    for (const e of World.ents.values()) {
      if (!e || e.kind !== 'player' || !e.name) continue;
      const name = this.lower(e.name);
      if (names.includes(name) && name !== me && !party.has(name)) out.push(e);
    }
    return out;
  },
  fallen(a, party) {
    const body = World.ents.get(a.gid), social = World.gp?.social;
    if (!body || body.name !== a.name) return false;
    if (a.outsider) return !!social && this.outsiders(social, this.names()).some(e => e.gid === a.gid) && this.outsiderDead(body);
    const member = party.find(m => m.id === a.member && m.name === a.name);
    return !!member && (member.status & 15) === 0 && this.dead(body);
  },
  noteRefusal(text) {
    const match = String(text).match(/^Cast rejected:\s*(\d+)\s*$/i), last = this.lastCast;
    if (!match || Number(match[1]) === 5 || !last || now() - last.at > RES_REFUSAL_MS) return;
    this.lastCast = null;
    this.refused[last.key] = now() + RES_REFUSED_MS;
    delete this.sent[last.key];
    this.holdUntil = 0;
    if (this.trip && this.trip.member === last.key) this.returnTrip();
    this.message = 'The game refused Rebirth on ' + last.name + ' (not in the party); skipping them for 10 minutes.';
    Log.warn(this.message);
  },
  // Whether a party member at 0 HP in the party list is dead: a corpse, or a standing body without known HP above 0.
  dead(e) {
    if (e.appearanceState?.[0] === 2) return true;
    const hp = World.hpOf(e.gid);
    return !isNum(hp) || hp === 0;
  },
  cancelTrip(message = '', halt = false) {
    if (this.trip && halt && this.trip.phase === 'approach') this.sent[this.trip.member] = now();
    if (this.trip && halt && World.inWorld() && !World.isDead()) Cmd.move(World.pose());
    this.trip = null;
    if (message) { this.message = message; Log.warn(message); }
  },
  returnTrip(message = '') {
    const a = this.trip;
    if (!a) return;
    a.phase = 'return'; a.travel = null; a.at = a.progressAt = now(); a.lastPose = { ...World.pose() }; a.sentAt = -Infinity;
    this.message = message || 'Returning to the hunting spot after resurrection.';
    if (message) Log.info(message);
  },
  travelTick(skill, members) {
    const a = this.trip, pose = World.pose();
    if (!a || !pose) return false;
    const body = World.ents.get(a.gid);
    if (a.phase === 'cast') this.returnTrip();
    if (a.phase === 'approach' && (!this.fallen(a, members) ||
        !Number.isFinite(dist2D(a.home, body)) || dist2D(a.home, body) > Settings.profile.party.resRadius)) {
      this.returnTrip('Resurrection target unavailable or outside the configured radius; returning.');
    }
    if (dist2D(a.lastPose, pose) > 3) { a.lastPose = { ...pose }; a.progressAt = now(); }
    if (now() - a.at > 30000 || now() - a.progressAt > 12000) {
      if (a.phase === 'approach') {
        this.sent[a.member] = now() + 30000;
        this.returnTrip('Resurrection travel timed out; returning to the hunting spot.');
      } else {
        this.cancelTrip('Resurrection return blocked or timed out.', true);
        if (Hunt.running) Hunt.stop('Resurrection return blocked or timed out.');
        return false;
      }
    }
    const destination = a.phase === 'return' ? a.home : body;
    const distance = dist2D(pose, destination);
    if (a.phase === 'return' && distance <= 12) { this.trip = null; this.message = 'Back at the hunting spot.'; return false; }
    if (a.phase === 'approach' && distance <= Math.max(1, (skill.range || 150) - 5)) return false;
    if (World.isCasting() || World.isSitting()) return true;
    const move = Navigation.next(a, destination);
    if (move.error && !move.waiting) {
      if (a.phase === 'approach') {
        this.sent[a.member] = now() + 30000;
        this.returnTrip('No walkable route to ' + a.name + '; returning.');
      } else {
        this.cancelTrip(move.error, true);
        if (Hunt.running) Hunt.stop(move.error);
      }
      return true;
    }
    if (move.waiting) { this.message = move.error || 'Waiting for resurrection travel.'; return true; }
    if (a.phase === 'approach' && dist2D(a.home, move.point) > Math.max(Settings.profile.party.resRadius, dist2D(a.home, pose) + 1)) {
      this.sent[a.member] = now() + 30000; this.returnTrip('Resurrection detour exceeds the configured radius; returning.'); return true;
    }
    if (now() - a.sentAt >= 900 && Cmd.move(move.point)) a.sentAt = now();
    this.message = a.phase === 'return' ? 'Returning to the hunting spot.' : 'Walking into resurrection range: ' + a.name;
    return true;
  },
  // The highest-tier learned corpse-targeted row: the Rebirth family marks
  // itself with the DeadBody target bit, and later tiers carry the higher
  // mastery requirement.
  skill() {
    let best = null;
    for (const id of World.gp?.skills || []) {
      const s = World.skill(id);
      if (!s || !s.targetRequired || !((s.targets ?? 0) & 128)) continue;
      if (!best || this.rank(s) > this.rank(best)) best = s;
    }
    return best;
  },
  rank(s) {
    const mastery = Math.max(0, ...(s.masteries || []).map(m => m.Level || 0));
    return mastery * 1000 + (s.level ?? 0);
  },
  tick() {
    const c = Settings.profile.party, names = this.names();
    if (!c.autoRes && !names.length) { this.cancelTrip('', true); this.holdUntil = 0; this.message = 'Auto-resurrect off.'; return false; }
    if (!World.inWorld() || World.isDead()) { this.cancelTrip(); this.holdUntil = 0; this.message = 'Waiting for a living character.'; return false; }
    if (now() - Manual.lastAt < Hunt.cfg().manualPauseS * 1000) { this.cancelTrip('Manual control: resurrection travel cancelled.'); this.holdUntil = 0; return false; }
    if (now() < this.holdUntil || this.holdUntil && World.isCasting()) return true;
    this.holdUntil = 0;
    const social = World.gp?.social, members = social?.members;
    if (!Array.isArray(members)) { this.cancelTrip('', true); return false; }
    const party = members.filter(m => m && m.id && m.name && m.name !== social.localName);
    const outsiders = this.outsiders(social, names);
    const t = now();
    for (const list of [this.sent, this.checked, this.tries, this.usedUp]) for (const id of Object.keys(list)) {
      if (id.startsWith('name:')) {
        const e = outsiders.find(x => this.key(x.name) === id);
        if (!names.includes(id.slice(5)) || e && !this.outsiderDead(e)) delete list[id];
        continue;
      }
      const m = party.find(x => x.id === Number(id));
      if (!m || (m.status & 15) !== 0) delete list[id];
    }
    for (const id of Object.keys(this.refused)) if (this.refused[id] <= t || !names.includes(id.slice(5))) delete this.refused[id];
    const wanted = [
      ...party.filter(m => c.autoRes || names.includes(this.lower(m.name))).map(m => ({ key: m.id, name: m.name, member: m })),
      ...outsiders.map(e => ({ key: this.key(e.name), name: e.name, body: e, outsider: true })),
    ];
    const offered = wanted.find(w => this.sent[w.key] && !this.usedUp[w.key]), finished = wanted.find(w => this.usedUp[w.key]);
    this.message = offered ? 'Resurrection offered: ' + offered.name + '; waiting for the answer.' :
      finished ? this.usedUpText(finished.name + (finished.outsider ? ' (not in the party)' : ''), this.maxTries()) :
      c.autoRes ? 'Watching for fallen party members.' : 'Watching for fallen players on the resurrect list.';
    const skill = this.skill();
    if (!skill) { this.cancelTrip('', true); this.message = 'No learned resurrection skill (Rebirth) was found.'; return; }
    if (this.trip && this.travelTick(skill, party)) return true;
    if (t < this.nextAt || World.gp.targetPending || !Cmd.canCast(skill.id)) return !!this.trip;
    if (World.isCasting() || World.isSitting() || World.local()?.mountedOn || World.gp.inventoryPending ||
        now() - Combat.lastCastAt < Settings.profile.macro.castGapMs || !Combat.mpOk(skill.id, World.me())) return !!this.trip;
    for (const w of wanted) {
      const m = w.member;
      if (m && (m.status & 15) !== 0 || this.sent[w.key] && t - this.sent[w.key] < this.waitMs() || this.checked[w.key] > t || this.refused[w.key] > t) continue;
      if (this.spent(w)) { this.message = this.usedUpText(w.name + (w.outsider ? ' (not in the party)' : ''), this.maxTries()); continue; }
      // The corpse must be in view as an entity to aim the select at.
      const e = w.body || [...World.ents.values()].find(x => x && x.kind === 'player' && x.name === m.name);
      if (!e) continue;
      if (w.outsider ? !this.outsiderDead(e) : !this.dead(e)) { if (!w.outsider) this.checked[w.key] = t + RES_ALIVE_MS; continue; }
      if (this.trip && e.gid !== this.trip.gid) continue;
      const distance = dist2D(World.pose(), e);
      const home = this.trip?.home || (Hunt.running && Settings.profile.hunt.center) || World.pose();
      if (!Number.isFinite(distance) || dist2D(home, e) > c.resRadius) continue;
      if (!w.outsider && e.appearanceState?.[0] !== 2 && this.sent[w.key] === undefined) Log.info(m.name + ' is at 0 HP in the party list but shown standing; offering resurrection.');
      if (Loot.active && !Loot.active.petGid) {
        if (!Cmd.move(World.pose())) return false;
        Loot.suspend();
      }
      if (distance > Math.max(1, (skill.range || 150) - 5)) {
        if (!this.trip) this.trip = { phase: 'approach', member: w.key, gid: e.gid, name: e.name, outsider: !!w.outsider, home: { ...home },
          at: t, progressAt: t, lastPose: { ...World.pose() }, sentAt: -Infinity };
        return this.travelTick(skill, party);
      }
      if (!Cmd.select(e.gid)) return !!this.trip;
      if (!Cmd.skill(skill.id, e.gid)) return !!this.trip;
      if (this.trip) this.trip.phase = 'cast';
      Combat.lastCastAt = t; Combat.lastCastId = skill.id; Stats.count('casts');
      this.lastCast = w.outsider ? { key: w.key, name: e.name, at: t } : null;
      // Keep combat/loot movement from replacing the approach or cast before
      // the worker has published it. Continue holding any observed cast.
      this.holdUntil = t + Math.max(1000, skill.actionMs || 6000) + 500;
      this.nextAt = t + 700;
      const first = this.sent[w.key] === undefined;
      this.sent[w.key] = t;
      this.tries[w.key] = (this.tries[w.key] || 0) + 1;
      const label = e.name + (w.outsider ? ' (not in the party)' : '');
      this.message = 'Resurrection offered: ' + label + '; waiting for the answer.';
      if (first) UI.toast('Resurrection offered: ' + label, 'info', 3000);
      if (first && w.outsider) Log.info('Resurrection offered: ' + label + '.');
      return true;
    }
  },
};
bus.on('game-error', text => Resurrect.noteRefusal(text));
bus.on('hunt', running => { if (running) Resurrect.newRun(); });
