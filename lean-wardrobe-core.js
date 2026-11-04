const WD_MEDIA = '/assets/images/Media_extracted/';
// Socket art keys (interface/equipment/equip_slot_<key>.png) per equipment slot 0..8
// and per avatar slot 0..3 (hat, dress, attachment, flag).
const WD_EQ_KEYS = ['helm', 'mail', 'shoulderguard', 'gauntlet', 'pants', 'boots', 'weapon', 'shield', 'specialdress'];
const WD_AV_KEYS = ['helm', 'cloth', 'pandernt', 'plag'];
// Socket grid: left column head/chest/legs, middle shoulder/hands/feet (the game's
// equipment pane), right column weapon/shield/job suit.
const WD_EQ_GRID = [0, 2, 6, 1, 3, 7, 4, 5, 8];
const WD_PAGE = 66;

// Codename grammar of every armour, weapon and shield in roster.dress (8439 rows, all
// slot 0..7 rows match except the two fortress weapons): race, sex, class, degree,
// part (HA/CA head, SA shoulder, BA chest, LA legs, AA hands, FA feet), grade, suffix.
const WD_RX = /^ITEM_(CH|EU)_(?:([MW])_(CLOTHES|LIGHT|HEAVY)_(\d\d)_(HA|CA|SA|BA|LA|AA|FA)|(SWORD|BLADE|SPEAR|TBLADE|BOW|DAGGER|TSWORD|AXE|CROSSBOW|DARKSTAFF|TSTAFF|HARP|STAFF|SHIELD)_(\d\d))_([ABC])(?:_(DEF|SUPER|RARE|MAGIC|LEGEND|MYTH)(?:_HONOR)?)?$/;
// Weapon tid4 per kind (client tooltip table Zp L5916 and stance table wh L17764).
const WD_WEAPON_T4 = { SWORD: 2, BLADE: 3, SPEAR: 4, TBLADE: 5, BOW: 6, EUSWORD: 7, TSWORD: 8, AXE: 9, DARKSTAFF: 10, TSTAFF: 11, CROSSBOW: 12, DAGGER: 13, HARP: 14, STAFF: 15, FORT: 16 };
const WD_ARMOR_T3 = { CLOTHES: 1, LIGHT: 2, HEAVY: 3 }; // +8 for European armour
const WD_JOB_T4 = { TRADER: 1, THIEF: 2, HUNTER: 3, VOUCHER: 5 };
// Equipment slot -> armour tid4 (inverse of the client rule [0,2,1,4,3,5][tid4-1]).
const WD_SLOT_T4 = [1, 3, 2, 5, 4, 6];
// Weapons a shield is worn with (random outfits keep two-handed weapons shield-free).
const WD_ONE_HAND = new Set(['SWORD', 'BLADE', 'EUSWORD', 'DAGGER', 'DARKSTAFF', 'STAFF']);
// Pick-pet models drawn exactly like another family (cos models get no material
// variant, R7 glow_pets), left out of the list.
const WD_PET_SKIP = new Set(['COS_P_PINKPIG', 'COS_P_SPOT_RABBIT']);

const WdCfg = () => Settings.profile.wardrobe;
const wdInt = (v, lo, hi) => clamp(Math.trunc(Number(v) || 0), lo, hi);
const wdTid3 = (tf) => ((Number(tf) >>> 0) >>> 7) & 15;
const wdTid4 = (tf) => ((Number(tf) >>> 0) >>> 11) & 31;
// Equipment typeFlags: bits 2-3 equipment (12), bit 5 wearable (32), tid3, tid4.
const wdTf = (t4, t3) => ((t4 << 11) | (t3 << 7) | 32 | 12) >>> 0;
const wdIsEquip = (tf) => ((Number(tf) >>> 0) & 126) === 44;
// Skill clip family of a weapon typeFlags: the game plays `${role}-${family}` (As(),
// index L21568) and skips the cast when neither that clip nor the bare role exists.
const WD_ANIM_FAM = { 2: 'sword', 3: 'sword', 4: 'spear', 5: 'spear', 6: 'bow', 12: 'bow', 7: '1hsword', 8: '2hsword', 9: 'axe', 10: '1hstaff', 15: '1hstaff', 11: '2hstaff', 13: 'dagger', 14: 'harp' };
const wdAnimFam = (tf) => WD_ANIM_FAM[wdTid4(tf)] || '';
// Job mode the game derives from inventory slot 8 (ac(), index L4334): 1..3 trader /
// thief / hunter, anything else normal; party matching and its commands follow it.
const wdJobMode = (tf) => ((Number(tf) >>> 0) & 2046) === 940 && wdTid4(tf) >= 1 && wdTid4(tf) <= 3;
// Case folding for search.
const wdFold = (s) => String(s || '').toLowerCase();

function wdSafe(what, fn) {
  try {
    return fn();
  } catch (e) {
    Log.warn('Wardrobe (' + what + '): ' + ((e && e.message) || e));
    return undefined;
  }
}

function wdClone(v) {
  try {
    return JSON.parse(JSON.stringify(v ?? null));
  } catch {
    return null;
  }
}

function wdItemName(ref) {
  return typeof Items !== 'undefined' && Items.name ? Items.name(ref) : '#' + ref;
}

