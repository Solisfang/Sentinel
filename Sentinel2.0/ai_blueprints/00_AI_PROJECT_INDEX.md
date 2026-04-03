# Sentinel AI Project Blueprint — Master Index

> This is the root document for Project Sentinel's AI-consumable blueprint. It describes the target system architecture and provides a comprehensive table of contents mapping every feature, interface, schema, and architectural rule to the specific blueprint file that defines it.

---

## System Architecture Summary

**Project Sentinel** is a privacy-first desktop Pomodoro timer with OS-level idle detection and server-side gamification. The application is being migrated from a legacy stack to a modern architecture:

| Layer | Source (Legacy) | Target (Current) |
|---|---|---|
| **Desktop Shell** | C# / .NET 8 / WPF / WebView2 | C# / .NET 8 / **Photino** (lightweight Chromium host) |
| **Frontend UI** | React 18 / Vite / TypeScript | **Angular** (Strict TypeScript, Standalone Components) |
| **Local Database** | SQLite via EF Core | **ELIMINATED** — replaced by Firestore offline persistence (IndexedDB) |
| **Cloud Backend** | Firebase (partial flat collections, no server logic) | **Firebase** (Firestore user-scoped subcollections, Auth, Cloud Functions v2) |
| **IPC Bridge** | `window.chrome.webview.postMessage` / `WebMessageReceived` | `window.external.sendMessage` / `receiveMessage` (Photino) |

**Three architectural pillars define the target system:**

1. **Dumb Shell / Smart Frontend:** The C# Photino shell is a thin native wrapper. It handles OS-level hooks (idle detection, media detection, active window whitelist, hotkeys, system sleep/resume) and settings file I/O. It does NOT manage UI state, store user data, or perform business logic. The Angular frontend owns all UI state, routing, and Firestore interactions.

2. **Firebase Hybrid Sync (Two Persistence Paths):**
   - **Standard Persistence** — Settings, Planner blocks, and Taxonomy documents use Firestore's native read/write with `onSnapshot` listeners. Offline writes queue automatically via IndexedDB.
   - **Secure Event Ledger** — Focus sessions and distractions are recorded as immutable, append-only events in `users/{uid}/session_events/`. The client writes events; it NEVER updates or deletes them. Cloud Functions process these events server-side.

3. **Server-Side Gamification Authority:** All gamification metrics (daily aggregates, streaks, achievements, Swift Recovery bonuses, Shiny Badge RNG) are computed exclusively by Firebase Cloud Functions triggered by `onDocumentCreated` on the Event Ledger. The Angular client reads results from Firestore aggregate documents but never computes or writes them. This prevents client-side cheating.

**Firestore document hierarchy:**

```
users/{uid}/
  ├── settings                              (Standard Persistence — read/write)
  ├── planner_blocks/{blockId}              (Standard Persistence — read/write)
  ├── taxonomy/{normalizedNote}             (Standard Persistence — read/write)
  ├── session_events/{eventId}              (Event Ledger — append-only, 7 event types)
  ├── stats/
  │   ├── daily/{YYYY-MM-DD}               (Server-Computed — read-only for client)
  │   ├── streaks                           (Server-Computed — read-only for client)
  │   └── perfect_sessions                  (Server-Computed — read-only for client)
  ├── achievements/{achievementId}          (Server-Computed — read-only for client)
  └── processed_events/{eventId}            (Idempotency guard — inaccessible to client)
```

**IPC message flow:**

```
C# Photino Shell                          Angular Frontend
┌──────────────────┐                     ┌──────────────────────────┐
│ UserActivityMon. │──IDLE_DETECTED────►│ BridgeService            │
│ MediaDetector    │──USER_ACTIVE──────►│   → InterventionService  │
│ SystemSuspendMon.│──SYSTEM_SUSPEND───►│   → TimerService         │
│ HotkeyManager    │──HOTKEY_*─────────►│   → EventLedgerService   │
│ SettingsService  │◄─SAVE_SETTINGS────│   → SettingsService      │
│ UpdateChecker    │──UPDATE_AVAILABLE─►│   → Firestore (direct)   │
└──────────────────┘                     └──────────────────────────┘
```

**Firebase project:** `sentinel-s073`

---

## Quick-Reference Lookup Table

Use this table to find the correct blueprint file for any feature, interface, or architectural rule.

