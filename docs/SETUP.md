# Sentinel Setup Guide

## Prerequisites
- Windows 11
- .NET 8 SDK
- Node.js (LTS)
- Yarn or npm
- Visual Studio 2022+ (for C#)
- VS Code (recommended for UI)


## Backend (C#)
1. Open `/Sentinel.Engine` in Visual Studio.
2. Restore NuGet packages.
3. Add and configure the Firebase Admin SDK for .NET (for Firestore access and optional Auth integration).
4. Build and run. The transparent overlay should appear.


## Frontend (React)
1. Open terminal in `/Sentinel.UI`.
2. Run `yarn install` or `npm install`.
3. Add Firebase JS SDK: `yarn add firebase` or `npm install firebase`.
4. Configure Firebase Auth and Firestore in your React app (see Firebase console for config values).
5. Run `yarn dev` or `npm run dev`.
6. The Pomodoro UI should open at `localhost:5173`.

## Firebase Setup
1. Go to the Firebase Console and create a new project.
2. Enable Firebase Auth (Email/Password or preferred provider).
3. Enable Firestore database.
4. Download your config files and add them to both `/Sentinel.UI` and `/Sentinel.Engine` as needed.

## MCP Servers
- See MCP_CONTEXT.md for setup and usage.
