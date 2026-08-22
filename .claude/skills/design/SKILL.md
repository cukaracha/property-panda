---
name: design
description:
  Visual design-system guidance for this project's web app - where design tokens
  live (a CSS :root), the color/spacing/radii/shadow/type scales, and the rules
  (sentence case, accent used sparingly, light/dark theme awareness, no emoji).
  Use when building or restyling any screen, page, or component, choosing
  colors/typography/spacing, or checking that UI conforms to the design system.
---

# Design system - visual spec

Brand-agnostic guidance for building consistent, on-system screens for **Sample
Agentic App**. Sections 1-7 are the visual language; section 8 is how it is
wired into the web app. The live source of truth for token _values_ is
`apps/ui/web/src/styles/tokens.css` - the tables below describe the shape and
the token names, not fixed brand values.

> **In one line:** calm, legible, consistent - a single accent color used
> sparingly against neutral surfaces, a heavier display font over a quiet body
> font, sentence-case copy, no emoji.

---

## 1. The look & feel

- **Mood:** plain-spoken, functional, forward-looking. Statements of capability,
  not hype.
- **Signature move:** one **accent color** (`--color-primary`) used deliberately
  for actions, active markers, and small highlights against generous neutral
  surfaces.
- **The accent is never a wash** - reserve it for primary actions, key icons,
  and small accents, not large fills.
- **No decorative gradients, no glassmorphism.** Surfaces are flat and quiet.
- **Imagery** (where used) is real and warm, never stocky.

---

## 2. Color

Values live in `tokens.css`; components consume the semantic aliases below,
never raw literals.

### Accent

| Token                    | Use                                        |
| ------------------------ | ------------------------------------------ |
| `--color-primary`        | Primary actions, active state, key accents |
| `--color-primary-hover`  | Hover on solid primary                     |
| `--color-primary-active` | Pressed                                    |
| `--color-accent`         | Optional secondary accent, used sparingly  |

### Neutrals (surfaces, text, borders)

A cool neutral ramp from page background through hairlines to strongest text -
exposed as semantic aliases so components never reach for a raw step:
`--color-bg` (page) · `--color-surface` (card) · `--color-surface-inverse` (dark
band) · `--color-text-strong` / `--color-text` / `--color-text-muted` ·
`--color-border` (hairline).

### Semantic

| Role     | Token                                        |
| -------- | -------------------------------------------- |
| Positive | `--color-positive` (+ `--color-positive-bg`) |
| Negative | `--color-negative` (+ `--color-negative-bg`) |
| Warning  | `--color-warning` (+ `--color-warning-bg`)   |
| Info     | `--color-info` (+ `--color-info-bg`)         |

### Prefer semantic aliases in components

`--surface-page` · `--surface-card` · `--surface-inverse` · `--text-strong` /
`--text-body` / `--text-muted` · `--border-subtle` · `--action-bg` (→
`--action-bg-hover` → `--action-bg-active`) · `--focus-ring`.

---

## 3. Typography

- **Display / headings:** a heavier grotesque **display font**
  (`--font-display`, 700-900). Set **tight** (`-0.02em`), **sentence case**,
  heavy weight.
- **Body / UI:** a clean humanist sans **body font** (`--font-body`, 400-600),
  line-height `1.5`.
- **Mono:** a monospace face (`--font-mono`) for data, code, and captions.
- **Core typographic move:** big contrast between heavy display and quiet body.

**Type scale (1rem = 16px):** `2xs 11` · `xs 12` · `sm 14` · `base 16` · `md 18`
· `lg 22` · `xl 28` · `2xl 36` · `3xl 48` · `4xl 60` · `5xl 76`.

**Roles:** hero = 76 / extrabold · title = 48 / bold · heading = 22 / bold ·
body = 16 / regular · eyebrow = 12 / bold (often `0.12em` tracking, all-caps).

**Line height:** tight `1.05` (hero) · snug `1.15` (headings) · normal `1.5`
(body) · relaxed `1.65`.

---

## 4. Spacing & layout

- **4px base grid.** Scale: 4 · 8 · 12 · 16 · 20 · 24 · **32 (default card
  padding)** · 40 · 48 · **64 (section rhythm)** · 80 · 96.
- **Container:** `1280px` max content column, centered on the page background.
- **Gutter** `24px` · **card grid gap** `16px` · **header height** `72px`
  (sticky).
- **Internal tools:** fixed `248px` sidebar + work area.

---

## 5. Effects

- **Radii:** inputs `6px` · buttons/chips `10px` · **cards `14px`**
  (`--radius-card`) · modals `20px` · pill `999px` for filters & badges-as-tabs
  · **`0` for dense data UI** (tables).
