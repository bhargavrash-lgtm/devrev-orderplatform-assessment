#!/usr/bin/env bash
# Start OrderWave for development on macOS or Linux: the API on :8000 and the Vite dev server
# on :5173. Logs go to .run/. Press Ctrl+C to stop both.
#
#   ./scripts/start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
RUN="$ROOT/.run"
ENV_FILE="$ROOT/.env"
mkdir -p "$RUN"

say() { printf '\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# Prerequisites
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PYTHON="$candidate"; break
  fi
done
[ -n "$PYTHON" ] || fail "Python 3.11 or newer is not installed."
command -v node >/dev/null 2>&1 || fail "Node.js 18 or newer is not installed."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || fail "Node.js 18 or newer is needed."
if [ ! -f "$ENV_FILE" ]; then
  echo "No .env file found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in every value:"
  echo "    cp .env.example .env"
  echo "    python3 -c 'import secrets; print(secrets.token_hex(32))'   # for SESSION_SECRET and MCP_API_KEY"
  exit 1
fi
for port in 8000 5173; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then fail "Port $port is already in use. Is OrderWave already running?"; fi
done

# Dependencies (installed only when missing or changed)
VENV_PY="$BACKEND/.venv/bin/python"
[ -x "$VENV_PY" ] || { say "Creating backend virtual environment"; "$PYTHON" -m venv "$BACKEND/.venv"; }
REQ_HASH="$("$VENV_PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$BACKEND/requirements.txt")"
if [ "$(cat "$BACKEND/.venv/.requirements.sha256" 2>/dev/null || true)" != "$REQ_HASH" ]; then
  say "Installing backend dependencies"
  "$VENV_PY" -m pip install --quiet --disable-pip-version-check -r "$BACKEND/requirements.txt"
  echo "$REQ_HASH" > "$BACKEND/.venv/.requirements.sha256"
fi
LOCK_HASH="$("$VENV_PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$FRONTEND/package-lock.json")"
if [ "$(cat "$FRONTEND/node_modules/.orderwave-lock.sha256" 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  say "Installing frontend dependencies (npm ci)"
  (cd "$FRONTEND" && npm ci --no-audit --no-fund)
  echo "$LOCK_HASH" > "$FRONTEND/node_modules/.orderwave-lock.sha256"
fi

# Start both, with .env loaded into the API's environment only (never printed).
say "Starting the API on :8000 and the frontend on :5173 (logs in .run/)"
( set -a; . "$ENV_FILE"; set +a; export SERVE_FRONTEND=0; cd "$BACKEND" && exec "$VENV_PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 ) > "$RUN/backend.log" 2>&1 &
BACKEND_PID=$!
( cd "$FRONTEND" && exec npm run dev ) > "$RUN/frontend.log" 2>&1 &
FRONTEND_PID=$!
cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true; wait 2>/dev/null || true; echo; echo "OrderWave stopped."; }
trap cleanup INT TERM EXIT

wait_for() {
  for _ in $(seq 1 120); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.75; done
  return 1
}
wait_for http://127.0.0.1:8000/api/health || fail "The API did not start; see .run/backend.log"
wait_for http://localhost:5173/ || fail "The frontend did not start; see .run/frontend.log"

cat <<EOF

OrderWave is running at http://localhost:5173

Demo accounts (passwords are SEED_CUSTOMER_PASSWORD / SEED_OPS_PASSWORD in .env):
    sundaram@orderwave.demo   (customer)
    greenfield@orderwave.demo (customer)
    ops@orderwave.demo        (ops)
    accounts@orderwave.demo   (ops)

Press Ctrl+C to stop.
EOF
wait
