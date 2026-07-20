#!/usr/bin/env python3
"""Ingests China's three entity-level lists (issued as individual MOFCOM
announcements, not a structured feed) into data/entities/cn.json:

  - 不可靠实体清单 (Unreliable Entity List)      -> list_id cn-unreliable-entity-list
  - 出口管制管控名单 (Export Control Watchlist)  -> list_id cn-export-control-watchlist
  - 关注名单 (Attention List)                    -> list_id cn-attention-list

There is no consolidated API, PDF, or index page maintained by MOFCOM for
these lists (unlike the US CSL or JP's periodic PDF). Announcements are
discovered via the "产业安全与进出口管制局" (aqygzj.mofcom.gov.cn) regulatory
document column, which is itself an internal JSON API this script calls
directly (found by inspecting the site's own AJAX pagination requests).

Each announcement is parsed one of two ways:
  1. A numbered "附件" (attachment) list, e.g. "1. Name（Original Name）"
     — used by roughly half of announcements, sometimes with addresses.
  2. Inline prose: "...决定将A（A_en）、B（B_en）列入<list name>..."
     — used by the other half. Extracted via regex anchored on "决定将".

Announcements that are follow-up advisories referencing an OLD listing
(e.g. a risk warning about a circumvention channel) rather than a new
listing decision do not match either pattern and correctly yield zero
entities — this has been verified against real examples (see the 2024-05-20
通用原子航空系统公司 announcement, which contains both a real new listing in
one paragraph and a backward-referencing advisory in another; only the
former matches "决定将...列入" and is extracted).

Where a title states "等N家..." entities, the extracted count is compared
against N and any mismatch is printed as a warning (not a hard failure) so
a human can review it — the source material itself is not always
internally consistent (see ingest_cn_lists.py's module docstring history /
PR description for the concrete case that motivated this).
"""
import os
import re
import sys
import json
import time
import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(__file__))
from common import write_entities, update_manifest, today_utc, read_entities, diff_entities, format_diff_summary, write_diff_summary

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

INDEX_API = "https://aqygzj.mofcom.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit"
INDEX_PARAMS_BASE = {
    "parseType": "bulidstatic",
    "webId": "b28941ad4e064442856787562c9a4961",
    "tplSetId": "DDBav9QvwJVbs9iznQVmO",
    "pageType": "column",
    "tagId": "信息列表",
    "editType": "null",
    "pageId": "79d6d2c4e44d458180d37dd4f0996645",  # 规章及规范性文件 column
}
BASE_SITE = "https://aqygzj.mofcom.gov.cn"

LIST_TYPES = {
    "不可靠实体清单": "cn-unreliable-entity-list",
    "出口管制管控名单": "cn-export-control-watchlist",
    "关注名单": "cn-attention-list",
}
LIST_ID_SHORT = {
    "cn-unreliable-entity-list": "uel",
    "cn-export-control-watchlist": "wl",
    "cn-attention-list": "att",
}
REASON_TEXT = {
    "cn-unreliable-entity-list": "不可靠実体清単に認定（対中正常取引の不当な中断等）",
    "cn-export-control-watchlist": "出口管制管控名単に掲載（両用品の輸出原則禁止）",
    "cn-attention-list": "関注名単に掲載（両用品の最終需要者・用途確認が困難）",
}

FOOTER_MARKER = "关于我们"


