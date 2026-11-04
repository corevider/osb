"""Turn the bilingual T(turkish, english) calls of the reviewed core code into plain English strings.

The original assistant carried Turkish and English text side by side; the bot shows English only, so the
Turkish half is dropped at build time (vendor/bot.js itself stays untouched). Anything else written in
Turkish is translated through TRANSLATIONS, and the build fails if Turkish letters are left in the output.
"""
import re

IDENT = re.compile(r'[A-Za-z0-9_$.]')


def _skip_string(code, i):
    """Index just after the string or template literal that starts at code[i]."""
    quote = code[i]
    i += 1
    while i < len(code):
        c = code[i]
        if c == '\\':
            i += 2
            continue
        if quote == '`' and c == '$' and code[i + 1:i + 2] == '{':
            depth = 1
            i += 2
            while i < len(code) and depth:
                if code[i] in '\'"`':
                    i = _skip_string(code, i)
                    continue
                if code[i] == '{':
                    depth += 1
                elif code[i] == '}':
                    depth -= 1
                i += 1
            continue
        if c == quote:
            return i + 1
        i += 1
    raise ValueError('unterminated string')


def _split_call(code, start):
    """For code[start] == '(' return (argument texts, index after the closing paren)."""
    i, depth, args, begin = start + 1, 0, [], start + 1
    while i < len(code):
        c = code[i]
        if c in '\'"`':
            i = _skip_string(code, i)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                args.append(code[begin:i])
                return args, i + 1
            depth -= 1
        elif c == ',' and depth == 0:
            args.append(code[begin:i])
            begin = i + 1
        i += 1
    raise ValueError('unterminated call')


def strip_t(code):
    out, pos = [], 0
    for m in re.finditer(r'(?<![A-Za-z0-9_$.])T\(', code):
        if m.start() < pos:
            continue
        args, end = _split_call(code, m.end() - 1)
        if len(args) != 2:
            continue
        out.append(code[pos:m.start()])
        out.append(strip_t(args[1].strip()))
        pos = end
    out.append(code[pos:])
    return ''.join(out)


# Messages that were written in Turkish only (no T() pair).
TRANSLATIONS = {
    'Komut gözlemcisi kurulamadı: ': 'Command observer could not be installed: ',
    "'Oyun zaten çalışıyordu: geç bağlanıldı (bazı veriler ilk değişiklikte gelir).'": "'The game was already running: attached late (some data arrives on the first change).'",
    "'Oyun worker\\'ına bağlanıldı.'": "'Attached to the game worker.'",
    'Oyun simülasyonu durdu: ': 'The game simulation stopped: ',
    'Veri işlenemedi: ': 'Could not process data: ',
    'Görünüm yeniden yazıcı hatası (': 'Display rewriter error (',
    'Komut gönderilemedi: ': 'Command could not be sent: ',
    'Zamanlayıcı worker kullanılamadı (': 'Timer worker unavailable (',
    "'); sayfa zamanlayıcısına geçildi.'": "'); switched to the page timer.'",
    "fallback('yanıt yok')": "fallback('no response')",
    "|| 'hata')": "|| 'error')",
    "'Ayar kaydedilemedi: '": "'Could not save settings: '",
    "'Av durdu'": "'Hunting stopped'",
    "'oyun paketlerinde yok: '": "'not found in the game packs: '",
    "'Skill reddedildi, '": "'Skill refused, skipping for '",
    "' sn atlanıyor: '": "' s: '",
    "'Av başladı.'": "'Hunting started.'",
    'Hedef bırakıldı (hasar alınamadı): ': 'Target dropped (no damage dealt): ',
    'Hedef seçilemedi, bırakıldı: ': 'Target could not be selected, dropped: ',
    "': kısa yanıt ('": "': short response ('",
    "' bayt)'": "' bytes)'",
    "'zaman aşımı: '": "'timeout: '",
    "'ağ hatası: '": "'network error: '",
    "'tarayıcı gzip açamıyor (DecompressionStream yok)'": "'the browser cannot decompress gzip (DecompressionStream missing)'",
    "'gzip açılamadı: '": "'gzip could not be decompressed: '",
    "'manifest JSON okunamadı'": "'manifest JSON could not be read'",
    "'manifest biçimi tanınmadı ('": "'manifest format not recognised ('",
    "'paket kimliği hatalı: '": "'bad pack identifier: '",
    "'paket başlığı hatalı: '": "'bad pack header: '",
    "'taşıma dosyası SHA-256 tutmuyor: '": "'transport file SHA-256 mismatch: '",
    "// Case folding for search: Turkish İ/I and English i/I all compare equal.\nconst wdFold = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');": "// Case folding for search.\nconst wdFold = (s) => String(s || '').toLowerCase();",
    "'Görünüm Stüdyosu ('": "'Wardrobe ('",
    "'Görünüm Stüdyosu kataloğu yüklenemedi: '": "'Wardrobe catalogue could not be loaded: '",
    '`Görünüm Stüdyosu: ${row.code} typeFlags ${real}, formül ${f} (gerçek değer kullanılıyor)`': '`Wardrobe: ${row.code} typeFlags ${real}, formula ${f} (using the real value)`',
}


def english_only(code):
    code = strip_t(code)
    for turkish, english in TRANSLATIONS.items():
        code = code.replace(turkish, english)
    return code


TURKISH = re.compile(r'[çğıöşüÇĞİÖŞÜ]')


def leftovers(code):
    return [(n + 1, line.strip()[:160]) for n, line in enumerate(code.split('\n')) if TURKISH.search(line)]
