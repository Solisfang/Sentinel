# Product Requirements Document (PRD) - V2 (Architectural Revision)

## Project Name: Sentinel

### Platform: Windows 11 Desktop (Native C# Wrapper + Web UI Overlay)

**Core Premise:** A privacy-first, zero-telemetry Pomodoro overlay that utilizes passive OS-level hardware polling to detect "phone drift," aggressively intervening to force users to log their distractions.

---

## 1. Product Vision & Market Differentiation

Standard Pomodoro apps assume ticking clocks equal productivity. Sentinel closes the accountability loop by monitoring physical presence. To stand out against competitors like Rize or RescueTime, Sentinel leans entirely into "Absolute Local Privacy" and "Immediate Cognitive Friction." It intervenes during the distraction, not after, and guarantees that behavior data never leaves the user's local C:\ drive unless explicitly opted into an encrypted backup.

---

## 2. Target Audience

- Developers, writers, and deep-work professionals.
- Digital artists and designers (Explicitly supported via Wacom/Digitizer raw input tracking).
- Privacy-conscious users hostile to cloud-dependent tracking tools.

---

## 3. Core User Workflows

### Workflow A: The Standard Session
1. User launches Sentinel. A minimalist overlay appears.
2. User sets the timer (default 25 mins) and clicks "Start."
3. The C# backend shifts the application into Windows "Efficiency Mode" (EcoQoS) and suspends the UI's Chromium renderer to drop CPU/RAM usage to near-zero.
4. Timer hits 00:00. The UI wakes up, plays a soft chime, and logs the session to the local SQLite database.

### Workflow B: The "Caught" Intervention (Idle Detected)
1. Timer is running. The user grabs their phone to scroll social media.
2. The C# backend, passively polling GetLastInputInfo, detects 45 seconds of zero hardware input.
3. The backend instantly wakes the WebView2 renderer (Resume()).
4. The overlay forces itself to the front. Prompt: "Idle Detected. Distracted?"
5. The text input box instantly steals Windows focus. The user types "Twitter", hits Enter, and the timer seamlessly resumes.

### Workflow C: The "Smart Suppression" Edge Case (Media/Learning)
1. User starts a session but is watching a 45-minute AWS tutorial on YouTube.
2. The user does not touch the mouse for 10 minutes.
3. Sentinel queries the SystemMediaTransportControls API and detects an active audio/video stream.
4. Sentinel silently suppresses the idle trigger. No false alarms; the user learns in peace.

### Workflow D: The System Sleep/Wake Recovery
1. User closes their laptop lid mid-session to walk to a meeting.
2. Sentinel intercepts the PBT_APMSUSPEND message, freezes the timer, and force-saves the state to SQLite before the CPU halts.
3. User opens the laptop an hour later. Sentinel intercepts PBT_APMRESUMEAUTOMATIC.
4. Instead of adding 60 minutes of "idle time," the UI prompts: "System sleep detected. Resume session or start fresh?"

---

## 4. Technical Architecture (The V2 Engine)

### The Frontend (UI/UX)
- **Stack:** Angular (or React/Vite for speed) hosted inside a WebView2 container.
- **UI Behavior:** Dark-mode, high-contrast, heavily utilizing CSS animations for the "pulse" effect during an intervention.
- **PerMonitorV2 DPI:** The UI must scale perfectly if dragged from a 4K laptop screen to a 1080p external monitor.

### The Backend (C# .NET 8+)
- **Idle Detection (The Core Pivot):**
  - *Primary:* GetLastInputInfo (Passive polling. Zero input lag, bypasses all Keylogger Antivirus heuristics).
  - *Secondary:* RAWINPUT (Targeting Usage Page 0x0D, Usage 0x02 to perfectly track Wacom tablet stylus movements).
- **Resource Management:**
  - Implements CoreWebView2.TrySuspendAsync() and MemoryUsageTargetLevel.Low when the timer is minimized.
  - Uses SetPriorityClass (IDLE_PRIORITY_CLASS) to run as a background-friendly citizen.
- **Window State:** Standard WS_EX_TOPMOST and WS_EX_TRANSPARENT. It will gracefully hide itself if the user launches an exclusive full-screen video game to prevent rendering crashes.

### Data & Sync
- **Local First:** Entity Framework Core + SQLite.
- **Cloud Sync (Future):** Firebase Web SDK, but strictly positioned as an "Opt-in Encrypted Backup," not a required telemetry stream.

---

## 5. Security & Distribution Strategy

- **The Antivirus Solution:** By abandoning SetWindowsHookEx, Sentinel structurally cannot record keystrokes, ensuring it passes Windows Defender dynamic behavioral analysis.
- **Code Signing:** Requires purchasing a standard OV (Organization Validation) or IV (Individual Validation) code-signing certificate loaded on a FIPS 140-2 hardware token.
- **Launch Plan:** Initially distributed to a closed beta group to organically build Microsoft SmartScreen reputation, ensuring the public launch does not greet users with a red "Untrusted Developer" warning screen.

---

## 6. MVP Scope (What to build on Night 1)

To prevent feature creep, the Day 1 MVP should only include:

- The C# WebView2 wrapper with a transparent, Topmost window.
- The Angular/React UI (Timer + Input Box + Recharts Pie Chart).
- The GetLastInputInfo polling loop to trigger the Angular UI when idle.
- Basic local JSON or SQLite saving.
  - (Smart media suppression, DPI scaling, and Wacom RawInput can be pushed to V1.1).