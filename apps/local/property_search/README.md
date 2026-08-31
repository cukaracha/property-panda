# Property search (local)

The whole backend of Property Panda. It scrapes PropertyGuru for-sale listings,
groups them by property and unit type, and serves them to the `Property search`
page of the web app. It also runs the in-app assistant that answers questions
about what is on that page.

This runs on your machine, which is what lets the scrape read the site either
way: over plain HTTP, or by driving a visible Chrome window on your desktop. See
Which transport a scrape runs on and The two tiers below.

## Running it

From the repo root:

```bash
./run.sh                              # http://localhost:3000/search
```

That builds anything missing — the Python virtualenv, `npm install`, and an
`apps/ui/web/.env.local` written from `AppConfig.json`. Ctrl+C stops both
services.

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

## Which transport a scrape runs on

The switch at the bottom of the nav rail picks between two ways of reading the
same pages, and picks nothing else. Nothing about a job row, a saved search or a
result records which one read them, so a search saved in one mode and re-run in
the other is the same search returning the same thing.

**API** is the default and is what The two tiers below describes: plain HTTP for
almost everything, the Web Unlocker for the shapes Cloudflare refuses. It needs
nobody watching, and it spends credits.

**Browser** opens one real Chrome window and reads the site with `fetch()` from
inside a page that has already cleared the challenge, which inherits the
clearance cookie and Chrome's own fingerprint and skips rendering entirely. It
costs nothing and needs Google Chrome installed, plus you at the machine: when
Cloudflare asks for a click, the session waits `MANUAL_SOLVE_SECONDS` for you to
answer and then fails the search rather than returning a short result set. The
clearance is kept in `.chrome-profile/` between runs, and Chrome holds an
exclusive lock on it, which is why scrapes run one at a time.

Cancelling is coarser in browser mode. A batch is handed to the in-page pool in
one go and cannot be taken back, so requests already issued run on into a tab
nobody reads until the session quits Chrome. It stops waiting straight away
though, including while it is waiting on you to clear a challenge.

The mode is one setting on this machine, kept in `.data/settings.json` and read
when a job starts, so flipping it never disturbs a search already running.
`SCRAPE_TRANSPORT` names the default for a machine where nobody has chosen yet,
and a choice made in the app wins over it from then on.

## The two tiers

PropertyGuru sits behind a Cloudflare managed challenge, but not on every
request. Probed live against the site, only three request shapes are ever
refused: a search URL carrying `sort=date` and `order=desc` together, a search
URL with the page number in its path (`/property-for-sale/1?page=1` is refused
where `/property-for-sale?page=1` is not), and any search page past the first.
Project pages, listing pages and a first page with any combination of filters
all answer 200 to a plain HTTP client, as long as that client's TLS and HTTP/2
fingerprints look like a real Chrome.

So tier 1 is `curl_cffi` impersonating Chrome, which is free and reads almost
everything. The page number is simply left out of the path, which costs nothing.
The sort pair is still sent though, and page 1 is paid for as a result. Omitting
it was tried first and is wrong: a search sent with no sort shares 2 of its 20
results with one sorted newest first, because the site's default ordering
promotes older listings over newer. No cheaper spelling reproduces the sort, so
this is the one place a credit buys correctness rather than convenience.

