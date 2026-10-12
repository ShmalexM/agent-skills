"""Fail a tour build when the page names something only its author can see.

A tour is meant to be shared with people who have the repository and nothing
else. Local paths, loopback ports, private output folders and agent names are
holes for that reader.

Personal patterns (your own launchers or instance names, default ports your
repos document) go in ~/.config/agent-skills/share_lint.json, outside the repo:

    {"patterns": [["\\bmy-launcher\\b", "personal launcher"]],
     "allow_ports": [8080]}

Each tour can extend the list with its own data.LINT_EXTRA patterns and
allow-list exact strings with data.LINT_ALLOW.
"""
import json
import os
import re
import sys

BASE_PATTERNS = [
    (r'(?<![\w.])~/', 'home-relative path'),
    (r'/Users/|/home/\w', 'absolute local path'),
    (r'Documents/Codex|\bscratchpad\b|\.local/state|\boutputs/', 'private output folder'),
    (r'\bCodex\b|\bClaude\b(?! Code)', 'agent or tooling name'),
    (r'\bworktree\b', 'local checkout detail'),
]


def config_path():
    root = os.environ.get('AGENT_SKILLS_CONFIG_DIR') or os.path.join(
        os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config'), 'agent-skills')
    return os.path.join(root, 'share_lint.json')


def load_config(path=None):
    path = path or config_path()
    try:
        with open(path) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        return {'patterns': [], 'allow_ports': []}
    return {'patterns': [tuple(p) for p in cfg.get('patterns', [])],
            'allow_ports': [int(p) for p in cfg.get('allow_ports', [])]}


def patterns(cfg=None):
    cfg = cfg if cfg is not None else load_config()
    ports = '|'.join(str(p) for p in cfg['allow_ports'])
    local = r'\b127\.0\.0\.1\b|\blocalhost:' + (rf'(?!(?:{ports})\b)' if ports else '') + r'\d+'
    why = 'local address' + (f' (allowed ports: {", ".join(map(str, cfg["allow_ports"]))})' if ports else '')
    return BASE_PATTERNS + [(local, why)] + cfg['patterns']


def lint(text, extra=(), allow=(), cfg=None):
    for a in allow:
        text = text.replace(a, '')
    hits = []
    for pat, why in patterns(cfg) + list(extra):
        for m in re.finditer(pat, text):
            s = max(0, m.start() - 40)
            hits.append(f'{why}: …{text[s:m.end() + 40]!s}…'.replace('\n', ' '))
    return hits


# Kept for tour scripts that import the list directly.
PATTERNS = patterns()

if __name__ == '__main__':
    hits = lint(open(sys.argv[1]).read())
    print('\n'.join(hits) or 'shareable: no local references')
    sys.exit(1 if hits else 0)
