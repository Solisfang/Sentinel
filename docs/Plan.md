# Sentinel Master Plan

> Last updated: 2026-03-21
>
> This file tracks the product roadmap at a high level. Phases 1-8 define the shipped or previously approved core roadmap. Phase 9 is the newly approved next enhancement set.

---

## Roadmap Status

| Phase | Description | Status | Priority |
|-------|-------------|--------|----------|
| Phase 1 | C# backend, idle detection, and Firebase connectivity | Complete | - |
| Phase 2 | React UI, timer, intervention modal, and auth shell | Complete | - |
| Phase 3 | WebView2 bridge, SQLite, settings, and persistence | Complete | - |
| Phase 4 | UX polish and intervention flow improvements | Complete | - |
| Phase 5 | Reporting and analytics dashboard | Complete | - |
| Phase 6 | Production build and distribution | Complete | - |
| Phase 7 | Advanced features | Complete | - |
| Phase 8 | Polish and optimization | Complete | - |
| Phase 9 | Distraction taxonomy and corner overlay | Complete | - |

---

## Current Focus

The next planned product pass is about lowering friction during distraction logging and making reporting smarter and more useful.

The approved goals are:

- let users reuse common distractions without retyping them every time
- group noisy raw distractions into user-controlled reporting categories
- let users clean up and edit taxonomy decisions later
- support a small corner overlay so Sentinel can stay visible without the full window staying open

---

## Completed Roadmap Summary

### Phase 1
- WPF shell with WebView2 host
- passive idle detection using `GetLastInputInfo`
- initial Firebase connectivity

### Phase 2
- React timer UI
- intervention modal
- local distraction logging state
- Firebase auth and sync shell

### Phase 3
- React to C# and C# to React messaging
- SQLite persistence
- settings UI and settings storage
- window persistence

### Phase 4
- improved visual design
- intervention options: distraction, false alarm, snooze, watching content
- timer pause and resume behavior
- configurable timer durations and presets

### Phase 5
- reports screen
- summary stats
- charts and recent session history
- date filtering

### Phase 6
- production asset build pipeline
- published Windows packaging flow

### Phase 7
- media suppression
- system sleep and wake recovery
- global hotkeys
- sound, goals, and export

### Phase 8
- onboarding
- accessibility improvements
- testing and performance cleanup
- crash reporting and final polish

---

## Phase 9: Distraction Taxonomy and Corner Overlay (Completed)

### Goal

Make distraction capture faster in the moment, make analytics cleaner over time, and make the app easier to keep visible during real desktop work.

### 9A. Faster Distraction Logging

Add quick-select distraction pills directly below the intervention input.

Requirements:

- show at least 5 pills
- prioritize the 2 most recent distractions
- add the 3 most frequent distractions
- de-duplicate if the same label appears in both groups
- allow a user to click a pill and submit immediately without typing
- keep typed entry available for new or uncommon distractions

### 9B. Distraction Categories and Mapping

When a user enters a new distraction, Sentinel should support lightweight taxonomy creation.

Requirements:

- preserve the raw distraction label exactly as the user entered it
- allow the raw label to stay uncategorized
- allow mapping to an existing category
- allow creating a new category inline
- make examples like `twitter` -> `Social Media` and `instagram` -> `Social Media` first-class supported behavior

### 9C. Historical Editing

Users should be able to revisit past distraction data and improve it later.

Requirements:

- review previously logged distraction labels
- rename labels if needed
- reassign labels to different categories
- create new categories later, not only during logging
- edit mappings without losing raw historical records

### 9D. Category-Aware Reporting

Reports should become more meaningful without hiding the original data.

Requirements:

- aggregate charts by category when a category exists
- retain raw-label drill-down or history visibility
- avoid fragmented reporting caused by near-duplicate entries
- keep local-first storage behavior intact

### 9E. Corner Overlay / Mini Window

Add an alternative lightweight always-visible mode for day-to-day use.

Requirements:

- a small corner overlay that fits comfortably in one screen corner
- essential timer visibility and quick controls only
- fast expand back to the full app
- appropriate for users who do not want the full window open all the time
- visually closer to a compact productivity popup than a full app screen

---

## Design and Data Guardrails

- This is a workflow and usability enhancement, not a product rebrand.
- Keep the current dark and violet Sentinel identity.
- Preserve local-first behavior and optional cloud sync.
- Do not replace raw distractions with categories; store both concepts.
- Treat categories and mappings as user-editable, not rigid defaults.
- Keep the intervention experience fast. Category mapping should help, not slow down the moment.
- The corner overlay should support awareness and basic actions, while deeper tasks stay in the full app.

---

## Suggested Implementation Slices

Recommended order for the future implementation pass:

1. Add local taxonomy data model and retrieval logic for recent and top distraction suggestions.
2. Update the intervention UI with quick pills and lightweight mapping controls.
3. Add historical taxonomy editing surface in reports or a dedicated management view.
4. Update reporting aggregation to use categories where available.
5. Add the corner overlay shell and the transition between overlay and full app.

---

## Key Documents to Keep in Sync

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/PROGRESS.md`
- `docs/PROMPTS.md`
- `docs/FAQ.md`
- `docs/STITCH_DESIGN_BRIEF.md`