Tier 2 is
[Bright Data's Web Unlocker](https://docs.brightdata.com/scraping-automation/web-unlocker/send-your-first-request),
a paid API that runs the challenge on its own infrastructure and hands back the
page. It costs one credit per request whatever the page weighs, and it is used
for search pages 2 and up, plus page 1 whenever the search is sorted newest
first, which is the default. So a ten page search of one property type spends
ten credits and a one page search spends one; the free tier renews 5,000 a
month. Measured live, an unlocked page takes about 12 seconds against 0.3 for a
free one, so it dominates how long a search feels as well as what it costs. It
was three times that until the requests started asking to exit in Singapore:
left to itself Bright Data routed through Los Angeles, and a search page pulls
over two hundred subresources while it renders, every one of them crossing the
Pacific twice. `UNLOCKER_COUNTRY` is what sets that.

It is asked for `format: "json"` rather than `"raw"`, so the page arrives inside
a `{status_code, headers, body}` envelope (their docs call that first key
`status`, but a live call returns `status_code`). That keeps the target's own
verdict apart from Bright Data's: under `raw` both arrive as one HTTP status and
nothing documents which, so a project page that genuinely 404s would be
indistinguishable from a token that was refused.

Put `BRIGHTDATA_API_KEY` and `BRIGHTDATA_ZONE` in the `.env` at the repo root,
which `run.sh` reads into the environment and which git ignores. Without them a
search that only needs the first page still runs, and one that needs more stops
and says so rather than quietly returning a short result set. A variable set on
the command line wins over that file, so `UNLOCKER_CONCURRENCY=1 ./run.sh` still
works.

Routing is static where the answer is known and dynamic where it is not: a tier
1 response that comes back refused (HTTP 403 with `cf-mitigated: challenge`)
escalates to tier 2, and the shape it belongs to is remembered for the rest of
the job. Every measurement above came from one residential connection, so if a
shape starts being refused from somewhere else the escalation covers it without
a code change.

## Stopping a search

Cancel search sits under the steps on the progress card. It is a request rather
than a kill: the scrape stops starting new page fetches, and whatever is already
in flight finishes, so the job usually goes terminal within a second. Nothing is
written as a result, but the project pages it had already fetched stay in the
cache, so running the search again is quicker.

## How a search runs

`POST /listings/search` validates the filters, records a queued job and returns
a jobId immediately; the page then polls `GET /listings/results?jobId=`, which
is both the poll and the fetch. Behind it, one background thread reads the
search result pages in a single HTTP session, fetches each new project page for
the property-level facts (TOP year, total units, tenure, developer, PSF range),
groups everything, and writes the result.

Requests go out several at a time, and how many depends on which phase is
running. Search pages are the heavier of the two and go six at a time, project
pages go sixteen. Both numbers sit where the site stops answering any faster
rather than where the machine does, so raising them buys nothing.

Paid requests are counted separately and go ten at a time, because what bounds
them is the Bright Data zone rather than the site. Each tier has a gate of its
own rather than sharing the worker pool: sharing one held the paid tier to
whichever of the two limits was smaller, so raising it past the free one did
nothing at all. Ten covers a full ten page search in one wave, which is worth
more here than anywhere else given what one of those requests costs in time.

While it runs, the page counts rather than sitting on one label: the listings
step says which result page it is on, and the property details step says how
many project pages of how many it has fetched. That second one is most of a cold
run, so it is the number worth watching. It reads `cached` instead when the
property cache already covered every property, which is the whole difference
between a warm search and a cold one.

Scrapes run one at a time. In browser mode that is a hard constraint, since
Chrome holds an exclusive lock on the profile directory carrying the clearance.
In API mode nothing requires it, and the same bound stands as a deliberate one
on how hard one machine leans on the source and on how fast a paid tier can be
spent.

Project pages are cached in `.data/properties.json` for 30 days, because they
change on the order of months while listings change hourly — without it, every
search would re-solve a challenge per property for data that has not moved. A
project page that would not load is written down too, for a day, so one dead
project is not re-attempted by every later search.

## Tuning

Each of these is read from the environment at start-up, so
`SCRAPE_SEARCH_CONCURRENCY=3 ./run.sh` is enough to change one.

| Variable                    | Default            | What it does                                                 |
| --------------------------- | ------------------ | ------------------------------------------------------------ |
| `SCRAPE_TRANSPORT`          | `api`              | The mode to start on before anyone has picked one            |
| `BRIGHTDATA_API_KEY`        | unset              | The Web Unlocker token. No default, and no tier 2 without it |
| `BRIGHTDATA_ZONE`           | unset              | The Web Unlocker zone that token may use                     |
| `SCRAPE_SEARCH_CONCURRENCY` | `6`                | Search pages fetched at once                                 |
| `SCRAPE_DETAIL_CONCURRENCY` | `16`               | Project pages fetched at once                                |
| `UNLOCKER_CONCURRENCY`      | `10`               | Paid requests in flight at once, across both phases          |
| `UNLOCKER_COUNTRY`          | `sg`               | Where the unlocker exits from. Empty lets Bright Data pick   |
| `SCRAPE_IMPERSONATE`        | `chrome`           | Which browser curl_cffi presents itself as                   |
| `AUTO_SOLVE_SECONDS`        | `30`               | Browser mode: how long a challenge gets before you are asked |
| `MANUAL_SOLVE_SECONDS`      | `300`              | Browser mode: how long it then waits for you before failing  |
| `CHROME_PROFILE_DIR`        | `.chrome-profile/` | Browser mode: where the clearance is kept                    |
| `PROPERTY_TTL_SECONDS`      | 30 days            | How long a project record stays cached                       |
| `PROPERTY_FAIL_TTL_SECONDS` | 1 day              | How long a project page that failed is left alone            |
| `CHAT_MODEL`                | `sonnet`           | The model alias the assistant runs on                        |

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
| `fetching.py`              | The two tier transport: curl_cffi, then the unlocker         |
| `browser.py`               | The visible Chrome session browser mode runs on              |
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
