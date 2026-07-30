#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUD_PORT="${HUD_PORT:-17491}"
MOCK_MAT_PORT="${MOCK_MAT_PORT:-18491}"
TOKEN="${MAT_HUD_TOKEN:-fixture-token}"
TMP_DIR="$(mktemp -d /tmp/jts-mat-integration-XXXXXX)"
APP_PID=""
MOCK_PID=""
GSI_LISTENER_PID=""
cleanup() {
  if [[ -n "$GSI_LISTENER_PID" ]]; then kill "$GSI_LISTENER_PID" 2>/dev/null || true; fi
  if [[ -n "$APP_PID" ]]; then
    kill -- "-$APP_PID" 2>/dev/null || true
    sleep 0.5
    kill -KILL -- "-$APP_PID" 2>/dev/null || true
  fi
  if [[ -n "$MOCK_PID" ]]; then kill "$MOCK_PID" 2>/dev/null || true; fi
  wait "$APP_PID" 2>/dev/null || true
  wait "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

cd "$ROOT"
MAT_HUD_TOKEN="$TOKEN" MOCK_MAT_PORT="$MOCK_MAT_PORT" \
  node scripts/mock-mat-server.cjs >"$TMP_DIR/mock.log" 2>&1 &
MOCK_PID=$!

setsid env XDG_CONFIG_HOME="$TMP_DIR/config" HUD_PORT="$HUD_PORT" GSI_PORT="$((HUD_PORT + 1))" \
  MAT_HUD_TOKEN="$TOKEN" MAT_HUD_URL="http://127.0.0.1:$MOCK_MAT_PORT" \
  xvfb-run -a ./node_modules/.bin/electron . --no-sandbox \
  >"$TMP_DIR/electron.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 80); do
  if curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings" >/dev/null

curl -fsS -X PUT "http://127.0.0.1:$HUD_PORT/api/settings/mat" \
  -H 'Origin: http://localhost:1349' \
  -H 'Content-Type: application/json' \
  --data "{\"enabled\":true,\"url\":\"http://127.0.0.1:$MOCK_MAT_PORT\",\"pollIntervalSeconds\":2}" \
  >"$TMP_DIR/mat-settings.json"

curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings/mat/status" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.state!=='connected'||v.currentMatchSlug!=='bebra-vs-fox')throw new Error(JSON.stringify(v))})"

test_override_status="$(curl -sS -o "$TMP_DIR/test-override.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$HUD_PORT/api/settings/mat/test" \
  -H 'Content-Type: application/json' \
  --data '{"url":"http://127.0.0.1:9"}')"
if [[ "$test_override_status" != '400' ]] || ! grep -q 'Enter a token' "$TMP_DIR/test-override.json"; then
  echo 'Saved MAT token could be used with a caller-provided test URL' >&2
  exit 1
fi
url_override_status="$(curl -sS -o "$TMP_DIR/url-override.json" -w '%{http_code}' \
  -X PUT "http://127.0.0.1:$HUD_PORT/api/settings/mat" \
  -H 'Content-Type: application/json' \
  --data '{"url":"http://127.0.0.1:9"}')"
if [[ "$url_override_status" != '400' ]] || ! grep -q 'MAT_HUD_TOKEN' "$TMP_DIR/url-override.json"; then
  echo 'Environment MAT token could be redirected to a caller-provided URL' >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:$HUD_PORT/api/teams" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.length!==2||v[0].shortName!=='BEBRA'||v[0].country!=='LT')throw new Error(JSON.stringify(v))})"

logo_redirect="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' \
  "http://127.0.0.1:$HUD_PORT/api/teams/logo/team-a")"
if [[ "$logo_redirect" != "302 http://127.0.0.1:$MOCK_MAT_PORT/assets/bebra.webp" ]]; then
  echo "Default HUD logo endpoint did not redirect to the MAT asset: $logo_redirect" >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:$HUD_PORT/api/players?steamids=76561198000000001" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v[0]?.username!=='aurum'||v[0]?.firstName!=='Aurimas'||!v[0]?.avatar.endsWith('aurum.webp'))throw new Error(JSON.stringify(v))})"

