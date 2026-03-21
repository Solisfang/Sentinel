@echo off
title Sentinel Dev Shutdown
echo ========================================
echo   Sentinel - Stopping Dev Environment
echo ========================================
echo.

:: Kill the Sentinel WPF app
echo [1/2] Stopping C# WPF app...
taskkill /im Sentinel.exe /f >nul 2>&1

:: Kill the cmd windows by title
taskkill /fi "WINDOWTITLE eq Sentinel-Engine*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Sentinel-React*" /f >nul 2>&1

echo [2/2] Stopping React dev server...
:: Kill node on port 5173
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /pid %%a /f >nul 2>&1
)

echo.
echo Dev environment stopped.
timeout /t 2 >nul
