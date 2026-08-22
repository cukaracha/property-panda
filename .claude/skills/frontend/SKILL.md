---
name: frontend
description: React/TypeScript web app conventions for this project: reusable vs page-specific components, no inline components in pages, per-page utils/hooks/types subfolders, design tokens / Tailwind theme, and page context + agent actions. Use when adding a UI component or page, deciding where a component file belongs, restyling or wiring design tokens, implementing a design handoff, or adding page context or agent actions.
---

# Frontend (React / TypeScript)

The web app is React + TypeScript (Vite). Components are either **reusable**
(shared across pages) or **page-specific**, and pages never define components
inline.

## Component organization

```
src/
├── components/                 # reusable, shared across pages
│   ├── ui/                     # primitives: button.tsx, card.tsx, input.tsx, ...
│   ├── modals/  tables/  inputs/  ...
├── pages/
│   └── <page>/
│       ├── <Page>.tsx          # the page component
│       └── components/         # page-specific components
│           └── <Thing>.tsx
```

## Rules

- **Reusable components live in `components/`** - UI primitives under
  `components/ui/`. Use them wherever possible.
- **Page-specific components live in `pages/<page>/components/`** - when a
  component is only used by one page, keep it next to that page, not in the
  shared `components/`.
- **Pages must not define inline components** - a page
  (`pages/<page>/<Page>.tsx`) always imports reusable or page-specific
  components; it never declares a component inside the page file.
- **A page folder may add `utils/`, `hooks/`, and `types/` subdirectories** when
  the page needs them - keep page-scoped helpers, hooks, and types with the
  page.

Quick test for placement: used by more than one page → `components/` (or
`components/ui/` if a primitive); used by exactly one page → that page's
`components/`.

## App identity & config

- **The displayed app name comes from config, never a literal** - import
  `APP_NAME` from `src/config/app.ts`
  (`export const APP_NAME = import.meta.env.VITE_APP_NAME || '…'`) and use it
  for the app name in headers, titles, and landing copy:
  ```tsx
  import { APP_NAME } from '../config/app';
  <h1>{APP_NAME}</h1>          // ✅
  <h1>My App</h1>              // ❌ hardcoded app name
  ```
  `VITE_APP_NAME` is sourced from `AppConfig.json` (`displayName`) and injected
  into the build by Terraform - never hardcode the app name in a component.
- **Runtime config comes from `import.meta.env.VITE_*`** - Cognito ids, API URL,
  region, and the AgentCore runtime ARN are written into `.env.production` by
  Terraform's `null_resource.deploy_ui`; read them via `import.meta.env`, never
  hardcode. Add new build-time config the same way (Terraform env → `.env` →
  `import.meta.env`) and keep `.env.example` in sync.

## Styling & design tokens

Theme values (colors, fonts, radii, shadows, motion) live **once** in
`src/styles/` and are exposed to Tailwind via `@theme inline`. Tailwind v4 is
config-less - there is no `tailwind.config.js`, so tokens are registered in CSS:

- `src/styles/tokens.css` - the raw `:root` custom properties (the single source
  of truth).
