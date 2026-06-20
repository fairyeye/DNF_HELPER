'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let engine = null;

// ================================================================
//                        窗口创建
// ================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 750,
    minWidth: 720,
    minHeight: 550,
    title: 'DNF 活动助手',
    backgroundColor: '#0d0d1a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile('index.html');

  // 开发时自动打开 DevTools
  // mainWindow.webContents.openDevTools();
}

// ================================================================
//                        引擎加载
// ================================================================

function getEnginePath() {
  // 1. 打包后: resources/app/main.js + resources/app/bot_core.mjs（构建时复制）
  const appPath = path.join(__dirname, 'bot_core.mjs');
  if (fs.existsSync(appPath)) {
    return 'file:///' + appPath.replace(/\\/g, '/');
  }
  // 2. 开发时: dnf_gui/main.js → ../dnf_bot_stronger/bot_core.mjs
  const devPath = path.resolve(__dirname, '..', 'dnf_bot_stronger', 'bot_core.mjs');
  if (fs.existsSync(devPath)) {
    return 'file:///' + devPath.replace(/\\/g, '/');
  }
  return null;
}

function copyResourceEvents() {
  if (!engine) return;
  // 打包后事件配置在 resources/events/
  const resEvents = path.resolve(process.resourcesPath || '', 'events');
  if (!fs.existsSync(resEvents)) return;
  fs.mkdirSync(engine.EVENTS_DIR, { recursive: true });
  for (const file of fs.readdirSync(resEvents)) {
    if (!file.endsWith('.json')) continue;
    const dest = path.join(engine.EVENTS_DIR, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(resEvents, file), dest);
      console.log('从 resources 复制事件配置:', file);
    }
  }
}

async function initEngine() {
  const enginePath = getEnginePath();
  if (!enginePath) {
    console.error('找不到 bot_core.mjs，请确保 dnf_bot_stronger 目录存在');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-ready', { error: '找不到引擎文件' });
    }
    return;
  }

  try {
    console.log('正在加载引擎:', enginePath);
    engine = await import(enginePath);
    console.log('引擎模块加载完成');
    engine.initEventsDir();
    copyResourceEvents();

    // 通过回调机制捕获引擎所有日志，发送到渲染进程
    engine.setLogCallback((msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bot-log', msg);
      }
    });
    console.log('引擎初始化完成');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-ready', { success: true });
    }
  } catch (err) {
    console.error('引擎加载失败:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-ready', { error: err.message });
    }
  }
}

// ================================================================
//                        事件管理辅助
// ================================================================

function listEvents() {
  if (!engine) return [];
  const dir = engine.EVENTS_DIR;
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const today = new Date().toISOString().slice(0, 10);

  return files.map(file => {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      return {
        ...config,
        _file: file,
        _active: config.endDate >= today,
        _daysLeft: Math.max(0, Math.ceil((new Date(config.endDate) - new Date(today)) / 86400000)),
      };
    } catch {
      return null;
    }
  }).filter(Boolean)
    .sort((a, b) => {
      if (a._active !== b._active) return a._active ? -1 : 1;
      return a.endDate.localeCompare(b.endDate);
    });
}

function routeClaim(config) {
  if (!engine) return Promise.reject(new Error('引擎未加载'));
  if (config.type === 'checkin') return engine.runCheckInClaim(config);
  if (config.framework === 'milo') return engine.runClaimMilo(config);
  return engine.runClaim(config);
}

// ================================================================
//                        IPC 处理器
// ================================================================

