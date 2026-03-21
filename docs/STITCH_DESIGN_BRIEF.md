# Sentinel Design Brief for Google Stitch

> Version: 1.1
> Date: 2026-03-21
> Purpose: This document is a design handoff brief for Google Stitch and similar AI screen-design tools. It is detailed on purpose so it can be reviewed first, then pasted fully or partially into Stitch to generate stronger desktop UI directions for Sentinel.

---

## 1. What This Brief Is For

Use this brief to generate polished desktop UI concepts for Sentinel.

It should help a design model understand:

- what Sentinel is
- who it is for
- what screens exist
- how users move through the product
- what functionality each screen must support
- what states and overlays exist
- what product rules must remain true
- what the visual style should feel like

This is for a **Windows desktop app**, not a mobile app.

---

## 2. Product Summary

### Product Name
Sentinel

### Product Type
Privacy-first focus timer and distraction accountability desktop app.

### Core Idea
Sentinel is not just a timer. During an active focus session, it detects idle drift and forces a quick intervention flow so the user acknowledges what distracted them. Over time, the app helps the user understand patterns in their attention and distraction habits.

### Core Promise

- helps users stay honest about distractions
- works local-first by default
- keeps cloud sync optional
- feels calm, serious, and productivity-oriented
- adds friction only when the user actually drifts
- gets smarter over time by learning repeated distractions and grouping them into better reporting categories

### Key Product Differentiators

Sentinel combines:

- focus timer
- idle detection
- interruption logging
- false-alarm handling
- snooze and watching-content modes
- quick distraction reuse via suggestion pills
- category-aware distraction reporting
- optional cloud sync
- small corner overlay mode for lightweight desktop presence

---

## 3. Target Users

Primary users:

- developers
- writers
- designers
- analysts
- deep-work professionals
- privacy-conscious desktop users

User mindset:

- they care about focus quality, not just minutes counted
- they do not want bloated gamification
- they want local ownership of their data
- they want a tool that feels intentional, elegant, and serious
- they want fast logging, not extra admin work in the middle of focus

---

## 4. Platform and Product Constraints

Sentinel is a **Windows desktop app** with a **native WPF shell** hosting a **React UI in WebView2**.

Important design constraints:

- design for desktop only
- default window size is about `480x640`
- minimum practical size is about `360x480`
- the main app window is resizable and can become much wider
- the product also supports a **small corner overlay / mini-window mode**
- the shell has a custom dark title bar with:
  - app name
  - minimize
  - maximize
  - close
- the UI should feel strong both in:
  - narrow floating window mode
  - wider resized desktop mode
  - tiny corner overlay mode

Do not design this as:

- a mobile app
- a tablet app
- a browser dashboard with browser chrome
- a social habit-tracking app

---

## 5. Product Personality and UX Goals

### Keywords

- focused
- calm
- intelligent
- private
- slightly strict
- elegant
- desktop-native

### Emotional Tone

- calm while focusing
- assertive during distraction intervention
- satisfying but restrained on completion
- trustworthy in settings, reporting, and data management

### UX Goals

- strong hierarchy
- clean spacing and grouping
- high scannability
- low friction for repeated actions
- desktop-grade polish
- structured settings and analytics
- a premium but restrained dark aesthetic
- obvious paths for fast action and deeper management

### What to Avoid

- neon cyberpunk overload
- childish gamification
- mobile bottom tabs
- oversaturated gradients everywhere
- toy-like controls
- enterprise-heavy tables on every screen

---

## 6. Visual Direction

### Color

- base: deep charcoal / graphite / near-black
- primary accent: violet / indigo
- success and short-break accent: emerald
- long-break accent: sky / cool blue
- warning / snooze / intervention accent: amber
- destructive accent: restrained red only when necessary

### Surfaces

- layered panels
- subtle transparency
- soft borders
- restrained shadow
- desktop-grade depth, not glossy mobile glass

### Typography

- clean modern sans serif
- strong legibility in small desktop windows
- premium timer numerals
- compact, confident headings

### Motion

- subtle transitions
- meaningful pulses only for urgency or live state
- overlay and modal transitions should feel smooth and intentional

---

## 7. Information Architecture

Primary screens and overlays:

