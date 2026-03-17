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
3. Build and run. The transparent overlay should appear.

## Frontend (React)
1. Open terminal in `/Sentinel.UI`.
2. Run `yarn install` or `npm install`.
3. Run `yarn dev` or `npm run dev`.
4. The Pomodoro UI should open at `localhost:5173`.

## MCP Servers
- See MCP_CONTEXT.md for setup and usage.
