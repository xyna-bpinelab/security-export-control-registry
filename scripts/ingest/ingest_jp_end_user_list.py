#!/usr/bin/env python3
"""Ingests Japan's 外国ユーザーリスト (Foreign End-User List) and normalizes
it into data/entities/jp.json.

Unlike the US CSL, METI does not publish this as structured data — only as
a PDF attached to a press release, and the PDF's URL changes every time the
list is revised (typically a few times a year). This script therefore:

  1. Fetches the press release page (PRESS_RELEASE_URL below) and finds its
     PDF attachment link.
  2. Extracts the table with PyMuPDF using manual column reconstruction
     (NOT page.find_tables()) because the list's rows can span a page
     break, and find_tables() silently drops the row that straddles the
     boundary (confirmed: it recovers 805/835 records here, i.e. exactly
     one dropped per page break). Reconstructing rows from raw text spans
     by x-column and a running "No." counter recovers all 835.

IMPORTANT: PRESS_RELEASE_URL must be updated by hand whenever METI issues a
new revision (see countries/jp/datasources.yaml's jp-end-user-list entry,
which carries the same caveat). There is no stable "latest" URL to poll.
"""
import os
import re
import sys
import json
import requests
import fitz  # PyMuPDF
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(__file__))
from common import write_entities, update_manifest, today_utc, read_entities, diff_entities, format_diff_summary, write_diff_summary, record_count_history

PRESS_RELEASE_URL = "https://www.meti.go.jp/press/2025/09/20250929006/20250929006.html"
LIST_ID = "jp-end-user-list"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Column right-edges (points), derived from the PDF's own table header cells:
# No. | Country (JP/EN) | Company/Org | Aliases | WMD concern | Conventional weapons
COL_BOUNDS = [48.96, 124.58, 276.29, 434.26, 517.32, 10_000]
HEADER_TEXTS = {
    "No.", "国名、地域名", "Country or Region", "企業名､組織名",
    "Company or Organization", "別名", "Also Known As", "懸念区分",
    "Type of WMD", "通常兵器", "Conventional", "Weapons",
}
# The page footer (page number) sits at y≈809.6pt; real table content never
# goes past ~790pt. Anything below this is footer noise, not a table cell.
FOOTER_Y_CUTOFF = 800
MIN_EXPECTED_RECORDS = 500  # sanity floor; the list has run ~700-900+ records historically


def find_pdf_url(press_release_url):
    resp = requests.get(press_release_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    link = soup.find("a", href=re.compile(r"\.pdf$"))
    if not link:
        raise RuntimeError(f"No PDF link found on {press_release_url}")
    href = link["href"]
    if href.startswith("http"):
        return href
    return "https://www.meti.go.jp" + href


def col_index(x0):
    for i, edge in enumerate(COL_BOUNDS):
        if x0 < edge:
            return i
    return len(COL_BOUNDS) - 1


def extract_rows(pdf_bytes):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    rows = []
    current = None  # list of 6 lists-of-strings, one per column

    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                text = "".join(s["text"] for s in spans).strip()
                if not text or text in HEADER_TEXTS:
                    continue
                y0 = min(s["bbox"][1] for s in spans)
                if y0 > FOOTER_Y_CUTOFF:
                    continue  # page-number footer
                x0 = min(s["bbox"][0] for s in spans)
                col = col_index(x0)
                if col == 0 and text.isdigit():
                    if current is not None:
                        rows.append(["\n".join(c) for c in current])
                    current = [[text], [], [], [], [], []]
                elif current is not None:
                    current[col].append(text)
    if current is not None:
        rows.append(["\n".join(c) for c in current])
    return rows


def normalize(row, checked_on):
    no, country_text, company_text, aliases_text, wmd_text, conv_text = row

    country_lines = [l for l in country_text.split("\n") if l.strip()]
    country_en = " ".join(country_lines[1:]).strip() if len(country_lines) > 1 else country_lines[0]

    aliases = [a.replace("\n", " ").strip() for a in aliases_text.split("・") if a.strip()]

    reason_parts = []
    if wmd_text.strip():
        reason_parts.append("大量破壊兵器等の懸念: " + wmd_text.replace("\n", " ").strip())
    if conv_text.strip():
        reason_parts.append("通常兵器の懸念: " + conv_text.replace("\n", " ").strip())

    return {
        "id": f"jp-eul-{no}",
        "country": "jp",
        "list_id": LIST_ID,
        "source_list_name": "外国ユーザーリスト (Foreign End-User List)",
        "entity_name": company_text.replace("\n", " ").strip(),
        "entity_type": "organization",
        "aliases": aliases,
        # The list only gives country/region-level location, not a street address.
        "addresses": [country_en] if country_en else [],
        "reason": "; ".join(reason_parts),
        "date_added": None,
        "source_url": PRESS_RELEASE_URL,
        "last_verified": checked_on,
    }


def main():
    print(f"Finding PDF attachment on {PRESS_RELEASE_URL} ...")
    pdf_url = find_pdf_url(PRESS_RELEASE_URL)
    print(f"Downloading {pdf_url} ...")
    resp = requests.get(pdf_url, headers=HEADERS, timeout=60)
    resp.raise_for_status()

    rows = extract_rows(resp.content)
    print(f"Extracted {len(rows)} rows.")

    nos = [int(r[0]) for r in rows]
    missing = sorted(set(range(1, max(nos) + 1)) - set(nos)) if nos else []
    if missing:
        print(f"ERROR: {len(missing)} row number(s) missing from the sequence: {missing[:20]}...", file=sys.stderr)
        sys.exit(1)
    if len(rows) < MIN_EXPECTED_RECORDS:
        print(
            f"ERROR: only {len(rows)} records extracted (expected >= {MIN_EXPECTED_RECORDS}). "
            "This likely indicates the PDF layout changed; aborting without overwriting existing data.",
            file=sys.stderr,
        )
        sys.exit(1)

    checked_on = today_utc()
    entities = [normalize(r, checked_on) for r in rows]

    old_entities = read_entities("jp")
    diff = diff_entities(old_entities, entities)
    summary = format_diff_summary("外国ユーザーリスト (Foreign End-User List)", LIST_ID, diff)
    if summary:
        write_diff_summary(summary)
        print("Wrote diff summary for update-alert issue.")

    out_path = write_entities("jp", entities)
    print(f"Wrote {len(entities)} normalized entities to {out_path}")

    update_manifest({
        "list_id": LIST_ID,
        "country": "jp",
        "name_en": "Foreign End-User List",
        "file": "data/entities/jp.json",
        "record_count": len(entities),
        "source_url": PRESS_RELEASE_URL,
        "update_frequency": "irregular",
        "last_updated": checked_on,
    })
    print("Updated data/manifest.json")

    record_count_history(LIST_ID, checked_on, len(entities))
    print("Updated data/entity_count_history.json")


if __name__ == "__main__":
    main()