1. Onboarding modal
2. Main timer screen
3. Preset picker popover
4. Intervention modal
5. Session complete screen
6. Settings screen
7. Reports screen
8. Distraction history / taxonomy manager
9. Account / auth screen
10. Sleep / resume prompt
11. Corner overlay / mini window

Navigation model:

- Main timer is the home screen
- Timer can open:
  - presets
  - reports
  - settings
  - overlay mode
- Settings can open account and deeper management areas
- Reports can link to distraction history or taxonomy editing
- Intervention and sleep/resume are modal overlays over the active context
- Onboarding appears only on first launch

---

## 8. Core Functionalities

### Timer System

- focus mode
- short break mode
- long break mode
- start / pause
- reset
- optional session name
- daily focus goal progress
- session complete state

### Presets

- Classic: 25 / 5 / 15
- Deep Work: 50 / 10 / 20
- Sprint: 15 / 3 / 10

### Idle Intervention

When the timer is running and the user is idle beyond the configured threshold:

- timer pauses
- intervention modal appears
- user can:
  - log distraction
  - mark false alarm
  - snooze for 5 / 10 / 30 minutes
  - mark watching content for 30 / 60 / 90 minutes

### Fast Distraction Logging

Inside the intervention modal:

- show at least 5 quick-select pills below the input
- use the 2 most recent distraction labels
- use the 3 most frequent distraction labels
- remove duplicates if needed
- clicking a pill should submit instantly
- typing should still work for new distractions

### Distraction Categories and Mapping

When a user enters a distraction:

- preserve the raw label exactly as entered
- allow keeping it uncategorized
- allow mapping it to an existing category
- allow creating a new category inline
- example: `twitter` and `instagram` can both map to `Social Media`

### Historical Editing

Users should be able to:

- review previously logged distractions
- edit labels later
- edit category mappings later
- create and rename categories
- improve report quality over time without losing raw historical data

### Reports

- focus time
- sessions completed
- distractions logged
- average session length
- top categories
- top raw distractions
- recent sessions list
- false alarm ratio
- date range filters

### Auth / Cloud Sync

- optional login
- optional signup
- logout
- cloud sync remains opt-in

### Overlay Behavior

- lightweight always-visible corner mode
- essential timer visibility and controls only
- expand back to full app quickly

---

## 9. Detailed User Flows

### Flow 1: First Launch

1. User opens Sentinel.
2. Onboarding appears.
3. User advances or skips.
4. User lands on the main timer screen.

### Flow 2: Standard Focus Session

1. User optionally names the session.
2. User chooses Focus, Short, or Long.
3. User presses Start.
4. Timer counts down.
5. Session completes.
6. User chooses Break or Again.

### Flow 3: Idle Intervention With Quick Suggestions

1. User is in an active focus session.
2. User goes idle beyond the threshold.
3. Intervention modal appears and the timer pauses.
4. Below the distraction input, the UI shows at least 5 pills:
   - recent 2 distractions
   - top 3 distractions
5. User can:
   - click a pill to submit instantly
   - type a new distraction manually
   - choose false alarm
   - choose snooze
   - choose watching content

### Flow 4: New Distraction With Category Mapping

1. User types a new distraction label such as `twitter`.
2. The UI offers a lightweight category step:
   - keep uncategorized
   - map to an existing category
   - create a new category
3. User confirms.
4. Sentinel stores the raw label and optional category mapping.

### Flow 5: Historical Taxonomy Cleanup

1. User opens a distraction history or taxonomy manager.
2. They review previously logged labels and categories.
3. They edit a mapping, rename a label, or create a new category.
4. Reports become cleaner and more meaningful.

### Flow 6: Review Reports

1. User opens Reports.
2. User selects a date range.
3. User reviews summary cards, charts, top categories, top raw distractions, and recent history.
4. User may jump into taxonomy editing from this area.

### Flow 7: Optional Cloud Sync

1. User opens Account from Settings.
2. User logs in or signs up.
3. User enables cloud sync in Settings.
4. Sessions and distraction history can sync to Firestore.

### Flow 8: Sleep / Wake Recovery

1. User is in an active session.
2. System sleeps.
3. Session pauses.
4. System wakes.
5. Resume prompt appears.
6. User resumes or starts fresh.

