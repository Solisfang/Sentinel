# Sentinel: One-Night Vibe Coding Master Plan

## 1. The Weapon of Choice & MCP Setup
To give your AI assistant (Cursor, Windsurf, etc.) the perfect context without hallucinating, attach these Model Context Protocol (MCP) servers:

* **`sqlite-mcp-server`**: *Crucial.* Allows the AI to query the local SQLite database directly to verify session saves without you manually opening DB Browser.
* **`fetch` or `puppeteer`**: Helps the AI read up-to-date Microsoft Learn documentation for WebView2 or `GetLastInputInfo` if it gets stuck on P/Invoke signatures.
* **`github-mcp` (Optional)**: Lets the AI automatically commit working milestones so you can easily revert when it inevitably breaks window rendering.

---

## 2. The Project Blueprint
Force the AI into this exact folder structure to prevent overcomplication:

    /Sentinel
      ├── /Sentinel.UI      (Vite + React + TypeScript + Tailwind + Recharts)
      └── /Sentinel.Engine  (C# .NET 8 WPF Application + WebView2 + SQLite Core)

---

## 3. The 3-Prompt Master Plan

Paste the **V2 PRD** into your system context first. Then, execute these three prompts sequentially. **Do not move to the next prompt until the current one compiles and runs.**

### Phase 1: The Invisible Engine (C# Backend)
*Goal: Get the transparent window and idle tracker working before touching the UI.*

> **Prompt 1:**
> Let's build the `Sentinel.Engine` first. Create a new C# .NET 8 WPF project. I need you to accomplish three things:
> 1. Set up the `MainWindow.xaml` to be a frameless, topmost, transparent window. Add a WebView2 control to it that fills the entire window. For now, just point the WebView2 `Source` to `https://example.com` to prove it loads.
> 2. Implement a `UserActivityMonitor` class. Use P/Invoke to call `GetLastInputInfo`. Do NOT use `SetWindowsHookEx`. Create a background DispatcherTimer that checks the idle time every 1 second.
> 3. If the idle time exceeds 10 seconds (for testing), use `Debug.WriteLine` to log 'Idle Detected'. If the user moves the mouse, log 'User Active'.
> 
> Do not write any database code yet. Just get the window and the idle detection running.

### Phase 2: The Shiny UI (React Frontend)
*Goal: Build the Pomodoro timer and intervention modal completely isolated from C#.*

> **Prompt 2:**
> Open a new terminal in the `/Sentinel.UI` folder. Scaffold a new Vite + React + TypeScript project with Tailwind CSS. Build a single-page Pomodoro app taking up 100vw and 100vh. It needs:
> 1. A transparent or dark-mode background.
> 2. A large 25-minute countdown timer in the center with a Start/Pause button.
> 3. A hidden 'Intervention State'. Add a temporary debug button to trigger this. When triggered, a modal overlay appears asking 'Distracted?' with a text input. When the user types a distraction and hits Enter, the modal closes and the distraction is saved to a local React state array.
> 4. When the timer hits 00:00, replace the timer with a Recharts Pie Chart showing the frequency of the logged distractions.
> 
> Keep the styling ultra-minimalist and modern.

### Phase 3: The Bridge (Interop & SQLite)
*Goal: Wire the C# idle detector to the React UI using WebView2's messaging system.*

> **Prompt 3:**
> Phase 3: The Interop. Let's connect the engine to the UI.
> 1. Update the C# WPF app to load the local Vite development server (`http://localhost:5173`) into the WebView2 control instead of example.com.
> 2. In the C# `UserActivityMonitor`, when 'Idle Detected' triggers, use `CoreWebView2.PostWebMessageAsJson` to send an event like `{ type: 'IDLE_DETECTED' }` to the React app.
> 3. In the React app, add an event listener for `window.chrome.webview.addEventListener('message', ...)`. When it receives the 'IDLE_DETECTED' message, automatically trigger the 'Intervention State' modal.
> 4. Once the user types their distraction and hits Enter in React, send a message back to C# using `window.chrome.webview.postMessage({ type: 'LOG_DISTRACTION', note: '...' })`. 
> 5. Have C# listen for this message and write it to a local SQLite database using Entity Framework Core.

---

## 4. 🚦 The Vibe Coding "Gotchas" (Watch List)
Watch out for these common AI hallucinations when building Windows hybrid apps:

* **The WebView2 Initialization Trap:** The AI might try to set the WebView2 `Source` in the XAML directly. Force it to use `await webView.EnsureCoreWebView2Async();` in the C# code-behind *before* navigating to the React server to prevent crashes.
* **The Transparent Window Bug:** WPF requires `AllowsTransparency="True"`, `WindowStyle="None"`, and `Background="Transparent"` on the `Window` tag. However, WebView2 has a default white background. Explicitly tell the AI to set `webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;` in C#, or you'll get a giant white box.
* **The 24-Day Tick Wrap:** `GetLastInputInfo` uses system ticks, rolling over to 0 every 24.9 days. The AI often forgets overflow arithmetic. It won't break your app tonight, but flag it for your first refactor.