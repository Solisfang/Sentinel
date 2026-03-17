# Sentinel Vibe Coding Prompts

Copy-paste these prompts sequentially. **Do not proceed to the next phase until the current one compiles and runs.**

---

## Phase 1: The Invisible Engine (C# Backend) ✅ COMPLETE

> Let's build the `Sentinel.Engine` first. Create a new C# .NET 8 WPF project. I need you to accomplish these things:
> 1. Set up the `MainWindow.xaml` to be a frameless, topmost, transparent window. Add a WebView2 control to it that fills the entire window. For now, just point the WebView2 `Source` to `https://example.com` to prove it loads.
> 2. Implement a `UserActivityMonitor` class. Use P/Invoke to call `GetLastInputInfo`. Do NOT use `SetWindowsHookEx`. Create a background DispatcherTimer that checks the idle time every 1 second.
> 3. If the idle time exceeds 10 seconds (for testing), use `Debug.WriteLine` to log 'Idle Detected'. If the user moves the mouse, log 'User Active'.
> 4. Integrate Firebase Admin SDK for .NET. Set up basic connectivity to Firestore and Firebase Auth (for user identity management). For now, just log successful connection to both.
>
> Do not write any session or distraction logic yet. Just get the window, idle detection, and Firebase connectivity running.

---

## Phase 2: The Shiny UI (React Frontend) ✅ COMPLETE

> Open a new terminal in the `/Sentinel.UI` folder. Scaffold a new Vite + React + TypeScript project with Tailwind CSS. Build a single-page Pomodoro app taking up 100vw and 100vh. It needs:
> 1. A transparent or dark-mode background.
> 2. A large 25-minute countdown timer in the center with a Start/Pause button.
> 3. A hidden 'Intervention State'. Add a temporary debug button to trigger this. When triggered, a modal overlay appears asking 'Distracted?' with a text input. When the user types a distraction and hits Enter, the modal closes and the distraction is saved to a local React state array.
> 4. When the timer hits 00:00, replace the timer with a Recharts Pie Chart showing the frequency of the logged distractions.
> 5. Integrate Firebase Auth for user login and Firestore for cloud sync of session and distraction data. Ensure all local state is mirrored to Firestore for backup and cross-device support.
>
> Keep the styling ultra-minimalist and modern.

---

## Phase 3: The Bridge (Interop & Settings) ✅ COMPLETE

> Phase 3: The Interop. Let's connect the engine to the UI.
> 1. Update the C# WPF app to load the local Vite development server (`http://localhost:5173`) into the WebView2 control instead of example.com.
> 2. In the C# `UserActivityMonitor`, when 'Idle Detected' triggers, use `CoreWebView2.PostWebMessageAsJson` to send an event like `{ type: 'IDLE_DETECTED' }` to the React app.
> 3. In the React app, add an event listener for `window.chrome.webview.addEventListener('message', ...)`. When it receives the 'IDLE_DETECTED' message, automatically trigger the 'Intervention State' modal.
> 4. Once the user types their distraction and hits Enter in React, send a message back to C# using `window.chrome.webview.postMessage({ type: 'LOG_DISTRACTION', note: '...' })`.
> 5. Have C# listen for this message and write it to a local SQLite database using Entity Framework Core.
> 6. Add a Settings UI in React with configurable timer durations, idle threshold, and cloud sync toggle.
> 7. Create a SettingsService in C# to persist settings to JSON and sync with React via WebView2 messaging.

---

## Phase 4: UX Polish & Intervention Flow 🔲 PENDING (PRIORITY)

