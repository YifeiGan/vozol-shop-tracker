#!/usr/bin/env python3
"""Import Houston visit workbooks into chen and CG Firestore profiles."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
TEAM_ID = "houston"
AREA_ID = "houston"
CHAIN_MIN_STORES = 5
MAX_TRAFFIC_NOTES = 3
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
OAUTH_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"

IMPORTS = [
    {
        "label": "chen",
        "uid": "OsshDdeG8qSdQf9G0fwdZxxz8tn1",
        "xlsx": Path("/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/休斯顿访店记录 chen.xlsx"),
        "sheet": "休斯顿访店记录",
        "kind": "chen",
    },
    {
        "label": "CG",
        "uid": "bvCEw8EMZyZTmc4G5YF67v0i3Iv2",
        "xlsx": Path("/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/VOZOL休斯顿区域）CG(1).xlsx"),
        "sheet": "跑店共享表",
        "kind": "cg",
    },
]

CITIES = [
    "The Woodlands", "League City", "Sugar Land", "Pearland", "Pasadena",
    "Galveston", "Conroe", "Humble", "Cypress", "Spring", "Katy", "Plano",
    "Fort Worth", "Arlington", "Irving", "Garland", "Frisco", "McKinney",
    "Denton", "Richardson", "Mesquite", "Grand Prairie", "Carrollton",
    "Allen", "Lewisville", "Dallas", "Houston", "Austin", "San Antonio",
]


def blank(value):
    if value is None:
        return ""
    if isinstance(value, float):
        text = f"{value:.10f}".rstrip("0").rstrip(".")
    elif isinstance(value, int) and not isinstance(value, bool):
        text = str(value)
    elif hasattr(value, "strftime"):
        text = value.strftime("%m.%d.%y")
    else:
        text = str(value)
    text = text.replace("\ufeff", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text).strip()
    if text in ("-", "—", "–", "null", "None", "none"):
        return ""
    return text


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
    if hasattr(text, "strftime") and not isinstance(text, str):
        return [text.strftime("%Y-%m-%d")]
    raw = blank(text).replace(",", ".")
    if not raw:
        return []
    # excel serial as float already handled by blank -> string
    for match in re.finditer(r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})", raw):
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            value = f"{year:04d}-{month:02d}-{day:02d}"
            if value not in dates:
                dates.append(value)
    for match in re.finditer(r"(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?", raw):
        month, day = int(match.group(1)), int(match.group(2))
        if not (1 <= month <= 12 and 1 <= day <= 31):
            continue
        year = 2026
        if match.group(3):
            y = int(match.group(3))
            year = 2000 + y if y < 100 else y
        value = f"{year:04d}-{month:02d}-{day:02d}"
        if value not in dates:
            dates.append(value)
    # excel date serial like 7.3 meaning July 3 when blank converted oddly
    if re.fullmatch(r"\d{1,2}\.\d{1,2}", raw):
        month, day = [int(x) for x in raw.split(".")]
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
    if dates and re.match(r"^[\*\-\s]*(\d{4}[./-])?\d{1,2}[./]\d{1,2}", blank(text)):
        return dates[0]
    return fallback


def split_note_blocks(info, visit_date):
    text = blank(info)
    if not text:
        return []
    chunks = re.split(r"(?=\n\s*[\*\-]?\s*(?:\d{4}[./-])?\d{1,2}[./]\d{1,2})", text)
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


def normalize_city(city, address):
    city = blank(city)
    if city:
        for known in sorted(CITIES, key=len, reverse=True):
            if city.lower() == known.lower():
                return known
        return city
    addr = blank(address)
    match = re.search(r"(.+?),\s*TX\s*\d{5}", addr, re.I)
    if not match:
        match = re.search(r"(.+?)\s+TX\s*,?\s*\d{5}", addr, re.I)
    before = match.group(1) if match else ""
    part = before.split(",")[-1].strip() if before else ""
    lower = part.lower()
    for known in sorted(CITIES, key=len, reverse=True):
        key = known.lower()
        if lower == key or lower.endswith(" " + key):
            return known
    return "Houston"


def parse_store_count(value):
    match = re.search(r"(\d+)", blank(value))
    return int(match.group(1)) if match else 1


def parse_tier(text):
    text = blank(text).upper().replace("＋", "+")
    text = re.sub(r"\s+", "", text)
    if text in ("S", "A+", "A", "B"):
        return text
    return ""


def is_yes(text):
    value = blank(text).lower()
    return value in ("是", "yes", "y", "true", "1", "试抽盒", "样机")


def map_status(sell_status, info=""):
    value = blank(sell_status).replace("\n", "")
    blob = f"{value} {blank(info)}"
    if "已卖进" in blob or "卖进" in value:
        return "visited"
    if "拒绝" in blob or "没兴趣" in blob:
        return "no_interest"
    return "follow_up"


def map_willingness(text):
    value = blank(text)
    if not value:
        return ""
    if value in ("极高", "高", "中", "低"):
        return value
    if "极高" in value:
        return "极高"
    if "高" in value:
        return "高"
    if "中" in value:
        return "中"
    if "低" in value or "没兴趣" in value:
        return "低"
    return ""


def name_key(name):
    text = blank(name).lower().replace("&", " and ")
    text = re.sub(r"\band\b", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def similar_name(a, b):
    na, nb = name_key(a), name_key(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def addr_key(addr):
    return re.sub(r"[^a-z0-9]+", "", blank(addr).lower())


def load_chen_rows(path, sheet_name):
    wb = load_workbook(path, data_only=True)
    ws = wb[sheet_name]
    shops = []
    for raw in ws.iter_rows(min_row=2, values_only=True):
        if not raw or len(raw) < 4:
            continue
        name = blank(raw[2])
        if not name:
            continue
        visit_raw = blank(raw[13] if len(raw) > 13 else "")
        visit_date = parse_visit_date(visit_raw)
        info = blank(raw[14] if len(raw) > 14 else "")
        popup = blank(raw[10] if len(raw) > 10 else "")
        note_source = "\n".join([x for x in (info, popup) if x])
        address = blank(raw[3])
        city = normalize_city(raw[1], address)
        coop_raw = blank(raw[11] if len(raw) > 11 else "")
        willingness = map_willingness(coop_raw)
        extra_note = ""
        if coop_raw and not willingness and len(coop_raw) > 2:
            extra_note = coop_raw
        if extra_note:
            note_source = "\n".join([x for x in (note_source, extra_note) if x])
        shops.append({
            "name": name,
            "address": address,
            "city": city,
            "shop_type": blank(raw[4]) or "smoke shop",
            "visit_date": visit_date,
            "visit_dates": parse_all_dates(visit_raw),
            "store_count": parse_store_count(raw[5] if len(raw) > 5 else ""),
            "tier": parse_tier(raw[8] if len(raw) > 8 else ""),
            "owner_name": blank(raw[6] if len(raw) > 6 else ""),
            "phone": blank(raw[7] if len(raw) > 7 else ""),
            "sell_status": "",
            "coop": willingness,
            "info": note_source,
            "sample": is_yes(raw[15] if len(raw) > 15 else ""),
            "test_case": is_yes(raw[12] if len(raw) > 12 else "") or is_yes(raw[16] if len(raw) > 16 else ""),
            "distributor": blank(raw[9] if len(raw) > 9 else ""),
            "notes": split_note_blocks(note_source, visit_date),
        })
    return shops


def load_cg_rows(path, sheet_name):
    wb = load_workbook(path, data_only=True)
    ws = wb[sheet_name]
    shops = []
    current = None
    for raw in ws.iter_rows(min_row=2, values_only=True):
        if not raw:
            continue
        person = blank(raw[0] if len(raw) > 0 else "")
        name = blank(raw[1] if len(raw) > 1 else "")
        info = blank(raw[11] if len(raw) > 11 else "")
        if not name:
            if current and info:
                current["info"] = "\n".join([x for x in (current.get("info") or "", info) if x])
                current["notes"] = split_note_blocks(current["info"], current.get("visit_date") or "")
            continue
        if name in ("店铺名称", "Model name"):
            continue
        visit_raw = blank(raw[5] if len(raw) > 5 else "")
        visit_date = parse_visit_date(visit_raw)
        popup = blank(raw[13] if len(raw) > 13 else "")
        note_source = "\n".join([x for x in (info, popup) if x])
        address = blank(raw[2] if len(raw) > 2 else "")
        city = normalize_city("", address)
        row = {
            "name": name,
            "address": address,
            "city": city,
            "shop_type": blank(raw[3] if len(raw) > 3 else "") or "smoke shop",
            "visit_date": visit_date,
            "visit_dates": parse_all_dates(visit_raw),
            "store_count": parse_store_count(raw[6] if len(raw) > 6 else ""),
            "tier": parse_tier(raw[7] if len(raw) > 7 else ""),
            "owner_name": blank(raw[8] if len(raw) > 8 else ""),
            "phone": blank(raw[9] if len(raw) > 9 else ""),
            "sell_status": blank(raw[4] if len(raw) > 4 else ""),
            "coop": map_willingness(raw[10] if len(raw) > 10 else ""),
            "info": note_source,
            "sample": is_yes(raw[14] if len(raw) > 14 else ""),
            "test_case": is_yes(raw[15] if len(raw) > 15 else ""),
            "distributor": blank(raw[12] if len(raw) > 12 else ""),
            "notes": split_note_blocks(note_source, visit_date),
            "person": person,
        }
        shops.append(row)
        current = row
    return shops


def merge_shops(rows):
    merged = OrderedDict()
    for row in rows:
        addr = addr_key(row["address"])
        key = None
        if addr:
            for existing_key, existing in merged.items():
                if addr_key(existing["address"]) == addr and similar_name(existing["name"], row["name"]):
                    key = existing_key
                    break
        if key is None:
            key = str(uuid.uuid4())
            merged[key] = {**row, "id": key, "visits": []}
        shop = merged[key]
        later = (row["visit_date"] or "") >= (shop["visit_date"] or "")
        if later:
            for field in (
                "name", "address", "city", "shop_type", "visit_date", "store_count", "tier",
                "owner_name", "phone", "sell_status", "coop", "info", "distributor",
            ):
                if row.get(field):
                    shop[field] = row[field]
            shop["sample"] = shop["sample"] or row["sample"]
            shop["test_case"] = shop["test_case"] or row["test_case"]
        else:
            for field in ("city", "shop_type", "tier", "owner_name", "phone", "sell_status", "coop", "distributor", "info"):
                if not shop.get(field) and row.get(field):
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


def shop_fields(shop, owner_uid):
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
    status = map_status(shop.get("sell_status"), shop.get("info") or "")
    city = shop.get("city") or normalize_city("", shop.get("address") or "")
    willingness = shop.get("coop") or ""
    return {
        "name": sval(shop["name"]),
        "address": sval(shop.get("address") or ""),
        "city": sval(city),
        "phone": sval(shop.get("phone") or ""),
        "tier": sval(tier),
        "status": sval(status),
        "willingness": sval(willingness),
        "sold_in_channel": sval("self" if status == "visited" else ""),
        "sold_in_on": sval(latest_date if status == "visited" else ""),
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
        "display_card_placed": bval(False),
        "display_card_placed_on": sval(""),
        "traffic_note": sval(traffic_text),
        "traffic_notes": aval(notes),
        "popup_notes": aval([]),
        "units_log": aval([]),
        "brands_note": sval(""),
        "next_plan": sval(""),
        "next_plan_date": sval(""),
        "next_plan_time": sval(""),
        "source_url": sval(""),
        "starred": bval(willingness == "极高"),
        "team_id": sval(TEAM_ID),
        "area_id": sval(AREA_ID),
        "assigned_to": sval(owner_uid),
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


def list_shops(token, uid):
    docs = []
    url = f"{BASE}/profiles/{uid}/shops?pageSize=300"
    while url:
        payload = request("GET", url, token)
        docs.extend(payload.get("documents") or [])
        page = payload.get("nextPageToken")
        if not page:
            break
        url = f"{BASE}/profiles/{uid}/shops?pageSize=300&pageToken={urllib.parse.quote(page)}"
    return docs


def clear_shops(token, uid, docs):
    if not docs:
        return
    print(f"  clearing {len(docs)} existing shops…")
    for start in range(0, len(docs), 200):
        chunk = docs[start:start + 200]
        writes = []
        for doc in chunk:
            name = doc["name"]
            writes.append({"delete": name})
            # best-effort delete visits collection docs if present in fields only; visits listed separately below
        # also delete visits for each shop
        for doc in chunk:
            shop_id = doc["name"].split("/")[-1]
            try:
                visits = request("GET", f"{BASE}/profiles/{uid}/shops/{shop_id}/visits?pageSize=100", token)
            except RuntimeError:
                visits = {}
            for visit in visits.get("documents") or []:
                writes.append({"delete": visit["name"]})
        for i in range(0, len(writes), 400):
            request("POST", f"{BASE}:commit", token, {"writes": writes[i:i + 400]})


def import_one(token, cfg):
    uid = cfg["uid"]
    profile = request("GET", f"{BASE}/profiles/{uid}", token)
    fields = profile.get("fields") or {}
    name = (fields.get("full_name") or {}).get("stringValue", "")
    team = (fields.get("team_id") or {}).get("stringValue", "")
    print(f"\n=== {cfg['label']} / {name} ({uid}) team={team} ===")

    existing = list_shops(token, uid)
    print(f"Existing shops: {len(existing)}")
    if existing:
        clear_shops(token, uid, existing)

    if cfg["kind"] == "chen":
        rows = load_chen_rows(cfg["xlsx"], cfg["sheet"])
    else:
        rows = load_cg_rows(cfg["xlsx"], cfg["sheet"])
    shops = merge_shops(rows)

    writes = []
    counts = {"follow_up": 0, "visited": 0, "no_interest": 0}
    samples = cases = chains = 0
    for shop in shops.values():
        fields, unique, created = shop_fields(shop, uid)
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
                "name": doc_name("profiles", uid, "shops", shop["id"]),
                "fields": fields,
            }
        })
        for index, block in enumerate(unique):
            vid = f"{block.get('date') or 'undated'}_{index}"
            writes.append({
                "update": {
                    "name": doc_name("profiles", uid, "shops", shop["id"], "visits", vid),
                    "fields": visit_fields(block, created),
                }
            })

    print(f"Raw rows: {len(rows)}; merged shops: {len(shops)}")
    print(
        f"Will write {len(shops)} shops "
        f"({counts['follow_up']} follow-up, {counts['visited']} sold-in, "
        f"{counts['no_interest']} no-interest, {cases} test case, {samples} sample, {chains} chain)"
    )
    for start in range(0, len(writes), 400):
        chunk = writes[start:start + 400]
        request("POST", f"{BASE}:commit", token, {"writes": chunk})
        print(f"  committed {start + 1}-{start + len(chunk)}")

    after = list_shops(token, uid)
    print(f"Shops after import: {len(after)}")


def main():
    token = load_token()
    for cfg in IMPORTS:
        if not cfg["xlsx"].exists():
            raise SystemExit(f"Missing file: {cfg['xlsx']}")
        import_one(token, cfg)
    print("\nDone.")


if __name__ == "__main__":
    main()
