#!/usr/bin/env bash
# scripts/update-alpaca-keys.sh
# Prompts for Alpaca paper key + secret silently, writes them to .env,
# recreates the api container, probes /api/alpaca/account.
#
# Run with:  bash scripts/update-alpaca-keys.sh
#
# What you type at each prompt does NOT echo to the screen and is NOT
# saved to your shell history.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $ROOT"
  exit 1
fi

echo "Paste your Alpaca paper key + secret. Nothing will appear on screen."
echo ""

read -rs -p "Alpaca paper KEY (starts with PK):     " K
echo
read -rs -p "Alpaca paper SECRET (40 random chars): " S
echo
echo ""

KLEN=${#K}
SLEN=${#S}
echo "Key length:    $KLEN  (must be 20)"
echo "Secret length: $SLEN  (must be 40)"

if [ "$KLEN" -ne 20 ] || [ "$SLEN" -ne 40 ]; then
  echo ""
  echo "Wrong length. Aborted. The two values you pasted are not a valid"
  echo "Alpaca paper key+secret pair. Generate fresh keys at"
  echo "  https://app.alpaca.markets/paper/dashboard/overview"
  echo "and re-run this script."
  unset K S
  exit 1
fi

# Validate the key starts with PK (paper) — live keys won't work here
case "$K" in
  PK*) ;;
  AK*)
    echo ""
    echo "WARNING: Key starts with 'AK' (live trading key)."
    echo "This system is configured for PAPER mode. Use a paper key (starts with PK)."
    echo "Get one at https://app.alpaca.markets/paper/dashboard/overview"
    unset K S
    exit 1
    ;;
  *)
    echo ""
    echo "WARNING: Key doesn't start with 'PK'. Real Alpaca paper keys always start with PK."
    echo "Are you sure that's the right key? Aborting to be safe."
    unset K S
    exit 1
    ;;
esac

# Backup .env before touching it
BAK=".env.bak.$(date +%s)"
cp .env "$BAK"
echo "Backed up .env to $BAK"

# Replace the two lines via sed (macOS BSD sed needs '' as first arg)
sed -i '' "s|^ALPACA_API_KEY=.*|ALPACA_API_KEY=${K}|" .env
sed -i '' "s|^ALPACA_SECRET_KEY=.*|ALPACA_SECRET_KEY=${S}|" .env

# Wipe variables from this shell immediately
unset K S

echo ""
echo "── Prefixes after edit (first 4 chars only) ──"
grep -E "^ALPACA_(API_KEY|SECRET_KEY)=" .env | sed -E 's/=(.{4}).*/=\1.../'

echo ""
echo "── Recreating api container so it loads new env ──"
docker compose up -d --no-deps --force-recreate api > /dev/null 2>&1

# Wait for the api container to settle (handshake takes a few seconds)
for i in 1 2 3 4 5 6 7 8 9 10; do
  HC=$(docker compose ps api 2>/dev/null | grep -c "healthy" || echo 0)
  if [ "$HC" -gt 0 ]; then
    echo "  api container healthy"
    break
  fi
  sleep 1
done

# Auth-cooldown can persist briefly. Wait once more then probe.
sleep 3

echo ""
echo "── /api/alpaca/account ──"
HTTP=$(curl -sS -o /tmp/gv-alpaca-resp.json -w "%{http_code}" http://localhost/api/alpaca/account)
echo "HTTP: $HTTP"
if command -v jq >/dev/null 2>&1; then
  jq '{status, equity, buying_power, cash, account_number}' /tmp/gv-alpaca-resp.json 2>/dev/null \
    || cat /tmp/gv-alpaca-resp.json
else
  cat /tmp/gv-alpaca-resp.json
fi
rm -f /tmp/gv-alpaca-resp.json

echo ""
case "$HTTP" in
  200)
    echo "✅ Alpaca authenticated. Done."
    ;;
  503|401)
    echo "⚠️  Still failing. Two options:"
    echo "   1. Cooldown might still be active. Wait 60 seconds, then re-probe:"
    echo "      curl -sS http://localhost/api/alpaca/account | jq ."
    echo "   2. If it stays 401/503: the keys you typed are wrong. Generate"
    echo "      fresh keys (the secret is shown ONCE — copy it carefully)."
    echo ""
    echo "   Hard reset (clears cooldown):"
    echo "      docker compose down && docker compose up -d postgres redis api nginx"
    ;;
  *)
    echo "Unexpected HTTP $HTTP — check 'docker compose logs api --tail 40'"
    ;;
esac
