// Spends the character's unspent stat points on Strength and Intelligence, one confirmed point at a time. The game's
// own stat button sends one point per press (the "stat-increase" command); a point is confirmed when the unspent count
// goes down, never because the command was sent. The split is a ratio, kept by counting what the bot itself spent.
const StatPoints = {
  pending: null, blockedUntil: 0, lastAt: -Infinity, spent: { str: 0, int: 0 }, message: 'Auto stat points off.', note: null,
  cfg() { return Settings.profile.statPoints; },
  weight(stat) { const w = Math.floor(Number(this.cfg()[stat])); return Number.isFinite(w) ? Math.min(10, Math.max(0, w)) : 0; },
  reserve() { const r = Math.floor(Number(this.cfg().reserve)); return Number.isFinite(r) ? Math.max(0, r) : 0; },
  reset() { this.pending = null; this.blockedUntil = 0; this.spent = { str: 0, int: 0 }; this.message = this.cfg().enabled ? 'Waiting for character data.' : 'Auto stat points off.'; },
  // The stat furthest behind its share; with equal progress Strength goes first. Null when both weights are zero.
  pick() {
    const s = this.weight('str'), i = this.weight('int');
    if (!s && !i) return null;
    if (!i) return 'str';
    if (!s) return 'int';
    return this.spent.str * i <= this.spent.int * s ? 'str' : 'int';
  },
  tick() {
    const c = this.cfg(), progression = World.gp?.progression;
    if (!c.enabled) { this.pending = null; this.message = 'Auto stat points off.'; return; }
    if (!World.inWorld() || World.isDead() || !progression) { this.message = 'Waiting for a living character.'; return; }
    const points = progression.statPoints;
    if (!Number.isInteger(points)) { this.message = 'Stat points are not known yet.'; return; }
    const p = this.pending;
    if (p) {
      if (points < p.before) {
        this.spent[p.stat]++; this.pending = null;
        this.message = `+1 ${p.stat === 'str' ? 'Strength' : 'Intelligence'} (${points} point${points === 1 ? '' : 's'} left).`;
      } else if (now() - p.at > 5000) {
        // Never resend blindly: the server may have refused (for example at a stat limit).
        this.pending = null; this.blockedUntil = now() + 60000;
        this.message = `The ${p.stat === 'str' ? 'Strength' : 'Intelligence'} point was not accepted; trying again in a minute.`;
      } else return;
    }
    if (now() < this.blockedUntil) return;
    if (!points) { this.message = 'No stat points to spend.'; return; }
    if (points <= this.reserve()) { this.message = `Keeping ${points} stat point${points === 1 ? '' : 's'} unspent (your reserve is ${this.reserve()}).`; return; }
    const stat = this.pick();
    if (!stat) { this.message = 'Set a Strength or Intelligence share above zero.'; return; }
    if (now() - this.lastAt < 500 || !Cmd.spaced('stat-increase')) return;
    if (Cmd.raw({ kind: 'stat-increase', stat }, 'Stat point: +1 ' + (stat === 'str' ? 'Strength' : 'Intelligence'))) {
      this.pending = { stat, before: points, at: now() }; this.lastAt = now();
      this.message = `Adding a ${stat === 'str' ? 'Strength' : 'Intelligence'} point; waiting for the game to confirm.`;
    }
  },
  status() { return this.message; },
  draw(parent) {
    const box = UI.group('Stat points', UI.check('Spend stat points automatically', () => this.cfg().enabled, v => { this.cfg().enabled = v; this.pending = null; this.blockedUntil = 0; }));
    box.append(UI.number('Strength share', () => this.cfg().str, v => this.cfg().str = v, 0, 10),
      UI.number('Intelligence share', () => this.cfg().int, v => this.cfg().int = v, 0, 10),
      UI.number('Keep this many points unspent', () => this.cfg().reserve, v => this.cfg().reserve = v, 0, 65535));
    this.note = el('p', this.message, 'muted');
    box.append(this.note, el('p', 'Spends one point at a time and waits for the game to confirm it. The shares are a ratio: 1 and 0 puts everything into Strength, 0 and 1 everything into Intelligence, 2 and 1 spends two Strength points for every Intelligence point. The ratio counts only points this bot spent since it loaded, so points you added yourself do not change it.', 'muted'));
    parent.append(box);
  },
};
for (const [name, method] of [['Auto stat points', 'tick']]) {
  const original = StatPoints[method];
  StatPoints[method] = function (...args) { return Controller.guard(name, () => original.apply(this, args)); };
}