- **Borders:** `1px` hairlines (`--color-border`) · `1.5px` control outlines ·
  `3-4px` accent for active tabs and markers.
- **Shadows:** cool, low, layered, quiet by default. Card resting =
  `--shadow-card`. Elevation only on hover (cards lift 2px), popovers, and
  modals. **No glow.**
- **Focus:** a soft accent focus ring (`--shadow-focus`).
- **Motion:** calm and short - `120-200ms` ease-out fades, 1-2px lifts; modals
  fade + rise 12px. **No bounce, no infinite loops.** Respect
  `prefers-reduced-motion`.
- **Hover/press:** hover = a step darker on solids, tint fill on ghost/outline,
  +2px card lift. Press = next shade darker + 0.5px nudge down.

---

## 6. Iconography

- **[Lucide](https://lucide.dev)** (`lucide-react`) - 24px, 2px round strokes.
  Render the accent at feature size, neutral in UI chrome.
- **No emoji. No unicode-character icons** (except numeric up/down indicators
  where genuinely needed).

---

## 7. Voice & copy

- **Sentence case everywhere** (headings, buttons, nav). Not Title Case.
- **Person:** "we / our" for the product; "you" when addressing the reader.
- **CTAs:** short, verb-led - "Find out more", "Read more".
- **Headlines:** assertive, often complete sentences with a full stop.
- **Numbers:** precise and unembellished. **No emoji, ever.**

---

## 8. Light & dark themes

The token layer is theme-aware: `tokens.css` defines the light `:root` values
and a dark override (e.g. `:root[data-theme="dark"]` and/or a
`prefers-color-scheme: dark` block) that re-points the **same** semantic
aliases. Because components consume aliases (`--surface-card`, `--text-body`,
`--action-bg`) rather than raw ramp steps, a screen built on the tokens flips
cleanly between themes with no per-component work. Check contrast (WCAG AA) in
**both** themes when adding a token.

---

## 9. Using the system in this web app

The system is wired into `apps/ui/web` (React + Vite + Tailwind v4). Conform to
it - don't reinvent values.

**Tokens live once, in `apps/ui/web/src/styles/`** (all imported by
`src/index.css`):

- `tokens.css` - raw `:root` custom properties (light + dark); the **single
  source of truth** for every value above.
- `theme.css` - an `@theme inline { … }` block mapping those vars onto Tailwind
  utility namespaces (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`), so
  `bg-primary`, `rounded-card`, etc. exist.
- `components.css` - bespoke `.ui-*` classes + keyframes for what utilities
  can't express (motion, layered chrome), with a `prefers-reduced-motion` block.

**Never hard-code a color / font / radius / shadow** - use the utility (or the
var):

```tsx
<button className="bg-primary text-white rounded-button shadow-card font-display">  // ✅
<button className="bg-[#2563eb] rounded-[10px]">                                    // ❌ hardcoded
```

**Reach for an existing primitive before styling raw elements.** Inventory in
`src/components/ui/*`: `Button` (variants: default · outline · ghost ·
destructive · secondary · link), `Card` (+
`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`), `Badge`,
`Tag`, `Banner`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Tabs`, `Spinner`.
Restyle a primitive by swapping its classes; do **not** change its prop
signature.

**Icons:** import from `lucide-react` (24px, 2px stroke; accent at feature size,
neutral in UI).

**Fonts** are loaded in `apps/ui/web/index.html` and exposed as `font-display` /
`font-body` / `font-mono`.

**`cn()` caveat:** `src/lib/utils.ts` is a plain class-string join with **no**
tailwind-merge - to override a base utility from a consumer, use an
`!`-important utility (e.g. `!rounded-modal`).

> Boundary: this skill owns the _visual language_ (what good looks like + where
> the tokens live). Component file placement, page structure, and TS strictness
> are an engineering concern owned by the `frontend` conventions, not here.

---

## 10. Verify (read-only)

Conformance checks that change no state:

```bash
# 1. No hardcoded values - colors/radii must come from tokens/utilities, not literals
grep -rEn '#[0-9A-Fa-f]{6}|bg-\[#|rounded-\[' apps/ui/web/src/components apps/ui/web/src/pages

# 2. Tokens are present and imported in order
grep -n '@import' apps/ui/web/src/index.css
```

Then eyeball the rules: **sentence case** (no Title Case), **no emoji**, the
accent only on actions/icons/accents (never a wash), **no decorative
gradients**, focus rings present, motion short and
`prefers-reduced-motion`-aware, and contrast holds in **both** light and dark
themes.
