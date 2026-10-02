---
mode: agent
description: Audit every project in the catalogue for correctness (documentation, stability, metadata) and repair the clear drift.
---

# Audit the project catalogue

Scope (fill in before running):

- Projects: `all` (default) or a comma-separated list of ids / repositories
- Live checks: `yes` (query GitHub + NuGet per project) / `no` (use the local cache only)
- Repair: `report-only` / `fix` (default: fix blockers and drift, report the rest)

## Instructions

1. Read `.agents/skills/audit-catalogue-projects/SKILL.md` and follow its method and report format.
2. Load `.agents/skills/project-manifest-reference/SKILL.md`,
   `.agents/skills/docs-aggregation-rules/SKILL.md`,
   `.agents/skills/use-case-authoring/SKILL.md`, and
   `.agents/skills/github-repo-metadata/SKILL.md` as the reference for the checks.
3. Load `.agents/skills/site-validation-loop/SKILL.md` for the commands and their meaning.

Use the `catalogue-auditor` agent if it is available.

## Deliverables

1. The deterministic results first: `just check-projects` and `bun run test` output.
2. A findings table (one row per issue) with Project, Field, Observed, Expected, Severity, Evidence,
   Fix — as specified in the audit skill.
3. The applied fixes (blockers and drift only), each with the command that proves it.
4. Re-validation after fixing: `just check-projects`, `bun run test`, and `just validate`.
5. A closing summary: projects audited, issues by severity, fixes applied, and the `upstream` items
   that must be resolved in the product repositories.

## Constraints

- Report before repairing, and never edit while still gathering evidence.
- Every finding needs a reproducible command and its observed output.
- Do not invent metadata, use cases, or evidence to silence a check.
- Do not change the schema vocabulary, the Astro components, or the validation logic.
- Do not hand-edit generated content or caches.
