# Property Panda

A property search app that runs entirely on your own machine: a **React** SPA, a
local **FastAPI** server that scrapes PropertyGuru through a real Chrome window,
and an in-app assistant running on your **Claude subscription**.

Nothing is deployed and nothing is signed in to. Two processes on loopback, one
person, one machine.

## Architecture

```
  Browser (React SPA, apps/ui/web)  http://localhost:3000
      │
      ├── REST ──► /listings/*   ─► scraper (Selenium + visible Chrome) ─► PropertyGuru
      │                              └─ jobs, results, saved searches, property cache → .data/*.json
      │
      └── SSE ──► /chat          ─► assistant (claude-agent-sdk → `claude` CLI)
                                     ├─ page context + page actions from the SPA
                                     ├─ WebSearch / WebFetch
                                     └─ transcript → .data/chat/{sessionId}.json

  apps/local/property_search  http://localhost:8000
```

**The scrape needs a real browser.** PropertyGuru sits behind a Cloudflare
managed challenge that returns 403 to every non-browser client and only clears
for a genuine browser on a real display, sometimes only after a person clicks in
it. That is why this is a local app driving a visible Chrome window rather than
a Lambda. Scrapes run one at a time, because Chrome holds an exclusive lock on
the profile directory that carries the clearance between runs.

**The assistant reads the page, and can act on it.** The SPA sends a rendered
description of what is currently on screen plus the actions available there
(hide a property, hide a unit, unhide, re-run the search). The agent answers
from that context, and when it wants to act it proposes a single action which
does nothing until you approve it.

## Repository layout

| Path                               | What                                      |
| ---------------------------------- | ----------------------------------------- |
| `apps/ui/web`                      | React 19 / Vite / Tailwind v4 SPA         |
| `apps/local/property_search`       | The local server: scraper, store, and API |
| `apps/local/property_search/agent` | The in-app assistant (claude-agent-sdk)   |
| `AppConfig.json`                   | App and assistant display names           |

## Running it

```bash
./run.sh                 # both services, and opens http://localhost:3000/search
./run.sh --api           # only the local API
./run.sh --ui            # only the web app
./run.sh --reinstall     # rebuild both dependency trees
./run.sh --no-open       # start without opening a browser tab
```

`run.sh` builds anything missing (the Python virtualenv, `npm install`) and
writes `apps/ui/web/.env.local` from `AppConfig.json` on every start. Ctrl+C
stops both services, and the Chrome the scraper opened with them.

**Prerequisites:** Node, Python 3.12 (or `uv`), real Google Chrome (Chromium is
fingerprinted by Cloudflare and does not clear the challenge), and the `claude`
CLI if you want the assistant.

## The assistant

It runs on your own Claude subscription, not an API key.

```bash
claude setup-token       # then paste the token on the /profile page
```

The token is stored in `apps/local/property_search/.data/claude_token.json`,
readable only by you, and is never sent back to the browser. Without one the
scraper still works and the chat panel reports that it needs a token.

Conversations are kept in `.data/chat/` and keyed by a session id the browser
holds in localStorage, so a reload resumes the same thread. "New chat" in the
panel rotates that id.

## Configuration

`AppConfig.json` holds the two names the UI shows. `run.sh` reads them and
writes them into `.env.local` as `VITE_APP_NAME` and `VITE_ASSISTANT_NAME`.

```jsonc
{
  "displayName": "Property Panda", // the app name in the sidebar and the tab title
  "assistantName": "Panda-chan", // what the assistant calls itself
  "allowedOrigins": ["http://localhost:3000"],
}
```

## Local state

Everything the app remembers is under `apps/local/property_search/.data/`, which
is gitignored and safe to delete:

| File                  | What                                              |
| --------------------- | ------------------------------------------------- |
| `jobs.json`           | Search job rows (24h TTL)                         |
| `results/*.json`      | The grouped result of each search                 |
| `properties.json`     | Project page cache (30 day TTL, 24h for failures) |
| `saved_searches.json` | Searches kept for re-running, and what each hides |
| `chat/*.json`         | Chat transcripts, one per session                 |
| `claude_token.json`   | Your Claude subscription token (mode 0600)        |

Browser Cloudflare clearance lives separately in `.chrome-profile/`. Delete that
if the browser ever gets into a state you cannot clear.

## Development

```bash
npm install
npm run dev          # the SPA alone, against a server started by ./run.sh --api
npm run build        # tsc -b && vite build
npm run lint         # from apps/ui/web
```

Root quality gates (husky + lint-staged + commitlint + prettier) run on commit.
See `CONTRIBUTING.md`.
