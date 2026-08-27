#!/usr/bin/env python3
"""Rewrite Yuan Sun shop traffic_note from every CSV feedback + next_plan."""

from __future__ import annotations

import csv
import json
import urllib.error
import urllib.request
from collections import OrderedDict

CSV_PATH = "/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/Supabase Snippet Untitled query.csv"
TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
OWNER_UID = "9TOUJ9cnhXYb6d3ICHhcEbIJY1C2"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def blank(value):
    text = "" if value is None else str(value).strip()
    if text.lower() in ("", "null", "none"):
        return ""
    return text


def load_token():
    with open(TOKEN_PATH) as fh:
        return json.load(fh)["tokens"]["access_token"]


def request(method, url, token, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise RuntimeError(f"{method} {url} -> {exc.code}\n{body[:2000]}") from exc


def visit_block(row):
    date = blank(row.get("visit_date"))
    feedback = blank(row.get("feedback"))
    next_plan = blank(row.get("next_plan"))
    if not feedback and not next_plan:
        return ""
    lines = []
    if date:
        lines.append(f"[{date}]")
    if feedback:
        lines.append(feedback)
    if next_plan:
        lines.append(f"下次计划：{next_plan}")
    return "\n".join(lines)


def group_notes():
    notes = OrderedDict()
    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            shop_id = blank(row.get("shop_id"))
            if not shop_id:
                continue
            block = visit_block(row)
            if not block:
                notes.setdefault(shop_id, {"name": blank(row.get("shop_name")), "blocks": []})
                continue
            entry = notes.setdefault(shop_id, {"name": blank(row.get("shop_name")), "blocks": []})
            entry["blocks"].append(block)
    return notes


def main():
    token = load_token()
    notes = group_notes()
    writes = []
    nonempty = 0
    for shop_id, entry in notes.items():
        text = "\n\n".join(entry["blocks"]).strip()
        if text:
            nonempty += 1
            print(f"{entry['name']}: {len(entry['blocks'])} block(s), {len(text)} chars")
        writes.append({
            "update": {
                "name": f"projects/{PROJECT}/databases/(default)/documents/profiles/{OWNER_UID}/shops/{shop_id}",
                "fields": {"traffic_note": {"stringValue": text}},
            },
            "updateMask": {"fieldPaths": ["traffic_note"]},
        })

    print(f"\nShops to patch: {len(writes)} ({nonempty} with notes)")
    for start in range(0, len(writes), 400):
        chunk = writes[start:start + 400]
        request("POST", f"{BASE}:commit", token, {"writes": chunk})
        print(f"Committed {start + 1}-{start + len(chunk)}")


if __name__ == "__main__":
    main()
