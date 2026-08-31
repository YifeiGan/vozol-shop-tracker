#!/usr/bin/env python3
"""Import Orlando门店 jacky.csv into Jacky's Firestore profile."""

from __future__ import annotations

import csv
import json
import re
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from datetime import datetime, timezone

CSV_PATH = "/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/Orlando门店 jacky.csv"
TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
OWNER_UID = "vxxmrOkJhTcPPHOOcd0geirUbIs2"
TEAM_ID = "orlando"
CHAIN_MIN_STORES = 5
MAX_TRAFFIC_NOTES = 2
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

OAUTH_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"

CITIES = [
    "Altamonte Springs",
    "Winter Springs",
    "Lake Buena Vista",
    "Dr. Phillips",
    "Winter Garden",
    "Winter Park",
    "Fern Park",
    "Casselberry",
    "Kissimmee",
    "Longwood",
    "Lake Mary",
    "Maitland",
    "Sanford",
    "Clermont",
    "Davenport",
    "Poinciana",
    "St Cloud",
    "Windermere",
    "Celebration",
    "Orlando",
    "Oviedo",
    "Apopka",
    "Ocoee",
]

OWNER_STOP = {
    "manager", "owner", "the", "and", "shop", "smoke", "vape",
    "店员", "老板", "店长", "经理", "采购", "黑人", "男的", "女的",
}


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


def parse_all_dates(text):
    dates = []
    for match in re.finditer(r"(\d{1,2})[./](\d{1,2})", blank(text)):
        month, day = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            value = f"2026-{month:02d}-{day:02d}"
            if value not in dates:
                dates.append(value)
    return dates


def parse_visit_date(text):
    dates = parse_all_dates(text)
    return dates[-1] if dates else ""


def fragment_date(text, fallback):
    dates = parse_all_dates(text)
    if dates and re.match(r"^\d{1,2}[./]\d{1,2}", blank(text)):
        return dates[0]
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


def looks_like_address(addr):
    text = blank(addr)
    if not text or not re.search(r"\d", text):
        return False
    if re.search(r"\bFL\b", text, re.I) or "," in text:
        return True
    return bool(re.search(r"\b(rd|st|ave|blvd|dr|hwy|trl|trail|pkwy|way|rd)\b", text, re.I))


def improve_address(addr, info):
    if looks_like_address(addr):
        return blank(addr)
    blob = blank(info)
    match = re.search(r"(\d{2,}[^,\n]+,\s*[^,\n]+,?\s*FL(?:\s*\d{5})?)", blob, re.I)
    if match:
        return blank(match.group(1))
    match = re.search(r"(\d{3,}\s+[A-Za-z0-9 .#'-]+,\s*[A-Za-z .']+\s*FL(?:\s*\d{5})?)", blob, re.I)
    if match:
        return blank(match.group(1))
    return blank(addr)


def parse_city(address):
    addr = blank(address)
    match = re.search(r"(.+?),\s*FL\s*\d{5}", addr, re.I)
    if not match:
        match = re.search(r"(.+?)\s*,?\s*FL\s*\d{5}", addr, re.I)
    if not match:
        match = re.search(r"(.+?)\s*,?\s*FL\b", addr, re.I)
    before = match.group(1) if match else ""
    part = before.split(",")[-1].strip() if before else ""
    lower = part.lower()
    for city in sorted(CITIES, key=len, reverse=True):
        key = city.lower()
        if lower == key or lower.endswith(" " + key):
            return city
    if part and not re.search(r"\d", part) and 2 < len(part) < 30:
        if not re.search(r"smoke|vape|shop", lower):
            return part
    return "Orlando"


def parse_store_count(text):
    match = re.search(r"(\d+)", blank(text))
    return int(match.group(1)) if match else 1


def parse_tier(text):
    text = blank(text).upper().replace("＋", "+")
    if text in ("S", "A+", "A", "B"):
        return text
    return ""


def is_yes(text):
    value = blank(text).lower()
    return value in ("是", "yes", "true", "1", "试抽盒", "样机")


def map_status(sell_status):
    value = blank(sell_status).replace("\n", "")
    if "已卖进" in value:
        return "visited"
    if "拒绝" in value:
        return "no_interest"
    return "follow_up"


def clean_shop_name(name):
    text = blank(name).replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"^\d+\.\s*", "", text)
    text = re.sub(r"[，,]?有?\d+家店$", "", text)
    text = re.sub(r"\s+\d+家店$", "", text)
    text = re.sub(r"\s+有两家店$", "", text)
    return text.strip(" ,")


def split_phone_url(text):
    raw = blank(text)
    url = ""
    match = re.search(r"https?://\S+", raw)
    if match:
        url = match.group(0).rstrip(".,)")
        raw = raw.replace(match.group(0), "")
    phone = re.sub(r"\s+", " ", raw).strip(" ,/")
    return phone, url


