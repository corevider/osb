"""Builds diagnostics-vocabulary.json: every value OSB itself can put in a diagnostics event.

build-lean.py calls build() on the finished userscript, writes the file and embeds the template words in
osb.user.js. OSB Manager and the platform keep byte-identical copies (DIAGNOSTICS.md 5.1.1).

Usage: python3 diagnostics_vocabulary.py --check
Compares diagnostics-vocabulary.json with the built osb.user.js and exits 1 when they differ.
"""
import json
import re
import sys
from pathlib import Path

FILE_NAME = 'diagnostics-vocabulary.json'
WORDS_ANCHOR = 'const DIAG_KNOWN_WORDS = '
WORDS_LINE = re.compile(r'^const DIAG_WORD_LIST = .*\n', re.M)
REGENERATE = ('diagnostics-vocabulary.json differs from the code: run "python3 build-lean.py", then copy the file to '
              'OSB Manager and osb-platform (DIAGNOSTICS.md 5.1.1)')

BROWSER_ERROR_TYPES = [
    'AbortError', 'NotAllowedError', 'NotFoundError', 'NotSupportedError', 'InvalidStateError', 'SecurityError',
    'NetworkError', 'QuotaExceededError', 'TimeoutError', 'DataCloneError', 'InvalidAccessError', 'OperationError',
    'UnknownError', 'DataError', 'TransactionInactiveError', 'ReadOnlyError', 'VersionError', 'ConstraintError',
    'EncodingError', 'NotReadableError', 'InvalidCharacterError', 'HierarchyRequestError', 'IndexSizeError',
    'InvalidModificationError', 'GPUPipelineError',
]

MASK = '\x01'
IDENTIFIER = re.compile(r'(?<![A-Za-z0-9_$\x80-￿])(?:[A-Za-z_$]|[^\x00-\x7f])(?:[A-Za-z0-9_$]|[^\x00-\x7f])*')
WORD = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*|[0-9][A-Za-z0-9_.]*|[^\x00-\x7f]+')
REGEX_AFTER = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'}
CODE = re.compile(r'^[a-z0-9][a-z0-9_.:-]{0,63}$')
ACTIVITY_CODE = re.compile(r'^[a-z0-9-]{1,64}$')
LITERAL = re.compile('([\'"])' + MASK + '*\\1')


def _string_end(source, i):
    quote = source[i]
    i += 1
    while source[i] != quote:
        if source[i] == '\n':
            raise ValueError('unterminated string at offset %d' % i)
        i += 2 if source[i] == '\\' else 1
    return i + 1


def _template_end(source, i, braces):
    while True:
        if source[i] == '\\':
            i += 2
        elif source[i] == '`':
            return i + 1
        elif source.startswith('${', i):
            braces.append(True)
            return i + 2
        else:
            i += 1


def _regex_end(source, i):
    i += 1
    in_class = False
    while True:
        c = source[i]
        if c == '\n':
            raise ValueError('unterminated regular expression at offset %d' % i)
        if c == '\\':
            i += 2
            continue
        if c == '[':
            in_class = True
        elif c == ']':
            in_class = False
        elif c == '/' and not in_class:
            i += 1
            while i < len(source) and source[i].isalpha():
                i += 1
            return i
        i += 1


