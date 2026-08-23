# Rules

- Follow existing code patterns and conventions in the codebase.
- Do not add comments, docstrings, or type annotations to code you didn't
  change.
- Prefer editing existing files over creating new ones.
- The local server runs on Python 3.12.
- Strictly forbidden from making architectural decisions without explicit
  approval by the user. If you encounter such issues, briefly describe the issue
  and propose options for the user to choose from.
- Before writing a plan, search the skills-gateway MCP for relevant skills, read
  each match, and list them in the plan. The gateway is authoritative over any
  local skills copy.

# Project Overview

A property search app that runs entirely on one machine. A React frontend
(`apps/ui/web`) talks to a local FastAPI server (`apps/local/property_search`)
over loopback. There is no cloud, no authentication, and nothing to deploy.

The server does two things. It scrapes PropertyGuru by driving a real, visible
Chrome window, because the source sits behind a Cloudflare challenge that only
clears for a genuine browser. And it runs the in-app assistant
(`apps/local/property_search/agent`) through `claude-agent-sdk`, on the user's
own Claude subscription token.

App identity lives in `AppConfig.json` at the project root: `run.sh` reads
`displayName` and `assistantName` from it and writes them into
`apps/ui/web/.env.local` on every start. Never hardcode either in the app.

# Development Guide

## Running

`./run.sh` starts both services and opens the app. `--api` and `--ui` start one
side alone, `--reinstall` rebuilds both dependency trees. Never start a second
scrape concurrently: Chrome holds an exclusive lock on the profile directory
that carries the Cloudflare clearance between runs.

## Web App

- Use reusable components from `components/` wherever possible. When a component
  is page-specific, place it in `pages/<page>/components/`.
- Pages must not define inline components — always use reusable or page-specific
  components.
- A page folder can optionally contain subdirectories for `utils/`, `hooks/`,
  and `types/` when needed.
- The build is strict: `verbatimModuleSyntax` (so type-only imports need
  `import type`), `erasableSyntaxOnly`, and `noUnusedLocals`. `npm run build`
  runs `tsc -b`, so a type error fails it.

## The local server

- `server.py` holds routes only: it parses the request, delegates, and formats
  the response. Business logic lives in the modules beside it.
- Request validation goes in `validation.py`, one function per request shape,
  raising `ValueError` with a message the SPA can show.
- Persistence goes through `store.py` (scraper state) or `agent/` (token and
  transcripts). Both write JSON under `.data/` via a lock plus a temp file and
  rename, because the API thread and the scrape thread both write there.
- Errors answer as `{"message": ...}`, which is the shape the SPA's services
  read.

## The assistant

- The browser and the agent share one event protocol: `{type, content}` with
  type in `reasoning | message | tool | action | status | error`, described in
  `apps/ui/web/src/types/chatbot.ts`. Both ends depend on it, so change it in
  both or not at all.
- `agent/stream_map.py` maps SDK messages onto that protocol and
  `agent/act_parser.py` splits proposed `<act>` actions out of the prose. Text
  is emitted as incremental `message` events, since `useChatEngine` accumulates
  those and has no `delta` case.
- Tool events are formatted `name(args)`, which is what `parseTool` in
  `ReasoningCard.tsx` splits on.
- A page offers the assistant by calling `setChatUi({ assistantEnabled: true })`
  and registering its context and actions through `usePageContextStore`. An
  action is a proposal: nothing runs until the user approves it in the panel.
