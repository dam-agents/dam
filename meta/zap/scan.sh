#!/usr/bin/env bash
# Headless ZAP scan of DAM dev. Usage: ./scan.sh [crawl|api|active ...]  (default: all three, in order)
# Requires: /Applications/ZAP.app, Playwright chromium (~/Library/Caches/ms-playwright), chromedriver matching its major version under ./browsers.
# Reports land in ./reports (gitignored); the plans read the directory from ZAP_REPORT_DIR.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
export ZAP_REPORT_DIR="$PWD/reports"
Z=http://127.0.0.1:8090
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
CHROMEDRIVER=$(find "$PWD/browsers" -type f -name chromedriver | head -1)

# Regenerate the tRPC request seed list from the router.
mise exec -- pnpm --dir "$REPO" --filter api-server exec tsx "$REPO/meta/zap/enumerate.mts" > procedures.json
python3 gen-requests.py

if ! curl -s -m 2 "$Z/JSON/core/view/version/" >/dev/null; then
  mkdir -p sessions
  nohup /Applications/ZAP.app/Contents/Java/zap.sh -daemon -port 8090 -dir "$PWD/zaphome" \
    -newsession "$PWD/sessions/dam-dev-$(date +%Y%m%d-%H%M)" \
    -config api.disablekey=true -config api.addrs.addr.name=127.0.0.1 -config api.addrs.addr.regex=false \
    -config "selenium.chromeBinary=$CHROME" -config "selenium.chromeDriver=$CHROMEDRIVER" > zap-daemon.log 2>&1 &
  until curl -s -m 2 "$Z/JSON/core/view/version/" | grep -q version; do sleep 2; done
fi

plans=("$@"); [ ${#plans[@]} -eq 0 ] && plans=(crawl api active)
for plan in "${plans[@]}"; do
  # The API answers the version view before the automation add-on is ready; retry until a plan id comes back.
  until id=$(curl -s "$Z/JSON/automation/action/runPlan/?filePath=$PWD/$plan.yaml" | python3 -c 'import json,sys; print(json.load(sys.stdin)["planId"])' 2>/dev/null); do sleep 3; done
  echo "== $plan.yaml (plan $id)"
  until curl -s -m 5 "$Z/JSON/automation/view/planProgress/?planId=$id" | grep -q '"finished": *"20'; do sleep 15; done
  curl -s "$Z/JSON/automation/view/planProgress/?planId=$id" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(d["info"])); print("WARN",d["warn"]); print("ERR",d["error"])'
done
echo "reports: $PWD/reports"