def mask(source):
    """The source with comments, regular expressions and the text of strings and template literals blanked out.

    Offsets do not move and quotes stay, so the text of a literal is read from the source at the same place.
    """
    out = list(source)
    braces = []
    regex_ok = True
    i, n = 0, len(source)

    def blank(start, end):
        for k in range(start, end):
            if out[k] != '\n':
                out[k] = MASK

    def template(start):
        end = _template_end(source, start, braces)
        blank(start, end - 1 if source[end - 1] == '`' else end - 2)
        return end

    while i < n:
        c = source[i]
        if c in ' \t\r\n﻿':
            i += 1
        elif source.startswith('//', i):
            end = source.find('\n', i)
            end = n if end < 0 else end
            blank(i, end)
            i = end
        elif source.startswith('/*', i):
            end = source.index('*/', i + 2) + 2
            blank(i, end)
            i = end
        elif c in '\'"':
            end = _string_end(source, i)
            blank(i + 1, end - 1)
            i, regex_ok = end, False
        elif c == '`':
            i, regex_ok = template(i + 1), False
        elif c == '/' and regex_ok:
            end = _regex_end(source, i)
            blank(i, end)
            i, regex_ok = end, False
        elif c == '{':
            braces.append(False)
            i, regex_ok = i + 1, True
        elif c == '}':
            if braces and braces.pop():
                i, regex_ok = template(i + 1), False
            else:
                i, regex_ok = i + 1, True
        elif c in ')]':
            i, regex_ok = i + 1, False
        else:
            word = WORD.match(source, i)
            if word:
                i, regex_ok = word.end(), word.group() in REGEX_AFTER
            else:
                i, regex_ok = i + 1, True
    if braces:
        raise ValueError('unbalanced braces in the userscript')
    return ''.join(out)


class Code:
    """The finished userscript and its masked twin."""

    def __init__(self, source):
        self.source = source
        self.masked = mask(source)

    def strings(self, start, end):
        return [self.source[m.start() + 1:m.end() - 1] for m in LITERAL.finditer(self.masked, start, end)]

    def find(self, text, start=0):
        at = self.masked.find(text, start)
        if at < 0:
            raise ValueError('diagnostics vocabulary: missing ' + text)
        return at

    def block(self, head, end=';\n'):
        assert self.masked.count(head) == 1, 'diagnostics vocabulary: expected exactly one ' + head
        start = self.find(head) + len(head)
        return start, self.find(end, start)

    def constant(self, name):
        return self.strings(*self.block('const ' + name + ' = '))

    def balanced(self, at):
        opener = self.masked[at]
        closer = {'{': '}', '(': ')', '[': ']'}[opener]
        depth = 0
        for i in range(at, len(self.masked)):
            if self.masked[i] == opener:
                depth += 1
            elif self.masked[i] == closer:
                depth -= 1
                if depth == 0:
                    return i + 1
        raise ValueError('unbalanced ' + opener)

    def parts(self, start, end):
        """Top-level comma-separated parts of the text between start and end, as (start, end) pairs."""
        parts, depth, begin = [], 0, start
        for i in range(start, end):
            c = self.masked[i]
            if c in '{[(':
                depth += 1
            elif c in '}])':
                depth -= 1
            elif c == ',' and depth == 0:
                parts.append((begin, i))
                begin = i + 1
        if self.masked[begin:end].strip():
            parts.append((begin, end))
        return parts

    def property(self, obj_start, obj_end, key):
        for start, end in self.parts(obj_start + 1, obj_end - 1):
            text = self.masked[start:end]
            name = re.match(r'\s*(\w+)\s*(:)?', text)
            if name and name.group(1) == key:
                if name.group(2):
                    return start + name.end(), end
                if text.strip() == key:
                    return None
        return None

    def literals(self, start, end):
        """The strings an expression made only of string literals and conditionals can have, else None."""
        text = self.masked[start:end]
        if LITERAL.fullmatch(text.strip()):
            return self.strings(start, end)
        ternary = re.fullmatch(r'[^\'"?]+\?\s*([\'"]' + MASK + r'*[\'"])\s*:(.+)', text, re.S)
        if ternary:
            rest = self.literals(start + ternary.start(2), start + ternary.end(2))
            if rest is not None:
                return self.strings(start + ternary.start(1), start + ternary.end(1)) + rest
        return None


