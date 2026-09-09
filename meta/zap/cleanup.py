#!/usr/bin/env python3
"""Delete what a scan run created under the zap user on dam-dev, in the three
collections a run is known to fill: artifact folders, skill sets, skill sources.

An item is deleted when it carries a marker of the scan: a field equal to one
of the enumerator's sample literals (the active scanner mutates one field per
request, so every created item keeps at least one), or a createdAt at or after
the run start (reports/started-at, written by scan.sh, or --since ISO-8601).
Anything else in those collections is listed and left alone. --all empties the
three collections instead. Other kinds the seed list can create (agents,
schedules, connections, API keys, ...) have so far always been rejected at
validation or ownership checks; inspect them by hand if a run changes that.
"""
import json, ssl, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
BASE = "https://dam-dev.apps.dam-cl.fmaas.res.ibm.com/api/trpc/"
TOKEN_URL = "https://keycloak-dam-dev.apps.dam-cl.fmaas.res.ibm.com/realms/platform/protocol/openid-connect/token"
SAMPLE_LITERALS = {"zap", "zap-1", "ZAP", "https://example.com/zap", "/zap"}  # keep in step with enumerate.mts

wipe_all = "--all" in sys.argv
since = None
if not wipe_all:
    if "--since" in sys.argv:
        since_text = sys.argv[sys.argv.index("--since") + 1]
    else:
        started = Path(__file__).with_name("reports") / "started-at"
        since_text = started.read_text().strip() if started.exists() else sys.exit("no reports/started-at; pass --since ISO-8601 or --all")
    since = datetime.fromisoformat(since_text.replace("Z", "+00:00")).astimezone(timezone.utc)

def token():
    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "platform-ui", "username": "zap", "password": "zap", "scope": "openid"}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, body), context=ctx) as r:
        return json.load(r)["access_token"]

tok = token()

def call(proc, inp=None, post=False):
    global tok
    url = BASE + proc + ("" if inp is None or post else "?input=" + urllib.parse.quote(json.dumps(inp)))
    req = urllib.request.Request(url, data=json.dumps(inp).encode() if post else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=ctx) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            tok = token(); return call(proc, inp, post)
        return {"error": e.code, "body": e.read()[:120].decode()}

def from_scan(item):
    if wipe_all or any(v in SAMPLE_LITERALS for v in item.values() if isinstance(v, str)):
        return True
    created = item.get("createdAt")
    return bool(created) and datetime.fromisoformat(created.replace("Z", "+00:00")).astimezone(timezone.utc) >= since

for lst, dele in (("artifactLibrary.listFolders", "artifactLibrary.deleteFolder"),
                  ("skills.sets.list", "skills.sets.delete"),
                  ("skills.sources.list", "skills.sources.delete")):
    items = call(lst)["result"]["data"]
    mine = [it for it in items if from_scan(it)]
    kept = [it for it in items if it not in mine]
    failed = [(it.get("name"), r) for it in mine if "error" in (r := call(dele, {"id": it["id"]}, post=True))]
    print(f"{lst}: {len(mine) - len(failed)} deleted, {len(failed)} failed, {len(kept)} not from the scan and kept", failed[:2])
    for it in kept:
        print(f"  kept: {it.get('name')!r} ({it['id']})")
