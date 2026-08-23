# Property search (local)

The whole backend of Property Panda. It scrapes PropertyGuru for-sale listings,
groups them by property and unit type, and serves them to the `Property search`
page of the web app. It also runs the in-app assistant that answers questions
about what is on that page.

This runs on your machine rather than in the cloud. PropertyGuru sits behind a
Cloudflare managed challenge: every non-browser client gets a 403, and the
challenge only clears for a real browser on a real display — sometimes only
after a person clicks in it. So the scraper drives a visible Chrome window you
can reach, which a Lambda cannot offer.

## Running it

From the repo root:

```bash
./run.sh                              # http://localhost:3000/properties
```

That builds anything missing — the Python virtualenv, `npm install`, and an
`apps/ui/web/.env.local` written from `AppConfig.json`. Ctrl+C stops both
services, and the Chrome the scraper opened with them.

`./run.sh --api` and `./run.sh --ui` start one side on its own, and
`./run.sh --reinstall` rebuilds both dependency trees.

To run the two by hand instead:

```bash
cd apps/local/property_search && .venv/bin/python server.py   # 127.0.0.1:8000
cd apps/ui/web && npm run dev                                 # localhost:3000
```

## The assistant

The chat panel on the property search page runs on your own Claude subscription
through `claude-agent-sdk`, which drives the `claude` CLI. Generate a token with
`claude setup-token` and paste it on the `/profile` page; it lands in
`.data/claude_token.json` with mode 0600 and is never sent back to the browser.
Without one the scraper works as usual and the panel says it needs a token.

Each turn is one `query()` against a fresh CLI process, so everything it knows
comes from the prompt: the page context and actions the SPA sends, plus the
conversation replayed out of `.data/chat/{sessionId}.json`. It has `WebSearch`
and `WebFetch` and nothing else — every filesystem and shell built-in is denied
by a `PreToolUse` hook, which returns an outright allow or deny so no call ever
blocks waiting for a permission prompt no one is there to answer.

An action is a proposal. The agent emits one `<act>` block and stops; the panel
renders Approve and Reject, and the page's own callback only runs on approval.

## The human verification

Set your filters, hit search, and a Chrome window opens. Most of the time the
challenge clears by itself within a few seconds and the window works through the
pages on its own.

When it does not, after 30 seconds the page tells you it is waiting and the
browser window stays open on the challenge. Complete it there. The scrape
notices the page has loaded and carries on by itself — there is nothing to click
in the app.

Clearance is kept in `.chrome-profile/`, so later runs usually skip the
challenge altogether. Delete that directory if the browser ever gets into a
state you cannot clear.

## How a search runs

`POST /listings/search` validates the filters, records a queued job and returns
a jobId immediately; the page then polls `GET /listings/results?jobId=`, which
is both the poll and the fetch. Behind it, one background thread reads the
search result pages in a single browser session, fetches each new project page
for the property-level facts (TOP year, total units, tenure, developer, PSF
range), groups everything, and writes the result.

That session loads pages across four tabs rather than one. Almost all of a
scrape is spent waiting, and enrichment is one page load per property, so the
tabs wait in parallel instead of queueing behind each other. They are there to
overlap the waiting, not to hit the site harder: every navigation passes through
one shared rate limit, so the tabs take turns rather than bursting.

While it runs, the page counts rather than sitting on one label: the listings
step says which result page it is on, and the property details step says how
many project pages of how many it has fetched. That second one is most of a cold
run, so it is the number worth watching. It reads `cached` instead when the
property cache already covered every property, which is the whole difference
between a warm search and a cold one.

Scrapes run one at a time: Chrome holds an exclusive lock on its profile
directory, and that profile is what carries the Cloudflare clearance between
runs.

Project pages are cached in `.data/properties.json` for 30 days, because they
change on the order of months while listings change hourly — without it, every
search would re-solve a challenge per property for data that has not moved. A
project page that would not load is written down too, for a day, so one dead
project is not re-attempted by every later search.

## Tuning

Each of these is read from the environment at start-up, so
`SCRAPE_TABS=2 ./run.sh` is enough to change one.

