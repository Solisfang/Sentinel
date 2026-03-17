# Sentinel FAQ

## General

**Q: What is Sentinel?**
A: Sentinel is a privacy-first Pomodoro timer for Windows that detects when you get distracted (via idle detection) and prompts you to log what pulled you away. It helps build self-awareness about your distraction patterns.

**Q: Is Sentinel free?**
A: Yes, Sentinel is free and open source.

**Q: Does Sentinel work offline?**
A: Yes! Sentinel stores all data locally in SQLite by default. Cloud sync to Firebase is optional.

---

## Privacy & Security

**Q: Does Sentinel log my keystrokes?**
A: No. Sentinel uses `GetLastInputInfo` which only tells us *when* the last input occurred, not *what* you typed. This is intentionally designed to pass antivirus behavioral analysis.

**Q: Why not use SetWindowsHookEx for idle detection?**
A: It requires elevated privileges, can trigger antivirus warnings, and can cause system instability. `GetLastInputInfo` is safer and sufficient for our use case.

**Q: Is my data private if I enable cloud sync?**
A: Yes. Your data is stored in your own Firebase account. Sentinel never shares data with third parties. You can delete your data anytime via the Firebase console.

**Q: Can I use Sentinel without cloud sync?**
A: Absolutely. Cloud sync is opt-in. By default, all data stays on your machine in `%LOCALAPPDATA%\Sentinel\`.

---

## Setup & Configuration

**Q: How do I change the timer duration?**
A: Click the ⚙ (settings) icon in the widget, then adjust the Pomodoro/Break durations.

**Q: How do I change the idle detection threshold?**
A: Click ⚙ → Settings → adjust "Idle Detection (sec)". Default is 45 seconds.

**Q: Where are settings stored?**
A: Settings are saved to `%LOCALAPPDATA%\Sentinel\settings.json`.

**Q: How do I reset all settings?**
A: Delete `%LOCALAPPDATA%\Sentinel\settings.json` and restart the app.

**Q: How do I set up Firebase?**
A: See SETUP.md for step-by-step instructions. You need to:
1. Create a Firebase project
2. Enable Auth and Firestore
3. Add your config to `Sentinel.UI/src/firebase.ts`
4. (Optional) Add service account JSON for backend

---

## Troubleshooting

**Q: The widget doesn't appear on screen**
A: Try these:
- Check if the app is running in Task Manager (`Sentinel.Engine.exe`)
- Look in the bottom-right corner of your screen
- Press `Alt+Tab` to find the window
- Check if "Always on Top" is enabled in settings

**Q: The timer shows but I can't click anything**
A: This was fixed in Phase 3. Make sure you're running the latest build.

**Q: Idle detection isn't working**
A: Check that:
1. The timer is running (idle detection only works during a session)
2. Idle threshold is reasonable (default 45 seconds)
3. You can test with debug mode by opening browser console

**Q: How do I debug idle detection?**
A: Run from Visual Studio and check the Output window for `[Sentinel]` debug messages.

**Q: How do I reset the SQLite database?**
A: Stop the app, delete `%LOCALAPPDATA%\Sentinel\sentinel.db`, and restart.

**Q: WebView2 shows a white screen**
A: Ensure:
1. React dev server is running (`npm run dev` in Sentinel.UI)
2. WebView2 runtime is installed (usually bundled with Windows 11)
3. Check the port matches (default `http://localhost:5173`)

---

## Development

**Q: How do I run in development mode?**
A:
```bash
# Terminal 1: Start React
cd Sentinel.UI
npm run dev

# Terminal 2: Run C# app
cd Sentinel.Engine
dotnet run
```

**Q: How do I build for production?**
A: See Phase 5 in PROMPTS.md (coming soon).

**Q: How do I add a new MCP server?**
A: See MCP_CONTEXT.md for instructions.

**Q: Can I contribute?**
A: Yes! See CONTRIBUTING.md for guidelines.

---

## Features

**Q: What timer modes are available?**
A: Focus (Pomodoro), Short Break, and Long Break. Durations are fully configurable in Settings.

**Q: Can I set custom timer durations?**
A: Yes! Go to Settings (⚙) and adjust Focus, Short Break, and Long Break durations. Coming soon: custom named sessions and presets.

**Q: What happens when I log a distraction?**
A: It's saved to local SQLite and (if enabled) synced to Firestore. At session end, you'll see a pie chart breakdown of your distractions.

**Q: What if I'm flagged as "distracted" but I was actually reading/thinking?**
A: Use the "False Alarm" button (coming in Phase 4) to dismiss without logging. This won't count against your focus time.

**Q: I'm watching a 40-minute tutorial. How do I avoid constant interruptions?**
A: Use the "Watching Content" snooze option (coming in Phase 4) to suppress idle detection for 30/60/90 minutes.

**Q: Does the timer pause when the intervention modal appears?**
A: Yes (coming in Phase 4). The timer pauses during intervention so distracted time isn't counted as focus time.

**Q: Can I snooze idle detection temporarily?**
A: Yes (coming in Phase 4). You can snooze for 5/10/30 minutes when the intervention modal appears.

**Q: Can I export my data?**
A: Coming in Phase 7. For now, you can directly query the SQLite database.

**Q: Is there a reporting dashboard?**
A: Coming in Phase 5. This will show daily/weekly/monthly statistics.
