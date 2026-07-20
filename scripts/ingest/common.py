#!/usr/bin/env python3
"""Shared helpers for country-specific entity ingestion scripts."""
import os
import json
from datetime import datetime, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA_DIR = os.path.join(REPO_ROOT, 'data')
ENTITIES_DIR = os.path.join(DATA_DIR, 'entities')
MANIFEST_PATH = os.path.join(DATA_DIR, 'manifest.json')
COUNT_HISTORY_PATH = os.path.join(DATA_DIR, 'entity_count_history.json')
SUMMARY_FILE = os.path.join(REPO_ROOT, 'scripts', 'crawler', 'update_summary.txt')

# Set on every ingest run regardless of whether the underlying record
# actually changed, so it must be excluded from diffing or every entity
# would show up as "updated" on every run.
DIFF_IGNORED_FIELDS = {'last_verified'}


def today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def read_entities(country):
    """Loads the currently-committed data/entities/<country>.json, or []
    if this is the first time the list is being ingested."""
    path = os.path.join(ENTITIES_DIR, f'{country}.json')
    if not os.path.exists(path):
        return []
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def diff_entities(old_entities, new_entities):
    """Compares two entity lists by id and returns which entities were
    added, removed, or had a field change (other than last_verified)."""
    old_by_id = {e['id']: e for e in old_entities}
    new_by_id = {e['id']: e for e in new_entities}

    added_ids = new_by_id.keys() - old_by_id.keys()
    removed_ids = old_by_id.keys() - new_by_id.keys()
    common_ids = old_by_id.keys() & new_by_id.keys()

    updated = []
    for eid in common_ids:
        old_e, new_e = old_by_id[eid], new_by_id[eid]
        changes = [
            (key, old_e.get(key), new_e.get(key))
            for key in sorted(set(old_e) | set(new_e))
            if key not in DIFF_IGNORED_FIELDS and old_e.get(key) != new_e.get(key)
        ]
        if changes:
            updated.append({'id': eid, 'entity': new_e, 'changes': changes})

    return {
        'added': sorted((new_by_id[i] for i in added_ids), key=lambda e: e['id']),
        'removed': sorted((old_by_id[i] for i in removed_ids), key=lambda e: e['id']),
        'updated': sorted(updated, key=lambda u: u['id']),
        'is_first_run': not old_entities,
    }


def _format_diff_value(value):
    if isinstance(value, list):
        value = "; ".join(str(v) for v in value)
    value = "" if value is None else str(value)
    value = value.replace("\n", " ").strip()
    if len(value) > 80:
        value = value[:80] + "..."
    return value or "(空)"


def format_diff_summary(list_name, list_id, diff, max_items=30):
    """Builds a Japanese Markdown summary of added/removed/updated entities
    for use as a GitHub issue body. Returns None when there's nothing worth
    reporting (no real changes, or this is the list's first-ever ingest,
    where every record would trivially show up as "added")."""
    if diff['is_first_run'] or not (diff['added'] or diff['removed'] or diff['updated']):
        return None

    lines = [f"## {list_name} ({list_id})", ""]

    def render_section(title, items, render_item):
        if not items:
            return
        lines.append(f"### {title} ({len(items)}件)")
        for item in items[:max_items]:
            lines.append(render_item(item))
        if len(items) > max_items:
            lines.append(f"- ...ほか{len(items) - max_items}件")
        lines.append("")

    render_section("追加", diff['added'], lambda e: f"- {e['entity_name']} (id: {e['id']})")
    render_section("削除", diff['removed'], lambda e: f"- {e['entity_name']} (id: {e['id']})")

    def render_updated(u):
        changes_text = "; ".join(
            f'{field}: "{_format_diff_value(old)}" → "{_format_diff_value(new)}"'
            for field, old, new in u['changes']
        )
        return f"- {u['entity']['entity_name']} (id: {u['id']}): {changes_text}"

    render_section("更新", diff['updated'], render_updated)

    return "\n".join(lines).rstrip() + "\n"


def write_diff_summary(text):
    """Writes (overwriting) the shared update-summary file consumed by the
    'Create Issue if Update Detected' workflow step."""
    os.makedirs(os.path.dirname(SUMMARY_FILE), exist_ok=True)
    with open(SUMMARY_FILE, 'w', encoding='utf-8') as f:
        f.write(text)


def record_count_history(list_id, date, record_count):
    """Upserts (date, record_count) into list_id's series in
    data/entity_count_history.json, powering the UI's collection-size trend
    chart. Reruns on the same day overwrite that day's point rather than
    appending a duplicate."""
    if os.path.exists(COUNT_HISTORY_PATH):
        with open(COUNT_HISTORY_PATH, 'r', encoding='utf-8') as f:
            history = json.load(f)
    else:
        history = {}

    series = [pt for pt in history.get(list_id, []) if pt['date'] != date]
    series.append({'date': date, 'record_count': record_count})
    series.sort(key=lambda pt: pt['date'])
    history[list_id] = series

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(COUNT_HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
        f.write('\n')


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
