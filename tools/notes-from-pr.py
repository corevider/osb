"""Write notes/<version>.md for a merged pull request.

Usage: notes-from-pr.py [--use <agent notes file>] <pr.json> <notes file> <pr number>

pr.json holds {"title", "body", "login"}. The agent notes file, when given and valid, is copied. Otherwise the notes are
built from the pull request. All of this text is untrusted: markup, links and control characters are removed from
text built from the pull request, every line is cut to a fixed length, and an agent file that is not plain notes in the
format build-lean.py expects is ignored.
"""
import json
import os
import re
import sys

MAX_NOTES_BYTES = 4096
MAX_TITLE = 80
MAX_LINE = 400


def clean(text, limit):
    text = re.sub(r'<[^>]*>|https?://\S+', '', text or '')
    text = re.sub(r'[`*_#<>\[\]()]', '', text)
    text = re.sub(r'[\x00-\x1f\x7f  ]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def build_notes(data, number):
    title = clean(data.get('title'), 60).rstrip('.') or 'Changes'
    bullets = [clean(re.sub(r'^\s*[-*+]\s+', '', line), 200)
               for line in (data.get('body') or '').splitlines()
               if re.match(r'^\s*[-*+]\s+\S', line)]
    items = [item for item in bullets if item][:5] or [clean(data.get('title'), 200) or 'Changes']
    note = ('Contributed by ' + (clean(data.get('login'), 40) or 'unknown') + ' (#' + str(number) + '). '
            'Notes written from the pull request, without a review of how it was tested.')
    return '# ' + title + '\n\n' + ''.join('- ' + item + '\n' for item in items) + '> ' + note + '\n'


def is_valid_notes(text):
    if len(text.encode('utf-8')) > MAX_NOTES_BYTES or re.search(r'[\x00-\x09\x0b-\x1f\x7f  ]', text):
        return False
    if re.search(r'<|https?://', text):
        return False
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    if not lines or not lines[0].startswith('# ') or len(lines[0]) > MAX_TITLE + 2:
        return False
    body = lines[1:]
    items = [line for line in body if line.startswith('- ')]
    notes = [line for line in body if line.startswith('> ')]
    return bool(items) and len(items) + len(notes) == len(body) and all(len(line) <= MAX_LINE for line in body)


def read_agent_notes(path):
    try:
        with open(path, encoding='utf-8') as source:
            text = source.read(MAX_NOTES_BYTES + 1)
    except (OSError, UnicodeDecodeError):
        return None
    return text if is_valid_notes(text) else None


def main(argv):
    agent_path = None
    if argv[:1] == ['--use']:
        agent_path, argv = argv[1], argv[2:]
    pr_path, notes_path, number = argv[:3]
    notes = read_agent_notes(agent_path) if agent_path and os.path.exists(agent_path) else None
    if notes is None:
        with open(pr_path, encoding='utf-8') as source:
            notes = build_notes(json.load(source), number)
    with open(notes_path, 'w', encoding='utf-8', newline='\n') as target:
        target.write(notes)


if __name__ == '__main__':
    main(sys.argv[1:])
