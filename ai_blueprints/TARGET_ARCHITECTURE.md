# TARGET ARCHITECTURE BLUEPRINT: PROJECT SENTINEL

## 1. System Overview
Sentinel is a desktop productivity and time-management utility that enforces accountability through OS-level idle detection. It operates on an "Optimistic Offline" basis, functioning flawlessly without internet access, while relying on a secure Cloud backend to calculate and verify gamification milestones to prevent client-side tampering.

## 2. Technology Stack
- **Desktop Shell & Native Interop:** C# / .NET 8+ utilizing Photino for lightweight, cross-platform web UI hosting.
- **Frontend UI:** Angular (Strict TypeScript).
- **Backend & Database:** Firebase (Firestore, Firebase Auth, Cloud Functions).
- **Communication Bridge:** Photino Inter-Process Communication (IPC) string/JSON message passing.

## 3. Desktop Shell & Native OS Layer (Photino/C#)
The C# shell is strictly a "dumb" wrapper with specific OS-level privileges. It does not handle user UI state. 
- **Idle Detection:** Utilizes `GetLastInputInfo` (or equivalent native OS hooks) on a background thread to monitor global mouse and keyboard activity.
- **Active Window Whitelist:** To prevent "False Idles," the C# backend must check the currently focused OS window process. If the active process matches a user-defined whitelist (e.g., `devenv.exe`, `code.exe`), the idle timeout threshold is extended or paused.
- **IPC Handshake:** The shell sends an `IdleDetected` JSON payload to the Angular frontend when the idle threshold is breached, and listens for `AuditorCleared` messages from Angular to resume monitoring.

## 4. Frontend Application (Angular)
The Angular application acts as the presentation layer and local state manager.
- **Core Modules:** Timer, Planner (Teams-style calendar), History, Reports, Settings, and Account.
- **The Distraction Auditor:** When the Angular app receives the `IdleDetected` IPC message from the C# shell, it instantly freezes the local Pomodoro timer state and triggers a forced-overlay modal. The user cannot dismiss this modal without categorizing the distraction via the Distraction Taxonomy.
- **Routing & State:** UI state is managed locally in memory to ensure zero-latency responsiveness during offline use.

## 5. Hybrid Sync Architecture & Data Models (Firebase)
The application utilizes a two-pronged approach to offline data handling via Firestore:
- **Standard Persistence:** User Settings, Planner schedules, and Distraction Taxonomy definitions use Firestore's native offline persistence. Angular writes directly to these documents, and Firestore automatically syncs them when the network is available.
- **The Event Ledger (Secure Sync):** Focus sessions and distractions DO NOT update a unified "state" document locally. Instead, the Angular app writes immutable event objects (e.g., `TimerStarted`, `IdleDetected`, `DistractionLogged`) to an append-only `session_events` Firestore collection.

## 6. Server-Side Authority & Gamification (Cloud Functions)
To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side.
- **Ledger Processing:** Firebase Cloud Functions listen to `onDocumentCreated` triggers on the `session_events` collection. 
- **Calculations:** The server processes the immutable events to calculate total focus time, daily streaks, and distraction recovery times.
- **Gamification Mechanics:** - *Tiered Achievements:* Bronze, Silver, Gold badges for focus milestones.
  - *Swift Recovery Multiplier:* Bonus points awarded by the server if the timestamp difference between an `IdleDetected` event and a `DistractionLogged` event is under 60 seconds.
  - *Shiny Badges:* Server-side RNG (Random Number Generator) drops for rare aesthetic badges awarded upon completion of perfect focus blocks.