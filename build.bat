@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

:: 国内镜像加速
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo ========================================
echo   DNF 活动助手 - 打包工具
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 https://nodejs.org
    pause
    exit /b 1
)

:: 检查引擎文件
if not exist "..\dnf_bot_stronger\bot_core.mjs" (
    echo [错误] 找不到 ..\dnf_bot_stronger\bot_core.mjs
    echo 请确保 dnf_bot_stronger 项目与 dnf_gui 在同一目录下
    pause
    exit /b 1
)

if not exist node_modules (
    echo [1/4] 安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/4] 依赖已就绪，跳过安装
)

echo.
echo [2/4] 复制引擎文件...
copy /Y "..\dnf_bot_stronger\bot_core.mjs" "." >nul
echo      bot_core.mjs → dnf_gui\

echo.
echo [3/4] 打包 EXE（需要几分钟）...
call npx electron-builder --win --config
if errorlevel 1 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

:: 清理临时复制的引擎文件
del /Q "bot_core.mjs" 2>nul

echo.
echo [4/4] 完成!
echo 安装包位于: dist\ 目录
echo.

explorer dist
pause
