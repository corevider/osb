import sys
"""Retain the original wardrobe's validated appearance core, without its window framework."""
from pathlib import Path
base = Path(__file__).resolve().parent
source_path = base / 'vendor' / 'bot.js'
if not source_path.exists():
    source_path = base / 'bot.js'
source = source_path.read_text(encoding='utf-8-sig')
def part(a, b):
    start = source.index(a)
    return source[start:source.index(b, start)]
constants = part('const WD_MEDIA =', 'const WdCfg =')
helpers = part('const wdInt =', '// Rich tooltip in the item tooltip style')
# Honor skins have the same validated body/slot contract as other catalogue rows.
helpers = helpers.replace("  if (c.includes('_HONOR')) return null;\n", '')
data = part('const WdData =', '// ---- the module ---')
data = data.replace("        typeof Items !== 'undefined' && Items.ready ? Items.ready().catch(() => null) : null,", "        Items.ready(),")
core = part('const Wardrobe =', '  // ---- window ---')
utilities = part('  myCos() {', '  render() {')
config = "const WdCfg = () => Settings.profile.wardrobe;\n"
adapters = '''  isOpen() { return false; },
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
'''
sys.path.insert(0, str(base))
from english_only import english_only
(base / 'lean-wardrobe-core.js').write_text(english_only(constants + config + helpers + data + core + utilities + adapters), encoding='utf-8', newline='\n')
