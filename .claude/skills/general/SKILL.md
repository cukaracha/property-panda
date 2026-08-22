---
name: general
description:
  Cross-cutting coding rules for this project that apply to any change, in any
  language or layer. Use when making any code change here - before adding files,
  comments, or changing structure.
---

# General coding rules

Apply these to every change, regardless of domain (Terraform, Lambda, frontend,
etc.).

## Rules

- **Follow existing patterns and conventions.** Match the surrounding code's
  style, naming, and structure rather than introducing a new approach.
- **App identity & environment config live in `AppConfig.json`** (repo root):
  app name, stage, and approved sign-up domains. Never hardcode these or other
  environment-specific values in any layer. Read them from there. Terraform
  loads it in `locals.tf` and injects the relevant fields as `VITE_*` build-time
  env vars that the frontend reads.
- **Don't add comments, docstrings, or type annotations to code you didn't
  change.** Touch only what the task requires and leave untouched code as-is.
- **Prefer editing existing files over creating new ones.** Extend what's there,
  and add a new file only when no existing file is the right home.
- **No architectural decisions without explicit user approval.** If a task seems
  to require one (new service, new stack/state boundary, new dependency, changed
  data flow), stop and briefly describe the issue, then propose options for the
  user to choose from, rather than deciding unilaterally.
- **No em dashes or semicolons in copy.** In any user-facing text (UI labels,
  headings, placeholders, messages, docs), use commas, periods, colons, or
  parentheses instead of em dashes, and split runs into separate sentences
  rather than joining them with a semicolon. Semicolons remain required as
  normal code syntax.
