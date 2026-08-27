#!/usr/bin/env python3
"""One-off import of Tampa colleague shop CSV into Firestore."""

from __future__ import annotations

import csv
import json
import re
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone

CSV_PATH = "/Users/ganyifei/Desktop/非常重要的东西/vozol-shop-tracker/Supabase Snippet Untitled query.csv"
TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
OWNER_UID = "9TOUJ9cnhXYb6d3ICHhcEbIJY1C2"
TEAM_ID = "tampa"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def blank(value):
    text = "" if value is None else str(value).strip()
    if text.lower() in ("", "null", "none"):
        return ""
    return text


def as_bool(value):
    text = blank(value).lower()
    return text in ("true", "1", "yes")


def as_int(value, default=0):
    text = blank(value)
    if not text:
        return default
    try:
        return int(float(text))
    except ValueError:
        return default


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


def sval(v):
    return {"stringValue": v}


def bval(v):
    return {"booleanValue": bool(v)}


def nval():
    return {"nullValue": None}


def ival(v):
    return {"integerValue": str(int(v))}


def tsval(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return {"timestampValue": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def parse_chain(texts):
    blob = "；".join(t for t in texts if t)
    is_chain = bool(re.search(r"连锁|两家店", blob))
    total = None
    match = re.search(r"(\d+)\s*家连锁", blob)
    if match:
        total = int(match.group(1))
    else:
        match = re.search(r"连锁大概\s*(\d+)\s*/\s*(\d+)\s*家", blob)
        if match:
            total = int(match.group(2))
        elif re.search(r"两家店|两家连锁", blob):
            total = 2
        elif "三家连锁" in blob:
            total = 3
    return is_chain, total


def has_sample(text):
    if not text:
        return False
    lower = text.lower()
    if "样机" in text or "试用品" in text:
        return True
    return "sample" in lower


def distributor_from(texts):
    blob = " ".join(t for t in texts if t).lower()
    if "7 star" in blob or "7-star" in blob:
        return "7 Star"
    if "孔雀" in blob:
        return "孔雀 wholesale"
    return ""


def visit_dt(date_str):
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=16, minute=0, tzinfo=timezone.utc)


def load_rows():
    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def group_shops(rows):
    shops = OrderedDict()
    for row in rows:
        shop_id = blank(row.get("shop_id"))
        if not shop_id:
            continue
        shop = shops.setdefault(
            shop_id,
            {
                "id": shop_id,
                "name": blank(row.get("shop_name")),
                "address": blank(row.get("address")),
                "city": blank(row.get("city")),
                "visits": [],
            },
        )
        date = blank(row.get("visit_date"))
        feedback = blank(row.get("feedback"))
        decision = blank(row.get("decision_maker"))
        restock = blank(row.get("restock_status"))
        next_plan = blank(row.get("next_plan"))
        placed = as_bool(row.get("test_case_placed"))
        if not date and not feedback and not decision and not restock and not next_plan and not placed:
            continue
        shop["visits"].append(
            {
                "date": date or "",
                "units": as_int(row.get("units"), 0),
                "note": feedback,
                "decision_maker": decision,
                "restock_status": restock,
                "test_case_placed": placed,
                "next_plan": next_plan,
            }
        )
    return shops


def shop_fields(shop):
    visits = shop["visits"]
    latest = visits[-1] if visits else {}
    notes = [v["note"] for v in visits if v.get("note")]
    if len(notes) > 1:
        traffic = "\n".join(
            f"[{v['date']}] {v['note']}" if v.get("date") else v["note"]
            for v in visits
            if v.get("note")
        )
    else:
        traffic = notes[0] if notes else ""

    next_plan = next((v["next_plan"] for v in reversed(visits) if v.get("next_plan")), "")
    owner = next((v["decision_maker"] for v in reversed(visits) if v.get("decision_maker")), "")
    restock = next((v["restock_status"] for v in reversed(visits) if v.get("restock_status")), "")
    test_case = any(v.get("test_case_placed") for v in visits)
    sample = any(has_sample(v.get("note", "")) for v in visits)
    is_chain, chain_total = parse_chain(notes)
    distributor = distributor_from(
        [restock, next_plan] + [v.get("note", "") for v in visits] + [v.get("restock_status", "") for v in visits]
    )

    if not visits:
        status = "not_visited"
    elif next_plan:
        status = "follow_up"
    else:
        status = "visited"

    now = datetime.now(timezone.utc)
    if visits and visits[-1].get("date"):
        updated = visit_dt(visits[-1]["date"])
        created = visit_dt(visits[0]["date"]) if visits[0].get("date") else updated
    else:
        created = updated = now

    fields = {
        "name": sval(shop["name"]),
        "address": sval(shop["address"]),
        "city": sval(shop["city"]),
        "phone": sval(""),
        "tier": sval(""),
        "status": sval(status),
        "is_chain": bval(is_chain),
        "chain_name": sval(""),
        "chain_total_stores": ival(chain_total) if chain_total else nval(),
        "staff_contact": sval(""),
        "owner_name": sval(owner),
        "owner_schedule": sval(""),
        "contact_role": sval(""),
        "store_number": sval(""),
        "restock_status": sval(restock),
        "distributor": sval(distributor),
        "test_case_placed": bval(test_case),
        "sample_placed": bval(sample),
        "traffic_note": sval(traffic),
        "brands_note": sval(""),
        "next_plan": sval(next_plan),
        "next_plan_date": sval(""),
        "next_plan_time": sval(""),
        "source_url": sval(""),
        "starred": bval(False),
        "team_id": sval(TEAM_ID),
        "assigned_to": sval(OWNER_UID),
        "created_at": tsval(created),
        "updated_at": tsval(updated),
    }
    return fields, created


def visit_fields(visit, created):
    return {
        "date": sval(visit["date"]),
        "units": ival(visit["units"]),
        "note": sval(visit["note"]),
        "decision_maker": sval(visit["decision_maker"]),
        "restock_status": sval(visit["restock_status"]),
        "test_case_placed": bval(visit["test_case_placed"]),
        "next_plan": sval(visit["next_plan"]),
        "created_at": tsval(created if visit["date"] else datetime.now(timezone.utc)),
    }


def doc_name(*parts):
    return f"projects/{PROJECT}/databases/(default)/documents/" + "/".join(parts)


def main():
    token = load_token()
    profile = request("GET", f"{BASE}/profiles/{OWNER_UID}", token)
    team = ((profile.get("fields") or {}).get("team_id") or {}).get("stringValue")
    name = ((profile.get("fields") or {}).get("full_name") or {}).get("stringValue")
    if team:
        global TEAM_ID
        TEAM_ID = team
    print(f"Owner: {name} ({OWNER_UID}) team={TEAM_ID}")

    existing = request("GET", f"{BASE}/profiles/{OWNER_UID}/shops?pageSize=300", token)
    existing_docs = existing.get("documents") or []
    print(f"Existing shops before import: {len(existing_docs)}")

    shops = group_shops(load_rows())
    writes = []
    visited = 0
    follow = 0
    samples = 0
    cases = 0
    visit_count = 0

    for shop in shops.values():
        fields, created = shop_fields(shop)
        status = fields["status"]["stringValue"]
        if status == "visited":
            visited += 1
        elif status == "follow_up":
            follow += 1
        if fields["sample_placed"]["booleanValue"]:
            samples += 1
        if fields["test_case_placed"]["booleanValue"]:
            cases += 1
        writes.append({
            "update": {
                "name": doc_name("profiles", OWNER_UID, "shops", shop["id"]),
                "fields": fields,
            }
        })
        for index, visit in enumerate(shop["visits"]):
            visit_count += 1
            vid = f"{visit['date'] or 'undated'}_{index}"
            writes.append({
                "update": {
                    "name": doc_name("profiles", OWNER_UID, "shops", shop["id"], "visits", vid),
                    "fields": visit_fields(visit, visit_dt(visit["date"]) if visit["date"] else created),
                }
            })

    print(
        f"Will write {len(shops)} shops, {visit_count} visits "
        f"({visited} visited, {follow} follow-up, {len(shops) - visited - follow} not visited, "
        f"{cases} test case, {samples} sample)"
    )
    print(f"Commit writes: {len(writes)}")

    # Firestore commit limit is 500
    for start in range(0, len(writes), 400):
        chunk = writes[start:start + 400]
        request("POST", f"{BASE}:commit", token, {"writes": chunk})
        print(f"Committed {start + 1}-{start + len(chunk)}")

    after = request("GET", f"{BASE}/profiles/{OWNER_UID}/shops?pageSize=300", token)
    print(f"Shops after import: {len(after.get('documents') or [])}")


if __name__ == "__main__":
    main()
