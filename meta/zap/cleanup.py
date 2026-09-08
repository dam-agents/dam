#!/usr/bin/env python3
"""Delete the folders, skill sets and skill sources the ZAP scan created under the zap user on dam-dev."""
import json, ssl, urllib.parse, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
BASE = "https://dam-dev.apps.dam-cl.fmaas.res.ibm.com/api/trpc/"
TOKEN_URL = "https://keycloak-dam-dev.apps.dam-cl.fmaas.res.ibm.com/realms/platform/protocol/openid-connect/token"

def token():
    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "platform-ui", "username": "zap", "password": "zap", "scope": "openid"}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(TOKEN_URL, body), context=ctx))["access_token"]

tok = token()

def call(proc, inp=None, post=False):
    global tok
    url = BASE + proc + ("" if inp is None or post else "?input=" + urllib.parse.quote(json.dumps(inp)))
    req = urllib.request.Request(url, data=json.dumps(inp).encode() if post else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, context=ctx))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            tok = token(); return call(proc, inp, post)
        return {"error": e.code, "body": e.read()[:120].decode()}

for lst, dele in (("artifactLibrary.listFolders", "artifactLibrary.deleteFolder"),
                  ("skills.sets.list", "skills.sets.delete"),
                  ("skills.sources.list", "skills.sources.delete")):
    items = call(lst)["result"]["data"]
    failed = [(it.get("name"), call(dele, {"id": it["id"]}, post=True)) for it in items]
    failed = [f for f in failed if "error" in f[1]]
    print(f"{lst}: {len(items) - len(failed)} deleted, {len(failed)} failed, {len(call(lst)['result']['data'])} remaining", failed[:2])