- `src/styles/theme.css` - an `@theme inline { … }` block mapping the raw vars
  onto Tailwind utility namespaces (`--color-*`, `--font-*`, `--radius-*`,
  `--shadow-*`) so utilities reference the raw var instead of re-emitting a
  second copy. (Don't map the `--text-*` size tokens - they collide with
  Tailwind's `text-*` font-size namespace.)
- `src/styles/components.css` - bespoke `.ui-*` classes + keyframes for what
  utilities can't express (motion, `field-sizing`, layered chrome), with a
  `prefers-reduced-motion` block.

**Never hard-code a color / font / radius / shadow** - use the token or its
utility:

```tsx
<button className="bg-primary text-white rounded-button shadow-card font-display">  // ✅
<button className="bg-[#2563eb] rounded-[10px]">                                    // ❌ hardcoded value
```

Three layers, in order of preference: **theme values** (tokens in `src/styles/`,
never duplicated) → **reusable primitives** (`components/ui/*`) styled _from_
tokens with **stable props/APIs** → **page-specific composition** built from
those primitives.

Consuming a design handoff:

- Tokens are the source of truth - port them into `src/styles/` first.
- Restyle primitives by swapping classes; do **not** change their signatures.
- Port bespoke CSS into `src/styles/` only when a utility can't express it
  (keyframes, `field-sizing`).
- Add webfonts in `index.html`; respect `prefers-reduced-motion`.
- Flag substitutes (e.g. a stand-in web font for the intended display/body font,
  lucide icons for bespoke SVGs).
- `cn()` (`lib/utils.ts`) is a plain join with **no** tailwind-merge - to
  override a base utility from a consumer, use an `!`-important utility (e.g.
  `!rounded-modal`).

## Page context & agent actions

The chat assistant receives the active page's context with **every** message, so
each page declares what the agent can see and do.

- A page registers context on mount via a `pages/<page>/PageContext.tsx`
  `use<Page>PageContext()` hook that calls
  `setPageContext({ pageName, pageDescription, contentDetailsProvider, actions })`
  and **clears it on unmount**; the page component calls the hook. `Chat.tsx`
  reads it at send time via
  `usePageContextStore.getState().getFormattedContext()`.
- `pageDescription` uses the structured `PageDescription`
  (`title / purpose / layout / sections[] / notes`). `contentDetailsProvider`
  returns a fresh plain-text summary read from stores via `getState()` at send
  time, and **must include any IDs the agent needs to build action payloads**
  (e.g. `Asset: Conveyor 3 (CV-03)`, a sensor reading) - the agent can't act on
  data it can't see.
- **Actions** are
  `{ name, description, parameters, example, display, callback, terminal? }`.
  The agent only ever sees `name / description / parameters / example` - that
  bound comes from the **agent-side whitelist**: `format_actions`
  (`apps/ai/agents/chat/format_prompt.py`) reads only those four keys and
  ignores the rest. `display` / `callback` are functions, so `JSON.stringify`
  drops them from the wire payload entirely; `terminal` is a **frontend-only**
  boolean (see below) that _is_ transmitted but is ignored by the whitelist, so
  it never reaches the model. `display(params)` returns a human label (may read
  stores via `getState()`); `callback(params)` runs on approval.
- **Callbacks must use React Router `useNavigate`, never
  `window.location.href`** - a full reload breaks SPA routing and drops
  auth/session state.
- Update the `contentDetailsProvider` ref **in an effect, not during render**
  (`react-hooks/refs`):
  ```tsx
  const providerRef = useRef(getContentDetails);
  useEffect(() => {
    providerRef.current = getContentDetails;
  }); // ✅ not during render
  ```
- **Actions are human-in-the-loop (approval-gated).** When the agent emits an
  `<act>`, `Chat.tsx` records it as a durable `PendingAction` - Chat-level
  state, **not** the transient `workflowSteps` trace (which is wiped each
  turn) - and renders a confirmation card that **stays until the user resolves
  it**; the composer is **locked while any action is pending**. Approve runs the
  action's `callback(payload)` **and** sends a confirmation turn back to the
  agent (which resumes from AgentCore Memory from its `sessionId`); reject sends
  a rejection turn. So adding a capability is still just a new `Action` in
  `usePageContextStore.actions`, but the behavior now spans the agent prompt
  too - the agent must treat actions as proposals and stop after emitting one:
  the agent prompt instructs the model to emit exactly one `<act>` per turn,
  then stop and await approval.
- **Mark navigational actions `terminal: true`** (`Action.terminal`) - e.g.
  `sign_out`. A terminal action runs its `callback` on approval and **skips**
  the confirmation turn, since it navigates away and unmounts the chat;
  non-terminal actions always send the confirmation/rejection turn.

## Build & strictness

`npm run build` runs `tsc -b && vite build` - the build **type-checks**, so type
errors fail it. Dev server runs on port 3000; Tailwind v4 is config-less
(`@import "tailwindcss"` in `src/index.css`, no `tailwind.config.js` / PostCSS).

The TypeScript config (`tsconfig.app.json`) is strict - write code that
satisfies it the first time:

- **`verbatimModuleSyntax`** → type-only imports MUST use `import type`:
  ```ts
  import type { Action } from '../types/chatbot'; // ✅
  import { Action } from '../types/chatbot'; // ❌ TS1484
  ```
- **`erasableSyntaxOnly`** → no enums, namespaces, or constructor parameter
  properties (use `const` objects / plain types instead).
- **`noUnusedLocals` / `noUnusedParameters`** → no unused symbols; drop unused
  imports and use an optional catch binding when you don't need the error:
  `try { … } catch { … }`.

ESLint (`eslint-plugin-react-hooks@7`, flat `recommended`) treats these as
**errors**, not warnings:

- **`react-hooks/refs`** - never read or write `ref.current` during render; do
  it in an effect or an event handler:
  ```tsx
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }); // ✅ update in an effect, NOT during render
  ```
- **`react-hooks/set-state-in-effect`** - don't call `setState` synchronously in
  an effect body.
- `react-hooks/exhaustive-deps` is a warning (lint still passes), but prefer
  complete dep arrays.

Gotcha: when porting reference/sample code, **adapt it to these stricter rules**
rather than copying verbatim - patterns like "assign a ref during render" pass
in looser setups but fail here.
