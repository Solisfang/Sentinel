# Sentinel Vibe Coding Prompts

Use these prompts as the implementation brief for the next planned phase. Phases 1-8 are already captured in the historical roadmap. The next prompt below is the one intended for the upcoming build pass.

---

## Roadmap Snapshot

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | Backend, idle detection, Firebase connectivity | Complete |
| Phase 2 | React UI, timer, auth shell, intervention modal | Complete |
| Phase 3 | WebView2 bridge, SQLite, settings | Complete |
| Phase 4 | UX polish and intervention behavior | Complete |
| Phase 5 | Reports and analytics | Complete |
| Phase 6 | Production build and distribution | Complete |
| Phase 7 | Advanced features | Complete |
| Phase 8 | Optimization, onboarding, accessibility, testing | Complete |
| Phase 9 | Distraction taxonomy and corner overlay | Approved Next |

---

## Phase 9: Distraction Taxonomy and Corner Overlay

> Implement the next Sentinel enhancement pass without changing the product's local-first philosophy or the existing dark desktop visual identity.
>
> The goal is to reduce friction when users log distractions, improve analytics by grouping related distractions into categories, and add a small corner overlay mode so the app can stay visible without the full window remaining open.
>
> Deliver this in focused steps while keeping the app buildable and behaviorally stable.
>
> ### 9A. Quick distraction pills in the intervention flow
> 1. In the intervention modal, below the text input, render at least 5 clickable suggestion pills.
> 2. Populate them from:
>    - the 2 most recent distraction labels
>    - the 3 most frequent distraction labels
> 3. De-duplicate values if there is overlap.
> 4. Clicking a pill should immediately log that distraction without requiring the user to type it again.
> 5. Keep manual text entry for brand-new distractions.
>
> ### 9B. Distraction categories and mappings
> 1. Introduce a taxonomy model that preserves:
>    - the raw distraction label exactly as entered
>    - an optional mapped category
> 2. When the user types a new distraction, allow them to:
>    - submit it uncategorized
>    - map it to an existing category
>    - create a new category and map it immediately
> 3. Example behavior:
>    - `twitter` and `instagram` can both map to `Social Media`
> 4. Do not remove or overwrite the raw original label when a mapping exists.
>
> ### 9C. Historical editing
> 1. Add a screen or management area where users can review previously logged distractions.
> 2. Let users:
>    - edit a raw distraction label
>    - change the mapped category
>    - create or rename categories
>    - re-map historical labels later
> 3. Make this accessible from an existing place that makes sense, such as Reports or Settings.
>
> ### 9D. Reporting updates
> 1. Update report aggregation so category-aware rollups are available.
> 2. Preserve the ability to understand the raw logged entries.
> 3. Improve top-distraction reporting so near-duplicate labels no longer fragment the charts.
>
> ### 9E. Corner overlay / mini window
> 1. Add a small corner overlay mode inspired by lightweight desktop productivity popups.
> 2. It should show:
>    - current mode
>    - remaining timer
>    - start or pause
>    - fast return to the full app
> 3. It should be practical for users who do not want the full window open all the time.
> 4. Keep settings, reports, history editing, and deeper workflows in the full app.
>
> ### Constraints
> - Keep the existing React and WPF architecture.
> - Preserve the current WebView2 message contract unless a minimal additive change is clearly necessary.
> - Do not break existing intervention actions such as false alarm, snooze, and watching content.
> - Keep local-first data storage behavior intact.
> - Maintain keyboard accessibility and small-window usability.
>
> ### Verification
> - Add or update tests for the new suggestion-pill and shell behaviors.
> - Ensure reports still render correctly with category-aware aggregation.
> - Ensure the app builds successfully.
> - Manually validate both the default narrow window and the new corner overlay workflow.

---

## Optional Follow-Up Prompt

> Refine the Phase 9 implementation for polish and usability:
> - make category mapping feel lightweight inside the intervention modal
> - ensure historical editing is easy to scan and safe to use
> - make the overlay feel premium and unobtrusive
> - preserve consistent spacing, accessibility, and responsive behavior across all related views
