#!/usr/bin/env python3
"""Ingests the US Consolidated Screening List (CSL) bulk JSON feed and
normalizes it into data/entities/us.json.

Source: https://www.trade.gov/consolidated-screening-list
Bulk download docs: https://developer.trade.gov/api-details#api=consolidated-screening-list
No API key is required for the bulk download endpoint used here. The feed
refreshes daily at ~05:00 US Eastern time.
"""
import os
import re
import sys
import json
import requests
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import write_entities, update_manifest, today_utc

CSL_URL = "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json"
LIST_ID = "us-consolidated-screening-list"

TYPE_MAP = {
    "Individual": "individual",
    "Vessel": "vessel",
    "Aircraft": "aircraft",
    "Entity": "organization",
}


def normalize_date(value):
    """The CSL feed is ~99.99% ISO 'YYYY-MM-DD' but has a few stray
    'M/D/YYYY' entries; normalize or drop rather than fail validation."""
    value = (value or "").strip()
    if not value:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    for fmt in ("%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def format_address(addr):
    parts = [
        addr.get("address") or "",
        addr.get("city") or "",
        addr.get("state") or "",
        addr.get("postal_code") or "",
        addr.get("country") or "",
    ]
    return ", ".join(p for p in parts if p).strip()


def normalize(record, checked_on):
    raw_id = str(record.get("id") or record.get("entity_number") or "")
    if not raw_id:
        return None

    programs = record.get("programs") or []
    remarks = (record.get("remarks") or "").strip()
    reason = remarks if remarks else "; ".join(programs)

    entity = {
        "id": f"us-csl-{raw_id.lower()}",
        "country": "us",
        "list_id": LIST_ID,
        "source_list_name": record.get("source") or "",
        "entity_name": record.get("name") or "",
        "entity_type": TYPE_MAP.get(record.get("type"), "other"),
        "aliases": record.get("alt_names") or [],
        "addresses": [format_address(a) for a in (record.get("addresses") or []) if format_address(a)],
        "reason": reason,
        "date_added": normalize_date(record.get("start_date")),
        "source_url": record.get("source_information_url") or record.get("source_list_url") or "https://www.trade.gov/consolidated-screening-list",
        "last_verified": checked_on,
    }
    return entity


def main():
    print(f"Fetching US Consolidated Screening List from {CSL_URL} ...")
    resp = requests.get(CSL_URL, timeout=120)
    resp.raise_for_status()
    payload = resp.json()
    raw_records = payload.get("results", [])
    print(f"Fetched {len(raw_records)} raw records.")

    checked_on = today_utc()
    entities = []
    seen_ids = set()
    skipped_no_name = 0
    skipped_duplicate = 0
    for r in raw_records:
        entity = normalize(r, checked_on)
        if entity is None or not entity["entity_name"]:
            skipped_no_name += 1
            continue
        if entity["id"] in seen_ids:
            skipped_duplicate += 1
            continue
        seen_ids.add(entity["id"])
        entities.append(entity)

    dropped = skipped_no_name + skipped_duplicate
    drop_ratio = dropped / len(raw_records) if raw_records else 0
    print(f"Skipped {skipped_no_name} record(s) with no name, {skipped_duplicate} duplicate id(s).")
    if drop_ratio > 0.01:
        print(
            f"ERROR: {drop_ratio:.1%} of records were dropped (expected <1%). "
            "This likely indicates an upstream schema change; aborting without "
            "overwriting existing data.",
            file=sys.stderr,
        )
        sys.exit(1)

    out_path = write_entities("us", entities)
    print(f"Wrote {len(entities)} normalized entities to {out_path}")

    update_manifest({
        "list_id": LIST_ID,
        "country": "us",
        "name_en": "Consolidated Screening List (CSL)",
        "file": "data/entities/us.json",
        "record_count": len(entities),
        "source_url": "https://www.trade.gov/consolidated-screening-list",
        "update_frequency": "daily",
        "last_updated": checked_on,
    })
    print("Updated data/manifest.json")


if __name__ == "__main__":
    main()
