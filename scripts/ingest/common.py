#!/usr/bin/env python3
"""Shared helpers for country-specific entity ingestion scripts."""
import os
import json
from datetime import datetime, timezone

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
ENTITIES_DIR = os.path.join(DATA_DIR, 'entities')
MANIFEST_PATH = os.path.join(DATA_DIR, 'manifest.json')


def today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def write_entities(country, records):
    """Writes one JSON object per line (wrapped in a single array) so that
    day-to-day diffs stay readable and small in git history."""
    os.makedirs(ENTITIES_DIR, exist_ok=True)
    records = sorted(records, key=lambda r: r['id'])
    out_path = os.path.join(ENTITIES_DIR, f'{country}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('[\n')
        lines = [json.dumps(r, ensure_ascii=False, sort_keys=True) for r in records]
        f.write(',\n'.join(lines))
        f.write('\n]\n')
    return out_path


def update_manifest(list_entry):
    """Upserts one entry (keyed by list_entry['list_id']) into data/manifest.json."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    else:
        manifest = {
            'schema_version': '1.0',
            'description': (
                'Machine-readable index of consolidated export-control / sanction '
                'entity lists published by this registry. Each entry points to a '
                'JSON file under data/entities/. Data is a best-effort mirror of '
                'public government sources — always verify against the primary '
                'source (source_url on each record) before making compliance '
                'decisions.'
            ),
            'lists': []
        }

    lists = [entry for entry in manifest['lists'] if entry['list_id'] != list_entry['list_id']]
    lists.append(list_entry)
    lists.sort(key=lambda e: e['list_id'])
    manifest['lists'] = lists
    manifest['generated_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')