function setupIPC() {

  // ---------- 事件列表 ----------
  ipcMain.handle('list-events', () => listEvents());

  // ---------- 运行签到 ----------
  ipcMain.handle('run-event', async (_e, eventId) => {
    if (!engine) return { error: '引擎未加载' };
    const events = listEvents();
    const config = events.find(e => e.id === eventId);
    if (!config) return { error: '找不到活动: ' + eventId };
    try {
      const result = await routeClaim(config);
      return { success: true, result };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ---------- 一键全部运行 ----------
  ipcMain.handle('run-all', async () => {
    if (!engine) return { error: '引擎未加载' };
    const active = listEvents().filter(e => e._active);
    if (active.length === 0) return { error: '没有活跃的活动' };
    const results = {};
    for (const config of active) {
      try {
        results[config.id] = await routeClaim(config);
      } catch (err) {
        results[config.id] = { error: err.message };
      }
    }
    return { success: true, results };
  });

  // ---------- 登录 ----------
  ipcMain.handle('login', async (_e, url, additionalUrls, framework) => {
    if (!engine) return { error: '引擎未加载' };
    try {
      await engine.runLogin(url, additionalUrls || [], framework || 'act');
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ---------- 检查登录状态（按框架检查 Cookie 文件 + Chrome Profile） ----------
  // 辅助函数：验证 Cookie 数组是否包含有效 QQ 认证信息
  function hasValidQQAuth(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    // 方式1：传统 QQ 登录 — uin + skey
    const hasUin = cookies.some(c => c.name === 'uin' && c.value && c.value !== 'undefined');
    const hasSkey = cookies.some(c => c.name === 'skey' && c.value && c.value !== 'undefined');
    if (hasUin && hasSkey) return true;
    // 方式2：ACT OAuth2 登录 — openid + access_token
    const hasOpenid = cookies.some(c => c.name === 'openid' && c.value && c.value !== 'undefined' && c.value !== '');
    const hasAccessToken = cookies.some(c => c.name === 'access_token' && c.value && c.value !== 'undefined' && c.value !== '');
    if (hasOpenid && hasAccessToken) return true;
    // 方式3：备选 — p_skey + pt4_token
    const hasPSkey = cookies.some(c => c.name === 'p_skey' && c.value && c.value !== 'undefined');
    const hasPt4 = cookies.some(c => c.name === 'pt4_token' && c.value && c.value !== 'undefined');
    return hasPSkey && hasPt4;
  }

  // ---------- 检查单个框架的登录状态 ----------
  ipcMain.handle('check-login', (_e, framework) => {
    if (!engine) return { loggedIn: false };
    const fw = framework || 'act';
    const cookiesFile = path.join(engine.DATA_DIR, `cookies.${fw}.json`);
    if (fs.existsSync(cookiesFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
        if (hasValidQQAuth(data)) {
          const validCount = data.filter(c => c && c.value && c.value !== 'undefined' && c.value !== 'null').length;
          return { loggedIn: true, cookieCount: validCount, framework: fw };
        }
      } catch { /* continue */ }
    }
    return { loggedIn: false, framework: fw };
  });

  // ---------- 批量检查所有框架的登录状态 ----------
  ipcMain.handle('check-all-logins', (_e, frameworks) => {
    if (!engine) return {};
    const results = {};
    const fws = frameworks || ['act', 'milo'];
    for (const fw of fws) {
      const cookiesFile = path.join(engine.DATA_DIR, `cookies.${fw}.json`);
      let loggedIn = false;
      if (fs.existsSync(cookiesFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
          if (hasValidQQAuth(data)) loggedIn = true;
        } catch { /* continue */ }
      }
      results[fw] = loggedIn;
    }
    return results;
  });

  // ---------- 清空登录信息 ----------
  ipcMain.handle('clear-login', () => {
    if (!engine) return { error: '引擎未加载' };
    try {
      const result = engine.clearLoginState();
      return { success: true, cleared: result.cleared };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ---------- 查询积分 ----------
  ipcMain.handle('status', async (_e, eventId) => {
    if (!engine) return { error: '引擎未加载' };
    const events = listEvents();
    const config = events.find(e => e.id === eventId);
    if (!config) return { error: '找不到活动' };
    try {
      const result = await engine.runStatus(config);
      return { success: true, result };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ---------- 添加事件 ----------
  ipcMain.handle('add-event', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择活动配置文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    try {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const config = JSON.parse(content);
      if (!config.id || !config.name) {
        return { error: '无效的配置：缺少 id 或 name 字段' };
      }
      const destPath = path.join(engine.EVENTS_DIR, path.basename(result.filePaths[0]));
      fs.writeFileSync(destPath, content, 'utf-8');
      return { success: true, event: config };
    } catch (err) {
      return { error: '添加失败: ' + err.message };
    }
  });

  // ---------- 删除事件 ----------
  ipcMain.handle('remove-event', async (_e, eventId) => {
    const events = listEvents();
    const evt = events.find(e => e.id === eventId);
    if (!evt) return { error: '找不到活动' };
    try {
      fs.unlinkSync(path.join(engine.EVENTS_DIR, evt._file));
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ---------- 打开事件目录 ----------
  ipcMain.handle('open-events-dir', () => {
    if (engine && fs.existsSync(engine.EVENTS_DIR)) {
      shell.openPath(engine.EVENTS_DIR);
    }
  });

  // ---------- 窗口控制 ----------
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-close', () => mainWindow?.close());
}

// ================================================================
//                        应用生命周期
// ================================================================

app.whenReady().then(async () => {
  createWindow();
  setupIPC();
  await initEngine();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
