@echo off
setlocal
cd /d "%~dp0"

:: China mirror for Electron downloads
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo ========================================
echo   DNF Event Helper - Build Tool
echo ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Check engine file
if not exist "..\dnf_bot_stronger\bot_core.mjs" (
    echo [ERROR] Missing ..\dnf_bot_stronger\bot_core.mjs
    echo Make sure dnf_bot_stronger is in the parent directory
    pause
    exit /b 1
)

if not exist node_modules (
    echo [1/4] Installing dependencies...
    call npm install --silent
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
) else (
    echo [1/4] Dependencies OK, skip install
)

echo.
echo [2/4] Copying engine file...
copy /Y "..\dnf_bot_stronger\bot_core.mjs" "." >nul
echo      bot_core.mjs -^> dnf_gui\

echo.
echo [3/4] Building EXE (this takes a few minutes)...
call npx electron-builder --win --config
if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

:: Clean up temp engine file
del /Q "bot_core.mjs" 2>nul

echo.
echo [4/4] Done!
echo Installer: dist\ directory
echo.

explorer dist
pause
