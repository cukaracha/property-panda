# Property Panda

A property search app that runs entirely on your own machine: a **React** SPA, a
local **FastAPI** server that scrapes PropertyGuru, and an in-app assistant
running on your **Claude subscription**.

Nothing is deployed and nothing is signed in to. Two processes on loopback, one
person, one machine.

## Architecture

```
  Browser (React SPA, apps/ui/web)  http://localhost:3000
      │
      ├── REST ──► /listings/*   ─► scraper (curl_cffi, + Web Unlocker) ─► PropertyGuru
      │                              └─ jobs, results, saved searches, property cache → .data/*.json
      │
      └── SSE ──► /chat          ─► assistant (claude-agent-sdk → `claude` CLI)
                                     ├─ page context + page actions from the SPA
                                     ├─ WebSearch / WebFetch
                                     └─ transcript → .data/chat/{sessionId}.json

  apps/local/property_search  http://localhost:8000
```

**The scrape gets past Cloudflare in two tiers.** PropertyGuru sits behind a
managed challenge, but it only refuses two request shapes: a search sorted
newest first by the explicit `sort` and `order` pair, and any search page past
the first. Everything else answers a plain HTTP client wearing Chrome's own TLS
fingerprint, which is tier 1 and is free. Bright Data's Web Unlocker is tier 2
and reads the rest, at one credit a request against a free tier of 5,000 a
month. See `apps/local/property_search/README.md` for the routing and the
credentials it needs.

**Or it drives a visible Chrome instead.** The switch at the bottom of the nav
rail picks which. API mode is the above: unattended, and it spends credits.
Browser mode opens a real Chrome window and reads the site from inside a page
that has already cleared the challenge, which costs nothing but needs you at the
machine to click through a challenge when one appears. Only the fetching
changes, so a search saved in one mode and re-run in the other returns the same
thing. Scrapes run one at a time either way: browser mode has to, since Chrome
locks the profile directory that carries the clearance, and API mode does by
choice.

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
stops both services.

**Prerequisites:** Node, Python 3.12 (or `uv`), `BRIGHTDATA_API_KEY` and
`BRIGHTDATA_ZONE` in the root `.env` if you want more than the first page of any
search, and the `claude` CLI if you want the assistant. `run.sh` reads that
`.env` on every start and git ignores it.

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
| `settings.json`       | Which transport a scrape runs on                  |

`.chrome-profile/` is the Chrome profile browser mode drives, and it is what
carries a Cloudflare clearance from one run to the next. Deleting it costs
nothing but the next challenge.

## Development

```bash
npm install
npm run dev          # the SPA alone, against a server started by ./run.sh --api
npm run build        # tsc -b && vite build
npm run lint         # from apps/ui/web
```

Root quality gates (husky + lint-staged + commitlint + prettier) run on commit.
See `CONTRIBUTING.md`.