def _codes_of_parameter(code, at):
    head = None
    for match in re.finditer(r'\n\s*(\w+)\s*\(([^()\n]*)\)\s*\{', code.masked[:at]):
        if 'code' in re.split(r'[\s,=]+', match.group(2)):
            head = match
    if head is None:
        raise ValueError('activity code without a literal near offset %d' % at)
    function = head.group(1)
    parameters = code.parts(head.start(2), head.end(2))
    index = next(i for i, (s, e) in enumerate(parameters) if code.masked[s:e].split('=')[0].strip() == 'code')
    codes = set()
    s, e = parameters[index]
    if '=' in code.masked[s:e]:
        codes.update(code.literals(s + code.masked[s:e].index('=') + 1, e) or [])
    owner = list(re.finditer(r'\nconst (\w+) = \{', code.masked[:at]))[-1]
    body_end = code.balanced(owner.end() - 1)
    calls = list(re.finditer(r'(?<![\w$])this\.' + function + r'\(', code.masked[owner.end():body_end]))
    offsets = [owner.end() + m.end() - 1 for m in calls]
    offsets += [m.end() - 1 for m in re.finditer(r'(?<![\w$])' + owner.group(1) + r'\.' + function + r'\(', code.masked)]
    for paren in offsets:
        arguments = code.parts(paren + 1, code.balanced(paren) - 1)
        if len(arguments) > index:
            literal = code.literals(*arguments[index])
            if literal is None:
                raise ValueError('activity code of %s is not a literal: %s' % (function, code.source[slice(*arguments[index])]))
            codes.update(literal)
    return codes


def activity_codes(code):
    """The structured codes of every Activity.emit and Activity.transition that can reach the log or the trail."""
    codes = set()
    for call in re.finditer(r'(?<![\w$])emit\(\s*\{', code.masked):
        start = call.end() - 1
        end = code.balanced(start)
        value = code.property(start, end, 'code')
        shorthand = value is None and re.search(r'[{,]\s*code\s*[,}]', code.masked[start:end])
        if value is None and not shorthand:
            continue
        level = code.property(start, end, 'level')
        if level and code.literals(*level) == ['cmd']:
            continue
        if shorthand:
            codes.update(_codes_of_parameter(code, call.start()))
            continue
        text = code.masked[slice(*value)].strip()
        if re.fullmatch(r'[\'"]' + MASK + r'+[\'"]\s*\+\s*key', text) and code.strings(*value) == ['toggle-']:
            settings = code.find('Activity.settingValues = () => (')
            body = code.find('{', settings)
            names = re.findall(r'\n\s*(\w+):', code.masked[body:code.balanced(body)])
            codes.update('toggle-' + name for name in names)
            continue
        literal = code.literals(*value)
        if literal is None:
            raise ValueError('activity code is not a literal: ' + code.source[slice(*value)].strip())
        codes.update(literal)
    for call in re.finditer(r'Activity\.transition\(', code.masked):
        arguments = code.parts(call.end(), code.balanced(call.end() - 1) - 1)
        literal = code.literals(*arguments[1])
        if literal is None:
            raise ValueError('transition code is not a literal: ' + code.source[slice(*arguments[1])].strip())
        codes.update(literal)
    codes = {c for c in codes if ACTIVITY_CODE.match(c)}
    codes.discard('legacy-message')
    codes.add('legacy')
    return codes


def _slug(text):
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', text.lower()))[:64]


def modules(code):
    """The module slugs OSB reports: every guard name and every Diag.error module."""
    names = []
    for call in re.finditer(r'(?<![\w$])guard\(\s*([\'"]' + MASK + r'+[\'"])\s*,', code.masked):
        names += code.strings(call.start(1), call.end(1))
    for table in re.finditer(r'for \(const \[name[^\]]*\] of \[\[', code.masked):
        start = table.end() - 2
        end = code.balanced(start)
        if 'Controller.guard(name,' not in code.masked[end:code.find('\n}', end)]:
            continue
        for row in re.finditer(r'\[\s*([\'"]' + MASK + r'+[\'"])', code.masked[start + 1:end]):
            names += code.strings(start + 1 + row.start(1), start + 1 + row.end(1))
    for call in re.finditer(r'Diag\.error\(\s*([\'"]' + MASK + r'+[\'"])', code.masked):
        names += code.strings(call.start(1), call.end(1))
    return {slug for slug in map(_slug, names) if CODE.match(slug)}


