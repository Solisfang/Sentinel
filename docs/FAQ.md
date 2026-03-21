# Sentinel FAQ

## General

**Q: What is Sentinel?**  
A: Sentinel is a privacy-first Windows focus timer that uses idle detection to catch distraction drift during active focus sessions and ask the user what pulled them away.

**Q: Is Sentinel local-first?**  
A: Yes. Sentinel stores data locally by default. Cloud sync is optional.

**Q: Does Sentinel work offline?**  
A: Yes. Core focus tracking, distraction logging, and local history do not require cloud sync.

---

## Privacy and Security

**Q: Does Sentinel log my keystrokes?**  
A: No. Sentinel uses `GetLastInputInfo`, which only measures inactivity timing. It does not capture what the user types.

**Q: Why does Sentinel use passive idle detection instead of global hooks?**  
A: Passive polling is safer, simpler, and less likely to trigger antivirus or privacy concerns than hook-based approaches.

**Q: If I enable cloud sync, is it optional?**  
A: Yes. Sync and login are optional companion features, not a requirement for using Sentinel.

---

## Current Core Behavior

**Q: What happens when Sentinel thinks I got distracted?**  
A: During an active focus session, the timer pauses and an intervention flow appears. The user can log a distraction, mark a false alarm, snooze idle detection, or mark that they are watching content.

**Q: Does a false alarm count as a distraction?**  
A: No. False alarms dismiss the interruption without logging a distraction.

**Q: Can I adjust timer durations and idle threshold?**  
A: Yes. Sentinel supports configurable focus and break durations, presets, and idle threshold settings.

**Q: Is there a reports screen?**  
A: Yes. Sentinel includes reporting for focus time, sessions, distractions, charts, and history views.

---

## Approved Next Enhancements

The items below are approved product direction, but they are not implemented yet.

**Q: Will I be able to log common distractions without typing them every time?**  
A: Yes. The next planned enhancement adds clickable suggestion pills under the distraction input so common entries can be logged instantly.

**Q: How many quick distraction suggestions will appear?**  
A: The current plan is at least 5 suggestions: the 2 most recent distractions and the 3 most frequent distractions, with duplicates removed.

**Q: Can Sentinel group raw distractions into broader categories?**  
A: Yes. The next planned enhancement introduces user-managed distraction categories and mappings, so entries like `twitter` and `instagram` can roll up into a category such as `Social Media`.

**Q: Will the original distraction text still be preserved if I map it to a category?**  
A: Yes. The plan is to preserve raw original labels while also storing an optional category mapping for better reporting.

**Q: Can I create a new category while logging a distraction?**  
A: Yes. The approved plan includes creating a new category inline or mapping to an existing one when a new distraction is entered.

**Q: Can I edit categories and mappings later?**  
A: Yes. A planned taxonomy-management flow will let users revisit previous distractions and edit labels, categories, and mappings after the fact.

**Q: Will reporting use categories once they exist?**  
A: Yes. The goal is cleaner charts and summaries by grouping related distractions while still keeping raw history available.

**Q: Will there be a smaller popup or overlay so I do not need the full app open?**  
A: Yes. A corner overlay or mini-window mode is part of the approved next enhancement set.

---

## Setup and Troubleshooting

**Q: Where are settings stored?**  
A: In `%LOCALAPPDATA%\Sentinel\settings.json`.

**Q: Where is the local database stored?**  
A: In `%LOCALAPPDATA%\Sentinel\sentinel.db`.

**Q: How do I run Sentinel in development?**  
A: Start the React app in `Sentinel.UI`, then run the WPF app in `Sentinel.Engine`.

**Q: Where should I look for more detail about upcoming work?**  
A: See `docs/Plan.md`, `docs/PRD.md`, `docs/PROGRESS.md`, and `docs/STITCH_DESIGN_BRIEF.md`.
