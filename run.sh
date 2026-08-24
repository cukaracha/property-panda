#!/bin/bash

# Launch Property Panda: the local API (scraper + assistant) and the web app, together.
#
# Everything this starts runs on this machine. The scraper drives a real, visible Chrome
# window because PropertyGuru sits behind a Cloudflare challenge that only clears for a
# genuine browser, and sometimes only after you click in it. The in-app assistant runs on
# your own Claude subscription through the `claude` CLI — see
# apps/local/property_search/README.md.
#
# Usage:
#   ./run.sh                Start both services (installing anything missing first)
#   ./run.sh --reinstall    Rebuild the Python venv and reinstall both dependency trees
#   ./run.sh --api          Start only the local API
#   ./run.sh --ui           Start only the web app
#   ./run.sh --no-open      Start as usual, without opening a browser tab

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
API_DIR="$REPO_ROOT/apps/local/property_search"
UI_DIR="$REPO_ROOT/apps/ui/web"
APP_CONFIG="$REPO_ROOT/AppConfig.json"

API_PORT=8000
UI_PORT=3000
PYTHON_VERSION=3.12

# Job control, so each background service gets its own process group. Without it, killing
# the API on Ctrl+C leaves chromedriver and its Chrome behind, holding the browser profile
# lock that the next run needs.
set -m

RUN_API=true
RUN_UI=true
REINSTALL=false
OPEN_BROWSER=true

RED=$'\033[31m'
GREEN=$'\033[32m'
CYAN=$'\033[36m'
YELLOW=$'\033[33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

API_PID=""
UI_PID=""
OPEN_PID=""

# ============================================================================
# Helpers
# ============================================================================

info()  { echo "${CYAN}==>${RESET} $*"; }
warn()  { echo "${YELLOW}warning:${RESET} $*"; }
fail()  { echo "${RED}error:${RESET} $*" >&2; exit 1; }

# Tag each service's output so two logs in one terminal stay readable. awk rather than
# `sed -u`, which is GNU-only, and fflush keeps the line from sitting in a pipe buffer.
prefix() {
    awk -v tag="$1" '{ printf "%s %s\n", tag, $0; fflush() }'
}

# LISTEN only. A bare `lsof -ti tcp:PORT` also matches *client* sockets on that port, so
# a browser tab left over from the last run reads as "port still in use" long after the
# server it was talking to exited.
port_pid() {
    lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | head -1
}

# ============================================================================
# Preflight
# ============================================================================

check_prerequisites() {
    command -v node >/dev/null 2>&1 || fail "node is required. Install Node.js, then re-run."
    command -v npm  >/dev/null 2>&1 || fail "npm is required. Install Node.js, then re-run."

    if ! command -v uv >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
        fail "Either uv or python3 is required to build the scraper environment."
    fi

    # claude-agent-sdk installs from PyPI but shells out to this, which does not come
    # with it. Warned rather than fatal: the scraper works perfectly well without an
    # assistant, and only the chat panel would fail.
    if [ "$RUN_API" = true ] && ! command -v claude >/dev/null 2>&1; then
        warn "the 'claude' CLI was not found, so the assistant will not answer.
         Install it from https://claude.com/claude-code, then run 'claude setup-token'
         and save the token on the profile page."
    fi

    # Checked here rather than left to Selenium, which reports a missing browser as an
    # unrelated-looking driver error. Real Google Chrome specifically: Chromium is
    # fingerprinted by Cloudflare and does not clear the challenge.
    if [ "$RUN_API" = true ] && ! chrome_installed; then
        fail "Google Chrome was not found. The scraper drives a real Chrome window;
       install it from https://google.com/chrome and re-run."
    fi
}

chrome_installed() {
    if [ -d "/Applications/Google Chrome.app" ]; then return 0; fi
    if command -v google-chrome >/dev/null 2>&1; then return 0; fi
    if command -v google-chrome-stable >/dev/null 2>&1; then return 0; fi
    return 1
}

