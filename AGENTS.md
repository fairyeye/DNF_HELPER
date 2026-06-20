# AGENTS.md - DNF 活动助手 GUI 开发规范

本文件定义 dnf_gui（Electron 桌面应用）的架构约束。

## 引擎依赖

- GUI 通过 `import()` 加载 `bot_core.mjs`（优先 `__dirname/bot_core.mjs`，其次 `../dnf_bot_stronger/bot_core.mjs`）
- 打包时 build.bat 会把 bot_core.mjs 从 dnf_bot_stronger 复制过来，构建后自动清理
- 引擎修改后必须重新打包才能生效

## IPC 通信

- 引擎日志通过 `setLogCallback` 回调 → `bot-log` IPC 事件发送到渲染进程
- 引擎加载完成后发送 `engine-ready` IPC 信号，渲染进程必须等此信号后才调用 `list-events` 和 `check-login`（防止引擎未加载时返回空数据）

## check-login 处理器

- 必须同时检查 `cookies.json` 文件和 Chrome Profile 目录
- `cookies.json` 检查需过滤 `value === 'undefined'` 等无效 Cookie
- Chrome Profile 检查 `Default` 或 `Profile*` 子目录是否存在

## routeClaim 路由

GUI 的 `run-event` / `run-all` 必须通过 `routeClaim(config)` 分发：

- `config.type === 'checkin'` → `engine.runCheckInClaim`
- `config.framework === 'milo'` → `engine.runClaimMilo`
- 默认 → `engine.runClaim`（ACT 框架）

## 打包注意

- `package.json` 的 `build.files` 必须包含 `bot_core.mjs`
- `build.extraResources` 从 `../dnf_bot_stronger/events` 复制活动配置到 `resources/events`
- 中国环境需设置 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR` 为 npmmirror.com