def fetch_announcement_index():
    """Returns a list of (date, url, title) across all pages of the
    regulatory-document column, newest first."""
    items = []
    page_no = 1
    while True:
        params = dict(INDEX_PARAMS_BASE)
        params["paramJson"] = json.dumps({"pageNo": page_no, "pageSize": 15})
        resp = requests.get(INDEX_API, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        html = data["data"]["html"]
        soup = BeautifulSoup(html, "html.parser")
        lis = soup.select("ul.txtList_01 li")
        if not lis:
            break
        for li in lis:
            a = li.find("a")
            span = li.find("span")
            if not a:
                continue
            href = a.get("href")
            title = a.get("title") or a.get_text(strip=True)
            date = span.get_text(strip=True).strip("[]") if span else None
            items.append((date, BASE_SITE + href, title))
        if len(lis) < 15:
            break
        page_no += 1
        time.sleep(0.3)
    return items


def classify(title):
    for keyword, list_id in LIST_TYPES.items():
        if keyword in title:
            return list_id
    return None


def fetch_text(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    # This server doesn't declare charset in Content-Type, so requests'
    # auto-detection guesses wrong; the site is UTF-8 (verified via curl).
    soup = BeautifulSoup(resp.content, "html.parser", from_encoding="utf-8")
    text = soup.get_text("\n", strip=True)
    footer_idx = text.rfind(FOOTER_MARKER)
    if footer_idx > 0:
        text = text[:footer_idx]
    return text


def split_name_and_original(chunk):
    """'描述性前缀洛克希德·马丁导弹与火控公司（Lockheed Martin Missiles and Fire Control）'
    -> ('描述性前缀洛克希德·马丁导弹与火控公司', 'Lockheed Martin Missiles and Fire Control').
    Tolerant of mixed full/half-width parentheses (seen in real announcements)."""
    m = re.match(r"^(.*?)[（(]([^（）()]+)[）)]\s*$", chunk.strip())
    if not m:
        return chunk.strip(), None
    return m.group(1).strip(), m.group(2).strip()


def parse_attachment_list(text):
    """Parses a numbered '附件' list. Returns list of (name_line, address_or_None)."""
    idx = text.rfind("附件")
    if idx == -1:
        return None
    section = text[idx:]
    chunks = re.split(r"\n(?=\d+\.\s*)", section)
    entries = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not re.match(r"^\d+\.\s*", chunk):
            continue
        lines = [l for l in chunk.split("\n") if l.strip()]
        name_line = re.sub(r"^\d+\.\s*", "", lines[0]).strip()
        address = None
        for line in lines[1:]:
            if line.startswith("地址："):
                address = line[len("地址："):].strip()
            elif line.startswith("邮编：") and address:
                address = f"{address}（{line.strip()}）"
            else:
                break
        entries.append((name_line, address))
    return entries if entries else None


def parse_inline_list(text):
    """Parses '...决定将A（A_en）、B（B_en）列入<list>...' phrasing.
    Returns (list_id, [(name_line, None), ...]) or None if no match."""
    m = re.search(r"决定将(.+?)列入(不可靠实体清单|出口管制管控名单|关注名单)", text, re.DOTALL)
    if not m:
        return None
    segment, list_keyword = m.groups()
    list_id = LIST_TYPES[list_keyword]
    # The last two entities in an enumeration are sometimes joined by "和"
    # ("and") instead of "、" (e.g. "...公司（B）和哈德森技术公司（C）等6家...").
    # Only normalize "）和" (paren-close immediately followed by 和) so this
    # never touches a "和" that's part of an entity's own Chinese name.
    segment = segment.replace("）和", "）、")
    chunks = [c for c in segment.split("、") if c.strip()]
    entries = [(c.strip(), None) for c in chunks]
    return list_id, entries


CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def cn_number_to_int(s):
    if s in CN_DIGITS:
        return CN_DIGITS[s]
    if len(s) == 2 and s[0] == "十":
        return 10 + CN_DIGITS.get(s[1], 0)
    if len(s) == 2 and s[1] == "十":
        return CN_DIGITS.get(s[0], 0) * 10
    if len(s) == 3 and s[1] == "十":
        return CN_DIGITS.get(s[0], 0) * 10 + CN_DIGITS.get(s[2], 0)
    return None


def count_hint(title):
    m = re.search(r"等(\d+)家", title)
    if m:
        return int(m.group(1))
    m = re.search(r"等([一二三四五六七八九十]{1,3})家", title)
    if m:
        return cn_number_to_int(m.group(1))
    return None


def normalize(list_id, name_line, address, date, url, checked_on, seq):
    local_name, original_name = split_name_and_original(name_line)
    entity_name = original_name or local_name
    aliases = [local_name] if original_name and local_name != original_name else []
    short = LIST_ID_SHORT[list_id]
    date_key = (date or "unknown").replace("-", "")
    return {
        "id": f"cn-{short}-{date_key}-{seq}",
        "country": "cn",
        "list_id": list_id,
        "source_list_name": {
            "cn-unreliable-entity-list": "不可靠实体清单 (Unreliable Entity List)",
            "cn-export-control-watchlist": "出口管制管控名单 (Export Control Watchlist)",
            "cn-attention-list": "关注名单 (Attention List)",
        }[list_id],
        "entity_name": entity_name,
        "entity_type": "organization",
        "aliases": aliases,
        "addresses": [address] if address else [],
        "reason": REASON_TEXT[list_id],
        "date_added": date,
        "source_url": url,
        "last_verified": checked_on,
    }


def main():
    checked_on = today_utc()
    print("Fetching announcement index from aqygzj.mofcom.gov.cn ...")
    items = fetch_announcement_index()
    print(f"Found {len(items)} total regulatory documents in the index.")

    candidates = [(d, u, t) for d, u, t in items if classify(t)]
    print(f"{len(candidates)} of those mention one of the three entity lists by title.")

    entities = []
    warnings = []

    for date, url, title in candidates:
        try:
            text = fetch_text(url)
        except Exception as e:
            warnings.append(f"[FETCH ERROR] {title} ({url}): {e}")
            continue

        attach_entries = parse_attachment_list(text)
        if attach_entries:
            list_id = classify(title)
            parsed = [(list_id, name, addr) for name, addr in attach_entries]
        else:
            inline_result = parse_inline_list(text)
            if not inline_result:
                # No "决定将...列入" and no 附件 -> this announcement does not
                # itself add anyone (e.g. a pure investigation notice, or a
                # follow-up advisory referencing an older listing). Correct
                # to yield zero entities here.
                continue
            list_id, raw_entries = inline_result
            parsed = [(list_id, name, addr) for name, addr in raw_entries]

        expected = count_hint(title)
        if expected is not None and expected != len(parsed):
            warnings.append(
                f"[COUNT MISMATCH] '{title}' ({url}) — title implies {expected}, "
                f"extracted {len(parsed)}. Included as extracted; please review the source."
            )

        for i, (list_id, name_line, addr) in enumerate(parsed, start=1):
            entities.append(normalize(list_id, name_line, addr, date, url, checked_on, i))

        time.sleep(0.3)

    # De-duplicate: the same entity can legitimately appear in more than one
    # announcement (e.g. re-affiliated entries), but identical (list_id,
    # entity_name, date) triples indicate the same record parsed twice.
    seen = set()
    deduped = []
    for e in entities:
        key = (e["list_id"], e["entity_name"], e["date_added"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(e)

    print(f"Extracted {len(deduped)} entity records ({len(entities) - len(deduped)} duplicate(s) dropped).")

    if warnings:
        print(f"\n{len(warnings)} item(s) need manual review:", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)

    by_list = {}
    for e in deduped:
        by_list.setdefault(e["list_id"], 0)
        by_list[e["list_id"]] += 1
    for list_id, count in sorted(by_list.items()):
        print(f"  {list_id}: {count} records")

    old_entities = read_entities("cn")
    diff = diff_entities(old_entities, deduped)
    summary = format_diff_summary(
        "中国 不可靠実体清単・出口管制管控名単・関注名単 (統合)", "cn-entity-lists", diff
    )
    if summary:
        write_diff_summary(summary)
        print("Wrote diff summary for update-alert issue.")

    out_path = write_entities("cn", deduped)
    print(f"\nWrote {len(deduped)} normalized entities to {out_path}")

    update_manifest({
        "list_id": "cn-entity-lists",
        "country": "cn",
        "name_en": "Unreliable Entity List + Export Control Watchlist + Attention List (combined)",
        "file": "data/entities/cn.json",
        "record_count": len(deduped),
        "source_url": "https://aqygzj.mofcom.gov.cn/flzc/gzjgfxwj/index.html",
        "update_frequency": "irregular",
        "last_updated": checked_on,
    })
    print("Updated data/manifest.json")


if __name__ == "__main__":
    main()
