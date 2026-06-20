# AGENTS.md - DNF 活动助手开发规范

本文件定义整个项目的架构约束和易踩坑点，修改代码时必须遵守。

## 项目结构

```
dnf_gui/
├── main.js          # Electron 主进程（IPC 通信、引擎加载）
├── index.html       # 渲染进程（界面、交互逻辑）
├── bot_core.mjs     # 核心引擎（Puppeteer 自动化、登录检测、任务领取）
├── events/          # 活动配置 JSON
├── package.json     # 依赖 + electron-builder 打包配置
├── build.bat        # 构建脚本
└── AGENTS.md        # 本文件
```

- 引擎（bot_core.mjs）和界面（main.js + index.html）在同一个目录下
- GUI 通过 `import()` 加载 `__dirname/bot_core.mjs`
- 打包时 `build.files` 包含 `bot_core.mjs`，`build.extraResources` 把 `events/` 复制到 `resources/events`

## IPC 通信

- 引擎日志通过 `setLogCallback` 回调 → `bot-log` IPC 事件发送到渲染进程
- 引擎加载完成后发送 `engine-ready` IPC 信号，渲染进程必须等此信号后才调用 `list-events` 和 `check-login`

## check-login 处理器

- 验证 Cookie 是否包含有效 QQ 认证信息（三种方式任一即可）：
  - 传统 QQ 登录：`uin` + `skey`
  - ACT OAuth2 登录：`openid` + `access_token`
  - 备选：`p_skey` + `pt4_token`

## routeClaim 路由

GUI 的 `run-event` / `run-all` 必须通过 `routeClaim(config)` 分发：

- `config.type === 'checkin'` → `engine.runCheckInClaim`
- `config.framework === 'milo'` → `engine.runClaimMilo`
- 默认 → `engine.runClaim`（ACT 框架）

## 打包注意

- `package.json` 的 `build.files` 必须包含 `bot_core.mjs`
- `build.extraResources` 从 `events` 复制活动配置到 `resources/events`
- 中国环境需设置 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR` 为 npmmirror.com

---

## 引擎约束（bot_core.mjs）

### 登录检测体系（核心，易出错）

#### 1. 登录态持久化（Chrome Profile + cookies.json 双保险）

- **Chrome Profile (`userDataDir: PROFILE_DIR`)** 是主持久化——浏览器关闭后自动保存 Cookie、localStorage、sessionStorage
- **`cookies.{framework}.json`** 是双保险——`saveCookies()` 每次成功操作后保存，`loadCookies()` 每次导航前恢复
- `navigateToPage()` **必须** 在 `page.goto()` 之前调用 `loadCookies(browser, framework)`，确保无头模式下登录态有效
- `clearLoginState()` 同时删除 Chrome Profile 目录 + 所有 cookies.*.json

#### 2. checkLoginStatus 严格检测策略

**只信任以下两种信号**（其他信号容易误判，已移除）：

1. **SDK 框架变量**（最可靠，由登录回调设置）：
   - `ACT.var.isLogin`：可能是 `true`、`1`、`"1"`、`"true"`，必须全部视为已登录
   - `Act.isLogin`（Milo 框架）：同理，兼容 `true`、`1`、`"1"`
   - 禁止用 `=== true` 单独判断 isLogin

2. **DOM 成对严格检测**：
   - `#logined` + `#unlogin` 或 `#milo-logined` + `#milo-unlogin`
   - 两个元素必须**同时存在**
   - logined 元素**必须可见**（display !== 'none' && offsetParent !== null && !hidden）
   - unlogin 元素**必须隐藏**（display === 'none' || offsetParent === null || hidden）

**已移除的弱信号（禁止重新添加）**：iCheckIn > 0、昵称 DOM、页面文本"注销"/"退出登录"/"【登录】"

#### 3. ensureLoggedIn Cookie 验证

- 必须验证 Cookie 中的有效认证信息（三种方式任一即可）：
  - `uin` + `skey`（传统 QQ 登录）
  - `openid` + `access_token`（ACT OAuth2 登录）
  - `p_skey` + `pt4_token`（备选）
- 如果 Cookie 文件存在但缺少有效认证，视为未登录，自动弹出浏览器重新登录

#### 4. waitForMiloLogin 三阶段

1. JS 变量轮询（1s 间隔，总超时 30s）
2. 5 秒后 DOM 回退检测——严格成对检测，**不要求 hasAct 为 true**
3. 轮询超时后调用 `checkLoginStatus()` 做最终兜底

禁止给 DOM 回退添加 `hasAct` 前置条件。禁止删除最终兜底。禁止在 DOM 回退中使用文本检测。

#### 5. runLogin 最低等待时间

- 页面加载后必须等待至少 8 秒再开始检测登录状态
- 原因：QQ OAuth 重定向需要时间

#### 6. runClaim / runStatus 重试机制

- ACT 框架路径的首次 `checkLoginStatus` 失败后，必须重试 3 次，每次间隔 4 秒
- Milo 框架路径使用 `waitForMiloLogin` 自带轮询，不需要额外重试

#### 7. waitForInitComplete 多信号检测

- 必须同时检测：`ACT.var.isInit`、`iCheckIn > 0`、`jScore > 0`、用户昵称 DOM、`Act.isBind`、页面含"注销"文本
- **初始化超时不得阻断流程**：超时后必须尝试继续读取数据

#### 8. 数据为空时主动刷新

- `jScore === 0` 时，必须调用 `refreshData(page, config.refreshToken)` 主动触发数据加载

#### 9. Milo API 超时与重试

- `FLOW_TIMEOUT` 必须 ≥ 30 秒
- 每次 Milo API 超时后必须等待 3 秒再重试一次

#### 10. saveCookies

- 每次登录成功、脚本执行完成、查询积分后都调用 `saveCookies(page, fw)` 保持 cookies 更新
- Cookie 按框架分文件：`cookies.act.json`（ACT OAuth2）、`cookies.milo.json`（传统 QQ 登录）

### 引擎通用约束

- **禁止 `process.exit()`**：bot_core.mjs 运行在 Electron 进程内
- **日志必须走 `setLogCallback`**：通过回调将日志发送到 GUI
- **框架路由**：`routeClaim()` 按 `config.type`/`config.framework` 分发

### 反检测 & 人类行为模拟（必须保留）

- `setupStealth`：覆盖 `navigator.webdriver`、伪造 plugins、设置 languages、注入 `evaluateOnNewDocument`
- `humanizePage`：随机滚动 1-3 次、随机鼠标移动 3-6 次
- 任务间延迟：禁止固定延迟，必须使用 `rand(2000, 5000)` 随机延迟
- 页面加载策略：`page.goto()` 使用 `domcontentloaded` 而非 `networkidle2`
- Chrome 启动参数：`--disable-blink-features=AutomationControlled`、`--disable-infobars`、`userDataDir: PROFILE_DIR`