check_ports() {
    local busy=""
    if [ "$RUN_API" = true ] && [ -n "$(port_pid $API_PORT)" ]; then
        busy="$busy $API_PORT"
    fi
    if [ "$RUN_UI" = true ] && [ -n "$(port_pid $UI_PORT)" ]; then
        busy="$busy $UI_PORT"
    fi

    if [ -n "$busy" ]; then
        fail "port(s)$busy already in use. Stop whatever is listening (an earlier
       ./run.sh, most likely) and try again:  kill \$(lsof -ti tcp:${busy## })"
    fi
}

# ============================================================================
# Dependencies
# ============================================================================

setup_api() {
    cd "$API_DIR"

    if [ "$REINSTALL" = true ]; then
        info "Rebuilding the scraper environment"
        rm -rf .venv
    fi

    if [ ! -x .venv/bin/python ]; then
        info "Creating the scraper virtualenv"
        if command -v uv >/dev/null 2>&1; then
            uv venv .venv --python "$PYTHON_VERSION" >/dev/null
        else
            python3 -m venv .venv
        fi
    fi

    # Reinstall only when requirements.txt has actually moved, so an ordinary start does
    # not pay for a dependency resolve it does not need.
    local stamp=".venv/.requirements-stamp"
    local current
    current=$(shasum requirements.txt | cut -d' ' -f1)

    if [ "$(cat "$stamp" 2>/dev/null)" != "$current" ]; then
        info "Installing Python dependencies"
        if command -v uv >/dev/null 2>&1; then
            uv pip install --python .venv/bin/python -r requirements.txt >/dev/null
        else
            .venv/bin/pip install --quiet -r requirements.txt
        fi
        echo "$current" > "$stamp"
    fi
}

setup_ui() {
    cd "$UI_DIR"

    if [ "$REINSTALL" = true ]; then
        info "Reinstalling web app dependencies"
        npm install
    elif [ ! -d node_modules ]; then
        info "Installing web app dependencies"
        npm install
    fi

    ensure_env_local
}

# Read one string out of AppConfig.json. Kept to a grep so the script needs no jq and
# no Python of its own; the file is written by hand and has one key per line.
app_config() {
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$APP_CONFIG" | head -1
}

# The two display names live in AppConfig.json, which is the one place app identity is
# configured. Vite only reads VITE_ vars out of a .env file, so they are copied across
# here rather than imported.
ensure_env_local() {
    local env_file="$UI_DIR/.env.local"
    local app_name assistant_name

    app_name=$(app_config displayName)
    assistant_name=$(app_config assistantName)
    [ -n "$app_name" ] || app_name="Property Panda"
    [ -n "$assistant_name" ] || assistant_name="Pandai"

    info "Writing .env.local"
    cat > "$env_file" <<ENV
# Written by run.sh from AppConfig.json on every start. Gitignored, so edit
# AppConfig.json rather than this file.
VITE_LISTINGS_API_URL=http://localhost:$API_PORT
VITE_APP_NAME=$app_name
VITE_ASSISTANT_NAME=$assistant_name
ENV
}

# ============================================================================
# Services
# ============================================================================

start_api() {
    info "Starting the local API on http://localhost:$API_PORT"
    cd "$API_DIR"
    .venv/bin/python server.py 2>&1 | prefix "${CYAN}[api]${RESET}" &
    API_PID=$!
}

start_ui() {
    info "Starting the web app on http://localhost:$UI_PORT"
    cd "$UI_DIR"
    npm run dev 2>&1 | prefix "${GREEN}[web]${RESET}" &
    UI_PID=$!
}

# Vite takes a moment to bind, and a tab opened before then lands on a connection error
# the browser will not retry. Wait for the port instead, in the background so the service
# logs keep streaming meanwhile.
open_when_ready() {
    local url="http://localhost:$UI_PORT/search"
    local waited=0

    while [ -z "$(port_pid $UI_PORT)" ]; do
        if [ "$waited" -ge 30 ]; then
            warn "the web app has not come up yet; open $url once it does."
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    if command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    else
        warn "no browser opener found; open $url yourself."
    fi
}

# Signal the whole process group, not just the child, so the API takes chromedriver and
# any Chrome it opened down with it.
stop_service() {
    local pid=$1
    if [ -z "$pid" ]; then
        return 0
    fi
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

shutdown() {
    trap '' INT TERM
    echo
    info "Stopping"
    stop_service "$OPEN_PID"
    stop_service "$API_PID"
    stop_service "$UI_PID"
    wait 2>/dev/null || true
    exit 0
}

# ============================================================================
# Main
# ============================================================================

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --reinstall) REINSTALL=true ;;
            --api)       RUN_UI=false ;;
            --ui)        RUN_API=false ;;
            --no-open)   OPEN_BROWSER=false ;;
            -h|--help)
                sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
                exit 0
                ;;
            *) fail "unknown option: $1  (try --help)" ;;
        esac
        shift
    done
}

main() {
    parse_args "$@"
    check_prerequisites
    check_ports

    if [ "$RUN_API" = true ]; then setup_api; fi
    if [ "$RUN_UI"  = true ]; then setup_ui;  fi

    trap shutdown INT TERM

    if [ "$RUN_API" = true ]; then start_api; fi
    if [ "$RUN_UI"  = true ]; then start_ui;  fi

    echo
    if [ "$RUN_UI" = true ]; then
        echo "  ${GREEN}Property search${RESET}  http://localhost:$UI_PORT/search"
    fi
    if [ "$RUN_API" = true ]; then
        echo "  ${DIM}Local API        http://localhost:$API_PORT${RESET}"
    fi
    echo "  ${DIM}Ctrl+C to stop${RESET}"
    echo

    if [ "$RUN_UI" = true ] && [ "$OPEN_BROWSER" = true ]; then
        open_when_ready &
        OPEN_PID=$!
    fi

    wait
}

main "$@"
