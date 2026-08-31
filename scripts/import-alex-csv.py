#!/usr/bin/env python3
"""Import Tampa bay门店alex.csv into Alex's Firestore profile."""

from __future__ import annotations

import csv
import json
import re
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from datetime import datetime, timezone

CSV_PATH = "/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/Tampa bay门店alex.csv"
TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
OWNER_UID = "IjnZrEZdh1ebpnz7Azw4Aym345h2"
TEAM_ID = "tampa"
CHAIN_MIN_STORES = 5
MAX_TRAFFIC_NOTES = 2
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

OAUTH_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"

CITIES = [
    "Town 'N' Country",
    "Land O' Lakes",
    "Wesley Chapel",
    "Temple Terrace",
    "Zephyrhills",
    "Oldsmar",
    "Seffner",
    "Brandon",
    "Valrico",
    "Odessa",
    "Lutz",
    "Tampa",
]


def blank(value):
    text = "" if value is None else str(value).strip()
    text = text.replace("\ufeff", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def load_token():
    with open(TOKEN_PATH) as fh:
        refresh = json.load(fh)["tokens"]["refresh_token"]
    body = urllib.parse.urlencode({
        "client_id": OAUTH_CLIENT_ID,
        "client_secret": OAUTH_CLIENT_SECRET,
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


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


def sval(v):
    return {"stringValue": v or ""}


def bval(v):
    return {"booleanValue": bool(v)}


def nval():
    return {"nullValue": None}


def ival(v):
    return {"integerValue": str(int(v))}


def aval(values):
    if not values:
        return {"arrayValue": {}}
    return {"arrayValue": {"values": values}}


def tsval(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return {"timestampValue": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def visit_dt(date_str):
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=16, minute=0, tzinfo=timezone.utc)


def parse_visit_date(text):
    text = blank(text).replace(".", "/")
    m = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})$", text)
    if not m:
        return ""
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def fragment_date(text, fallback):
    text = blank(text)
    m = re.match(r"^(\d{4})[./](\d{1,2})[./](\d{1,2})", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{1,2})[./](\d{1,2})", text)
    if m:
        return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return fallback


def split_note_blocks(info, visit_date):
    text = blank(info)
    if not text:
        return []
    chunks = re.split(r"(?=\n\s*\d{1,2}[./]\d{1,2})", text)
    blocks = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        date = fragment_date(chunk, visit_date or "")
        blocks.append({"date": date, "text": chunk})
    if not blocks:
        return []
    if len(blocks) == 1 and not blocks[0]["date"]:
        blocks[0]["date"] = visit_date
    return blocks[-MAX_TRAFFIC_NOTES:]


def parse_city(address):
    addr = blank(address)
    m = re.search(r"(.+?),\s*FL\s*\d{5}", addr, re.I)
    if not m:
        m = re.search(r"(.+?)\s+FL\s+\d{5}", addr, re.I)
    before = m.group(1) if m else ""
    part = before.split(",")[-1].strip() if before else ""
    lower = part.lower()
    for city in sorted(CITIES, key=len, reverse=True):
        key = city.lower()
        if lower == key or lower.endswith(" " + key):
            return city
    if part and not re.search(r"\d", part) and 2 < len(part) < 30:
        if not re.search(r"smoke|vape|shop", lower):
            return part
    return "Tampa"


def parse_store_count(text):
    m = re.search(r"(\d+)", blank(text))
    return int(m.group(1)) if m else 1


def parse_tier(text):
    text = blank(text).upper().replace("＋", "+")
    if text in ("S", "A+", "A", "B"):
        return text
    return ""


def is_yes(text):
    value = blank(text).lower()
    return value in ("是", "yes", "true", "1", "试抽盒", "样机")


def map_status(sell_status):
    value = blank(sell_status)
    if value == "已卖进":
        return "visited"
    if value == "拒绝":
        return "no_interest"
    if value in ("待跟进", "寄售"):
        return "follow_up"
    return "follow_up"


def similar_name(a, b):
    na = re.sub(r"[^a-z0-9]+", "", a.lower())
    nb = re.sub(r"[^a-z0-9]+", "", b.lower())
    if not na or not nb:
        return False
    return na in nb or nb in na


def row_key(row):
    addr = blank(row["address"]).lower()
    name = blank(row["name"]).lower()
    return addr or name


def load_rows():
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as fh:
        raw = list(csv.reader(fh))
    shops = []
    for raw_row in raw[1:]:
        if len(raw_row) < 12:
            continue
        name = blank(raw_row[1])
        if not name:
            continue
        visit_date = parse_visit_date(raw_row[4] if len(raw_row) > 4 else "")
        info = blank(raw_row[11] if len(raw_row) > 11 else "")
        shops.append({
            "name": name,
            "address": blank(raw_row[2] if len(raw_row) > 2 else ""),
            "shop_type": blank(raw_row[3] if len(raw_row) > 3 else ""),
            "visit_date": visit_date,
            "store_count": parse_store_count(raw_row[5] if len(raw_row) > 5 else ""),
            "tier": parse_tier(raw_row[6] if len(raw_row) > 6 else ""),
            "owner_name": blank(raw_row[7] if len(raw_row) > 7 else ""),
            "phone": blank(raw_row[8] if len(raw_row) > 8 else ""),
            "sell_status": blank(raw_row[9] if len(raw_row) > 9 else ""),
            "coop": blank(raw_row[10] if len(raw_row) > 10 else ""),
            "info": info,
            "sample": is_yes(raw_row[12] if len(raw_row) > 12 else ""),
            "test_case": is_yes(raw_row[13] if len(raw_row) > 13 else ""),
            "distributor": blank(raw_row[14] if len(raw_row) > 14 else ""),
            "notes": split_note_blocks(info, visit_date),
        })
    return shops


def merge_shops(rows):
    merged = OrderedDict()
    for row in rows:
        addr = blank(row["address"]).lower()
        key = None
        if addr:
            for existing_key, existing in merged.items():
                if blank(existing["address"]).lower() == addr and similar_name(existing["name"], row["name"]):
                    key = existing_key
                    break
        if key is None:
            key = str(uuid.uuid4())
            merged[key] = {**row, "id": key, "visits": []}
        shop = merged[key]
        later = (row["visit_date"] or "") >= (shop["visit_date"] or "")
        if later:
            for field in (
                "name", "address", "shop_type", "visit_date", "store_count", "tier",
                "owner_name", "phone", "sell_status", "coop", "info", "distributor",
            ):
                if row.get(field):
                    shop[field] = row[field]
            shop["sample"] = shop["sample"] or row["sample"]
            shop["test_case"] = shop["test_case"] or row["test_case"]
        else:
            shop["sample"] = shop["sample"] or row["sample"]
            shop["test_case"] = shop["test_case"] or row["test_case"]
        shop["visits"].append(row)
    return merged


def note_maps(shop):
    blocks = []
    for visit in shop["visits"]:
        blocks.extend(visit.get("notes") or [])
    if not blocks and shop.get("info"):
        blocks = [{"date": shop.get("visit_date") or "", "text": shop["info"]}]
    seen = []
    unique = []
    for block in blocks:
        text = blank(block.get("text"))
        if not text or text in seen:
            continue
        seen.append(text)
        unique.append(block)
    unique = unique[-MAX_TRAFFIC_NOTES:]
    values = []
    for block in unique:
        date = block.get("date") or shop.get("visit_date") or ""
        at = visit_dt(date) if date else datetime.now(timezone.utc)
        values.append({
            "mapValue": {
                "fields": {
                    "date": sval(date),
                    "text": sval(block["text"]),
                    "at": ival(int(at.timestamp() * 1000)),
                }
            }
        })
    return values, unique


def shop_fields(shop):
    notes, unique = note_maps(shop)
    latest_date = shop.get("visit_date") or (unique[-1]["date"] if unique else "")
    created_date = shop["visits"][0].get("visit_date") or latest_date
    updated = visit_dt(latest_date) if latest_date else datetime.now(timezone.utc)
    created = visit_dt(created_date) if created_date else updated
    store_count = int(shop.get("store_count") or 1)
    is_chain = store_count >= CHAIN_MIN_STORES
    tier = shop.get("tier") or ""
    sample = bool(shop.get("sample"))
    test_case = bool(shop.get("test_case"))
    sample_on = latest_date if sample else ""
    test_on = latest_date if test_case else ""
    traffic_text = unique[-1]["text"] if unique else (shop.get("info") or "")
    status = map_status(shop.get("sell_status"))
    city = parse_city(shop.get("address") or "")
    return {
        "name": sval(shop["name"]),
        "address": sval(shop.get("address") or ""),
        "city": sval(city),
        "phone": sval(shop.get("phone") or ""),
        "tier": sval(tier),
        "status": sval(status),
        "is_chain": bval(is_chain),
        "chain_name": sval(""),
        "chain_total_stores": ival(store_count) if is_chain else nval(),
        "chain_a_plus_count": ival(1 if is_chain and tier in ("S", "A+", "A") else 0) if is_chain else nval(),
        "staff_contact": sval(""),
        "owner_name": sval(shop.get("owner_name") or ""),
        "owner_schedule": sval(""),
        "contact_role": sval(""),
        "store_number": sval("" if is_chain or store_count <= 1 else f"{store_count}家"),
        "restock_status": sval(shop.get("sell_status") or ""),
        "distributor": sval(shop.get("distributor") or ""),
        "test_case_placed": bval(test_case),
        "test_case_placed_on": sval(test_on),
        "sample_placed": bval(sample),
        "sample_placed_on": sval(sample_on),
        "traffic_note": sval(traffic_text),
        "traffic_notes": aval(notes),
        "units_log": aval([]),
        "brands_note": sval(""),
        "next_plan": sval(""),
        "next_plan_date": sval(""),
        "next_plan_time": sval(""),
        "source_url": sval(""),
        "starred": bval(shop.get("coop") == "极高"),
        "team_id": sval(TEAM_ID),
        "assigned_to": sval(OWNER_UID),
        "created_at": tsval(created),
        "updated_at": tsval(updated),
        "lat": nval(),
        "lng": nval(),
        "geocode_query": sval(""),
        "geocode_failed": bval(False),
    }, unique, created


def visit_fields(block, created):
    date = block.get("date") or ""
    at = visit_dt(date) if date else created
    return {
        "date": sval(date),
        "units": ival(0),
        "note": sval(block.get("text") or ""),
        "decision_maker": sval(""),
        "restock_status": sval(""),
        "test_case_placed": bval(False),
        "next_plan": sval(""),
        "created_at": tsval(at),
    }


def doc_name(*parts):
    return f"projects/{PROJECT}/databases/(default)/documents/" + "/".join(parts)


def main():
    token = load_token()
    profile = request("GET", f"{BASE}/profiles/{OWNER_UID}", token)
    fields = profile.get("fields") or {}
    name = (fields.get("full_name") or {}).get("stringValue", "")
    team = (fields.get("team_id") or {}).get("stringValue", "")
    print(f"Owner: {name} ({OWNER_UID}) team={team}")

    existing = request("GET", f"{BASE}/profiles/{OWNER_UID}/shops?pageSize=300", token)
    existing_docs = existing.get("documents") or []
    print(f"Existing shops before import: {len(existing_docs)}")
    if existing_docs:
        raise SystemExit("Alex already has shops; aborting to avoid duplicates.")

    shops = merge_shops(load_rows())
    writes = []
    counts = {"follow_up": 0, "visited": 0, "no_interest": 0, "not_visited": 0}
    samples = 0
    cases = 0
    starred = 0
    chains = 0

    for shop in shops.values():
        fields, unique, created = shop_fields(shop)
        status = fields["status"]["stringValue"]
        counts[status] = counts.get(status, 0) + 1
        if fields["sample_placed"]["booleanValue"]:
            samples += 1
        if fields["test_case_placed"]["booleanValue"]:
            cases += 1
        if fields["starred"]["booleanValue"]:
            starred += 1
        if fields["is_chain"]["booleanValue"]:
            chains += 1
        writes.append({
            "update": {
                "name": doc_name("profiles", OWNER_UID, "shops", shop["id"]),
                "fields": fields,
            }
        })
        for index, block in enumerate(unique):
            vid = f"{block.get('date') or 'undated'}_{index}"
            writes.append({
                "update": {
                    "name": doc_name("profiles", OWNER_UID, "shops", shop["id"], "visits", vid),
                    "fields": visit_fields(block, created),
                }
            })

    print(
        f"Will write {len(shops)} shops "
        f"({counts['follow_up']} follow-up, {counts['visited']} sold-in, "
        f"{counts['no_interest']} no-interest, {cases} test case, {samples} sample, "
        f"{chains} chain, {starred} starred)"
    )
    print(f"Commit writes: {len(writes)}")

    for start in range(0, len(writes), 400):
        chunk = writes[start:start + 400]
        request("POST", f"{BASE}:commit", token, {"writes": chunk})
        print(f"Committed {start + 1}-{start + len(chunk)}")

    after = request("GET", f"{BASE}/profiles/{OWNER_UID}/shops?pageSize=300", token)
    print(f"Shops after import: {len(after.get('documents') or [])}")


if __name__ == "__main__":
    main()
