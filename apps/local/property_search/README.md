# Property search (local)

Scrapes PropertyGuru for-sale listings, groups them by property and unit type,
and serves them to the `Property search` page of the web app.

This one runs on your machine rather than in AWS. PropertyGuru sits behind a
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
`apps/ui/web/.env.local` holding `VITE_LOCAL_MODE=true` (which lets the SPA boot
without Cognito) and `VITE_LISTINGS_API_URL`. Local mode is additionally gated
on Vite's dev flag, so a production build drops it whatever that file says.
Ctrl+C stops both services, and the Chrome the scraper opened with them.

`./run.sh --api` and `./run.sh --ui` start one side on its own, and
`./run.sh --reinstall` rebuilds both dependency trees.

To run the two by hand instead:

```bash
cd apps/local/property_search && .venv/bin/python server.py   # 127.0.0.1:8000
cd apps/ui/web && npm run dev                                 # localhost:3000
```

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

| Variable                    | Default | What it does                                          |
| --------------------------- | ------- | ----------------------------------------------------- |
| `SCRAPE_TABS`               | `4`     | Tabs the session spreads page loads across            |
| `SCRAPE_DELAY_SECONDS`      | `5`     | Politeness gap per tab, shared out across all of them |
| `AUTO_SOLVE_SECONDS`        | `30`    | How long a challenge gets before it asks you for help |
| `MANUAL_SOLVE_SECONDS`      | `300`   | How long it then waits for you                        |
| `MARKER_GRACE_SECONDS`      | `5`     | Grace before a rendered page counts as the wrong page |
| `PROPERTY_TTL_SECONDS`      | 30 days | How long a project record stays cached                |
| `PROPERTY_FAIL_TTL_SECONDS` | 1 day   | How long a project page that failed is left alone     |

## Hiding

Hiding a property or a unit is a flag, not a delete. The result set keeps
everything, the page filters at render time, and unhiding puts a row straight
back with no re-scrape. The list lives in `.data/hidden.json`.

## Layout

| File                       | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `server.py`                | The API the SPA calls, and the background job handoff       |
| `scraper.py`               | One job end to end: scrape, enrich, group, record           |
| `browser.py`               | The visible Chrome session and the verification wait        |
| `sources/property_guru.py` | Reads the site's `__NEXT_DATA__` and project page markup    |
| `grouping.py`              | listings to properties to unit types to units               |
| `store.py`                 | Job rows, property cache, hidden list, results (JSON files) |
| `validation.py`            | Filter validation for a search request                      |

Adding another portal means one module under `sources/` and one entry in
`scraper._SOURCES`; nothing else knows which site the records came from.
