#!/usr/bin/env python3
"""Rewrite Firestore team_id texas -> houston on profiles and shops."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

TOKEN_PATH = "/Users/ganyifei/.config/configstore/firebase-tools.json"
PROJECT = "vozol-orlando-management"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
OAUTH_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"


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


def list_all(token, path):
    docs = []
    url = f"{BASE}/{path}?pageSize=300"
    while url:
        payload = request("GET", url, token)
        docs.extend(payload.get("documents") or [])
        page = payload.get("nextPageToken")
        if not page:
            break
        url = f"{BASE}/{path}?pageSize=300&pageToken={urllib.parse.quote(page)}"
    return docs


def field_str(doc, key, default=""):
    value = (doc.get("fields") or {}).get(key) or {}
    return value.get("stringValue", default)


def doc_id(doc):
    return doc.get("name", "").split("/")[-1]


def patch_team(token, doc_name, *, also_area=False):
    fields = {"team_id": {"stringValue": "houston"}}
    mask = ["team_id"]
    if also_area:
        fields["area_id"] = {"stringValue": "houston"}
        mask.append("area_id")
    query = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(path)}" for path in mask)
    request(
        "PATCH",
        f"{BASE.split('/documents')[0]}/documents/{doc_name.split('/documents/', 1)[-1]}?{query}"
        if "/documents/" in doc_name
        else f"{doc_name}?{query}",
        token,
        {"fields": fields},
    )


def patch_doc(token, doc, *, also_area=False):
    name = doc["name"]
    # name like projects/.../documents/profiles/uid
    relative = name.split("/documents/", 1)[-1]
    fields = {"team_id": {"stringValue": "houston"}}
    mask = ["team_id"]
    if also_area:
        fields["area_id"] = {"stringValue": "houston"}
        mask.append("area_id")
    query = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(path)}" for path in mask)
    request("PATCH", f"{BASE}/{relative}?{query}", token, {"fields": fields})


def is_texas(value: str) -> bool:
    key = (value or "").strip().lower().replace("-", "_")
    return key in {"texas", "tx"}


def main():
    token = load_token()
    profiles = list_all(token, "profiles")
    print(f"Profiles: {len(profiles)}")
    texas_profiles = []
    for profile in profiles:
        team = field_str(profile, "team_id")
        if is_texas(team):
            texas_profiles.append(profile)
            print(f"  profile {doc_id(profile)} | {field_str(profile, 'full_name')} | {team}")

    for profile in texas_profiles:
        patch_doc(token, profile, also_area=True)
        print(f"  updated profile {doc_id(profile)} -> houston")

    # Nested shops under every profile
    shop_updates = 0
    for profile in profiles:
        uid = doc_id(profile)
        shops = list_all(token, f"profiles/{uid}/shops")
        for shop in shops:
            team = field_str(shop, "team_id")
            if is_texas(team):
                patch_doc(token, shop, also_area=True)
                shop_updates += 1
                print(f"  updated shop profiles/{uid}/shops/{doc_id(shop)} -> houston")

    # Legacy top-level shops
    try:
        legacy = list_all(token, "shops")
    except RuntimeError:
        legacy = []
    for shop in legacy:
        team = field_str(shop, "team_id")
        if is_texas(team):
            patch_doc(token, shop, also_area=True)
            shop_updates += 1
            print(f"  updated legacy shop {doc_id(shop)} -> houston")

    print(f"Done. profiles={len(texas_profiles)} shops={shop_updates}")


if __name__ == "__main__":
    main()
