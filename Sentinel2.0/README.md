# Sentinel2.0 Start Guide

This folder is a clean root for building Sentinel vNext from blueprint docs and Stitch exports.

## Directory Layout

- `ai_blueprints/`: authoritative architecture and implementation specs.
- `stitch_exports/Sentinel2.0/`: latest UI designs, screen exports, and design token metadata.
  - `metadata/design-system-theme.json`: design tokens reference source.
  - `metadata/manifest.json`: export metadata.
  - `code/`: per-screen exported HTML references.

## Build Approach

Follow phase order in `ai_blueprints/09_ERROR_HANDLING.md`:

1. Phase 1: Photino shell scaffold
2. Phase 2: OS hooks
3. Phase 3: Angular scaffold + design system
4. Phase 4: Timer + intervention
5. Phase 5: Firebase auth + standard persistence
6. Phase 6: Event ledger client path
7. Phase 7: Cloud Functions authority
8. Phase 8: Planner
9. Phase 9: Reports + history
10. Phase 10: migration tooling
11. Phase 11: end-to-end + security
12. Phase 12: installer + release

## Greenfield Rule

If legacy source files are missing in this workspace, treat all Source -> Target mapping sections as behavior references only. Implement target files directly from target architecture sections and phase deliverables.

## Design Usage Rule

Use Stitch exports as UI/UX guidance only.

- Do not treat exported HTML as production code.
- Align component hierarchy, screen states, and interaction patterns with the blueprints.
- Keep architecture and data contracts from `ai_blueprints/` as the source of truth.

## Prompting Rule for Scaffolding Agents

When prompting an agent to scaffold in this root, include:

- "Use `ai_blueprints/00_AI_PROJECT_INDEX.md` as the table of contents."
- "Execute one phase at a time from `ai_blueprints/09_ERROR_HANDLING.md`."
- "If source files are unavailable, continue using target specs without blocking."
