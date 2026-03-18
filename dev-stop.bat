@echo off
title Sentinel Dev Shutdown
echo ========================================
echo   Sentinel - Stopping Dev Environment
echo ========================================
echo.

:: Kill the dotnet process (Sentinel.Engine)
echo [1/2] Stopping C# WPF app...
taskkill /fi "WINDOWTITLE eq Sentinel-Engine" /f >nul 2>&1
taskkill /im Sentinel.exe /f >nul 2>&1
taskkill /fi "IMAGENAME eq dotnet.exe" /fi "WINDOWTITLE eq Sentinel*" /f >nul 2>&1

:: Kill the Vite dev server (node)
echo [2/2] Stopping React dev server...
taskkill /fi "WINDOWTITLE eq Sentinel-React" /f >nul 2>&1

echo.
echo Dev environment stopped.
timeout /t 2 >nul