def name_key(name):
    text = clean_shop_name(name).lower().replace("&", " and ")
    text = re.sub(r"\band\b", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def similar_name(a, b):
    na, nb = name_key(a), name_key(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def addr_key(addr):
    return re.sub(r"[^a-z0-9]+", "", blank(addr).lower())


def similar_addr(a, b):
    ka, kb = addr_key(a), addr_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    shorter, longer = (ka, kb) if len(ka) <= len(kb) else (kb, ka)
    return len(shorter) >= 10 and longer.startswith(shorter)


def owner_tokens(text):
    tokens = set(re.findall(r"[A-Za-z\u4e00-\u9fff]{3,}", blank(text).lower()))
    return {t for t in tokens if t not in OWNER_STOP}


def similar_owner(a, b):
    return bool(owner_tokens(a) & owner_tokens(b))


def address_score(addr):
    text = blank(addr)
    score = 0
    if re.search(r"FL\s*\d{5}", text, re.I):
        score += 3
    elif re.search(r"\bFL\b", text, re.I):
        score += 1
    score += min(len(text), 80) / 80
    return score


def better_address(old, new):
    if not blank(new):
        return old
    if not blank(old):
        return new
    return new if address_score(new) >= address_score(old) else old


def load_rows():
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as fh:
        raw = list(csv.reader(fh))
    shops = []
    for raw_row in raw[1:]:
        if len(raw_row) < 12:
            continue
        name = clean_shop_name(raw_row[1])
        if not name:
            continue
        info = blank(raw_row[11] if len(raw_row) > 11 else "")
        address = improve_address(raw_row[2] if len(raw_row) > 2 else "", info)
        visit_date = parse_visit_date(raw_row[4] if len(raw_row) > 4 else "")
        dates = parse_all_dates(raw_row[4] if len(raw_row) > 4 else "")
        phone, url = split_phone_url(raw_row[8] if len(raw_row) > 8 else "")
        shops.append({
            "name": name,
            "address": address,
            "shop_type": blank(raw_row[3] if len(raw_row) > 3 else ""),
            "visit_date": visit_date,
            "visit_dates": dates,
            "store_count": parse_store_count(raw_row[5] if len(raw_row) > 5 else ""),
            "tier": parse_tier(raw_row[6] if len(raw_row) > 6 else ""),
            "owner_name": blank(raw_row[7] if len(raw_row) > 7 else ""),
            "phone": phone,
            "source_url": url,
            "sell_status": blank(raw_row[9] if len(raw_row) > 9 else ""),
            "coop": blank(raw_row[10] if len(raw_row) > 10 else ""),
            "info": info,
            "sample": is_yes(raw_row[12] if len(raw_row) > 12 else ""),
            "test_case": is_yes(raw_row[13] if len(raw_row) > 13 else ""),
            "distributor": blank(raw_row[14] if len(raw_row) > 14 else ""),
            "notes": split_note_blocks(info, visit_date),
        })
    return shops


def should_merge(existing, row):
    same_place = similar_addr(existing.get("address") or "", row.get("address") or "")
    if not same_place:
        return False
    return similar_name(existing["name"], row["name"]) or similar_owner(
        existing.get("owner_name") or "",
        row.get("owner_name") or "",
    )


def merge_shops(rows):
    merged = OrderedDict()
    for row in rows:
        key = None
        for existing_key, existing in merged.items():
            if should_merge(existing, row):
                key = existing_key
                break
        if key is None:
            key = str(uuid.uuid4())
            merged[key] = {**row, "id": key, "visits": []}
        shop = merged[key]
        later = (row["visit_date"] or "") >= (shop["visit_date"] or "")
        if row.get("address"):
            shop["address"] = better_address(shop.get("address") or "", row["address"])
        if later:
            for field in (
                "name", "shop_type", "visit_date", "store_count", "tier",
                "owner_name", "phone", "source_url", "sell_status", "coop", "info", "distributor",
            ):
                if row.get(field):
                    shop[field] = row[field]
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
    created_dates = [v.get("visit_date") for v in shop["visits"] if v.get("visit_date")]
    created_date = min(created_dates) if created_dates else latest_date
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
        "source_url": sval(shop.get("source_url") or ""),
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
        raise SystemExit("Jacky already has shops; aborting to avoid duplicates.")

    shops = merge_shops(load_rows())
    writes = []
    counts = {"follow_up": 0, "visited": 0, "no_interest": 0, "not_visited": 0}
    samples = 0
    cases = 0
    chains = 0

    for shop in shops.values():
        fields, unique, created = shop_fields(shop)
        status = fields["status"]["stringValue"]
        counts[status] = counts.get(status, 0) + 1
        if fields["sample_placed"]["booleanValue"]:
            samples += 1
        if fields["test_case_placed"]["booleanValue"]:
            cases += 1
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
        f"{chains} chain)"
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
