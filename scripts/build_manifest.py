#!/usr/bin/env python3
import json, subprocess, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHORTS_DIR = ROOT / 'shorts'
MANIFEST = SHORTS_DIR / 'manifest.json'

# Obsidian wikilink cleaners
WIKILINK_EMBED  = re.compile(r'!\[\[[^\]]*\]\]')                           # ![[file]] -> remove
WIKILINK_ALIAS  = re.compile(r'\[\[[^\]|#]+(?:#[^\]|]+)?\|([^\]]+)\]\]')   # [[Page#Sec|Alias]] -> Alias
WIKILINK_SIMPLE = re.compile(r'\[\[([^\]|#]+)(?:#[^\]]+)?\]\]')            # [[Page#Sec]] -> Page

def clean_obsidian(text: str) -> str:
    text = WIKILINK_EMBED.sub('', text)
    text = WIKILINK_ALIAS.sub(r'\1', text)
    text = WIKILINK_SIMPLE.sub(r'\1', text)
    return text

md_files = sorted(SHORTS_DIR.glob('*.md'))
items = []
for p in md_files:
    # Last commit time (ISO 8601)
    try:
        modified = subprocess.check_output(
            ['git','log','-1','--format=%cI','--',str(p)],
            cwd=ROOT
        ).decode().strip()
    except subprocess.CalledProcessError:
        modified = None

    # Title = first non-empty line (clean Obsidian, strip markdown #)
    title = p.stem
    with p.open('r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            s = line.strip()
            if s:
                s = clean_obsidian(s)
                s = re.sub(r'^#+\s*', '', s)
                title = s or p.stem
                break

    items.append({
        'path': f'shorts/{p.name}',
        'slug': p.stem,
        'title': title,
        'modified': modified
    })

# Newest first
items.sort(key=lambda x: (x['modified'] or ''), reverse=True)

MANIFEST.parent.mkdir(parents=True, exist_ok=True)
with MANIFEST.open('w', encoding='utf-8') as f:
    json.dump({'generated': True, 'items': items}, f, ensure_ascii=False, indent=2)

print(f"Wrote {MANIFEST} with {len(items)} items")
