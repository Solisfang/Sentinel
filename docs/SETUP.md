# Sentinel Setup Guide

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Windows | 10/11 | Target platform |
| .NET SDK | 8.0+ | C# backend |
| Node.js | 18+ LTS | React frontend |
| Visual Studio | 2022+ | C# development (optional, can use `dotnet` CLI) |
| VS Code | Latest | React development (recommended) |

---

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url>
cd Sentinel

# 2. Install frontend dependencies
cd Sentinel.UI
npm install

# 3. Start React dev server
npm run dev
# Leave this terminal running...

# 4. In a new terminal, run the C# app
cd ../Sentinel.Engine
dotnet run
```

The Sentinel widget should appear in the bottom-right corner of your screen.

---

## Backend Setup (C#)

### Option A: Visual Studio

1. Open `Sentinel.sln` in Visual Studio 2022
2. Right-click solution → Restore NuGet Packages
3. Set `Sentinel.Engine` as startup project
4. Press F5 to run

### Option B: Command Line

```bash
cd Sentinel.Engine
dotnet restore
dotnet build
dotnet run
```

### Packages Used

| Package | Purpose |
|---------|---------|
| `Microsoft.Web.WebView2` | Embedded browser for React UI |
| `Microsoft.EntityFrameworkCore.Sqlite` | Local database |
| `FirebaseAdmin` | Firebase Admin SDK (optional) |
| `Google.Cloud.Firestore` | Firestore client (optional) |

---

## Frontend Setup (React)

```bash
cd Sentinel.UI
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

### Packages Used

| Package | Purpose |
|---------|---------|
| `react` | UI framework |
| `typescript` | Type safety |
| `tailwindcss` | Styling |
| `recharts` | Charts |
| `firebase` | Auth & Firestore client |

---

## Firebase Setup

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Create a project**
3. Name it (e.g., "Sentinel")
4. Disable Google Analytics (optional)
5. Click **Create project**

### Step 2: Enable Authentication

1. Go to **Build → Authentication**
2. Click **Get started**
3. Enable **Email/Password** provider

### Step 3: Enable Firestore

1. Go to **Build → Firestore Database**
2. Click **Create database**
3. Select **Start in test mode** (for development)
4. Choose a region
5. Click **Enable**

### Step 4: Get Web App Config

1. Click **⚙ Project settings**
2. Scroll to **Your apps**
3. Click **Add app** → **Web** (</> icon)
4. Register app name
5. Copy the config object

### Step 5: Update React Config

Edit `Sentinel.UI/src/firebase.ts`:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Step 6: (Optional) Backend Service Account

For C# backend Firebase access:

1. Go to **⚙ Project settings → Service accounts**
2. Click **Generate new private key**
3. Save as `firebase-service-account.json`
4. Place in `Sentinel.Engine/bin/Debug/net8.0-windows/`

Or set environment variable:
```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\firebase-service-account.json
```

---

## MCP Servers Setup

Install MCP servers for AI-assisted development:

```bash
npm install -g mcp-server-sqlite-npx mcp-server-fetch-typescript @modelcontextprotocol/server-github
```

Configure in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["mcp-server-sqlite-npx"]
    },
    "fetch": {
      "command": "npx",
      "args": ["mcp-server-fetch-typescript"]
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>"
      }
    }
  }
}
```

---

## Verify Installation

After setup, you should see:

1. **Widget** appears in bottom-right corner
2. **Timer** shows 25:00 (or configured duration)
3. **Settings** accessible via ⚙ icon
4. **Idle detection** triggers after configured threshold
5. **Login** works (if Firebase configured)

---

## Troubleshooting

### "WebView2 not found"
Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### "Port 5173 in use"
Kill the process using the port:
```bash
netstat -ano | findstr :5173
taskkill /F /PID <pid>
```

### "Firebase connection failed"
- Check `firebase.ts` config values
- Ensure Firestore rules allow read/write
- Check browser console for errors

### "SQLite database locked"
Close all Sentinel instances and retry.

---

## Data Locations

| Data | Path |
|------|------|
| Settings | `%LOCALAPPDATA%\Sentinel\settings.json` |
| Database | `%LOCALAPPDATA%\Sentinel\sentinel.db` |
| Logs | Visual Studio Output window |
