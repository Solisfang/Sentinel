@echo off
title Sentinel Dev Launcher
echo ========================================
echo   Sentinel - Starting Dev Environment
echo ========================================
echo.

:: Start React dev server in a new window
echo [1/2] Starting React dev server...
start "Sentinel-React" cmd /k "cd /d %~dp0Sentinel.UI && npm run dev"

:: Wait for Vite to spin up
timeout /t 4 /nobreak >nul

:: Start C# WPF app in a new window
echo [2/2] Starting C# WPF app...
start "Sentinel-Engine" cmd /k "cd /d %~dp0Sentinel.Engine && dotnet run"

echo.
echo Dev environment started!
echo   - React: http://localhost:5173
echo   - WPF app: running
echo.
echo Use dev-stop.bat to close everything.
timeout /t 3 >nul
