# Sentinel Vibe Coding Prompts

## Phase 1: The Invisible Engine (C# Backend)
> Let's build the `Sentinel.Engine` first. Create a new C# .NET 8 WPF project. I need you to accomplish three things:
> 1. Set up the `MainWindow.xaml` to be a frameless, topmost, transparent window. Add a WebView2 control to it that fills the entire window. For now, just point the WebView2 `Source` to `https://example.com` to prove it loads.
> 2. Implement a `UserActivityMonitor` class. Use P/Invoke to call `GetLastInputInfo`. Do NOT use `SetWindowsHookEx`. Create a background DispatcherTimer that checks the idle time every 1 second.
> 3. If the idle time exceeds 10 seconds (for testing), use `Debug.WriteLine` to log 'Idle Detected'. If the user moves the mouse, log 'User Active'.
> 
> Do not write any database code yet. Just get the window and the idle detection running.

## Phase 2: The Shiny UI (React Frontend)
> Open a new terminal in the `/Sentinel.UI` folder. Scaffold a new Vite + React + TypeScript project with Tailwind CSS. Build a single-page Pomodoro app taking up 100vw and 100vh. It needs:
> 1. A transparent or dark-mode background.
> 2. A large 25-minute countdown timer in the center with a Start/Pause button.
> 3. A hidden 'Intervention State'. Add a temporary debug button to trigger this. When triggered, a modal overlay appears asking 'Distracted?' with a text input. When the user types a distraction and hits Enter, the modal closes and the distraction is saved to a local React state array.
> 4. When the timer hits 00:00, replace the timer with a Recharts Pie Chart showing the frequency of the logged distractions.
> 
> Keep the styling ultra-minimalist and modern.

## Phase 3: The Bridge (Interop & SQLite)
> Wire the C# idle detector to the React UI using WebView2's messaging system.