### Flow 9: Corner Overlay / Mini Window

1. User switches Sentinel into overlay mode.
2. Full app collapses into a small corner popup.
3. Overlay shows timer, current mode, and essential actions.
4. User can stay aware of the session without keeping the full app open.
5. User expands back to the full app for settings, reports, or taxonomy editing.

---

## 10. Screen-by-Screen Requirements

## 10.1 Main Timer Screen

### Purpose
Primary home screen and emotional center of the app.

### Content

- optional session name input
- mode selector: Focus / Short / Long
- large timer
- start or pause primary CTA
- reset secondary action
- status row:
  - sessions completed
  - distractions count
  - sync state if relevant
- daily goal progress
- snooze indicator if active
- navigation to presets, reports, settings, and overlay mode

### Notes

- timer must stay visually dominant
- layout must feel balanced in both narrow and wide windows
- navigation should feel integrated, not tacked on

---

## 10.2 Preset Picker Popover

### Purpose
Quickly apply a timer preset without leaving the main timer screen.

### Content

- preset name
- focus / short / long values
- active preset indication

### Notes

- lightweight floating panel
- visually related to the timer screen

---

## 10.3 Intervention Modal

### Purpose
The signature Sentinel interruption flow.

### Content

- heading such as `Still focused?`
- short explanation that the timer is paused
- distraction text input
- quick-select pills under the input:
  - recent 2
  - top 3
- inline category affordance when a new distraction is typed:
  - uncategorized
  - existing category
  - create category
- primary action: log distraction
- secondary action: false alarm
- snooze options: 5m / 10m / 30m
- watching content options: 30m / 60m / 90m

### Notes

- should feel more urgent than normal screens but still premium
- should be understandable in under 2 seconds
- category mapping must feel lightweight, not like filling a form
- clear grouping between:
  - quick log
  - dismiss
  - suppress temporarily

---

## 10.4 Session Complete Screen

### Purpose
Reward the user and guide the next action.

### Content

- completion message
- optional session name
- distraction breakdown mini-chart if relevant
- actions for Break and Again

### Notes

- satisfying and calm
- not game-like

---

## 10.5 Settings Screen

### Purpose
Control behavior, timing, account access, exports, and utility features.

### Ideal Grouping

Card 1: Timer and Presets
- focus minutes
- short break minutes
- long break minutes
- preset selection

Card 2: Idle and Behavior
- idle threshold
- sound
- always on top
- suppress during media
- cloud sync

Card 3: Goals and Export
- daily focus goal
- export JSON
- export CSV
- export status feedback

Card 4: Account and Shortcuts
- account entry point
- keyboard shortcuts reference
- update banner if needed

Card 5: Data Organization
- entry point to distraction history / taxonomy manager
- short explanation of categories and mappings

### Notes

- should feel structured, not like one long settings list
- toggles should include helper text
- cards can stack on narrow widths and form a grid on wider layouts

---

## 10.6 Reports Screen

### Purpose
Help users understand productivity and distraction patterns.

### Content

- header
- date range filter
- summary cards:
  - focus time
  - sessions
  - distractions
  - average session
- chart for daily focus
- chart for top categories
- secondary view for top raw distractions
- recent session history
- false alarm ratio
- entry point to edit distraction mappings or history

### Notes

- analytical but calm
- clear card structure
- readable even in narrow desktop sizes

---

## 10.7 Distraction History / Taxonomy Manager

### Purpose
Give users control over how distraction data is organized.

### Content

- searchable list or table of logged distractions
- raw distraction label
- mapped category
- frequency or recent usage
- edit action
- create category action
- rename category action
- filter by uncategorized items

### Notes

- should feel administrative but still clean and lightweight
- should support quick cleanup sessions without feeling like enterprise software
- this screen is important for long-term reporting quality

---

## 10.8 Account / Auth Screen

### Purpose
Manage optional sign-in for cloud sync.

### Content

- explanation that account is optional
- email and password fields
- login button
- signup button
- logged-in state with email and logout

### Notes

- should feel trustworthy and secondary to local-first usage

---

## 10.9 Sleep / Resume Prompt

