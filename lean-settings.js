const SUPPORT_URL = 'https://github.com/corevider/osb/issues';
const NOTES_URL = 'https://github.com/corevider/osb/releases';
const CLASS_KEYS = ['normal', 'champion', 'party', 'giant', 'partyChampion', 'partyGiant', 'elite', 'unique'];
const ROTATION_LABELS = { normal: 'Normal', champion: 'Champion', party: 'Party', giant: 'Giant', partyChampion: 'Party champion', partyGiant: 'Party giant', elite: 'Elite', unique: 'Unique' };
const ROTATION_ICONS = { normal: ['tw_normal'], champion: ['tw_champion'], party: ['tw_party'], giant: ['tw_giant'], partyChampion: ['tw_party', 'tw_champion'], partyGiant: ['tw_party', 'tw_giant'], elite: ['tw_elite'], unique: ['tw_unique'] };
const Rotations = {
  classOf(e) {
    const cls = rotationKey(monsterClass(e));
    if (cls !== 'party') return cls;
    const grade = RARITY[e.rarity ?? 0];
    return grade === 'champion' ? 'partyChampion' : grade === 'giant' ? 'partyGiant' : 'party';
  },
  source(cls, macro = Settings.profile.macro) {
    const rotations = macro?.rotations || {};
    let i = Math.max(0, CLASS_KEYS.indexOf(rotationKey(cls)));
    if (Array.isArray(rotations[CLASS_KEYS[i]]) && rotations[CLASS_KEYS[i]].length) return CLASS_KEYS[i];
    if (!macro?.fallbackToNormal) return null;
    while (--i >= 0) if (Array.isArray(rotations[CLASS_KEYS[i]]) && rotations[CLASS_KEYS[i]].length) return CLASS_KEYS[i];
    return null;
  },
  list(cls, macro = Settings.profile.macro) {
    const key = this.source(cls, macro);
    return key ? macro.rotations[key] : [];
  },
  hint(cls, macro = Settings.profile.macro) {
    const key = this.source(cls, macro);
    if (key === cls) return '';
    return key ? 'Empty: uses ' + ROTATION_LABELS[key] : 'Empty: no skills';
  },
  upgrade(input) {
    const rotations = input?.macro?.rotations;
    if (!rotations || typeof rotations !== 'object' || !Array.isArray(rotations.party) || !rotations.party.length) return input;
    const missing = ['partyChampion', 'partyGiant'].filter(key => !(key in rotations));
    if (!missing.length) return input;
    const copy = { ...rotations };
    for (const key of missing) copy[key] = rotations.party.map(entry => entry && typeof entry === 'object' ? { ...entry } : entry);
    return { ...input, macro: { ...input.macro, rotations: copy } };
  },
};
const SOX_SEALS = ['star', 'moon', 'sun'];
function upgradeSoxSound(input) {
  const pickup = input?.hunt?.pickup;
  if (!pickup || typeof pickup !== 'object' || !('soxSound' in pickup)) return input;
  const { soxSound, ...rest } = pickup;
  if (!('soxSeals' in rest)) rest.soxSeals = Object.fromEntries(SOX_SEALS.map(seal => [seal, soxSound !== false]));
  return { ...input, hunt: { ...input.hunt, pickup: rest } };
}
function upgradeProfile(input) { return upgradeSoxSound(Rotations.upgrade(input)); }
const DEFAULT_PROFILE = {
  items: { rules: {}, balance: false, petToBag: false, autoEquip: false, gear: { primaryWeapon: null, secondaryWeapon: null, shield: null } },
  sounds: { player: false, died: false, levelUp: false, unique: false },
  unique: { spots: [], waitS: 0, learned: false, chase: 800, titans: false, selfDefence: true, skipBelow: 75, limitM: 60, chime: true },
  uniqueNests: { on: false, picks: [], maxM: 1000 },
  uniqueState: { deadTrustM: 30, tracker: false },
  stall: { title: '', greeting: '', network: true, closeWhenEmpty: true, prices: {} },
  alchemy: { target: 3, limit: 20, elixir: 0, powder: false, use: { luck: false, steady: false, immortal: false, astral: false }, stones: { luck: 1, steady: 1, immortal: 1, astral: 1 }, stoneLimit: 0,
    // The plus from which each helper is used: a failure from +5 up can destroy the item (Steady and Immortal matter from there),
    // Luck and lucky powder help at every plus, and Astral keeps +4 on a failure.
    from: { powder: 0, luck: 0, steady: 5, immortal: 5, astral: 4 },
    // Attribute percentages: the lowest variance value (0 to 31) wanted per NATTR_ name, 0 or missing = leave it alone.
    attr: { targets: {}, limit: 100 } },
  statPoints: { enabled: false, str: 1, int: 0, reserve: 0 },
  leveling: { on: false, spots: true, gear: true, accessories: true, sellOld: true, move: true, reserve: 5000, skills: true, prepared: '', added: [], elements: '', imbued: [], pet: '', build: 'auto', weapon: null },
  // Auto Quest: learned tokens bind a quest codename (QNO_...) to its refId, and learned targets
  // name the monster types whose kills advance each refId. Both fill themselves while playing.
  quest: { on: false, accept: true, picked: [], include: '', exclude: '', skip: [], learned: {}, targets: {} },
  trade: { from: 'CH', to: 'WC', trips: 1, potions: true, goods: 0 },
  trace: { enabled: false, name: '', distance: 12, fight: true },
  mastery: { enabled: false, ids: [], gap: 0, skills: false, scope: 'rotation', reserve: 0, order: 'masteries', max: false },
  lure: { enabled: false, points: [], taunt: { id: 0, group: 0 }, area: { id: 0, group: 0 }, holdS: 10, pauseEveryM: 10, pauseS: 4, radius: 15, returnHpPct: 50, stopAt: 0, stopOnPlayers: 0, stopAfter: 0 },
  pet: { attack: { on: false, recall: true, radius: 15, timeout: 3, resend: 5 } },
  scroll: { damageInc: false, damageAbs: false },
  mall: { on: false, budgetSilk: 0, hp: { on: false, low: 10, target: 1000 }, mp: { on: false, low: 10, target: 1000 }, damageInc: { on: false, low: 5, target: 20 }, damageAbs: { on: false, low: 5, target: 20 }, reverse: { on: false, low: 1, target: 5 } },
  party: { autoAcceptMatching: false, autoRecruit: false, joinMain: false, mainName: '', leaveIfNotLeader: false, onlyWhileRunning: false, acceptNames: '', autoInvite: false, inviteNames: '', inviteAnyone: false, inviteRadius: 300, autoRes: false, acceptRes: false, acceptResAny: false, resNames: '', reviveWaitS: 20, resRadius: 300, resWaitS: 31, resMax: 0, title: 'Hunting party', min: 1, max: 90, purpose: 0, expShare: true, itemShare: true,
    support: { enabled: false, whileStopped: false, range: 30, heal: { id: 0, group: 0, pct: 60, self: false }, group: { id: 0, group: 0, pct: 60, count: 2 }, buffs: [] },
    protect: { enabled: false, all: false, names: [], range: 40, whileNoAttack: false } },
  wardrobe: { on: true, phantom: true, realAnim: true, hideAvatars: false,
    eq: {}, av: {}, pet: { atk: 0, pick: 0, mount: 0 }, presets: {}, undo: null },
  macro: {
    rotations: { normal: [], champion: [], party: [], giant: [], partyChampion: [], partyGiant: [], elite: [], unique: [] },
    fallbackToNormal: true, normalAttack: true, buffs: [], imbue: null, buffSwap: false, buffAuto: true, buffSets: [],
    imbueBeforeAttack: true, berserkClasses: { normal: false, champion: false, giant: true, giantParty: false, party: false, elite: false, unique: false, titan: false }, berserkCornered: 0,
    minMpPct: 0, castGapMs: 350,
  },
  potion: {
    enabled: true, speedScroll: false, repairHammer: { on: false, pct: 50 }, hp: { on: true, pct: 60 }, mp: { on: true, pct: 40 },
    vigor: { on: true, hpPct: 30, mpPct: 15 }, cure: { on: true }, petHp: { on: false, pct: 50 }, petHgp: { on: false, pct: 30 },
    prefer: { hp: 0, mp: 0, vigor: 0, cure: 0 }, delayMs: 350,
    restock: {
      enabled: false, vendor: null, route: [], offers: [],
      town: { enabled: false, revive: true, revivePet: false, deathReturn: 'recall', returnBy: 'reverse', storeSox: true, sellStar: false, sellBag: false, sellExcess: false, storeLevels: '', petFull: true, petFree: 1, arrivalRadius: 500,
        broken: true, wear: { on: false, pct: 15 }, noXp: { on: false, minutes: 10, action: 'town' }, every: { on: false, minutes: 60 }, arrival: null, storage: null, vendor: null, smith: null, gate: null,
        keep: '', store: { equipment: true, elixirs: true, powders: true, alchemy: true, others: false } },
      hp: { on: true, refObjId: 0, low: 20, target: 100 },
      mp: { on: true, refObjId: 0, low: 20, target: 300 },
      cure: { on: false, refObjId: 58, low: 10, target: 50 },
      vigor: { on: false, refObjId: 22, low: 10, target: 50 },
      reverse: { on: false, refObjId: 3795, low: 10, target: 50 },
      hgp: { on: false, refObjId: 0, low: 5, target: 50 },
      kit: { on: false, refObjId: 0, low: 5, target: 50 },
      ammo: { arrow: { on: false, low: 200, target: 2000 }, bolt: { on: false, low: 200, target: 2000 } },
    },
  },
  hunt: {
    levelSpots: { on: false, list: [] },
    center: null, radius: 400, chase: 700, returnToCenter: true, travel: true, attack: true,
    classes: { normal: true, champion: true, giant: true, party: false, elite: false, unique: false, titan: false },
    levelMin: 0, levelMax: 0, include: '', exclude: '', priority: 'attackers', avoidKs: true, avoidKsScope: 'all', avoidKsBelow: 50,
    targetTimeoutS: 25,
    pickup: { enabled: true, soxOnly: false, skipStar: false, gold: true, potions: true, equipment: true, elixirs: true, powders: true, magicStones: true, attrStones: true, alchemy: true, others: true,
      collector: 'character', by: {}, petFullSound: true, petWhileManual: true, petWhileStopped: true, petInputHoldS: 3, petIdleRadius: 250, soxSeals: { star: true, moon: true, sun: true }, include: '', exclude: '', radius: 300, afterKillOnly: true, retries: 2 },
    sit: { enabled: true, hpBelow: 35, mpBelow: 20, resumeAt: 90 },
    antiStuck: { enabled: true, minutes: 3, maxRecoveries: 3, recall: false },
    detour: { enabled: true, stallMs: 2500 },
    trap: { enabled: true, seconds: 20, recall: false, diagnostics: false },
    onDeath: 'stop', stopNoHpPotion: false, stopInvFull: false, autoStart: false, retry: false,
    playerAlert: { enabled: false, radius: 250, pause: false }, manualPauseS: 6,
  },
};
// Preserve only bot settings. The original assistant's settings are never changed.
function botProfile(input) {
  const result = deepMerge(DEFAULT_PROFILE, {});
  if (!input || typeof input !== 'object') return result;
  input = upgradeProfile(input);
  for (const key of ['macro', 'potion', 'hunt', 'lure', 'pet', 'scroll', 'mall', 'wardrobe', 'party', 'alchemy', 'mastery', 'statPoints', 'leveling', 'trace', 'items', 'trade', 'stall', 'quest', 'sounds', 'unique', 'uniqueNests', 'uniqueState']) {
    if (!input[key] || typeof input[key] !== 'object') continue;
    for (const field of Object.keys(DEFAULT_PROFILE[key])) {
      if (field in input[key]) result[key][field] = deepMerge(DEFAULT_PROFILE[key][field], input[key][field]);
    }
  }
  for (const key of CLASS_KEYS) if (!Array.isArray(result.macro.rotations[key])) result.macro.rotations[key] = [];
  result.hunt.pickup.soxSeals = Object.fromEntries(SOX_SEALS.map(seal => [seal, result.hunt.pickup.soxSeals?.[seal] === true]));
  delete result.hunt.pickup.soxSound;
  // Migrate the old separate town stack targets once. Preserve the active
  // return mode's target; walking-only profiles retain their refill quantities.
  const restock = input.potion?.restock;
  if (restock?.town?.enabled && restock.town.stacks) {
    for (const kind of ['hp', 'mp']) {
      const stacks = restock.town.stacks[kind];
      if (Number.isInteger(stacks) && stacks >= 1 && stacks <= 200) result.potion.restock[kind].target = stacks * 50;
    }
  }
  delete result.potion.restock.town.stacks;
  if (!Number.isInteger(result.potion.delayMs) || result.potion.delayMs < 0 || result.potion.delayMs > 60000) result.potion.delayMs = DEFAULT_PROFILE.potion.delayMs;
  if (!['death', 'recall'].includes(result.potion.restock.town.deathReturn)) result.potion.restock.town.deathReturn = 'recall';
  if (!['reverse', 'walk'].includes(result.potion.restock.town.returnBy)) result.potion.restock.town.returnBy = 'reverse';
  const merchantReverse = result.potion.restock.reverse, mallReverse = result.mall.reverse;
  if (merchantReverse.on) {
    if (!mallReverse.on) { mallReverse.low = merchantReverse.low; mallReverse.target = merchantReverse.target; }
    mallReverse.on = true; merchantReverse.on = false;
  }
  // The anti-KS scope only has the two meanings; anything else is the old full behavior.
  if (result.hunt.avoidKsScope !== 'minor') result.hunt.avoidKsScope = 'all';
  // The finish-steal cutoff stops at 50: above it the kill can still be won, so avoiding is pointless.
  if (!Number.isFinite(result.hunt.avoidKsBelow) || result.hunt.avoidKsBelow < 0) result.hunt.avoidKsBelow = 0;
  if (result.hunt.avoidKsBelow > 50) result.hunt.avoidKsBelow = 50;
  const unique = result.unique, uniqueDefaults = DEFAULT_PROFILE.unique;
  unique.spots = (Array.isArray(unique.spots) ? unique.spots : []).filter(s => s && Number.isInteger(s.regionId) && [s.x, s.y ?? 0, s.z].every(Number.isFinite))
    .slice(0, 30).map(s => ({ name: typeof s.name === 'string' ? s.name.trim().slice(0, 32) : '', regionId: s.regionId, x: s.x, y: s.y ?? 0, z: s.z }));
  for (const key of ['learned', 'titans', 'selfDefence', 'chime']) if (typeof unique[key] !== 'boolean') unique[key] = uniqueDefaults[key];
  for (const [key, min, max] of [['waitS', 0, 600], ['chase', 100, 3000], ['skipBelow', 0, 100], ['limitM', 5, 1440]]) {
    unique[key] = Number.isFinite(unique[key]) ? clamp(Math.round(unique[key]), min, max) : uniqueDefaults[key];
  }
  const nests = result.uniqueNests;
  nests.on = nests.on === true;
  nests.picks = [...new Set((Array.isArray(nests.picks) ? nests.picks : []).filter(c => typeof c === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(c)))].slice(0, 100);
  nests.maxM = Number.isFinite(nests.maxM) ? clamp(Math.round(nests.maxM / 100) * 100, 100, 5000) : DEFAULT_PROFILE.uniqueNests.maxM;
  const stateCfg = result.uniqueState;
  stateCfg.tracker = stateCfg.tracker === true;
  stateCfg.deadTrustM = Number.isFinite(stateCfg.deadTrustM) ? clamp(Math.round(stateCfg.deadTrustM), 5, 240) : DEFAULT_PROFILE.uniqueState.deadTrustM;
  const P = result.hunt.pickup, pickupDefaults = DEFAULT_PROFILE.hunt.pickup;
  if (typeof P.petWhileStopped !== 'boolean') P.petWhileStopped = pickupDefaults.petWhileStopped;
  P.petInputHoldS = Number.isFinite(P.petInputHoldS) ? clamp(Math.round(P.petInputHoldS), 0, 30) : pickupDefaults.petInputHoldS;
  P.petIdleRadius = Number.isFinite(P.petIdleRadius) ? clamp(Math.round(P.petIdleRadius / 10) * 10, 50, 500) : pickupDefaults.petIdleRadius;
  const party = result.party, partyDefaults = DEFAULT_PROFILE.party;
  party.autoInvite = party.autoInvite === true; party.inviteAnyone = party.inviteAnyone === true;
  if (typeof party.inviteNames !== 'string') party.inviteNames = partyDefaults.inviteNames;
  party.inviteRadius = Number.isFinite(party.inviteRadius) ? clamp(Math.round(party.inviteRadius / 10) * 10, 10, 1000) : partyDefaults.inviteRadius;
  const protect = result.party.protect;
  for (const key of ['enabled', 'all', 'whileNoAttack']) protect[key] = protect[key] === true;
  protect.range = Number.isFinite(protect.range) ? clamp(Math.round(protect.range), 5, 100) : DEFAULT_PROFILE.party.protect.range;
  protect.names = [...new Set((Array.isArray(protect.names) ? protect.names : []).filter(n => typeof n === 'string').map(n => n.trim().slice(0, 32)).filter(Boolean))].slice(0, 50);
  // New categories inherit the old Other items switch, preserving existing selection.
  const pickup = input.hunt?.pickup;
  for (const key of ['elixirs', 'powders', 'alchemy']) {
    if (pickup && !(key in pickup)) result.hunt.pickup[key] = pickup.others ?? true;
  }
  // The old Berserk dropdown: Off and Whenever full carry over; Champion and above becomes Giants only.
  const mode = input.macro?.berserk;
  if (!input.macro?.berserkClasses && (mode === 'off' || mode === 'always')) {
    for (const key of Object.keys(result.macro.berserkClasses)) result.macro.berserkClasses[key] = mode === 'always';
  }
  // Party Giants used to follow the Party monsters switch.
  const savedBerserk = input.macro?.berserkClasses;
  if (savedBerserk && typeof savedBerserk === 'object' && !('giantParty' in savedBerserk)) result.macro.berserkClasses.giantParty = savedBerserk.party === true;
  // Magic and attribute stones used to sit in the alchemy switch, so they keep its setting.
  for (const key of ['magicStones', 'attrStones']) {
    if (pickup && !(key in pickup)) result.hunt.pickup[key] = pickup.alchemy ?? pickup.others ?? true;
  }
  // Helper stones used to be on when their count was above zero; now each has a switch and a count of at least 1.
  const oldStones = input.alchemy?.stones;
  if (oldStones && !input.alchemy?.use) for (const key of Object.keys(result.alchemy.use)) {
    const n = Number(oldStones[key]) || 0; result.alchemy.use[key] = n > 0; result.alchemy.stones[key] = Math.min(6, Math.max(1, n));
  }
  // A character wears one shield: the old primary and secondary shield become that one, the primary first.
  const gear = result.items.gear, oldGear = input.items?.gear;
  if (oldGear && typeof oldGear === 'object' && !('shield' in oldGear)) gear.shield = [oldGear.primaryShield, oldGear.secondaryShield].find(k => typeof k === 'string' && k) || null;
  delete gear.primaryShield; delete gear.secondaryShield;
  return result;
}
const Settings = {
  profileKey: 'profile:default',
  profile: botProfile(Store.get('profile:default', null)),
  saveProfile: debounce(() => Store.set(Settings.profileKey, Settings.profile), 250),
  useCharacter(name) {
    const key = name ? 'profile:' + name : 'profile:default';
    if (key === this.profileKey) return;
    Store.set(this.profileKey, this.profile);
    this.profileKey = key;
    this.profile = botProfile(Store.get(key, null));
    bus.emit('profile');
  },
  importOriginal() {
    try {
      const raw = W.localStorage.getItem('sroAsistan:v7:' + this.profileKey)
        || W.localStorage.getItem('sroAsistan:v7:profile:default');
      if (!raw) return UI.toast('No original bot profile was found.', 'warn');
      stopAll('settings changed');
      this.profile = botProfile(JSON.parse(raw));
      // The improved loot controller defaults to finishing its fight first.
      this.profile.hunt.pickup.afterKillOnly = true;
      this.saveProfile();
      bus.emit('profile');
      UI.toast('Imported combat, potion and hunting settings. Review them before starting.');
    } catch (e) { UI.toast('Could not import profile: ' + e.message, 'warn'); }
  },
};
// A change made right before the page closes still reaches storage; the debounce alone would lose it.
W.addEventListener('pagehide', () => Store.set(Settings.profileKey, Settings.profile));
const Sound = {
  ctx: null,
  unlock() {
    try {
      this.ctx ||= new (W.AudioContext || W.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {}
  },
  // Only these alerts are audible; existing combat/UI calls stay silent.
  tones: { 'pet-full': { notes: [659.25, 830.61, 987.77], gap: 0.18 }, sox: { notes: [783.99, 987.77, 1174.66, 1567.98], gap: 0.11 },
    player: { notes: [392, 329.63], gap: 0.25 }, died: { notes: [523.25, 415.3, 329.63], gap: 0.2 },
    levelUp: { notes: [523.25, 659.25, 783.99, 1046.5], gap: 0.12 }, unique: { notes: [880, 1108.73, 880, 1108.73], gap: 0.15 },
    uniqueKilled: { notes: [1318.51, 1046.5, 783.99, 1046.5, 1318.51, 1567.98], gap: 0.12 } },
  // Alert chimes for events the bus already carries (SBot-style alarms); every switch is off by default.
  level: null,
  anyOn() { const s = Settings.profile.sounds; return !!(s && (s.player || s.died || s.levelUp || s.unique)); },
  soxOn(tier = 0) { const s = Settings.profile.hunt.pickup.soxSeals || {}; return tier ? s[SOX_SEALS[tier - 1]] === true : SOX_SEALS.some(seal => s[seal] === true); },
  init() {
    bus.on('alert', (kind, e) => { if (kind === 'player' && e && Settings.profile.sounds?.player) this.play('player'); });
    bus.on('death', e => { if (e?.gid === World.localGid() && Settings.profile.sounds?.died) this.play('died'); });
    bus.on('spawn', e => { if (Settings.profile.sounds?.unique && e?.kind === 'monster' && RARITY[e.rarity] === 'unique') this.play('unique'); });
    // The first snapshot only learns the level; a chime needs a rise, and a character switch resets it.
    bus.on('gameplay', () => {
      if (!Settings.profile.sounds?.levelUp) { this.level = null; return; }
      const level = World.gp?.progression?.level;
      if (!Number.isInteger(level)) return;
      if (this.level !== null && level > this.level) this.play('levelUp');
      this.level = level;
    });
    bus.on('profile', () => { this.level = null; });
  },
  customKinds: ['sox'],
  customMaxBytes: 1024 * 1024,
  buffers: {},
  customKey(kind) { return 'sound:' + kind; },
  custom(kind) { return this.customKinds.includes(kind) ? Store.get(this.customKey(kind), null) : null; },
  setCustom(kind, file) {
    return new Promise((resolve, reject) => {
      if (!this.customKinds.includes(kind)) return reject(new Error('this alert has no custom sound'));
      if (!file) return reject(new Error('no file'));
      if (file.size > this.customMaxBytes) return reject(new Error('the file is larger than 1 MB'));
      const reader = new W.FileReader();
      reader.onerror = () => reject(new Error('the file could not be read'));
      reader.onload = async () => {
        const data = String(reader.result || '');
        this.unlock();
        try { await this.decode(data); } catch { return reject(new Error('the browser cannot play that file')); }
        if (!Store.set(this.customKey(kind), { name: String(file.name || 'sound').slice(0, 80), data })) return reject(new Error('browser storage is full'));
        delete this.buffers[kind];
        resolve();
      };
      reader.readAsDataURL(file);
    });
  },
  clearCustom(kind) { Store.remove(this.customKey(kind)); delete this.buffers[kind]; },
  async decode(dataUrl) {
    const ctx = this.ctx;
    if (!ctx) throw new Error('no audio');
    const bytes = Uint8Array.from(W.atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), c => c.charCodeAt(0));
    return await ctx.decodeAudioData(bytes.buffer);
  },
  playBuffer(buffer) {
    const ctx = this.ctx, source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; gain.gain.value = 0.8;
    source.connect(gain); gain.connect(ctx.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start();
  },
  playCustom(kind, custom) {
    const cached = this.buffers[kind];
    if (cached?.data === custom.data) { this.playBuffer(cached.buffer); return; }
    this.decode(custom.data).then(buffer => { this.buffers[kind] = { data: custom.data, buffer }; this.playBuffer(buffer); })
      .catch(() => { this.clearCustom(kind); this.play(kind); });
  },
  play(kind) {
    const tone = this.tones[kind];
    if (!tone) return false;
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return false;
      const custom = this.custom(kind);
      if (custom?.data) { this.playCustom(kind, custom); return true; }
      tone.notes.forEach((frequency, i) => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        const at = ctx.currentTime + i * tone.gap;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.12, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
        oscillator.connect(gain); gain.connect(ctx.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + 0.6);
      });
      return true;
    } catch { return false; }
  },
  async test(kind = 'pet-full') {
    this.unlock();
    try { if (this.ctx?.state === 'suspended') await this.ctx.resume(); } catch {}
    if (!this.play(kind)) UI.toast('Sound is blocked by the browser. Allow audio for this site and try again.', 'warn');
  },
};
