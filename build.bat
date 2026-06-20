@echo off
setlocal
cd /d "%~dp0"

:: China mirror for Electron downloads
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo ========================================
echo   DNF 活动助手 - 构建工具
echo ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未找到 Node.js，请从 https://nodejs.org 安装
    pause
    exit /b 1
)

:: Check engine file
if not exist "bot_core.mjs" (
    echo [ERROR] 缺少 bot_core.mjs
    pause
    exit /b 1
)

if not exist node_modules (
    echo [1/3] 安装依赖...
    call npm install --silent
    if errorlevel 1 (
        echo [ERROR] npm install 失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已就绪
)

echo.
echo [2/3] 正在构建 EXE（需要几分钟）...
call npx electron-builder --win --config
if errorlevel 1 (
    echo [ERROR] 构建失败
    pause
    exit /b 1
)

echo.
echo [3/3] 完成!
echo 安装包: dist\ 目录
echo.

explorer dist
pause
