#!/usr/bin/env python3
import os
import sys
import json
import re
import requests
from bs4 import BeautifulSoup

STATE_FILE = os.path.join(os.path.dirname(__file__), 'state.json')
SUMMARY_FILE = os.path.join(os.path.dirname(__file__), 'update_summary.txt')

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load state file: {e}", file=sys.stderr)
    return {}

def save_state(state):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error: Failed to save state file: {e}", file=sys.stderr)

def check_jp_meti(state):
    url = "https://www.meti.go.jp/policy/anpo/index.html"
    print(f"Checking JP METI Export Control site: {url}")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"
    }
    
    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"Error requesting JP METI: {e}", file=sys.stderr)
        return None
        
    soup = BeautifulSoup(r.text, 'html.parser')
    
    # 1. Get homepage update date
    last_mod_text = ""
    update_div = soup.find(id="__rdo_update")
    if update_div:
        p_tag = update_div.find('p')
        if p_tag:
            last_mod_text = p_tag.text.strip()
    
    # 2. Parse latest news
    latest_news = None
    h2_news = soup.find('h2', string=re.compile("新着情報"))
    if h2_news:
        table = h2_news.find_next('table')
        if table:
            rows = table.find_all('tr')
            # The first row is the header (Date, Category, Description)
            # Check the second row for the latest entry
            if len(rows) > 1:
                cols = rows[1].find_all('td')
                if len(cols) >= 3:
                    date_val = cols[0].text.strip()
                    type_val = cols[1].text.strip()
                    content_a = cols[2].find('a')
                    content_val = content_a.text.strip() if content_a else cols[2].text.strip()
                    link_val = content_a['href'] if (content_a and 'href' in content_a.attrs) else ""
                    
                    if link_val and not link_val.startswith('http'):
                        link_val = "https://www.meti.go.jp" + link_val
                    
                    latest_news = {
                        "date": date_val,
                        "type": type_val,
                        "content": content_val,
                        "link": link_val
                    }
                    
    current_state = {
        "last_modified_text": last_mod_text,
        "latest_news": latest_news
    }
    
    prev = state.get("jp_meti", {})
    changed = False
    details = []
    
    if not prev:
        changed = True
        details.append("Initial monitoring setup for JP METI.")
    else:
        if prev.get("last_modified_text") != current_state["last_modified_text"]:
            changed = True
            details.append(f"Homepage update date changed: {prev.get('last_modified_text')} -> {current_state['last_modified_text']}")
        
        prev_news = prev.get("latest_news") or {}
        curr_news = current_state["latest_news"] or {}
        if prev_news.get("date") != curr_news.get("date") or prev_news.get("content") != curr_news.get("content"):
            changed = True
            details.append(
                f"New news item detected:\n"
                f"  Date: {curr_news.get('date')}\n"
                f"  Category: {curr_news.get('type')}\n"
                f"  Title: {curr_news.get('content')}\n"
                f"  URL: {curr_news.get('link')}"
            )
            
    return {
        "changed": changed,
        "details": details,
        "state": current_state
    }

def main():
    state = load_state()
    new_state = {}
    updates = []
    
    # JP METI
    jp_result = check_jp_meti(state)
    if jp_result:
        new_state["jp_meti"] = jp_result["state"]
        if jp_result["changed"]:
            updates.append({
                "source": "Japan METI (Export Control Homepage)",
                "details": jp_result["details"]
            })
    else:
        if "jp_meti" in state:
            new_state["jp_meti"] = state["jp_meti"]

    # Save current state
    save_state(new_state)
    
    # Handle summary file
    if updates:
        print("\n=== Update Detected! ===")
        summary_lines = []
        summary_lines.append("# Security Export Control Source Updates Detected\n")
        for u in updates:
            print(f"\nSource: {u['source']}")
            summary_lines.append(f"## Source: {u['source']}\n")
            for d in u["details"]:
                print(f"- {d}")
                summary_lines.append(f"- {d}")
            summary_lines.append("")
        
        try:
            with open(SUMMARY_FILE, 'w', encoding='utf-8') as f:
                f.write("\n".join(summary_lines))
            print(f"\nSummary saved to {SUMMARY_FILE}")
        except Exception as e:
            print(f"Error: Failed to save summary file: {e}", file=sys.stderr)
    else:
        print("\nNo updates detected.")
        if os.path.exists(SUMMARY_FILE):
            try:
                os.remove(SUMMARY_FILE)
            except Exception as e:
                print(f"Warning: Failed to delete summary file: {e}", file=sys.stderr)

if __name__ == '__main__':
    main()
