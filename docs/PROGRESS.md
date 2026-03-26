# Sentinel Development Progress

> Last updated: 2026-03-21
>
> This file tracks shipped progress and the newly approved next enhancement set.

---

## Overall Status

Sentinel's original 8-phase roadmap is documented as complete. The next approved product pass is now tracked as Phase 9.

---

## Phase Status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | The Invisible Engine | Complete | Backend shell and idle detection foundation |
| 2 | The Shiny UI | Complete | Timer UI, intervention shell, auth foundation |
| 3 | The Bridge | Complete | WebView2 messaging, SQLite, settings |
| 4 | UX Polish and Intervention Flow | Complete | Better UX and intervention handling |
| 5 | Reporting and Analytics Dashboard | Complete | Reports, charts, filters, summaries |
| 6 | Production Build and Distribution | Complete | Build pipeline and packaging |
| 7 | Advanced Features | Complete | Media suppression, sleep recovery, hotkeys, export |
| 8 | Polish and Optimization | Complete | Onboarding, accessibility, tests, optimization |
| 9 | Distraction Taxonomy and Corner Overlay | Complete | Taxonomy, mappings, corner overlay |

---

## Completed Highlights

### Phase 1
- WPF shell with WebView2
- passive idle detection via `GetLastInputInfo`
- Firebase connectivity groundwork

### Phase 2
- React timer UI
- intervention modal
- session completion summary
- auth and sync foundation

### Phase 3
- WebView2 bridge
- SQLite persistence
- settings UI and JSON settings persistence
- window position persistence

### Phase 4
- cleaner visual design
- timer pause during interventions
- false alarm, snooze, and watching content flows
- configurable durations and presets

### Phase 5
- reporting screen
- date filters
- summary cards and charts
- recent session history

### Phase 6
- production asset build output
- distribution and installer preparation

### Phase 7
- media suppression
- sleep and wake recovery
- global hotkeys
- sound, goals, and export

### Phase 8
- onboarding
- accessibility improvements
- tests
- crash reporting and polish

---

## Phase 9 (Completed Enhancements)

These items were completed in Phase 9.

| Enhancement | Purpose | Status |
|-------------|---------|--------|
| Quick-select distraction pills | Let users log repeated distractions without retyping | Complete |
| Recent and top distraction suggestions | Show at least 5 pills using recent and frequent history | Complete |
| Distraction categories and mappings | Group raw labels into cleaner reporting categories | Complete |
| Historical taxonomy editing | Let users edit labels, categories, and mappings later | Complete |
| Category-aware reporting | Improve analytics clarity without losing raw data | Complete |
| Corner overlay / mini-window mode | Keep Sentinel visible in a small corner popup | Complete |

---

## Current Documentation Note

The documentation now reflects the following agreed product direction:

- distraction suggestions should be fast and reusable in the intervention flow
- taxonomy should be user-controlled and editable over time
- reports should become category-aware while preserving raw entries
- Sentinel should support a lightweight corner overlay for everyday desktop use

---

## Known Product Gaps (Resolved in Phase 9)

These are not regressions in the shipped roadmap. They are the previously acknowledged gaps that Phase 9 solved.

| Gap | Why It Matters | Resolved By |
|-----|----------------|-------------------|
| Users must retype common distractions too often | Adds friction at the exact moment of interruption | Quick-select pills and history-driven suggestions |
| Similar distractions fragment reports | Analytics become noisy and harder to learn from | Category mapping and taxonomy editing |
| Historical cleanup is limited | Users cannot easily improve old data quality | Dedicated taxonomy management flow |
| Full window can feel heavy for constant visibility | Users may want a lighter always-visible timer presence | Corner overlay / mini-window mode |

---

## Next Step

Phase 9 is completed. Future enhancements will be discussed.