> **This phase focuses on critical UX improvements before adding new features.**
>
> **4A: Visual Design Overhaul**
> 1. Update the color theme to be more transparent and modern:
>    - Use glassmorphism effect (blur + transparency)
>    - Softer, muted colors with accent highlights
>    - Rounded, pill-shaped buttons with subtle hover effects
> 2. Add a maximize button to window controls (minimize, maximize, close)
> 3. Make the widget more visually appealing:
>    - Subtle border glow when timer is running
>    - Smooth transitions and micro-animations
>    - Better typography and spacing
>
> **4B: Configurable Timer Durations**
> 1. In Settings, allow users to set custom durations for:
>    - Focus session (currently "Pomodoro")
>    - Short break
>    - Long break
>    - Custom session (user-defined name and duration)
> 2. Add presets: "Classic Pomodoro (25/5/15)", "Deep Work (50/10/20)", "Quick Sprint (15/3/10)"
> 3. Save custom durations to settings.json
>
> **4C: Improved Intervention Flow**
> 1. When idle is detected:
>    - **PAUSE the timer** (don't let it keep running)
>    - Show intervention modal with multiple options:
>      - "Log Distraction" - current behavior, input what distracted you
>      - "False Alarm" - dismiss without logging (user was reading/thinking)
>      - "Snooze 5 min" - suppress idle detection temporarily
>      - "Watching Content" - suppress for 30/60/90 min (for tutorials)
> 2. Add snooze state to C# `UserActivityMonitor`:
>    - When snoozed, don't fire idle events until snooze expires
>    - Show snooze indicator in UI ("Idle detection paused for 5:00")
> 3. Resume timer automatically when user dismisses intervention
>
> **4D: Timer Pause Behavior**
> 1. When intervention modal appears, timer should PAUSE
> 2. Show visual indicator that timer is paused (pulsing border, grayed text)
> 3. Resume timer when:
>    - User logs a distraction
>    - User clicks "False Alarm"
>    - User clicks "Snooze" (timer resumes, idle detection paused)
> 4. Add explicit Pause/Resume to intervention modal

---

## Phase 5: Reporting & Analytics Dashboard 🔲 PENDING

> Add a reporting feature to Sentinel:
> 1. Create a new "Reports" view in React accessible from the settings menu.
> 2. In C#, add a `ReportingService` class that queries SQLite for:
>    - Total focus time (today, this week, this month)
>    - Number of sessions completed
>    - Number of distractions logged
>    - Average session length
>    - Most common distraction categories
>    - False alarms vs actual distractions ratio
> 3. Add a new message type `GET_REPORT_DATA` that React can send to C#.
> 4. C# responds with `REPORT_DATA` containing aggregated statistics.
> 5. In the Reports view, display:
>    - Summary cards (total time, sessions, distractions)
>    - Bar chart showing focus time per day for the last 7 days (using Recharts)
>    - Pie chart showing distraction breakdown
>    - Line chart showing productivity trends
> 6. Add date range filters (Today, This Week, This Month, All Time).
> 7. If cloud sync is enabled, also fetch historical data from Firestore.

---

## Phase 6: Production Build & Distribution 🔲 PENDING

> Prepare Sentinel for production distribution:
> 1. Configure Vite to build production assets to `Sentinel.Engine/wwwroot/` folder.
> 2. Update `MainWindow.xaml.cs` to detect production mode:
>    - In dev: Load `http://localhost:5173`
>    - In prod: Load local files from `wwwroot/index.html`
> 3. Create a PowerShell build script `build.ps1` that:
>    - Runs `npm run build` in Sentinel.UI
>    - Copies `dist/*` to `Sentinel.Engine/wwwroot/`
>    - Runs `dotnet publish -c Release -r win-x64 --self-contained`
> 4. Add proper application metadata:
>    - Application icon (`.ico` file)
>    - Assembly info (version, description, company)
>    - Windows manifest for DPI awareness
> 5. Configure single-file publish in `.csproj`
> 6. Create an installer script using Inno Setup or NSIS
> 7. Add auto-update mechanism using Squirrel.Windows or similar

---

## Phase 7: Advanced Features 🔲 PENDING

> Add power-user features to Sentinel:
>
> **7A: Smart Media Suppression**
> - Query `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager` to detect active media playback
> - Auto-suppress idle detection when video/audio is playing
> - Add toggle in settings: "Suppress idle during media playback"
>
> **7B: System Sleep/Wake Recovery**
> - Handle `WM_POWERBROADCAST` messages in WPF
> - On `PBT_APMSUSPEND`: Pause timer, save state
> - On `PBT_APMRESUMEAUTOMATIC`: Show prompt "Resume session or start fresh?"
>
> **7C: Global Hotkeys**
> - Register global hotkey `Ctrl+Shift+S` to toggle Start/Pause
> - Register `Ctrl+Shift+D` to manually trigger distraction log
> - Use `RegisterHotKey` P/Invoke
>
> **7D: Notifications & Sounds**
> - Play sound on session complete (using `System.Media.SoundPlayer`)
> - Show Windows toast notification on session complete
> - Add sounds settings: enable/disable, volume, custom sound file
>
> **7E: Goals & Streaks**
> - Daily focus time goal setting
> - Track consecutive days streak
> - Show progress indicator in main UI
>
> **7F: Data Export**
> - Export all sessions to CSV
> - Export to JSON for backup
> - Import from JSON backup

---

## Phase 8: Polish & Optimization 🔲 PENDING

> Final polish before v1.0 release:
> 1. Add onboarding flow for first-time users
> 2. Implement keyboard navigation throughout the app
> 3. Add loading states and error handling UI
> 4. Optimize bundle size (code splitting, lazy loading)
> 5. Add unit tests for critical paths
> 6. Performance profiling and optimization
> 7. Accessibility audit (screen reader support, contrast)
> 8. Create user documentation and FAQ
> 9. Set up crash reporting (Sentry or similar)
> 10. Beta testing with real users
