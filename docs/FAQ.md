# Sentinel FAQ

**Q: Why not use SetWindowsHookEx for idle detection?**
A: It requires elevated privileges and can cause system instability. GetLastInputInfo is safer and sufficient.

**Q: How do I debug idle detection?**
A: Use Debug.WriteLine in C# and check the output window in Visual Studio.

**Q: How do I reset the SQLite DB?**
A: Stop the app, delete the DB file in the app data folder, and restart.

**Q: What if the overlay doesn't appear?**
A: Ensure transparency and topmost settings are correct in MainWindow.xaml.

**Q: How do I add a new MCP server?**
A: See MCP_CONTEXT.md for instructions.