def stop_codes(code):
    start, end = code.block('const STOP_CODES = [', '];\n')
    codes = {s for s in code.strings(start, end) if ACTIVITY_CODE.match(s)}
    start, end = code.block('const StopCodes = {', '};\n')
    for match in re.finditer(r'return ([\'"]' + MASK + r'+[\'"])', code.masked[start:end]):
        codes.update(code.strings(start + match.start(1), start + match.end(1)))
    return codes


def error_codes(code):
    start, end = code.block('  errorCode(message) {', '\n  },\n')
    return {s for s in code.strings(start, end) if ACTIVITY_CODE.match(s)}


def error_types(code):
    types = set(code.constant('DIAG_ENGINE_ERRORS')) | set(BROWSER_ERROR_TYPES) | {'Error'}
    types.update(re.findall(r'class (\w+) extends \w*Error\b', code.masked))
    return types


def identifiers(code):
    """Every identifier of the code: functions, methods, classes, object keys, variables and properties."""
    return {m.group() for m in IDENTIFIER.finditer(code.masked)}


def build(source, version):
    """The vocabulary of a finished userscript whose template word list is not yet embedded."""
    code = Code(source)
    start, end = code.block('const DIAG_MODES = ')
    modes = {code.source[start + m.start(1) + 1:start + m.end(1) - 1]
             for m in re.finditer(r':\s*([\'"]' + MASK + r'+[\'"])', code.masked[start:end])}
    return {
        'version': version,
        'modules': sorted(modules(code)),
        'stop_codes': sorted(stop_codes(code) | {'other'}),
        'activity_categories': sorted(set(code.constant('ACTIVITY_CATEGORIES'))),
        'activity_codes': sorted(activity_codes(code)),
        'error_codes': sorted(error_codes(code)),
        'error_types': sorted(error_types(code)),
        'phases': sorted(set(code.constant('DIAG_PHASES')) | {'other'}),
        'modes': sorted(modes | {'other'}),
        'town_phases': sorted(set(code.constant('TOWN_PHASES'))),
        'outcomes': sorted(set(code.constant('DIAG_OUTCOMES'))),
        'refusal_sources': sorted(set(code.constant('DIAG_REFUSAL_SOURCES'))),
        'refusal_reasons': sorted(set(code.constant('DIAG_REFUSAL_REASONS'))),
        'engine_words': sorted(set(code.constant('DIAG_ENGINE_WORDS'))),
        'identifiers': sorted(identifiers(code)),
    }


def text(vocabulary):
    return json.dumps(vocabulary, indent=1, ensure_ascii=True) + '\n'


def embed(source, vocabulary):
    """Inserts the identifiers in front of DIAG_KNOWN_WORDS; the engine words are already in the code."""
    assert source.count(WORDS_ANCHOR) == 1, 'diagnostics vocabulary: expected one ' + WORDS_ANCHOR
    words = json.dumps(vocabulary['identifiers'], separators=(',', ':'))
    return source.replace(WORDS_ANCHOR, 'const DIAG_WORD_LIST = ' + words + ';\n' + WORDS_ANCHOR)


def version_of(source):
    return re.search(r"const VERSION = '([\d.]+)';", source).group(1)


def check(base):
    built = (base / 'osb.user.js').read_text(encoding='utf-8')
    source = WORDS_LINE.sub('', built, count=1)
    expected = build(source, version_of(source))
    stored = (base / FILE_NAME).read_text(encoding='utf-8')
    if stored != text(expected) or embed(source, expected) != built:
        print(REGENERATE)
        return 1
    print('diagnostics-vocabulary.json matches osb.user.js (%d identifiers)' % len(expected['identifiers']))
    return 0


if __name__ == '__main__':
    if sys.argv[1:] != ['--check']:
        print(__doc__)
        sys.exit(2)
    sys.exit(check(Path(__file__).resolve().parent))
