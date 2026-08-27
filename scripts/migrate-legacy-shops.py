#!/usr/bin/env python3
"""Move leftover top-level /shops docs into profiles/{uid}/shops."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
FALLBACK_UID = "34dtw6D0pjVJuEJpK7YHQpbSSVy2"  # Yifei Gan


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


def list_all(token, path):
    docs = []
    url = f"{BASE}/{path}?pageSize=300"
    while url:
        payload = request("GET", url, token)
        docs.extend(payload.get("documents") or [])
        token_page = payload.get("nextPageToken")
        if not token_page:
            break
        url = f"{BASE}/{path}?pageSize=300&pageToken={token_page}"
    return docs


def field_str(doc, key, default=""):
    value = (doc.get("fields") or {}).get(key) or {}
    return value.get("stringValue", default)


def doc_id(doc):
    return doc.get("name", "").split("/")[-1]


def parent_shop_id_from_visit(doc):
    # .../documents/shops/{shopId}/visits/{visitId}
    parts = doc.get("name", "").split("/")
    try:
        i = parts.index("shops")
        return parts[i + 1]
    except (ValueError, IndexError):
        return ""


def main():
    token = load_token()
    profiles = {doc_id(p): p for p in list_all(token, "profiles")}
    print("Profiles:", len(profiles))
    for uid, p in profiles.items():
        print(f"  {uid} | {field_str(p, 'full_name')} | {field_str(p, 'team_id')}")

    shops = list_all(token, "shops")
    print(f"\nTop-level shops: {len(shops)}")

    owner_counts = {}
    writes_by_owner = {}
    deletes = []
    visit_moves = 0
    already = 0
    missing_owner = 0

    for shop in shops:
        sid = doc_id(shop)
        assigned = field_str(shop, "assigned_to")
        team = field_str(shop, "team_id") or "orlando"
        name = field_str(shop, "name")
        owner = assigned if assigned in profiles else FALLBACK_UID
        if assigned not in profiles:
            missing_owner += 1
        owner_counts[owner] = owner_counts.get(owner, 0) + 1
        dest = f"{BASE}/profiles/{owner}/shops/{sid}"
        dest_doc = None
        try:
            dest_doc = request("GET", dest, token)
        except RuntimeError as exc:
            if "404" not in str(exc):
                raise
        visits = []
        try:
            visits = list_all(token, f"shops/{sid}/visits")
        except RuntimeError as exc:
            if "404" not in str(exc):
                raise

        if not dest_doc:
            writes_by_owner.setdefault(owner, []).append({
                "update": {
                    "name": dest.replace(BASE + "/", f"projects/{PROJECT}/databases/(default)/documents/"),
                    "fields": {
                        **(shop.get("fields") or {}),
                        "assigned_to": {"stringValue": owner},
                        "team_id": {"stringValue": team},
                    },
                }
            })
            for visit in visits:
                vid = doc_id(visit)
                writes_by_owner[owner].append({
                    "update": {
                        "name": f"projects/{PROJECT}/databases/(default)/documents/profiles/{owner}/shops/{sid}/visits/{vid}",
                        "fields": visit.get("fields") or {},
                    }
                })
                visit_moves += 1
        else:
            already += 1
            visit_moves += len(visits)

        for visit in visits:
            deletes.append({"delete": visit.get("name")})
        deletes.append({"delete": shop.get("name")})
        print(f"  {sid[:8]}… {name} -> {field_str(profiles[owner], 'full_name')} ({owner[:6]}…) assigned={assigned or '-'} visits={len(visits)}")

    print("\nMove plan:")
    for owner, count in owner_counts.items():
        print(f"  {field_str(profiles[owner], 'full_name')}: {count} shops")
    print(f"  already in place: {already}")
    print(f"  missing/invalid assigned_to (fallback Yifei): {missing_owner}")
    print(f"  visits to copy: {visit_moves}")
    print(f"  top-level deletes: {len(deletes)}")

    all_writes = [w for chunk in writes_by_owner.values() for w in chunk]
    commit_url = f"{BASE}:commit"

    for start in range(0, len(all_writes), 400):
        chunk = all_writes[start:start + 400]
        request("POST", commit_url, token, {"writes": chunk})
        print(f"Wrote {start + 1}-{start + len(chunk)}")

    for start in range(0, len(deletes), 400):
        chunk = deletes[start:start + 400]
        request("POST", commit_url, token, {"writes": chunk})
        print(f"Deleted {start + 1}-{start + len(chunk)}")

    leftover = list_all(token, "shops")
    print(f"\nTop-level shops after: {len(leftover)}")
    for uid, p in profiles.items():
        owned = list_all(token, f"profiles/{uid}/shops")
        print(f"  profiles/{field_str(p, 'full_name')}/shops: {len(owned)}")


if __name__ == "__main__":
    main()