| Variable                    | Default  | What it does                                          |
| --------------------------- | -------- | ----------------------------------------------------- |
| `SCRAPE_TABS`               | `4`      | Tabs the session spreads page loads across            |
| `SCRAPE_DELAY_SECONDS`      | `5`      | Politeness gap per tab, shared out across all of them |
| `AUTO_SOLVE_SECONDS`        | `30`     | How long a challenge gets before it asks you for help |
| `MANUAL_SOLVE_SECONDS`      | `300`    | How long it then waits for you                        |
| `MARKER_GRACE_SECONDS`      | `5`      | Grace before a rendered page counts as the wrong page |
| `PROPERTY_TTL_SECONDS`      | 30 days  | How long a project record stays cached                |
| `PROPERTY_FAIL_TTL_SECONDS` | 1 day    | How long a project page that failed is left alone     |
| `CHAT_MODEL`                | `sonnet` | The model alias the assistant runs on                 |

## Saved searches, hiding and bookmarking

A saved search is the request body itself, kept under a name in
`.data/saved_searches.json` so a set of filters worth running twice does not
have to be retyped. Running one starts an ordinary scrape.

Hiding a property or a unit is a flag, not a delete. The result set keeps
everything, the page filters at render time, and unhiding puts a row straight
back with no re-scrape. What is hidden belongs to the search that turned it up,
so it is stored inside that search's row rather than in a list of its own: a
search hides the same things every time it runs, and hiding something in one
search leaves every other search alone. A search the user has not saved keeps
its hidden items in the browser until they do.

Bookmarking is the mirror of hiding and is kept in the same row for the same
reason. It sorts instead of filtering: a bookmarked property is pinned to the
top of the results, and removing the bookmark drops its card back where the
scrape put it. Bookmarks are properties only, since a unit has no card of its
own to pin, and hiding still wins, so a property that is both stays off screen
until it is unhidden. Both lists come back on every run of the search.

## Shortlisting

Hearting a unit copies it into `.data/shortlist.json` as it stands at that
moment, project facts and all. It stores the whole listing rather than a
reference to one because there would be nothing left to reference: job rows age
out after a day and take their results with them, and the property cache holds
project facts only, nothing per unit. So the shortlist is the one thing here
that survives without a scrape behind it, and `GET /listings/shortlist` regroups
those snapshots into the same shape a search returns, through the same helpers.

The shortlist belongs to the app rather than to a search, which is deliberately
the opposite of hiding. Hiding answers "not this one, in this search", so it
lives in the search. A shortlist answers "these are the ones I like", and which
search happened to turn a unit up does not come into it.

The cost of a snapshot is that it goes stale: a shortlisted unit's price is
whatever it was when it was hearted, and it is never re-scraped. The page shows
when each one was saved so that is visible rather than assumed.

## Layout

| File                       | What it does                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `server.py`                | The API the SPA calls, and the background job handoff        |
| `scraper.py`               | One job end to end: scrape, enrich, group, record            |
| `browser.py`               | The visible Chrome session and the verification wait         |
| `sources/property_guru.py` | Reads the site's `__NEXT_DATA__` and project page markup     |
| `grouping.py`              | listings to properties to unit types to units                |
| `store.py`                 | Job rows, property cache, saved searches, shortlist, results |
| `validation.py`            | Request validation for searches, saves, shortlist and chat   |
| `agent/runner.py`          | The SDK options and the event pipeline for one chat turn     |
| `agent/stream_map.py`      | SDK messages to the `{type, content}` events the SPA reads   |
| `agent/act_parser.py`      | Splits proposed `<act>` actions out of the streamed prose    |
| `agent/format_prompt.py`   | The page context / actions / history / message envelope      |
| `agent/prompts.json`       | The system prompt and the standing instructions              |
| `agent/transcript.py`      | Chat history, one JSON file per session                      |
| `agent/tokens.py`          | The Claude subscription token                                |

Adding another portal means one module under `sources/` and one entry in
`scraper._SOURCES`; nothing else knows which site the records came from.
