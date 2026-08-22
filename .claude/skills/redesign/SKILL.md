---
name: redesign
description:
  Build a self-contained redesign handoff package (design brief + per-screen
  functional parity contracts) to give Claude Design or any designer, granting
  full freedom over visual aesthetics, brand, layout, and IA while locking exact
  functional parity. Use when asked to kick off a redesign, create a design
  export/handoff, write parity contracts for an existing app, or prepare
  instructions for Claude Design.
---

# Redesign handoff export

Produce a folder of markdown that a designer can redesign an app from **with no
access to the source code**, such that the result can be re-implemented later
with **zero behavioral regressions**. The package is a _parity contract_: every
feature, control, state, data field, and flow is enumerated as acceptance
criteria; everything visual is explicitly released. Proven end-to-end on an LMS
app (5 surfaces, 246 checklist items → coded handoff → re-implementation
verified item-by-item against the same checklists).

## The one rule (put it verbatim in the package README)

> **Preserve the functionality at exact parity. Redesign everything else.**

The contract cuts one way only: every capability that exists today must exist
and behave identically after the redesign — nothing added, removed, or changed
in behavior. Layout, information architecture, navigation structure, palette,
typography, component styling, brand identity, even product/assistant _names_
are all the designer's to reinvent.

## Package layout

Create at `samples/redesign/` (or wherever the user prefers — it just needs to
be one self-contained folder you can zip/share):

```
samples/redesign/
├── README.md            ← the one rule, preserve/reinvent table, how to use the package
├── 00-overview.md       ← app, users, jobs-to-be-done, tech stack, shell/nav, sitemap, flows
├── 01-brand-identity.md ← the CURRENT brand distilled from real tokens — reference only
├── 99-redesign-goals.md ← constraints (priority order), freedoms, out-of-scope, deliverable
└── screens/
    └── <surface>.md     ← one per surface: brief + functional parity checklist
```

## Step 1 — Inventory the surfaces

- Enumerate routes from the router (e.g. `App.tsx`), including
  redirects/fallbacks and auth gates. Each routed page is a surface.
- Add non-route surfaces: the global shell (header/sidebar), and any overlay
  with its own lifecycle (chat widget, command palette). These get their own
  `screens/*.md` too.
- Hunt for **dead scaffolding** — components that exist but are not imported by
  any routed page (`grep -rn '<ComponentName' src/ --include='*.tsx'` for each
  suspect). Declare these explicitly OUT OF SCOPE in the package, or the
  designer will design behavior that does not exist.
- Note controls that render but are not wired (decorative search box,
  notification bell, "remember me"). These must be flagged individually:
  _present and focusable, but non-functional — preserve as present_ (or let the
  designer propose removing them as a documented deliberate change; see
  Deliverable).

## Step 2 — Framing docs

**README.md** — the one rule; a two-column **Preserve vs. Reinvent** table
(preserve: every checklist item, all content/data fields, stack feasibility;
reinvent: brand, aesthetics, layout, IA/navigation, component styling); a
one-paragraph description of what the app is; reading order
(`00 → 01 → screens/ → 99`); the package contents tree; any brand-lineage cruft
to ignore (stale template branding in manifests, old skill docs, leftover
assets).