### Purpose
Handle system sleep and wake during an active session.

### Content

- short message
- Resume action
- Start Fresh action

### Notes

- centered modal
- reassuring tone

---

## 10.10 Corner Overlay / Mini Window

### Purpose
Keep Sentinel visible in a tiny desktop footprint.

### Content

- current mode label
- remaining timer
- start / pause
- expand to full app
- optional quick log entry point if space allows

### Notes

- should feel like a polished desktop corner popup
- inspired by the convenience of small productivity popups like Microsoft To Do's lighter overlay feel, but visually consistent with Sentinel's dark premium design
- must be useful, not decorative

---

## 11. Functional Rules That Must Stay True

- focus timer is the primary workflow
- intervention only appears during active focus sessions
- intervention pauses the timer
- false alarm does not log a distraction
- snooze suppresses future interventions temporarily
- watching content is a longer suppression mode
- quick-select pills should reduce friction, not create extra decisions
- category mapping must preserve raw original entries
- users must be able to edit mappings later
- cloud sync is optional and off by default
- reports should show cleaner rollups without hiding raw history
- the corner overlay is a real usage mode, not a decorative mock
- keyboard use matters

---

## 12. Important States and Edge Cases

Stitch should reflect these states where relevant:

- timer idle
- timer running
- timer paused
- timer paused by intervention
- session complete
- snoozed
- signed out
- signed in
- loading reports
- empty reports
- export success
- export in progress
- uncategorized distractions present
- category creation while logging
- category edit after the fact
- overlay collapsed
- overlay expanded back to full app

---

## 13. Design System Guidance for Stitch

Ask Stitch to generate:

- a desktop-first component system
- reusable cards, toggles, inputs, buttons, pills, panels, chart cards, and modal patterns
- layouts that work in both narrow and wide windows
- a coherent relationship between the full app and the corner overlay

Important visual guidance:

- dark desktop productivity aesthetic
- premium but restrained
- subtle glassmorphism
- violet-led accent system
- strong spacing and grouping
- intentional pill styling for quick distraction suggestions
- calm but clear data-management UI for taxonomy editing

Do not ask Stitch for:

- mobile-first UI
- browser chrome
- playful streak dashboards
- social feed patterns

---

## 14. What Google Stitch Should Generate

Preferred output:

- one strong desktop visual direction
- connected screens instead of isolated shots
- a reusable component language
- strong layouts for:
  - main timer
  - intervention modal
  - settings
  - reports
  - taxonomy manager
  - auth
  - session complete
  - corner overlay

If using image input:

- provide current Sentinel screenshots
- tell Stitch to preserve functionality but significantly improve hierarchy, spacing, grouping, and desktop polish

---

## 15. Master Prompt for Google Stitch

Use the following as the main prompt:

```text
Design a Windows 11 desktop app called Sentinel.

Sentinel is a privacy-first focus timer and distraction accountability app. It is not just a Pomodoro timer. During an active focus session, the app detects user idleness and shows an intervention flow so the user can quickly acknowledge what distracted them, mark it as a false alarm, snooze idle detection, or mark that they are watching content. All data is local-first by default, with optional account login and optional cloud sync.

This is a desktop app with a native shell and a web UI inside it. Design for desktop only, not mobile. The default app window is narrow, around 480x640, but it is resizable and should also look good in wider desktop layouts. The product also has a small corner overlay or mini-window mode for users who do not want the full app open all the time.

The visual style should feel premium, focused, calm, dark, and privacy-oriented. Use deep charcoal or graphite surfaces, subtle glassmorphism, soft borders, strong hierarchy, and violet as the main accent. Use emerald for positive or break states, cool blue for long-break accents, amber for warnings or distraction states, and red only for destructive actions. Avoid playful gamification, neon cyberpunk, social-app patterns, or mobile tab-bar layouts.

Create a cohesive screen system for these screens and overlays:

1. Onboarding modal
- short multi-step intro
- what Sentinel is
- how idle detection works
- keyboard shortcuts
- local-first privacy

2. Main timer screen
- session name input
- focus / short / long mode selector
- large timer
- start or pause primary action
- reset secondary action
- stats row
- daily goal progress
- snooze indicator when active
- navigation to presets, reports, settings, and overlay mode

3. Preset picker popover
- Classic 25/5/15
- Deep Work 50/10/20
- Sprint 15/3/10

4. Intervention modal
- elegant but high-focus interruption state
- text input for distraction note
- at least 5 clickable suggestion pills below the input
- pills should represent the 2 most recent distractions and the 3 most frequent distractions
- clicking a pill should submit instantly
- if the user types a new distraction, show a lightweight category mapping affordance:
  - keep uncategorized
  - map to an existing category
  - create a new category
- false alarm action
- snooze options: 5m, 10m, 30m
- watching content options: 30m, 60m, 90m

5. Session complete screen
- subtle success state
- optional distraction breakdown mini chart
- actions for Break and Again

6. Settings screen
- grouped cards, not one long list
- timer and presets card
- idle and behavior card
- goals and export card
- account and shortcuts card
- data organization card with entry point to distraction history and category management
- helper descriptions for toggles

7. Reports screen
- date range filter
- summary cards
- daily focus chart
- top categories chart
- top raw distractions view
- recent sessions list
- false alarm ratio
- clear entry point into distraction history or taxonomy editing

8. Distraction history / taxonomy manager
- searchable list of logged distractions
- raw label
- mapped category
- frequency or recency
- edit mapping actions
- create and rename category actions
- filter for uncategorized distractions
- should feel clean and useful, not enterprise-heavy

9. Account/Auth screen
- optional login and signup flow
- logged-in state with email and logout
- should feel secondary to local-first usage

10. Sleep/wake resume prompt
- Resume or Start Fresh

11. Corner overlay / mini-window
- tiny desktop popup for one corner of the screen
- mode label
- timer
- start or pause
- expand back to full app
- should feel like a practical lightweight productivity popup, not a toy widget

Important behavior to respect:
- intervention only happens during active focus sessions
- intervention pauses the timer
- false alarm does not log a distraction
- snooze suppresses future interventions temporarily
- category mappings preserve raw original entries
- users can edit categories and mappings later
- cloud sync is optional and disabled by default
- keyboard-friendly behavior matters

Please generate a polished desktop-first design direction with connected screens, a reusable component system, and layouts that work in narrow window mode, wider desktop mode, and corner overlay mode.
```

---

## 16. Follow-Up Prompts for Stitch Iteration

### Prompt A: Improve the intervention flow

```text
Keep the same design direction, but explore 3 stronger variations for the intervention modal. Make the suggestion pills, text input, and category mapping affordance extremely fast to understand. The user should be able to act in under 2 seconds.
```

### Prompt B: Improve taxonomy management

```text
Keep the same visual system, but redesign the distraction history and taxonomy manager to feel cleaner and more approachable. It should support editing mappings, creating categories, and filtering uncategorized items without looking like enterprise admin software.
```

### Prompt C: Improve the corner overlay

```text
Keep the same design language, but explore 3 stronger concepts for the corner overlay or mini-window. It should feel practical, calm, premium, and genuinely useful for everyday desktop use. Preserve very small-footprint usability.
```

### Prompt D: Improve settings readability

```text
Keep the same design direction, but make the Settings screen feel significantly more structured and desktop-native. Emphasize grouped cards, helper text, better spacing, and a clear entry point to distraction history and category management.
```

---

## 17. Recommended Usage Strategy

Best way to use this brief with Stitch:

1. Paste the master prompt first.
2. Upload current Sentinel screenshots.
3. Ask for connected desktop screens, not isolated mobile-style mockups.
4. Review the first output for hierarchy, spacing, overlay practicality, and taxonomy clarity.
5. Use the follow-up prompts to refine one problem area at a time.
6. Export the strongest direction to Figma or implementation references.

---

## 18. Final Notes for Review

This brief is intended to preserve Sentinel's core behavior while making the experience more polished, faster to use, and more insightful over time.

The goal is:

- better spacing and hierarchy
- faster distraction capture
- cleaner reporting through categories
- stronger desktop-native layouts
- a genuinely useful corner overlay mode

The goal is not:

- turning Sentinel into a mobile app
- adding playful gamification
- replacing raw distraction logs with abstract categories
- overcomplicating the intervention moment