function wdText(key, fallback) {
  return typeof Items !== 'undefined' && Items.text ? Items.text(key, fallback) || fallback : fallback;
}

// Icon path in the form the game stores for its own items ("item\china\...ddj");
// the catalogue gives "icon/item/...ddj" (the client's Gi() adds the icon/ root).
function wdGameIcon(ref) {
  const ddj = typeof Items !== 'undefined' && Items.iconDdj ? Items.iconDdj(ref) : '';
  return ddj ? String(ddj).replace(/^icon[\\/]/i, '').replace(/\//g, '\\') : '';
}

function wdSlotName(s) {
  const n = typeof Items !== 'undefined' && Items.slotName ? Items.slotName(s) : '';
  return n || ['Head', 'Chest', 'Shoulder', 'Hands', 'Legs', 'Feet', 'Weapon', 'Shield', 'Job suit'][s] || '';
}

function wdAvatarName(s) {
  return ['Hat', 'Dress', 'Attachment', 'Flag'][s] || '';
}

function wdKindName(kind) {
  const k = {
    SWORD: () => 'Sword',
    BLADE: () => 'Blade',
    SPEAR: () => 'Spear',
    TBLADE: () => 'Glaive',
    BOW: () => 'Bow',
    EUSWORD: () => 'One-handed sword',
    TSWORD: () => 'Two-handed sword',
    AXE: () => 'Dual axe',
    DARKSTAFF: () => 'Dark staff',
    TSTAFF: () => 'Two-handed staff',
    CROSSBOW: () => 'Crossbow',
    DAGGER: () => 'Dagger',
    HARP: () => 'Harp',
    STAFF: () => 'Staff',
    FORT: () => 'Fortress weapon',
    SHIELD: () => 'Shield',
  }[kind];
  return k ? k() : kind || '';
}

function wdClassName(cls, race) {
  const eu = race === 'EU';
  if (cls === 'CLOTHES') return eu ? 'Robe' : 'Garment';
  if (cls === 'LIGHT') return eu ? 'Light armour' : 'Protector';
  if (cls === 'HEAVY') return eu ? 'Heavy armour' : 'Armour';
  return '';
}

function wdBodyName(body) {
  return (
    {
      CH_M: () => 'Chinese male',
      CH_W: () => 'Chinese female',
      EU_M: () => 'European male',
      EU_W: () => 'European female',
    }[body] || (() => '—')
  )();
}

function wdSoxName(n) {
  return n ? wdText(['PARAM_RARE_FIRST', 'PARAM_RARE_SECOND', 'PARAM_RARE_THIRD'][n - 1], ['Seal of Star', 'Seal of Moon', 'Seal of Sun'][n - 1]) : '';
}

// +plus glow band (thresholds from the equipment GLB rows, R7 glow_pets).
function wdGlow(plus) {
  const p = Number(plus) || 0;
  if (p >= 9) return { name: 'Blue-green', color: '#6ff0d4' };
  if (p >= 7) return { name: 'Gold', color: '#ffc84a' };
  if (p >= 5) return { name: 'Pink', color: '#ff8ad8' };
  if (p >= 3) return { name: 'White', color: '#ffffff' };
  return { name: 'No glow', color: '#8f8a7a' };
}

// Parsed codename: weapons {race, kind, deg, grade, sox, honor}, armour {race, sex,
// cls, deg, part, ...}, job suits {job, deg}; sox 0 none | 1 Star | 2 Moon | 3 Sun.
function wdParse(code) {
  const c = String(code || '');
  const m = WD_RX.exec(c);
  if (m) {
    const sox = m[9] && /^(RARE|MAGIC|LEGEND|MYTH)$/.test(m[9]) ? 'ABC'.indexOf(m[8]) + 1 : 0;
    const base = { race: m[1], grade: m[8], sox, plain: !m[9] };
    if (m[6]) return { ...base, kind: m[6] === 'SWORD' && m[1] === 'EU' ? 'EUSWORD' : m[6], deg: +m[7] };
    return { ...base, sex: m[2], cls: m[3], deg: +m[4], part: m[5] };
  }
  let f = /^ITEM_FORT_FORTRESS_(HAMMER|AXE)_(\d+)/.exec(c);
  if (f) return { race: '', kind: 'FORT', deg: +f[2] || 0, sox: 0, plain: true };
  f = /_TRADE_(TRADER|THIEF|HUNTER)_(\d+)$/.exec(c);
  if (f) return { job: f[1], deg: +f[2] || 0, sox: 0, plain: true };
  if (/_FRPVP_VOUCHER_[A-E]$/.test(c)) return { job: 'VOUCHER', deg: 0, sox: 0, plain: true };
  const d = /_(\d\d)_/.exec(c);
  return { deg: d ? +d[1] : 0, sox: 0, plain: true };
}

const WdData = {
  rows: null, // [{id, code, slot, av, bodies:Set, glow, ac, m}]
  byId: new Map(),
  bodyByModel: new Map(), // character model refObjId -> body key
  modelName: new Map(), // cos / mount refObjId -> display name
  pets: [], // [{id, code, name, size}]
  mounts: [], // [{id, code, name}]
  petIds: new Set(),
  mountIds: new Set(),
  forBody: new Map(),
  promise: null,
  failedAt: -Infinity,
  error: '',
  texts: null, // merged textdata, for model names
  petsReady: false, // pet list built from a non-empty model list
  petPromise: null,
  petFailedAt: -Infinity,

  ready() {
    return !!this.rows;
  },

  // Loads once; a failure may be retried after 30 s (or right away from the window).
  load(force) {
    if (this.rows) return Promise.resolve(true);
    if (this.promise) return this.promise;
    if (!force && now() - this.failedAt < 30000) return Promise.resolve(false);
    this.error = '';
    this.promise = (async () => {
      const [wd, models, texts] = await Promise.all([
        Assets.wardrobe(),
        Assets.npcModels(),
        Assets.texts(),
        Items.ready(),
      ]);
      if (!wd || !Array.isArray(wd.items)) throw new Error('wardrobe catalogue unavailable');
      this.build(wd, Array.isArray(models) ? models : [], texts || {});
      return true;
    })()
      .catch((e) => {
        this.failedAt = now();
        this.error = String((e && e.message) || e);
        Log.warn('Wardrobe catalogue could not be loaded: ' + this.error);
        return false;
      })
      .finally(() => {
        this.promise = null;
      });
    return this.promise;
  },

  build(wd, models, texts) {
    const rows = [];
    const byId = new Map();
    for (const r of wd.items) {
      if (!Array.isArray(r) || !Number.isInteger(r[0])) continue;
      const slot = Number.isInteger(r[2]) && r[2] >= 0 && r[2] < 9 ? r[2] : -1;
      const av = Number.isInteger(r[3]) && r[3] >= 0 && r[3] < 4 ? r[3] : -1;
      if (slot < 0 && av < 0) continue;
      const row = { id: r[0], code: String(r[1] || ''), slot, av, bodies: new Set(String(r[4] || '').split(',').filter(Boolean)), glow: r[5] ? 1 : 0, ac: r[6] || 0 };
      row.m = wdParse(row.code);
      if (!row.m) continue;
      rows.push(row);
      byId.set(row.id, row);
    }
    const bodyByModel = new Map();
    const modelName = new Map();
    this.texts = texts;
    const mounts = [];
    for (const m of wd.models || []) {
      if (!Array.isArray(m)) continue;
      const mm = /^CHAR_(CH|EU)_(MAN|WOMAN)_/.exec(m[1] || '');
      if (mm) bodyByModel.set(m[0], mm[1] + '_' + (mm[2] === 'MAN' ? 'M' : 'W'));
      if (m[2]) {
        const name = this.nameOf(m[1]);
        mounts.push({ id: m[0], code: m[1], name });
        modelName.set(m[0], name);
      }
    }
    mounts.sort((a, b) => a.name.localeCompare(b.name));
    this.byId = byId;
    this.bodyByModel = bodyByModel;
    this.modelName = modelName;
    this.mounts = mounts;
    this.mountIds = new Set(mounts.map((p) => p.id));
    this.buildPets(models);
    if (!this.petsReady) this.petFailedAt = now();
    this.forBody.clear();
    this.rows = rows;
  },

  nameOf(code) {
    const texts = this.texts || {};
    const fam = code.replace(/_\d+$/, '');
    for (const k of [code, fam, fam + '_01']) if (texts['SN_' + k]) return texts['SN_' + k];
    return fam
      .replace(/^COS_[A-Z]_/, '')
      .toLowerCase()
      .replace(/(^|_)([a-z])/g, (_, s, ch) => (s ? ' ' : '') + ch.toUpperCase());
  },

  // Pets: one entry per family, two growth stages (first and last level model) when
  // the family has several. An empty model list (load failure) stays retryable.
  buildPets(models) {
    const fams = new Map();
    for (const m of models) {
      if (!Array.isArray(m) || m[2] !== 'cos' || !Number.isInteger(m[0])) continue;
      const code = String(m[1] || '');
      this.modelName.set(m[0], this.nameOf(code));
      const fam = code.replace(/_\d+$/, '');
      if (WD_PET_SKIP.has(fam)) continue;
      if (!fams.has(fam)) fams.set(fam, []);
      fams.get(fam).push({ id: m[0], code });
    }
    const pets = [];
    for (const [fam, list] of fams) {
      list.sort((a, b) => a.id - b.id);
      const name = this.nameOf(list[0].code);
      if (list.length === 1) pets.push({ id: list[0].id, code: list[0].code, name, size: '' });
      else {
        pets.push({ id: list[0].id, code: list[0].code, name, size: 'small', fam });
        pets.push({ id: list[list.length - 1].id, code: list[list.length - 1].code, name, size: 'large', fam });
      }
    }
    pets.sort((a, b) => a.name.localeCompare(b.name) || (a.size === 'large') - (b.size === 'large'));
    this.pets = pets;
    this.petIds = new Set(pets.map((p) => p.id));
    this.petsReady = pets.length > 0;
  },

  // Retries the pet model list after a failed load (at most every 30 s unless forced);
  // resolves true when the list was rebuilt.
  loadPets(force) {
    if (!this.rows || this.petsReady) return Promise.resolve(false);
    if (this.petPromise) return this.petPromise;
    if (!force && now() - this.petFailedAt < 30000) return Promise.resolve(false);
    this.petPromise = Promise.resolve(Assets.npcModels())
      .then((models) => {
        if (Array.isArray(models) && models.length) this.buildPets(models);
        if (!this.petsReady) this.petFailedAt = now();
        return this.petsReady;
      })
      .catch(() => {
        this.petFailedAt = now();
        return false;
      })
      .finally(() => {
        this.petPromise = null;
      });
    return this.petPromise;
  },

  rowsFor(body) {
    if (!this.rows || !body) return [];
    let list = this.forBody.get(body);
    if (!list) {
      list = this.rows.filter((r) => r.bodies.has(body));
      this.forBody.set(body, list);
    }
    return list;
  },

  bodyOf(modelRef) {
    return this.bodyByModel.get(modelRef) || '';
  },

  // Learned / formula typeFlags key of a catalogue row.
  classKey(row) {
    if (!row) return '';
    if (row.av >= 0) return 'v' + row.av;
    const m = row.m || {};
    if (row.slot === 6) return 'w:' + (m.kind || '');
    if (row.slot === 7) return 's:' + (m.race || '');
    if (row.slot >= 0 && row.slot < 6) return 'a:' + (m.race || '') + ':' + (m.cls || row.ac) + ':' + row.slot;
    if (row.slot === 8) return 'j:' + (m.job || '');
    return '';
  },

  // typeFlags by the standard layout (R2 / R7 appearance step 3), 0 when unknown.
  formulaTf(row) {
    if (!row) return 0;
    const m = row.m || {};
    if (row.av >= 0) return (((row.av + 1) << 11) | 1708) >>> 0;
    if (row.slot === 6) return WD_WEAPON_T4[m.kind] ? wdTf(WD_WEAPON_T4[m.kind], 6) : 0;
    if (row.slot === 7) return wdTf(m.race === 'EU' ? 2 : 1, 4);
    if (row.slot >= 0 && row.slot < 6) {
      const t3 = (WD_ARMOR_T3[m.cls] || clamp(row.ac || 1, 1, 3)) + (m.race === 'EU' ? 8 : 0);
      return wdTf(WD_SLOT_T4[row.slot], t3);
    }
    if (row.slot === 8) return wdTf(WD_JOB_T4[m.job] || 1, 7);
    return 0;
  },
};

const Wardrobe = {
  win: null,
  cssDone: false,
  // Arrays handed to the game, and the arrays they were built from.
  inv: null,
  baseInv: null,
  av: null,
  baseAv: null,
  body: '', // body key of the local character model
  learned: new Map(), // classKey -> typeFlags seen on real items
  warned: new Set(),
  applyTimer: 0,
  leftTimer: 0,
  learnAt: 0,
  sig: '',
  hsig: '',
  loadReq: false,
  view: { tab: 'items', slot: 'e6', q: '', kind: '', cls: '', deg: 0, rar: '', page: 0 },
  setOpt: { deg: 0, cls: '', sox: 0, weapon: '', shield: false, plus: 0 },
  el: {},

  // ---- state -------------------------------------------------------------------

  cfg() {
    const c = WdCfg();
    if (!c.eq || typeof c.eq !== 'object' || Array.isArray(c.eq)) c.eq = {};
    if (!c.av || typeof c.av !== 'object' || Array.isArray(c.av)) c.av = {};
    if (!c.pet || typeof c.pet !== 'object') c.pet = { atk: 0, pick: 0, mount: 0 };
    if (!c.presets || typeof c.presets !== 'object' || Array.isArray(c.presets)) c.presets = {};
    return c;
  },

  active() {
    return !!(this.cfg().on && WdData.ready() && this.body);
  },

  hasOverrides(c = this.cfg()) {
    return Object.keys(c.eq).length > 0 || Object.keys(c.av).length > 0 || !!(c.pet.atk || c.pet.pick || c.pet.mount) || !!c.hideAvatars;
  },

  outfit() {
    const c = this.cfg();
    return wdClone({ eq: c.eq, av: c.av, pet: c.pet, hideAvatars: !!c.hideAvatars });
  },

  useOutfit(o) {
    const c = this.cfg();
    const x = wdClone(o) || {};
    c.eq = x.eq && typeof x.eq === 'object' ? x.eq : {};
    c.av = x.av && typeof x.av === 'object' ? x.av : {};
    c.pet = { atk: wdInt(x.pet?.atk, 0, 4294967295), pick: wdInt(x.pet?.pick, 0, 4294967295), mount: wdInt(x.pet?.mount, 0, 4294967295) };
    c.hideAvatars = !!x.hideAvatars;
  },

  snapshot() {
    this.cfg().undo = this.outfit();
  },

  petKey() {
    const p = this.cfg().pet;
    return [p.atk || 0, p.pick || 0, p.mount || 0].join();
  },

  // Catalogue row of an equipment override when it may be handed to the game.
  validEq(slot, ref) {
    const row = ref ? WdData.byId.get(Number(ref)) : null;
    return row && row.slot === slot && row.bodies.has(this.body) ? row : null;
  },

  validAv(slot, ref) {
    const row = ref ? WdData.byId.get(Number(ref)) : null;
    return row && row.av === slot && row.bodies.has(this.body) ? row : null;
  },

  // Real item typeFlags win over the formula (and disagreements are logged once).
  tfFor(row) {
    const key = WdData.classKey(row);
    const seen = key ? this.learned.get(key) : undefined;
    return seen !== undefined ? seen : WdData.formulaTf(row);
  },

  learn() {
    if (!WdData.ready()) return;
    const add = (ref, tf) => {
      if (!Number.isInteger(ref) || !isNum(tf)) return;
      const row = WdData.byId.get(ref);
      const key = WdData.classKey(row);
      if (!key || this.learned.has(key)) return;
      const real = (Number(tf) >>> 0) & ~1; // bit 0 marks mall items
      this.learned.set(key, real);
      const f = WdData.formulaTf(row);
      if (f && f !== real && !this.warned.has(key)) {
        this.warned.add(key);
        Log.warn(`Wardrobe: ${row.code} typeFlags ${real}, formula ${f} (using the real value)`);
      }
    };
    const gp = World.gp;
    for (const it of Array.isArray(gp?.inventory) ? gp.inventory : []) if (it) add(it.refObjId, it.typeFlags);
    for (const it of Array.isArray(gp?.avatarInventory) ? gp.avatarInventory : []) if (it) add(it.refObjId, it.typeFlags);
    for (const e of World.ents.values()) {
      if (e && Array.isArray(e.equipment)) for (const q of e.equipment) if (q) add(q.refObjId, q.typeFlags);
      if (e && Array.isArray(e.avatars)) for (const q of e.avatars) if (q) add(q.refObjId, q.typeFlags);
    }
  },

  // ---- what the game is given ---------------------------------------------------

  // slot -> { item } (replace / add) or { hide: true } for the equipment overrides.
  eqPlan(base) {
    const plan = new Map();
    if (!this.active()) return plan;
    const c = this.cfg();
    const realArmor = base.find((it) => it && it.slot >= 0 && it.slot < 6 && [1, 2, 3, 9, 10, 11].includes(wdTid3(it.typeFlags)) && wdIsEquip(it.typeFlags));
    for (let s = 0; s < 9; s++) {
      const o = c.eq[s];
      if (!o || typeof o !== 'object') continue;
      const real = base.find((it) => it && it.slot === s) || null;
      if (o.hide) {
        // A worn job suit stays: dropping it would switch the game to normal mode.
        if (real && !(s === 8 && wdJobMode(real.typeFlags))) plan.set(s, { hide: true });
        continue;
      }
      const row = this.validEq(s, o.ref);
      const plusOv = (s === 6 || s === 7) && o.plus != null && isNum(Number(o.plus)) ? wdInt(o.plus, 0, 255) : null;
      if (!row && plusOv == null) continue;
      if (real) {
        const sameClass = this.groupOf(real.typeFlags) === this.slotGroup(s);
        const realPlus = Number.isInteger(real.plus) && real.plus >= 0 && real.plus <= 255 ? real.plus : 0;
        if (!row) {
          if (sameClass && plusOv !== realPlus) plan.set(s, { item: { ...real, plus: plusOv } });
          continue;
        }
        if (row.id === real.refObjId && plusOv == null) continue;
        if (sameClass) {
          const tf = s === 6 ? this.weaponTf(row, real.typeFlags) : real.typeFlags;
          plan.set(s, { item: { ...real, refObjId: row.id, typeFlags: tf, plus: plusOv ?? realPlus } });
        } else {
          plan.set(s, { item: this.standIn(s, row, plusOv ?? 0, realArmor, real) });
        }
      } else if (row && c.phantom) {
        plan.set(s, { item: this.standIn(s, row, plusOv ?? 0, realArmor, null), add: true });
      }
    }
    return plan;
  },

  // Slot 6 typeFlags of a fake weapon. It picks the stance (wh()) and the skill clip
  // family (As()); with "animations follow the real weapon" on, a fake of another
  // family keeps the real family (no weapon = tid4 0, unarmed), so casts never lose
  // their clips.
  weaponTf(row, realTf) {
    const base = realTf != null ? Number(realTf) >>> 0 : wdTf(0, 6);
    const fake = this.tfFor(row) || 0;
    if (!fake) return base;
    if (!this.cfg().realAnim) return fake;
    return wdAnimFam(fake) === wdAnimFam(base) ? fake : base;
  },

  // Item object for a slot without a real item of the same class: every field the
  // game's inventory UI reads (icon, name, typeFlags, quantity, plus, durability,
  // variance as BigInt string, magic arrays), no tooltip so it is shown by name only.
  standIn(s, row, plus, realArmor, real) {
    let tf = this.tfFor(row);
    // Same armour class as the real armour, so the game does not mark real parts as a
    // mixed set (w_ L2236); the drawn model does not depend on it.
    if (s < 6 && realArmor && tf) tf = wdTf(wdTid4(tf), wdTid3(realArmor.typeFlags));
    // The weapon keeps the real animation family (or unarmed) unless the user opted out.
    if (s === 6) tf = this.weaponTf(row, real && this.groupOf(real.typeFlags) === 'w' ? real.typeFlags : null);
    // A job suit stand-in must read as normal mode (tid4 0) for ac(); the job mode only
    // ever comes from a real suit, whose typeFlags are kept on the other path.
    if (s === 8) tf = wdTf(0, 7);
    if (!tf) tf = s === 7 ? wdTf(1, 4) : wdTf(WD_SLOT_T4[s] || 1, 1);
    return {
      slot: s,
      refObjId: row.id,
      typeFlags: tf,
      plus: wdInt(plus, 0, 255),
      quantity: 1,
      durability: 0,
      variance: real && real.variance ? real.variance : '0',
      magic: real && Array.isArray(real.magic) ? real.magic.slice() : [],
      magicReferences: real && Array.isArray(real.magicReferences) ? real.magicReferences.slice() : [],
      name: wdItemName(row.id),
      icon: wdGameIcon(row.id),
    };
  },

  groupOf(tf) {
    if (!wdIsEquip(tf)) return 'n';
    const t3 = wdTid3(tf);
    return t3 === 6 ? 'w' : t3 === 4 ? 's' : t3 === 7 ? 'j' : [1, 2, 3, 9, 10, 11].includes(t3) ? 'a' : 'x';
  },

  slotGroup(s) {
    return s === 6 ? 'w' : s === 7 ? 's' : s === 8 ? 'j' : 'a';
  },

  buildInv(base) {
    const plan = this.eqPlan(base);
    if (!plan.size) return base.slice();
    const out = [];
    const done = new Set();
    for (const it of base) {
      const s = it && it.slot;
      if (Number.isInteger(s) && s >= 0 && s < 9 && plan.has(s)) {
        done.add(s);
        const p = plan.get(s);
        if (p.item) out.push(p.item);
        continue;
      }
      out.push(it);
    }
    for (const [s, p] of plan) {
      if (done.has(s) || !p.add || !p.item) continue;
      const at = out.findIndex((it) => it && Number.isInteger(it.slot) && it.slot > s);
      if (at < 0) out.push(p.item);
      else out.splice(at, 0, p.item);
    }
    return out;
  },

  avSlotOf(a) {
    const row = WdData.byId.get(a && a.refObjId);
    return row && row.av >= 0 ? row.av : wdTid4(a && a.typeFlags) - 1;
  },

  avTf(s) {
    const seen = this.learned.get('v' + s);
    return seen !== undefined ? seen : (((s + 1) << 11) | 1708) >>> 0;
  },

  buildAv(base) {
    if (!this.active()) return base.slice();
    const c = this.cfg();
    if (c.hideAvatars) return [];
    const over = new Map(); // avatarSlot -> row | null (hidden)
    for (let s = 0; s < 4; s++) {
      const o = c.av[s];
      if (!o || typeof o !== 'object') continue;
      if (o.hide) over.set(s, null);
      else {
        const row = this.validAv(s, o.ref);
        if (row) over.set(s, row);
      }
    }
    if (!over.size) return base.slice();
    const out = base.filter((a) => a && !over.has(this.avSlotOf(a)));
    for (const [s, row] of over) if (row) out.push({ slot: s, refObjId: row.id, typeFlags: this.avTf(s), plus: 0 });
    return out;
  },

  // Gameplay rewriter: always hands the game a copy of the inventory array (kept for
  // in-place updates), with the overrides applied.
  onGameplay(st) {
    if (!st || typeof st !== 'object' || !Array.isArray(st.inventory)) return undefined;
    const next = this.buildInv(st.inventory);
    this.baseInv = st.inventory;
    this.inv = next;
    return { ...st, inventory: next };
  },

  // Entity rewriter: the local player's avatars (always a copy, kept for in-place
  // updates) and the models of the player's own pet and ridden COS.
  onEntity(e) {
    if (!e || typeof e !== 'object') return undefined;
    if (e.kind === 'local-player') {
      if (WdData.ready()) {
        const b = WdData.bodyOf(e.refObjId);
        if (b !== this.body) {
          this.body = b;
          this.rebuildInv();
        }
      }
      const base = Array.isArray(e.avatars) ? e.avatars : [];
      const next = this.buildAv(base);
      this.baseAv = base;
      this.av = next;
      return { ...e, avatars: next };
    }
    if (e.kind === 'cos') return this.petLook(e);
    return undefined;
  },

  petLook(e) {
    const c = this.cfg();
    if (!c.on || !WdData.ready()) return undefined;
    const lg = World.localGid();
    const t4 = (Number(e.tidWord) >>> 11) & 31;
    const local = World.local();
    let want = 0;
    if (local && local.mountedOn === e.gid && (t4 === 1 || t4 === 2)) want = WdData.mountIds.has(c.pet.mount) ? c.pet.mount : 0;
    else if (lg && e.ownerGid === lg && t4 === 3) want = WdData.petIds.has(c.pet.atk) ? c.pet.atk : 0;
    else if (lg && e.ownerGid === lg && t4 === 4) want = WdData.petIds.has(c.pet.pick) ? c.pet.pick : 0;
    if (!want || want === e.refObjId) return undefined;
    return { ...e, refObjId: want };
  },

  rebuildInv() {
    if (!this.inv || !this.baseInv) return;
    const next = this.buildInv(this.baseInv);
    this.inv.length = 0;
    for (const it of next) this.inv.push(it);
  },

  // Writes the current overrides into the arrays the game holds (next frame).
  applyNow() {
    wdSafe('uygula', () => {
      this.rebuildInv();
      if (this.av && this.baseAv) {
        const next = this.buildAv(this.baseAv);
        this.av.length = 0;
        for (const a of next) this.av.push(a);
      }
    });
  },

  applySoon() {
    if (this.applyTimer) return;
    this.applyTimer = setTimeout(() => {
      this.applyTimer = 0;
      this.applyNow();
    }, 40);
  },

  // pet: true only when the pet / mount look really changed (the toast explains the
  // delay until the animal's next update).
  changed(pet) {
    Settings.saveProfile();
    this.applySoon();
    const out = this.myCos();
    if (pet && (out.p3 || out.p4 || out.pm)) UI.toast('The pet and mount look changes with the animal’s next update (movement).', 'info', 3500);
    if (this.isOpen()) {
      this.renderLeft();
      this.renderHead();
      this.markGrid();
    }
  },

  // ---- actions --------------------------------------------------------------------

  ensureEq(s) {
    const c = this.cfg();
    if (!c.eq[s] || typeof c.eq[s] !== 'object') c.eq[s] = {};
    return c.eq[s];
  },

  tidyEq(s) {
    const c = this.cfg();
    const o = c.eq[s];
    if (o && !o.ref && o.plus == null && !o.hide) delete c.eq[s];
  },

  pick(row) {
    const id = this.view.slot;
    const c = this.cfg();
    if (id[0] === 'e') {
      const s = +id.slice(1);
      const o = this.ensureEq(s);
      if (o.ref === row.id && !o.hide) delete o.ref;
      else {
        o.ref = row.id;
        delete o.hide;
      }
      this.tidyEq(s);
    } else if (id[0] === 'a') {
      const s = +id.slice(1);
      if (c.av[s] && c.av[s].ref === row.id) delete c.av[s];
      else c.av[s] = { ref: row.id };
    }
    this.changed(false);
  },

  setPet(kind, ref) {
    const c = this.cfg();
    const before = c.pet[kind] || 0;
    c.pet[kind] = before === ref ? 0 : ref || 0;
    this.changed(c.pet[kind] !== before);
    if (this.isOpen()) this.renderPane();
  },

  resetSlot(id) {
    const c = this.cfg();
    const pets = this.petKey();
    if (id[0] === 'e') delete c.eq[+id.slice(1)];
    else if (id[0] === 'a') delete c.av[+id.slice(1)];
    else if (id === 'p3') c.pet.atk = 0;
    else if (id === 'p4') c.pet.pick = 0;
    else if (id === 'pm') c.pet.mount = 0;
    this.changed(this.petKey() !== pets);
    if (this.isOpen() && id[0] === 'p' && this.view.slot === id) this.renderPane();
  },

  toggleHide(id) {
    const c = this.cfg();
    if (id[0] === 'e') {
      const s = +id.slice(1);
      const o = this.ensureEq(s);
      const real = this.realEq(s);
      if (o.hide) delete o.hide;
      else if (s === 8 && real && wdJobMode(real.typeFlags)) {
        UI.toast('A worn job suit cannot be hidden: the game reads the job mode from this slot.', 'warn', 4000);
      } else {
        o.hide = true;
        if (s === 6 && real) UI.toast('With the weapon hidden, skill animations and hit effects may not play.', 'warn', 4000);
      }
      this.tidyEq(s);
    } else if (id[0] === 'a') {
      const s = +id.slice(1);
      if (c.av[s] && c.av[s].hide) delete c.av[s];
      else c.av[s] = { hide: true };
    }
    this.changed(false);
  },

  resetAll() {
    if (!this.hasOverrides()) return;
    this.snapshot();
    const pets = this.petKey();
    this.useOutfit({ eq: {}, av: {}, pet: { atk: 0, pick: 0, mount: 0 }, hideAvatars: false });
    this.changed(this.petKey() !== pets);
    UI.toast('Back to the real look ("Undo" restores the previous outfit).', 'info', 3000);
    if (this.isOpen()) this.renderPane();
  },

  undo() {
    const c = this.cfg();
    if (!c.undo) return;
    const cur = this.outfit();
    const pets = this.petKey();
    this.useOutfit(c.undo);
    c.undo = cur;
    this.changed(this.petKey() !== pets);
    if (this.isOpen()) this.renderPane();
  },

  randomize() {
    const rows = WdData.rowsFor(this.body);
    if (!rows.length) return;
    this.snapshot();
    const c = this.cfg();
    const any = (list) => list[Math.floor(Math.random() * list.length)];
    const eq = {};
    for (let s = 0; s < 6; s++) {
      const l = rows.filter((r) => r.slot === s);
      if (l.length) eq[s] = { ref: any(l).id };
    }
    const weapons = rows.filter((r) => r.slot === 6 && r.m.kind && r.m.kind !== 'FORT');
    if (weapons.length) {
      const w = any(weapons);
      eq[6] = { ref: w.id, plus: Math.floor(Math.random() * 13) };
      const shields = rows.filter((r) => r.slot === 7);
      const realShield = this.realEq(7);
      if (WD_ONE_HAND.has(w.m.kind) && shields.length && Math.random() < 0.7) eq[7] = { ref: any(shields).id, plus: Math.floor(Math.random() * 13) };
      // Only a real shield is hidden next to a two-handed weapon; arrows and bolts stay.
      else if (realShield && this.groupOf(realShield.typeFlags) === 's') eq[7] = { hide: true };
    }
    const av = {};
    for (let s = 0; s < 4; s++) {
      const l = rows.filter((r) => r.av === s);
      if (l.length && Math.random() < (s === 1 ? 0.3 : 0.5)) av[s] = { ref: any(l).id };
    }
    c.eq = eq;
    c.av = av;
    c.hideAvatars = false;
    this.changed(false);
    if (this.isOpen()) this.renderPane();
  },

  // Best row of a slot for the set builder: exact SoX grade first, then the plain
  // A-grade item, honour and _DEF/_SUPER variants last.
  bestRow(rows, slot, test) {
    let best = null;
    let score = -1;
    for (const r of rows) {
      if (r.slot !== slot || !test(r)) continue;
      const sc = (r.m.honor ? 0 : 4) + (r.m.plain || r.m.sox ? 2 : 0) + (r.m.grade === 'A' ? 1 : 0);
      if (sc > score || (sc === score && r.id < best.id)) {
        best = r;
        score = sc;
      }
    }
    return best;
  },

  // Puts the chosen set on; armour slots the set has no piece for are cleared so no
  // part of an older outfit stays mixed in. Returns {n, miss}.
  applySet() {
    const o = this.setOpt;
    const rows = WdData.rowsFor(this.body);
    if (!rows.length || !o.deg || !o.cls) return { n: 0, miss: 0 };
    this.snapshot();
    const c = this.cfg();
    const soxOk = (r) => (o.sox ? r.m.sox === o.sox : !r.m.sox);
    let n = 0;
    let miss = 0;
    const parts = [0, 1, 2, 3, 4, 5].map((s) => this.bestRow(rows, s, (x) => x.m.cls === o.cls && x.m.deg === o.deg && soxOk(x)));
    // With no armour piece at all the armour overrides are left alone.
    if (parts.some(Boolean)) {
      parts.forEach((r, s) => {
        if (r) {
          c.eq[s] = { ref: r.id };
          n++;
        } else {
          delete c.eq[s];
          miss++;
        }
      });
    }
    // Weapon / shield of the same degree, or the closest lower degree that exists.
    const near = (slot, test) => {
      for (let d = o.deg; d >= 1; d--) {
        const r = this.bestRow(rows, slot, (x) => x.m.deg === d && test(x) && soxOk(x));
        if (r) return r;
      }
      return null;
    };
    const plus = wdInt(o.plus, 0, 255);
    if (o.weapon) {
      const w = near(6, (x) => x.m.kind === o.weapon);
      if (w) {
        c.eq[6] = { ref: w.id, plus };
        n++;
      }
    }
    if (o.shield) {
      const sh = near(7, () => true);
      if (sh) {
        c.eq[7] = { ref: sh.id, plus };
        n++;
      }
    }
    this.changed(false);
    return { n, miss };
  },

  savePreset(name) {
    const key = String(name || '')
      .trim()
      .slice(0, 32);
    if (!key || /^(__proto__|constructor|prototype)$/.test(key)) return false;
    const c = this.cfg();
    if (!Object.prototype.hasOwnProperty.call(c.presets, key) && Object.keys(c.presets).length >= 40) {
      UI.toast('Up to 40 outfits can be stored.', 'warn', 2500);
      return false;
    }
    c.presets[key] = this.outfit();
    Settings.saveProfile();
    return true;
  },

  loadPreset(name) {
    const presets = this.cfg().presets;
    const p = Object.prototype.hasOwnProperty.call(presets, name) ? presets[name] : null;
    if (!p || typeof p !== 'object') return;
    this.snapshot();
    const pets = this.petKey();
    this.useOutfit(p);
    this.changed(this.petKey() !== pets);
  },

  deletePreset(name) {
    delete this.cfg().presets[name];
    Settings.saveProfile();
  },

  myCos() {
    const out = { p3: null, p4: null, pm: null };
    const lg = World.localGid();
    const local = World.local();
    if (!lg) return out;
    for (const e of World.ents.values()) {
      if (!e || e.kind !== 'cos') continue;
      const t4 = (Number(e.tidWord) >>> 11) & 31;
      if (local && local.mountedOn === e.gid) out.pm = e;
      else if (e.ownerGid === lg && t4 === 3) out.p3 = e;
      else if (e.ownerGid === lg && t4 === 4) out.p4 = e;
    }
    return out;
  },

  realEq(s) {
    const inv = Array.isArray(World.gp?.inventory) ? World.gp.inventory : [];
    return inv.find((it) => it && it.slot === s) || null;
  },

  realAv(s) {
    const l = World.local();
    return (l?.avatars || []).find((a) => a && this.avSlotOf(a) === s) || null;
  },

  isOpen() { return false; },
  ensureData(force = false) { return LeanWardrobe.load(force); },
  tick() {
    if (!WdData.ready()) {
      if (World.inWorld() && this.cfg().on && this.hasOverrides()) this.ensureData();
      return;
    }
    const body = WdData.bodyOf(World.local()?.refObjId);
    if (body && body !== this.body) { this.body = body; this.applyNow(); }
    if (now() - this.learnAt > 2000) { this.learnAt = now(); this.learn(); }
  },
};
Display.addGameplay('wardrobe', st => Wardrobe.onGameplay(st));
Display.add('wardrobe', e => Wardrobe.onEntity(e));