curl -fsS "http://127.0.0.1:$HUD_PORT/api/match/current" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);const cache=v.vetos.find(x=>x.mapName==='de_cache');if(v.matchType!=='bo3'||v.left.wins!==1||v.right.wins!==0||cache?.score?.['team-a']!==13||cache?.winner!=='team-a')throw new Error(JSON.stringify(v))})"

curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if('matTokenEncrypted' in v||'token' in v)throw new Error('MAT token leaked from settings response')})"

GSI_READY_FILE="$TMP_DIR/gsi-socket-ready"
node "$ROOT/scripts/wait-for-gsi-event.cjs" \
  "http://127.0.0.1:$HUD_PORT" "$GSI_READY_FILE" &
GSI_LISTENER_PID=$!
for _ in $(seq 1 40); do
  [[ -f "$GSI_READY_FILE" ]] && break
  sleep 0.1
done
if [[ ! -f "$GSI_READY_FILE" ]]; then
  echo 'JTs-Hud GSI test socket did not become ready' >&2
  exit 1
fi
curl -fsS -X POST "http://127.0.0.1:$((HUD_PORT + 1))/cs2/input" \
  -H 'Content-Type: application/json' \
  --data-binary "@$ROOT/scripts/fixtures/gsi-live.json" >/dev/null
wait "$GSI_LISTENER_PID"
GSI_LISTENER_PID=""
curl -fsS "http://127.0.0.1:$HUD_PORT/api/match/current" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);if(m.left.wins!==1||m.right.wins!==0)throw new Error('GSI overwrote MAT series score')})"

write_status="$(curl -sS -o "$TMP_DIR/write-block.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$HUD_PORT/api/teams" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Must Not Persist","country":"LT","shortName":"NO","logo":"","extra":{}}')"
if [[ "$write_status" != '400' ]] || ! grep -q 'read-only' "$TMP_DIR/write-block.json"; then
  echo "Expected MAT mode to reject local writes, got HTTP $write_status" >&2
  cat "$TMP_DIR/write-block.json" >&2
  exit 1
fi

kill "$MOCK_PID"
wait "$MOCK_PID" 2>/dev/null || true
MOCK_PID=""
stale_seen=false
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings/mat/status" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(JSON.parse(s).state==='stale'?0:1))"; then
    stale_seen=true
    break
  fi
  sleep 0.25
done
if [[ "$stale_seen" != true ]]; then
  echo 'MAT integration did not enter stale state after the REST source stopped' >&2
  exit 1
fi
curl -fsS "http://127.0.0.1:$HUD_PORT/api/teams" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.length!==2)throw new Error('MAT cache was lost while offline')})"

MAT_HUD_TOKEN="$TOKEN" MOCK_MAT_PORT="$MOCK_MAT_PORT" \
  node scripts/mock-mat-server.cjs >>"$TMP_DIR/mock.log" 2>&1 &
MOCK_PID=$!
connected_again=false
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings/mat/status" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(JSON.parse(s).state==='connected'?0:1))"; then
    connected_again=true
    break
  fi
  sleep 0.25
done
if [[ "$connected_again" != true ]]; then
  echo 'MAT integration did not recover after the REST source returned' >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:$MOCK_MAT_PORT/__delay-next?ms=1500" >/dev/null
curl -fsS -X POST "http://127.0.0.1:$HUD_PORT/api/settings/mat/refresh" \
  >"$TMP_DIR/racing-refresh.json" &
RACING_REFRESH_PID=$!
sleep 0.2
curl -fsS -X PUT "http://127.0.0.1:$HUD_PORT/api/settings/mat" \
  -H 'Origin: http://localhost:1349' \
  -H 'Content-Type: application/json' \
  --data '{"enabled":false}' >/dev/null
wait "$RACING_REFRESH_PID" 2>/dev/null || true
sleep 1.5

curl -fsS "http://127.0.0.1:$HUD_PORT/api/settings/mat/status" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.state!=='disabled')throw new Error('In-flight refresh resurrected MAT after disable')})"

curl -fsS "http://127.0.0.1:$HUD_PORT/api/teams" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);if(v.length!==0)throw new Error('Standalone fallback did not restore local teams')})"

printf 'JTs MAT integration passed: Bearer fetch, profiles, veto, BO3 1:0, GSI live data, token isolation, offline cache/recovery, read-only mode and standalone fallback\n'