| If you need to understand... | Open this file |
|---|---|
| Source (legacy) codebase inventory, entity definitions, migration principles | `01_SYSTEM_OVERVIEW.md` |
| Target vs. source IPC message registry comparison | `01_SYSTEM_OVERVIEW.md` §1.1.3 + §1.2.3 |
| Glossary of domain terms (Distraction Auditor, Event Ledger, etc.) | `01_SYSTEM_OVERVIEW.md` §1.5 |
| Photino `PhotinoWindow` setup, `Program.cs`, window management | `02_TECH_STACK.md` |
| Compact mode / mini-overlay (pill, compact, monitoring styles) | `02_TECH_STACK.md` §2.3.2 |
| Global hotkey registration (`RegisterHotKey` P/Invoke) | `02_TECH_STACK.md` §2.4 |
| DPI awareness manifest, crash reporter | `02_TECH_STACK.md` §2.1.3, §2.2.4 |
| IPC message envelope schema (`{ type, payload }`) | `03_ARCHITECTURE.md` §3.1.3 |
| Complete outbound message catalog (C# → Angular) | `03_ARCHITECTURE.md` §3.2 |
| Complete inbound message catalog (Angular → C#) | `03_ARCHITECTURE.md` §3.3 |
| C# `IpcDispatcher` switch block (full handler code) | `03_ARCHITECTURE.md` §3.5 |
| Angular `BridgeService` inbound dispatch patterns | `03_ARCHITECTURE.md` §3.6 |
| Which source IPC messages are DROPPED vs. PORTED vs. REDESIGNED | `03_ARCHITECTURE.md` §3.2–§3.3 |
| `UserActivityMonitor` idle detection (P/Invoke, state machine, suppression) | `04_DATA_MODELS_AND_STORAGE.md` §4.1 |
| Snooze mechanism (DateTime-based expiry) | `04_DATA_MODELS_AND_STORAGE.md` §4.2 |
| `MediaDetector` COM interop (`IAudioMeterInformation`) | `04_DATA_MODELS_AND_STORAGE.md` §4.3 |
| Active window whitelist (`ActiveWindowMonitor` — NEW) | `04_DATA_MODELS_AND_STORAGE.md` §4.4–§4.5 |
| Complete target C# service files (verbatim code) | `04_DATA_MODELS_AND_STORAGE.md` §4.5–§4.8 |
| Angular project scaffold, `angular.json`, `tsconfig.json` | `05_STATE_MANAGEMENT.md` §5.1 |
| Tailwind v4 "Obsidian Sanctuary" design system tokens | `05_STATE_MANAGEMENT.md` §5.1.4 |
| Shared components (`GlyphComponent`, `WorkspaceLayout`, `SectionCard`, `ModalLayout`) | `05_STATE_MANAGEMENT.md` §5.2 |
| Routing (`app.routes.ts`, lazy loading, `authGuard`) | `05_STATE_MANAGEMENT.md` §5.3 |
| Timer engine (drift-free anchor-based, `TimerService`, signals) | `05_STATE_MANAGEMENT.md` §5.4 |
| Distraction intervention flow (trigger → freeze → modal → submit → resume) | `05_STATE_MANAGEMENT.md` §5.5 |
| Planner module (Teams-style calendar — NEW) | `05_STATE_MANAGEMENT.md` §5.6 |
| Reports module (server-computed aggregates, charts) | `05_STATE_MANAGEMENT.md` §5.7 |
| Session history module (paginated Firestore query) | `05_STATE_MANAGEMENT.md` §5.8 |
| Taxonomy manager (category CRUD, triage workflow) | `05_STATE_MANAGEMENT.md` §5.9 |
| Settings module (all fields, presets, whitelist editor) | `05_STATE_MANAGEMENT.md` §5.10 |
| Auth module (Firebase Auth, Google sign-in) | `05_STATE_MANAGEMENT.md` §5.11 |
| Onboarding wizard (first-launch detection) | `05_STATE_MANAGEMENT.md` §5.12 |
| Core Angular services summary table | `05_STATE_MANAGEMENT.md` §5.13 |
| Keyboard shortcuts | `05_STATE_MANAGEMENT.md` §5.14 |
| Source entity definitions (Distraction, Session, AppSettings) | `06_UI_AND_ROUTING.md` §6.1 |
| Firestore document schemas (settings, planner, taxonomy) | `06_UI_AND_ROUTING.md` §6.2.1 |
| Event Ledger schemas (all 7 event types, envelope interface) | `06_UI_AND_ROUTING.md` §6.2.2 |
| `EventLedgerService` complete code | `06_UI_AND_ROUTING.md` §6.2.2.8 |
| Server-computed aggregate schemas (daily stats, streaks, achievements) | `06_UI_AND_ROUTING.md` §6.2.3 |
| Complete target TypeScript models file (`models.ts`) | `06_UI_AND_ROUTING.md` §6.5 |
| Source-to-target entity mapping table | `06_UI_AND_ROUTING.md` §6.4 |
| Firebase offline persistence (`enableIndexedDbPersistence`) | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.1 |
| Standard Persistence services (`SettingsService`, `TaxonomyService`) | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.2 |
| Event Ledger append-only enforcement (3 levels) | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.3.2 |
| Why `serverTimestamp()` was replaced with client ISO 8601 | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.3.4 |
| Complete Firestore security rules (target) | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.4 |
| SQLite → Firestore data migration utility | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.5 |
| Angular service dependency graph (sync architecture) | `07_SERVICES_AND_OS_INTEGRATIONS.md` §7.6 |
| Cloud Functions project structure (`pipeline/`, `handlers/`, `engines/`) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.1 |
| Event processing pipeline (4 stages: validate → idempotency → dispatch → handle) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.2 |
| Focus time calculation & daily aggregate engine | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.3 |
| Streak tracking engine (day boundary logic, timezone handling) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.4 |
| Achievement system (12 achievements: 4 categories × 3 tiers) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.5 |
| Swift Recovery multiplier (3 speed tiers: Instant/Fast/Swift) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.6 |
| Shiny Badge RNG (4 rarity tiers, server-side `crypto.randomInt`) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.7 |
| Migrated event handling (`migrated: true` flag) | `08_BUSINESS_LOGIC_AND_GAMIFICATION.md` §8.8 |
| Migration execution plan (12 phases, dependency graph) | `09_ERROR_HANDLING.md` §9 |
| Phase-by-phase deliverables, acceptance criteria, file maps | `09_ERROR_HANDLING.md` §9.1–§9.12 |
| Build script (`build.ps1`) and installer (`installer.iss`) changes | `09_ERROR_HANDLING.md` §9.12 |
| Release cutover plan (beta → RC → production → monitoring) | `09_ERROR_HANDLING.md` §9.12.6 |
| Complete phase↔section↔file cross-reference | `09_ERROR_HANDLING.md` §9.13 |

---

## Master Table of Contents

### 01_SYSTEM_OVERVIEW.md

- **§1. System Overview**
  - §1.1. Source Architecture Summary
    - §1.1.1. WPF + WebView2 + React + SQLite Stack
    - §1.1.2. Source Entity Definitions
      - Distraction Entity
      - Session Entity
      - AppSettings Model
      - CustomPreset Model
      - TaxonomyData (DistractionGroup, Category)
      - ReportData Aggregate DTO
    - §1.1.3. Source IPC Message Registry
      - Outbound (C# → React): SETTINGS_LOADED, REPORT_DATA, TAXONOMY_DATA, SESSION_LIST, UPDATE_AVAILABLE, SNOOZE_STATUS, IDLE_DETECTED, USER_ACTIVE, SEED_COMPLETE, EXPORT_COMPLETE
      - Inbound (React → C#): SAVE_SETTINGS, LOG_DISTRACTION, LOG_SESSION, GET_REPORT_DATA, GET_TAXONOMY_DATA, SNOOZE, WATCHING_CONTENT, CANCEL_SNOOZE, TOGGLE_COMPACT, INTERVENTION_DISMISSED, TIMER_RUNNING, GET_SETTINGS, CHECK_UPDATE, EXPORT_DATA, OVERLAY_CLOSE, OVERLAY_MINIMIZE, JS_ERROR, RENAME_CATEGORY, UPDATE_DISTRACTION_GROUP, DELETE_DISTRACTION_GROUP
    - §1.1.4. Source SQLite Schema
    - §1.1.5. Source Firestore Schema (Flat Collections)
  - §1.2. Target Architecture Summary
    - §1.2.1. Photino + Angular + Firebase Stack
    - §1.2.2. Target Firestore Schemas
      - User-Scoped Document Paths
      - Event Ledger (session_events)
      - Standard Persistence (settings, planner_blocks, taxonomy)
      - Server-Computed Aggregates (stats/daily, stats/streaks, achievements)
    - §1.2.3. Target IPC Message Registry (Reduced Surface)
  - §1.3. Migration Principles
    - 10 Non-Negotiable Constraints
  - §1.4. Source File Inventory
  - §1.5. Glossary of Domain Terms
  - §1.6. Document Conventions

---

## 02_TECH_STACK.md

- **§2. Photino C# Shell & Native Host**
  - §2.1. Project Scaffold
    - §2.1.1. .csproj — Source vs. Target
    - §2.1.2. Publish Profile (Single-File, Self-Contained)
    - §2.1.3. Application Manifest (`app.manifest`)
    - §2.1.4. Angular Dist Embedding Strategy (wwwroot)
  - §2.2. Application Lifecycle
    - §2.2.1. Entry Point (`Program.cs`) — PhotinoWindow Initialization
    - §2.2.2. Startup Sequence
    - §2.2.3. Graceful Shutdown
    - §2.2.4. Crash Reporter (AppDomain + TaskScheduler Handlers)
  - §2.3. Window Management
    - §2.3.1. Main Window Properties
    - §2.3.2. Compact Mode / Mini-Overlay (3 Overlay Styles: Pill, Compact, Monitoring)
    - §2.3.3. DragMove via CSS (`-webkit-app-region: drag`)
    - §2.3.4. Power State: Sleep/Resume via `WndProc` Subclass
  - §2.4. Global Hotkey Registration
    - §2.4.1. Ctrl+Shift+S (Start/Pause)
    - §2.4.2. Ctrl+Shift+D (Log Distraction)
    - §2.4.3. NativeMethods P/Invoke Declarations
    - §2.4.4. WndProc Implementation (Hotkeys + Power Broadcast)

---

## 03_ARCHITECTURE.md

- **§3. IPC Bridge (C# ↔ Angular)**
  - §3.1. Transport Mechanism
    - §3.1.1. Photino `SendMessage` / `receiveMessage` vs. WebView2
    - §3.1.2. JSON Serialization (Strict camelCase via `IpcSerializer`)
    - §3.1.3. Message Envelope Schema (`{ type, payload }`)
  - §3.2. Outbound Messages (C# → Angular)
    - §3.2.1. IDLE_DETECTED
    - §3.2.2. USER_ACTIVE
    - §3.2.3. SETTINGS_LOADED (Redesigned — no `todaySessionsCompleted`)
    - §3.2.4. REPORT_DATA (DROPPED)
    - §3.2.5. TAXONOMY_DATA (DROPPED)
    - §3.2.6. SESSION_LIST (DROPPED)
    - §3.2.7. UPDATE_AVAILABLE
    - §3.2.8. SNOOZE_STATUS
    - §3.2.9. SYSTEM_SUSPEND / SYSTEM_RESUME
    - §3.2.10. HOTKEY_START_PAUSE / HOTKEY_DISTRACTION
    - §3.2.11. COMPACT_MODE_CHANGED
  - §3.3. Inbound Messages (Angular → C#)
    - §3.3.1. SAVE_SETTINGS (with full handler code)
    - §3.3.2. LOG_DISTRACTION (DROPPED)
    - §3.3.3. LOG_SESSION (DROPPED)
    - §3.3.4. GET_REPORT_DATA (DROPPED)
    - §3.3.5. GET_TAXONOMY_DATA (DROPPED)
    - §3.3.6. SNOOZE_IDLE (merged from SNOOZE + WATCHING_CONTENT)
    - §3.3.7. CANCEL_SNOOZE
    - §3.3.8. TOGGLE_COMPACT
    - §3.3.9. AUDITOR_CLEARED (renamed from INTERVENTION_DISMISSED)
    - §3.3.10. TIMER_RUNNING
    - §3.3.11. GET_SETTINGS
    - §3.3.12. CHECK_UPDATE
    - §3.3.13. OVERLAY_CLOSE / OVERLAY_MINIMIZE
    - §3.3.14. JS_ERROR
  - §3.4. Error Handling
    - §3.4.1. Unknown Type Logging
    - §3.4.2. Malformed Payload Rejection
    - §3.4.3. Thread Marshalling
  - §3.5. Complete C# IPC Dispatch Handler (Switch Block)
  - §3.6. Angular-Side IPC Integration Patterns
    - §3.6.1. Startup Handshake
    - §3.6.2. Timer ↔ Idle Sync
    - §3.6.3. Idle Detection → Distraction Auditor → Event Ledger Flow (Complete)

---

## 04_DATA_MODELS_AND_STORAGE.md

- **§4. OS-Level Hooks & Native Interop**
  - §4.1. Idle Detection Engine (`UserActivityMonitor`)
    - §4.1.1. `GetLastInputInfo` P/Invoke
    - §4.1.2. Polling Loop (`DispatcherTimer` → `System.Timers.Timer`)
    - §4.1.3. `IdleEventArgs`
    - §4.1.4. State Machine (2 States: MONITORING ↔ IDLE_DETECTED)
    - §4.1.5. Three Suppression Conditions
    - §4.1.6. Start / Stop / Dispose Lifecycle
  - §4.2. Snooze Mechanism
    - §4.2.1. DateTime-Based Expiry
    - §4.2.2. Snooze / CancelSnooze Methods
    - §4.2.3. Auto-Expire Logic
  - §4.3. Media-Aware Suppression (`MediaDetector`)
    - §4.3.1. COM `IAudioMeterInformation` Interface
    - §4.3.2. Peak Threshold (> 0.001f)
    - §4.3.3. Complete COM Interop Declarations
  - §4.4. Active Window Whitelist (NEW)
    - §4.4.1. `GetForegroundWindow` / `GetWindowThreadProcessId` P/Invoke
    - §4.4.2. Process Name Resolution
    - §4.4.3. Case-Insensitive `HashSet` Matching + `.exe` Stripping
    - §4.4.4. Delegate Injection into `UserActivityMonitor`
  - §4.5. Target File: `ActiveWindowMonitor.cs`
  - §4.6. Target File: `UserActivityMonitor.cs`
  - §4.7. Target File: `MediaDetector.cs`
  - §4.8. Target File: `IdleEventArgs.cs`
  - §4.9. Cross-Reference Table

---

## 05_STATE_MANAGEMENT.md

- **§5. Angular Frontend Application**
  - §5.1. Project Scaffold
    - §5.1.1. Angular CLI Strict Mode
    - §5.1.2. `tsconfig.json` Configuration
    - §5.1.3. `angular.json` Build Configuration
    - §5.1.4. Tailwind CSS v4 Integration ("Obsidian Sanctuary" Design System)
    - §5.1.5. Code-Splitting Strategy (8 Modules)
  - §5.2. Shared Components
    - §5.2.1. `GlyphComponent` (24 Icons)
    - §5.2.2. `WorkspaceLayoutComponent` (7 Nav Items incl. Planner)
    - §5.2.3. `SectionCardComponent`
    - §5.2.4. `ModalLayoutComponent`
    - §5.2.5. Theme Constants (`MODE_META`)
    - §5.2.6. Responsive Breakpoints (Compact vs. Full)
  - §5.3. Routing
    - §5.3.1. `app.routes.ts` (Lazy-Loaded Standalone Components)
    - §5.3.2. `authGuard`
    - §5.3.3. Deep-Link Support from IPC
  - §5.4. Core Timer Module
    - §5.4.1. Drift-Free Anchor-Based Engine (`TimerService` with Angular Signals)
    - §5.4.2. `timerAnchor` Pattern + `setInterval` at 250ms
    - §5.4.3. State Machine Diagram
    - §5.4.4. Presets (`PRESETS` Array)
      - §5.4.4.1. Timer Screen UI (Circular Progress Ring)
      - §5.4.4.2. Start / Pause / Reset Controls
      - §5.4.4.3. Session Name Input
      - §5.4.4.4. Daily Focus Goal Progress (`calculateGoalProgress()`)
    - §5.4.5. Session Completion Flow (Event Ledger Writes)
  - §5.5. Distraction Intervention Flow
    - §5.5.1. Trigger from `IDLE_DETECTED`
    - §5.5.2. Timer Freeze
    - §5.5.3. Forced Overlay Modal (Note Input, Category Selection, False Alarm, Quick Suggestions)
    - §5.5.4. Taxonomy Engine (`normalizeDistractionNote`, `getMappedCategoryForNote`, `buildQuickSuggestions`)
    - §5.5.5. Submission via `EventLedgerService`
    - §5.5.6. Timer Resume after `AUDITOR_CLEARED`
  - §5.6. Planner Module (NEW)
    - §5.6.1. Calendar Grid (Day / Week / Month Views)
    - §5.6.2. Drag-to-Create / Resize / Move
    - §5.6.3. `PlannedBlock` Model with `RepeatRule`
    - §5.6.4. Firestore Standard Persistence
  - §5.7. Reports Module
    - §5.7.1. Data Source Change (IPC → Firestore Direct Reads from `stats/daily`)
    - §5.7.2. `ReportData` Interface + Metric Cards
    - §5.7.3. Distraction Breakdown (Category Pie Chart, Frequency Bar Chart)
    - §5.7.4. Daily History Timeline (Bar Chart)
    - §5.7.5. Date Range Selector (Since Date Filter)
    - §5.7.6. Daily Focus Goal vs. Actual Visualization
  - §5.8. Session History Module
    - §5.8.1. Paginated Session List (Firestore Query — No IPC)
    - §5.8.2. Session Detail Card (Name, Duration, Start/End, EarlyEnd Badge)
    - §5.8.3. Distraction Log Per Session
  - §5.9. Taxonomy Manager Module
    - §5.9.1. Full Taxonomy Tree View
    - §5.9.2. Category Rename Operation (Firestore Direct — No IPC)
    - §5.9.3. Note → Category Remap Operation
    - §5.9.4. Uncategorized Distraction Triage Workflow
  - §5.10. Settings Module
    - §5.10.1. Pomodoro Duration Settings
    - §5.10.2. Break Duration Settings
    - §5.10.3. Idle Threshold Adjustment (Seconds Slider)
    - §5.10.4. Always-On-Top Toggle
    - §5.10.5. Suppress During Media Toggle
    - §5.10.6. Daily Focus Goal (Minutes)
    - §5.10.7. Overlay Style Preference
    - §5.10.8. Cloud Sync Enable/Disable Toggle
    - §5.10.9. Custom Preset Management (Add / Edit / Delete)
    - §5.10.10. Active Window Whitelist Editor (New — Target Architecture)
  - §5.11. Account & Auth Module
    - §5.11.1. Firebase Auth Integration (Email/Password, Google Sign-In)
    - §5.11.2. Auth State Listener & User Context Provider
    - §5.11.3. Sign-In / Sign-Up / Sign-Out Screens
    - §5.11.4. Account Profile Display
  - §5.12. Onboarding Flow
    - §5.12.1. First-Launch Detection
    - §5.12.2. Onboarding Modal Wizard (Welcome, Preset Selection, Goal Setting)
    - §5.12.3. Initial Settings Persistence on Completion
  - §5.13. Core Services Summary
  - §5.14. Keyboard Shortcuts
  - §5.15. IPC Message Handling — Angular `BridgeService` Inbound Dispatch
  - §5.16. Cross-Reference Table

---

## 06_UI_AND_ROUTING.md

- **§6. Data Models & Schema**
  - §6.1. Local Models (C# & TypeScript)
    - §6.1.1. Distraction Entity (Field-by-Field)
    - §6.1.2. Session Entity (Field-by-Field)
    - §6.1.3. AppSettings Model (All Fields + Validation Rules)
    - §6.1.4. ReportData Aggregate DTO
    - §6.1.5. Taxonomy Models (`DistractionGroup`, `Category`)
    - §6.1.6. `DistractionNormalizer` Utility
  - §6.2. Firestore Document Schemas
    - §6.2.1. Standard Persistence
      - §6.2.1.1. Settings (`users/{uid}/settings`)
      - §6.2.1.2. Planner Blocks (`users/{uid}/planner_blocks/{blockId}`)
      - §6.2.1.3. Taxonomy (`users/{uid}/taxonomy/{normalizedNote}`)
        - Upsert / Rename / Delete Operations
        - Complete `TaxonomyService` Code
    - §6.2.2. Secure Event Ledger
      - §6.2.2.1. `TimerStarted` Event Schema
      - §6.2.2.2. `TimerPaused` Event Schema
      - §6.2.2.3. `TimerCompleted` / `TimerEndedEarly` Event Schema
      - §6.2.2.4. `IdleDetected` Event Schema
      - §6.2.2.5. `DistractionLogged` Event Schema
      - §6.2.2.6. `FalseAlarmMarked` Event Schema
      - §6.2.2.7. Event Envelope (`SessionEvent<T>` Interface)
      - §6.2.2.8. `EventLedgerService` (Complete Code)
      - §6.2.2.9. Firestore Security Rules for `session_events`
    - §6.2.3. Server-Computed Aggregates
      - §6.2.3.1. Daily Stats (`users/{uid}/stats/daily/{date}`)
      - §6.2.3.2. Streaks (`users/{uid}/stats/streaks`)
      - §6.2.3.3. Achievements (`users/{uid}/achievements/{achievementId}`)
  - §6.3. IPC Settings Payload Shapes
  - §6.4. Source-to-Target Entity Mapping Table
  - §6.5. Complete Target TypeScript Models File (`src/app/core/models.ts`)
  - §6.6. Cross-Reference Table

---

## 07_SERVICES_AND_OS_INTEGRATIONS.md

- **§7. Firebase Hybrid Sync Architecture**
  - §7.1. Optimistic Offline Strategy
    - §7.1.1. `enableIndexedDbPersistence` Configuration (Complete `firebase.provider.ts`)
    - §7.1.2. Offline Write Queue (Replacing `pendingSyncsRef`)
    - §7.1.3. Conflict Resolution (LWW vs. Append-Only)
  - §7.2. Standard Persistence Path (Direct Firestore Writes)
    - §7.2.1. `SettingsService` with Dual Sync (IPC + Firestore)
    - §7.2.2. `TaxonomyService` with Complete CRUD Operations
    - §7.2.3. Real-Time Snapshot Listeners for Cross-Device Sync
    - §7.2.4. Local Cache Read Priority
  - §7.3. Secure Event Ledger Path
    - §7.3.1. Client-Side Event Construction (All 7 Event Types — Complete TypeScript Code)
    - §7.3.2. Append-Only Enforcement at 3 Levels
    - §7.3.3. `pendingSyncsRef` Elimination
    - §7.3.4. Event Ordering with Client Timestamps
    - §7.3.5. Anti-Tampering Rationale
  - §7.4. Firestore Security Rules (Complete Target Rules)
    - §7.4.1. User Isolation (`request.auth.uid == uid`)
    - §7.4.2. Event Ledger Write-Only (No Update/Delete)
    - §7.4.3. Server-Computed Read-Only (`stats/`, `achievements/`)
    - §7.4.4. Rate Limiting Strategy
  - §7.5. Data Migration: SQLite → Firestore
    - §7.5.1. One-Time Migration Utility (Flow Diagram + C# `MigrationService`)
    - §7.5.2. Session History Backfill as Ledger Events
    - §7.5.3. Distraction History Backfill (+ Taxonomy Backfill)
    - §7.5.4. Deduplication Strategy for Migrated Records
  - §7.6. Angular Service Architecture for Sync (Dependency Graph + Complete Session Lifecycle Flow)
  - §7.7. Cross-Reference Table

---

## 08_BUSINESS_LOGIC_AND_GAMIFICATION.md

- **§8. Cloud Functions — Server-Side Authority & Gamification**
  - §8.1. Function Deployment
    - §8.1.1. Node.js/TypeScript Project Structure (`pipeline/`, `handlers/`, `engines/`)
    - §8.1.2. `package.json` & `tsconfig.json`
    - §8.1.3. Function Entry Point (`onDocumentCreated` Trigger)
    - §8.1.4. `FUNCTION_CONFIG` (All Thresholds)
  - §8.2. Event Ledger Processing Pipeline (4 Stages)
    - §8.2.1. Stage 1: Validation (`event-processor.ts`)
    - §8.2.2. Stage 2: Schema & Plausibility Checks (`event-validator.ts`)
    - §8.2.3. Stage 3: Idempotency (`idempotency.ts` — `processed_events` Subcollection)
    - §8.2.4. Stage 4: Dispatch & Handler Routing (`event-dispatcher.ts`)
  - §8.3. Focus Time Calculation Engine
    - §8.3.1. Session Duration Validation (Cross-Check)
    - §8.3.2. Daily Aggregate Creation/Update (`timer-completed.ts` Handler)
    - §8.3.3. `distraction-logged.ts` Handler
    - §8.3.4. `false-alarm.ts` Handler
  - §8.4. Streak Tracking Engine
    - §8.4.1. `streak.ts` — Day Boundary Logic
    - §8.4.2. Timezone Handling Rationale
    - §8.4.3. `getPreviousDateKey()` Function
  - §8.5. Achievement & Badge System
    - §8.5.1. 12 Achievements (4 Categories × 3 Tiers)
    - §8.5.2. `ACHIEVEMENT_DEFINITIONS` Array
    - §8.5.3. `checkAchievements` with `gatherMetrics` + `perfect_sessions` Counter
    - §8.5.4. Duplicate Award Prevention
  - §8.6. Swift Recovery Multiplier
    - §8.6.1. Trigger: `DistractionLogged` Event Created
    - §8.6.2. Lookup: Most Recent `IdleDetected` Event for Same Session
    - §8.6.3. Time Delta Calculation (`DistractionLogged.timestamp − IdleDetected.timestamp`)
    - §8.6.4. Threshold: Delta < 60 Seconds Qualifies
    - §8.6.5. Bonus Points Calculation & Application (`swiftRecoveryCount`)
    - §8.6.6. Recovery Speed Tiers (Instant < 15s, Fast < 30s, Swift < 60s)
  - §8.7. Shiny Badge RNG System
    - §8.7.1. Trigger: Perfect Focus Block (No Distractions, No Early End)
    - §8.7.2. Server-Side RNG (`crypto.randomInt()`)
    - §8.7.3. Drop Rate Table (Common 60%, Uncommon 25%, Rare 12%, Legendary 3%)
    - §8.7.4. Badge Catalog & Aesthetic Variants (12 Regular + 12 Shiny)
    - §8.7.5. Badge Document Write with Rarity Metadata
    - §8.7.6. Anti-Cheat: Why RNG Must Be Server-Side
  - §8.8. Migrated Event Handling (`migrated: true` Flag)
  - §8.9. Cross-Reference Table

---

## 09_ERROR_HANDLING.md

- **§9. Migration Execution Plan (12 Phases)**
  - §9.1. Phase 1: Photino Shell Scaffold
    - §9.1.1. Deliverables Table
    - §9.1.2. Complete `.csproj`
    - §9.1.3. `Program.cs`
    - §9.1.4. `IpcDispatcher.cs`
    - §9.1.5. `IpcMessageTypes.cs`
    - §9.1.6. Placeholder `index.html`
    - §9.1.7. Acceptance Criteria
  - §9.2. Phase 2: OS Hooks
    - §9.2.1. Deliverables Table
    - §9.2.2. Source → Target File Map
    - §9.2.3. Breaking Changes
    - §9.2.4. Implementation Steps (Service Wiring Code)
    - §9.2.5. Acceptance Criteria
  - §9.3. Phase 3: Angular App Scaffold
    - §9.3.1. Deliverables Table
    - §9.3.2. Project Structure
    - §9.3.3. Design System Integration (`@theme` CSS)
    - §9.3.4. `BridgeService` Implementation
    - §9.3.5. Build Pipeline
    - §9.3.6. Acceptance Criteria
  - §9.4. Phase 4: Timer Module & Intervention
    - §9.4.1. Deliverables Table
    - §9.4.2. Timer States Diagram
    - §9.4.3. Intervention Modal Behavior
    - §9.4.4. Acceptance Criteria
  - §9.5. Phase 5: Firebase Auth & Standard Persistence
    - §9.5.1. Deliverables Table
    - §9.5.2. Firebase Initialization
    - §9.5.3. Dual Settings Sync
    - §9.5.4. Acceptance Criteria
  - §9.6. Phase 6: Event Ledger Client-Side
    - §9.6.1. Deliverables Table
    - §9.6.2. 7 Event Types Table
    - §9.6.3. `EventLedgerService` Implementation
    - §9.6.4. `TimerService` Integration
    - §9.6.5. Acceptance Criteria
  - §9.7. Phase 7: Cloud Functions
    - §9.7.1. Deliverables Table
    - §9.7.2. Implementation Steps
    - §9.7.3. Acceptance Criteria
  - §9.8. Phase 8: Planner Module
    - §9.8.1. Deliverables Table
    - §9.8.2. `PlannerBlock` Schema
    - §9.8.3. Acceptance Criteria
  - §9.9. Phase 9: Reports Module
    - §9.9.1. Deliverables Table
    - §9.9.2. Data Sources (Firestore Aggregates)
    - §9.9.3. Metrics Displayed
    - §9.9.4. Acceptance Criteria
  - §9.10. Phase 10: SQLite → Firestore Migration
    - §9.10.1. Deliverables Table
    - §9.10.2. Migration Flow
    - §9.10.3. Data Conversion Tables
    - §9.10.4. Deduplication
    - §9.10.5. Acceptance Criteria
  - §9.11. Phase 11: E2E Testing & Security Audit
    - §9.11.1. Deliverables Table
    - §9.11.2. C# Shell Unit Tests
    - §9.11.3. Angular Unit Tests
    - §9.11.4. Firestore Security Rules Tests
    - §9.11.5. E2E Scenarios (5 Scenarios Table)
    - §9.11.6. Security Audit Checklist (10-Item Table)
    - §9.11.7. Acceptance Criteria
  - §9.12. Phase 12: Installer, Auto-Update, & Production Release
    - §9.12.1. Deliverables Table
    - §9.12.2. Build Script Changes (`build.ps1`)
    - §9.12.3. Installer Script Changes (`installer.iss`)
    - §9.12.4. Auto-Update Checker
    - §9.12.5. Production Verification Checklist (10-Item)
    - §9.12.6. Release Cutover Plan (4 Stages)
    - §9.12.7. Acceptance Criteria
  - §9.13. Cross-Reference Table (All 12 Phases → Blueprint Sections → Source Files → Target Files)
