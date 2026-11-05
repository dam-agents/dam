import json
import pathlib
import sys

UNITS = {"usd", "usd_list", "bobcoin", "free"}
KINDS = {"cut", "useful", "unknown"}
ACTIONS = {"fix", "how"}

if len(sys.argv) != 3:
    sys.exit("usage: fill-report.py report.json report.html")

template_path = pathlib.Path(__file__).resolve().parent / "report.html"
out_path = pathlib.Path(sys.argv[2])
if out_path.resolve() == template_path:
    sys.exit("fill-report.py: write the report somewhere else than the template")

data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
problems = []


def amount(value, where):
    if not isinstance(value, dict):
        problems.append(f"{where}: needs {{\"unit\", \"amount\"}}")
        return
    if value.get("unit") not in UNITS:
        problems.append(f"{where}.unit: one of {sorted(UNITS)}")
    if isinstance(value.get("amount"), bool) or not isinstance(value.get("amount"), (int, float)):
        problems.append(f"{where}.amount: a number in whole units")


if not isinstance(data, dict):
    sys.exit("report.json: the top level must be an object")
for key in ("agent", "window", "headline", "summary"):
    if not isinstance(data.get(key), str) or not data[key].strip():
        problems.append(f"{key}: a non-empty string")
for i, change in enumerate(data.get("changes") or []):
    where = f"changes[{i}]"
    if not isinstance(change, dict) or not change.get("title"):
        problems.append(f"{where}.title: missing")
        continue
    if "saving" in change:
        amount(change["saving"], f"{where}.saving")
    if change.get("action") is not None:
        if change["action"] not in ACTIONS:
            problems.append(f"{where}.action: one of {sorted(ACTIONS)}, or leave it out")
        if not isinstance(change.get("prompt"), str) or not change["prompt"].strip():
            problems.append(f"{where}.prompt: the message its button sends")
if data.get("total") is not None:
    for part in ("saving", "from", "to"):
        amount((data["total"] or {}).get(part), f"total.{part}")
for i, bucket in enumerate(data.get("buckets") or []):
    amount(bucket, f"buckets[{i}]")
    if isinstance(bucket, dict) and bucket.get("kind") not in KINDS:
        problems.append(f"buckets[{i}].kind: one of {sorted(KINDS)}")
for i, run in enumerate(data.get("runs") or []):
    amount(run.get("cost") if isinstance(run, dict) else None, f"runs[{i}].cost")
if problems:
    sys.exit("report.json:\n  " + "\n  ".join(problems))

template = template_path.read_text(encoding="utf-8")
marker = '<script type="application/json" id="report-data">{}</script>'
payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
page = template.replace(marker, f'<script type="application/json" id="report-data">{payload}</script>')
out_path.write_text(page, encoding="utf-8")
print(f"wrote {out_path}")