**00-overview.md** — what the app is and its display-name source; who uses it
(roles); jobs-to-be-done (numbered); **tech stack as a feasibility constraint**
(framework, styling engine, icon set, state/auth/markdown libs — "your design
must be buildable in this stack, no new framework or heavy UI library"); the
global shell & navigation today; a sitemap code block (routes → screens, auth
gates, unknown-path fallback); primary user flows as small ASCII diagrams; a
closing table of surfaces → route → `screens/*.md` file.

**01-brand-identity.md** — the CURRENT palette/type/shape/elevation/motion
distilled from the app's real token files (hex values, font stacks, radii). Open
with an emphatic disclaimer: _reference, not a requirement — the new brand is
yours to define_. Without this framing the designer anchors on the old look;
without the content they can't tell what they're replacing.

**99-redesign-goals.md** — hard constraints in priority order:

1. **Exact functional parity** (the checklists are acceptance tests — if an item
   becomes impossible, the redesign fails, however good it looks).
2. **All content & data preserved** (may be re-arranged, never dropped).
3. **Implementable in the current stack.**
4. **Accessibility** — keyboard operability, visible focus, WCAG AA contrast for
   whatever palette is chosen, `prefers-reduced-motion`.

Then: the freedoms (spell them out — brand, layout, IA, component styling,
names); out-of-scope items (dead scaffolding, backend/auth internals — keep the
_flows_, not the endpoints; unwired control destinations); and the
**Deliverable** section below.

## Step 3 — Screen briefs (`screens/<surface>.md`)

Fixed section skeleton per surface:

```markdown
# <Surface> — <route or "overlay">

> One-sentence purpose.

## 1. Route & entry ← registration, auth gate, entry points, param fallbacks

## 2. User & job-to-be-done

## 3. Content & data shown ← every field rendered, where it comes from, fallbacks

## 4. Functional parity checklist — the contract, must not break

## 5. Current layout & sections ← today's arrangement (context, not a mandate)

## 6. States & edge cases ← loading/empty/error, unknown params, remount/reset rules

## 7. Interactions & actions ← every click/keyboard action and its target

## 8. Aesthetic & layout freedoms ← free-to-change / must-stay-true / out-of-scope
```

### Writing checklist items that hold up (section 4 is the whole point)

- **Derive from the code, not from looking at the UI.** Read the component
  source and transcribe: element ids, input types, placeholders, `required`
  flags, exact copy strings, error-message maps, handler flow
  (`preventDefault → setLoading → await api → finally`), state machines and
  their step names, nav targets, store side effects on mount/unmount.
- One observable behavior per `- [ ]` item, independently checkable against the
  code.
- Include the invisible contract: keyboard behavior (Enter-submits vs
  click-only, focus order, no traps), remount keys, effect cleanup that resets
  shared state, double-submit guards, auto-close timers with their exact ms
  values.
- Quote exact strings — `placeholder "Enter your password"`, error
  `'Passwords do not match'`. Exact strings are what make post-implementation
  verification mechanical.
- Mark decorative/unwired controls inline: "present but non-functional — must
  still render".
- State the fallback behavior for bad input (unknown route param → which
  default, no 404).

Example items at the right granularity:

```markdown
- [ ] `lesson = getLesson(lessonId)` resolves by slug; unknown/missing id falls
      back to `LESSONS['double-slit-experiment']` — the screen never 404s on a
      bad param.
- [ ] Show/hide password toggle (`type='button'`) flips `showPassword`; renders
      `EyeOff` when shown, `Eye` when hidden.
- [ ] The effect cleanup calls `reset()` on unmount and before each re-run when
      `topic` changes, clearing scope/suggestions/topicId so the assistant hides
      on other pages.
```

### Section 8 — the freedoms, per screen

Three lists: **Free to change** (everything visual on this screen, named
concretely so the permission is credible), **Must stay true to the contract**
(the 3–5 items from section 4 most at risk of being designed away), **Explicitly
out of scope** (dead code adjacent to this screen, with the grep evidence that
it's unreferenced).

## Deliverable (request this in 99-redesign-goals.md)

Whatever form the handoff takes (concepts, mockups, or a coded prototype),
require per screen: the redesigned layout/treatment; an **explicit parity
check** mapping every checklist item to its home in the new design; and
system-level notes (shell, tokens, type scale, component styles, motion) so the
screens read as one product. Crucially: **any deliberate product change the
designer proposes (renames, removed decorative controls, new pages) must be
documented as an explicit numbered list in the handoff's README** — that list is
what lets the implementer distinguish sanctioned changes from regressions.

## Kickoff message (send with the folder)

> Attached is a self-contained redesign brief for <app>. Start with `README.md`.
> The one rule: preserve the functionality at exact parity — every item in each
> screen's Functional parity checklist must still work — and redesign everything
> else freely: brand, palette, type, layout, information architecture,
> navigation, component styling. Deliver per screen: the redesigned layout, a
> parity check against the checklist, and system-level notes; document every
> deliberate product change you propose in your README.

## Closing the loop (when the handoff comes back)

- The handoff is the source of truth for _look + its documented deliberate
  changes_; the current app is the source of truth for _behavior_. Where they
  conflict, keep the behavior, apply the look.
- Re-implement, then verify **every checklist item** against the new code (the
  checklists double as acceptance tests; fan out one verification pass per
  screen doc).
- Grep for the old brand strings/hex values to confirm the rebrand swept clean.

## Gotchas (each cost real time)

- **Undeclared dead code** → the designer styles components no route renders.
  Grep-verify and declare out of scope up front.
- **Brand shown without the "reference only" disclaimer** → the new design
  anchors on the old palette. Lead 01-brand-identity.md with the disclaimer.
- **Vague checklist items** ("login works") → unverifiable later. Exact ids,
  strings, and handler flows or it didn't happen.
- **Undocumented designer changes** → indistinguishable from regressions at
  implementation time. Make the numbered deliberate-changes list a hard
  deliverable requirement.
- **Stale prior-brand cruft** (old template names in manifests/docs) → gets
  faithfully reproduced. Call it out as ignore-this in the README.

## Verify (read-only)

- Every route in `00-overview.md`'s sitemap has a `screens/*.md`; overlays/shell
  included.
- Every `screens/*.md` has all 8 sections and a non-trivial section 4 (tens of
  items for an interactive screen, not a handful).
- `grep -rn 'src/\|\.tsx' samples/redesign/` — code paths may appear as
  _references_, but spot-check that no checklist item requires opening a file to
  be understood.
- Read the package start to finish pretending you cannot see the repo: every
  screen should be reconstructible from words alone.
