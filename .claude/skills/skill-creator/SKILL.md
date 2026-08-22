---
name: skill-creator
description:
  Create a new skill (SKILL.md) in a consistent, standalone, concise format. Use
  when asked to write a new skill, capture a repeatable workflow or hard-won
  finding as a skill, or scaffold a skills directory entry.
---

# Creating a skill

A skill is a single self-contained `SKILL.md` in its own directory:
`skills/<skill-name>/SKILL.md`. It captures a repeatable workflow or hard-won
finding so it can be reused without re-deriving it.

## Format

```markdown
---
name: <kebab-case, matches the directory name>
description:
  <what it does + "Use when ..." triggers; keyword-rich; 1–2 sentences>
---

# <Title>

<1–3 sentence intro: what this captures and when it applies.>

## <Section> ...
```

- Required frontmatter: only `name` and `description`.
- `name`: lowercase, hyphens only; **must match the folder name**.
- `description` decides when the skill activates - pack it with the
  keywords/phrases a user would actually say, and include explicit **"Use when
  …"** triggers. Describe _when to use it_, not just what it is.

## Rules (the conventions to follow)

- **Standalone.** A skill must work on its own. Referencing project file PATHS
  as the subject you document (e.g. "put the file in
  `apps/apis/<domain>/<verb>/`") is fine and expected. What to avoid is a
  pointer that sends the reader into ANOTHER skill or doc to act (e.g. "see the
  X skill"). Inline the one fact instead, or copy the needed snippet. Exception:
  in a deliberately decomposed family of skills, a shared contract may be owned
  by one skill and referenced as an explicit boundary (e.g. "the full handler
  template is owned by the `lambda` skill"), as long as each skill still stands
  alone for its own task.
- **Concise and sharp.** Dense and actionable: tables, short bullets,
  copy-pasteable code. No filler, no narration.
- **Functional.** Include enough real code/commands that someone can run the
  workflow without leaving the file.
- **Agent/tool-neutral.** Don't name the assistant or a specific CLI; keep it
  portable. (Literal domain data like API or model identifiers is fine.)
- **Capture what's proven + the traps.** Record known-good values, mark tested
  steps, and list the gotchas that actually cost time - with concrete values,
  not generalities.

## Good vs bad descriptions

- ✅ "Run a quick local X deploy with no remote backend. Use when doing a
  throwaway test deploy or deciding how to split config files."
- ❌ "Helps with X." / "X stuff."

## Template (copy, then fill)

```markdown
---
name: my-skill
description: <one-liner + "Use when ...">
---

# <Title>

<intro: what + when>

## <Core workflow / pattern>

<copy-pasteable code or commands>

## Gotchas

- <trap> → <fix / concrete value>

## Known-good defaults

| Thing | Value |
| ----- | ----- |
| ...   | ...   |

## Verify (read-only)

<a command or check that confirms the work, with no state changes>
```

## Checklist before finishing

- [ ] `name` matches the folder; kebab-case.
- [ ] `description` has real keywords + a "Use when …" trigger.
- [ ] Self-contained: project paths are fine, but no "see the X skill" pointers
      (inline the fact instead).
- [ ] Concise, sharp, copy-pasteable.
- [ ] Proven steps + gotchas + concrete values captured.
- [ ] A read-only verify/tested cue, where the skill has a runnable workflow.

## Where skills live

Author the folder as `<skill-name>/SKILL.md`. Related skills may be grouped
under a category folder (e.g. `coding/<skill-name>/SKILL.md`) to keep a domain
family together. Skills are not auto-discovered from arbitrary locations, so
place (or symlink) the folder into the active skills directory and confirm the
loader walks nested category folders.
