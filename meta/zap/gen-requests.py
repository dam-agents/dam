import json, urllib.parse
p = json.load(open("procedures.json"))
base = "https://dam-dev.apps.dam-cl.fmaas.res.ibm.com/api/trpc/"
# e2e.* are test hooks, applyPreset mutates cluster-wide egress config, subscriptions are WS-only.
skip = lambda x: x["path"].startswith("e2e.") or x["path"] == "egressRules.applyPreset" or x["type"] == "subscription"
lines = ["  - type: requestor", "    parameters:", "      user: zap", "    requests:"]
n = 0
for x in p:
    if skip(x): continue
    inp = json.dumps(x.get("input")) if "input" in x else None
    if x["type"] == "query":
        url = base + x["path"] + (f"?input={urllib.parse.quote(inp, safe='')}" if inp else "")
        lines += [f"      - url: {json.dumps(url)}", "        method: GET", "        name: " + x["path"]]
    else:
        lines += [f"      - url: {json.dumps(base + x['path'])}", "        method: POST", "        name: " + x["path"],
                  '        headers: ["Content-Type: application/json"]', f"        data: {json.dumps(inp or '{}')}"]
    n += 1
api = open("api.yaml").read()
head, _, tail = api.partition("  - type: requestor")
tail = tail[tail.index("  - type: passiveScan-wait"):]
open("api.yaml", "w").write(head + "\n".join(lines) + "\n" + tail)
print("requests:", n)
