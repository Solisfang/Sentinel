# Sentinel FAQ


**Q: Why not use SetWindowsHookEx for idle detection?**
A: It requires elevated privileges and can cause system instability. GetLastInputInfo is safer and sufficient.


**Q: How do I debug idle detection?**
A: Use Debug.WriteLine in C# and check the output window in Visual Studio.


**Q: How do I reset the SQLite DB?**
A: Stop the app, delete the DB file in the app data folder, and restart.

**Q: How do I set up Firebase for Sentinel?**
A: See SETUP.md for step-by-step instructions. You need to create a Firebase project, enable Auth and Firestore, and add the config to both backend and frontend.

**Q: Is my data still private if it syncs to Firestore?**
A: Sentinel only syncs data you explicitly allow. You control your account and can delete your data at any time via the Firebase console. No telemetry or analytics are sent by default.

**Q: Can I use Sentinel without cloud sync?**
A: Yes, you can run Sentinel in local-only mode using SQLite. Cloud sync is optional but recommended for backup and multi-device support.

**Q: What if the overlay doesn't appear?**
A: Ensure transparency and topmost settings are correct in MainWindow.xaml.

**Q: How do I add a new MCP server?**
A: See MCP_CONTEXT.md for instructions.
