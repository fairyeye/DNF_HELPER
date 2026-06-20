#!/usr/bin/env node
/**
 * DNF Bot Core - 通用活动领取引擎
 * 
 * 提供浏览器管理、登录检测、积分领取等通用功能
 * 被 dnf_bot.mjs 调用，配合 events/*.json 配置运行
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ================================================================
//                        数据目录
// ================================================================

export const DATA_DIR = (() => {
  if (process.env.DNF_BOT_DATA_DIR) return process.env.DNF_BOT_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'dnf-bot', 'stronger');
  }
  return path.join(__dirname, '.dnf-data');
})();

const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile');
const LOG_FILE = path.join(DATA_DIR, 'bot.log');

// Cookie 按登录框架分文件存储：不同框架的登录方式不同，Cookie 不共用
function getCookiesFile(framework = 'act') {
  return path.join(DATA_DIR, `cookies.${framework}.json`);
}

/**
 * 根据活动配置判断登录框架类型
 * - milo: Milo SDK 登录（WeGame 活动、打卡活动）
 * - act:  ACT 框架登录（默认）
 */
export function getFramework(config) {
  if (config.type === 'checkin' || config.framework === 'milo') return 'milo';
  return 'act';
}

// 事件配置存放在数据目录内（确保 EXE 模式下也可读写）
export const EVENTS_DIR = path.join(DATA_DIR, 'events');

// 源码目录中的事件配置（用于首次初始化时复制）
const SOURCE_EVENTS_DIR = path.join(__dirname, 'events');

/**
 * 初始化事件目录：首次运行时从源码目录复制配置到数据目录
 */
export function initEventsDir() {
  fs.mkdirSync(EVENTS_DIR, { recursive: true });
  // 如果源码目录有事件配置而数据目录是空的，复制过去
  if (fs.existsSync(SOURCE_EVENTS_DIR)) {
    const sourceFiles = fs.readdirSync(SOURCE_EVENTS_DIR).filter(f => f.endsWith('.json'));
    for (const file of sourceFiles) {
      const destFile = path.join(EVENTS_DIR, file);
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(path.join(SOURCE_EVENTS_DIR, file), destFile);
      }
    }
  }
}

// 等待时间配置 (ms)
const WAIT_AFTER_ACTION = 2500;
const WAIT_FOR_INIT = 8000;
const FLOW_TIMEOUT = 30000;

// ================================================================
//                        Chromium 管理
// ================================================================

function findChromeExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const localChromiumDir = path.join(DATA_DIR, 'chromium');
  if (fs.existsSync(localChromiumDir)) {
    const chromeExe = findChromeInDir(localChromiumDir);
    if (chromeExe) return chromeExe;
  }

  const systemPaths = getSystemChromePaths();
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function getSystemChromePaths() {
  const platform = process.platform;
  if (platform === 'win32') {
    return [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
  } else if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  } else {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
  }
}

function findChromeInDir(dir) {
  const names = process.platform === 'win32'
    ? ['chrome.exe', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
    : process.platform === 'darwin'
      ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'Chromium']
      : ['chrome-linux/chrome', 'chrome', 'chromium'];

  for (const name of names) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function ensureChromeAvailable() {
  let chromePath = findChromeExecutable();
  if (chromePath) {
    log(`使用 Chrome: ${chromePath}`);
    return chromePath;
  }

  log('未找到 Chrome/Chromium，正在自动下载...');
  try {
    const { install, Browser, detectBrowserPlatform, resolveBuildId } = await import('@puppeteer/browsers');
    const platform = detectBrowserPlatform();
    const buildId = await resolveBuildId(Browser.CHROMIUM, platform, 'stable');
    const cacheDir = path.join(DATA_DIR, 'chromium');

    log(`正在下载 Chromium ${buildId} (${platform})...`);
    const installed = await install({
      browser: Browser.CHROMIUM,
      buildId,
      cacheDir,
    });
    chromePath = installed.executablePath;
    log(`Chromium 下载完成: ${chromePath}`);
    return chromePath;
  } catch (e) {
    log(`自动下载 Chromium 失败: ${e.message}`);
    log('请手动安装 Chrome 浏览器，或设置 CHROME_PATH 环境变量');
    throw new Error('Chromium 下载失败，请安装 Chrome 浏览器');
  }
}

// ================================================================
//                        工具函数
// ================================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function ts() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function log(msg) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  if (_logCallback) _logCallback(msg);
}

let _logCallback = null;
export function setLogCallback(fn) { _logCallback = fn; }

export function logSep() {
  log('='.repeat(52));
}

// ================================================================
//                    反检测 & 人类行为模拟
// ================================================================

/**
 * 隐身补丁 — 消除 Puppeteer/CDP 自动化痕迹
 * 在每个新 page 上调用一次，必须在导航前执行
 */
async function setupStealth(page) {
  await page.evaluateOnNewDocument(() => {
    // 1. 隐藏 webdriver 标志
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    delete navigator.__proto__.webdriver;

    // 2. 伪造 plugins（真实 Chrome 至少有 PDF Viewer）
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ];
        arr.length = 3;
        return arr;
      }
    });

    // 3. 伪造 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en']
    });

    // 4. 隐藏 Chrome 自动化痕迹
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};

    // 5. 隐藏 CDP 相关属性
    if (window.domAutomation) delete window.domAutomation;
    if (window.domAutomationController) delete window.domAutomationController;

    // 6. 伪造 permissions query
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }
  });
}

/**
 * 模拟人类浏览行为 — 滚动、鼠标移动、随机延迟
 * 在页面加载完成后调用，触发懒加载内容 & 反作弊检测
 */
async function humanizePage(page) {
  try {
    // 随机滚动 1-3 次
    const scrolls = rand(1, 3);
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel({ deltaY: rand(150, 400) });
      await sleep(rand(200, 500));
    }
    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(rand(200, 400));

    // 随机鼠标移动 3-6 次
    const moves = rand(3, 6);
    for (let i = 0; i < moves; i++) {
      await page.mouse.move(rand(100, 1200), rand(100, 700));
      await sleep(rand(80, 200));
    }
  } catch { /* 静默：无头模式下某些鼠标操作可能受限 */ }
}

// ================================================================
//                    浏览器管理
// ================================================================

export async function launchBrowser(headless = true) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const executablePath = await ensureChromeAvailable();

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    executablePath,
    userDataDir: PROFILE_DIR,
    args: [
      '--window-size=1440,900',
      '--lang=zh-CN',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  return browser;
}

export async function navigateToPage(browser, url, framework = 'act') {
  // 导航前恢复保存的 Cookie，确保无头模式下登录态有效
  // Chrome Profile (userDataDir) 是主持久化，loadCookies 是双保险
  await loadCookies(browser, framework);

  const page = await browser.newPage();

  // 隐身补丁（必须在导航前执行）
  await setupStealth(page);

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );

  log('正在打开活动页面...');
  // domcontentloaded 比 networkidle2 快得多，剩余初始化由 waitForInitComplete 轮询处理
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('页面加载完成，等待初始化...');
  await sleep(WAIT_FOR_INIT);

  // 模拟人类行为：滚动 + 鼠标移动（触发懒加载 & 反作弊）
  await humanizePage(page);

  return page;
}

// ================================================================
//                    登录检测 & Cookie 管理
// ================================================================

export async function checkLoginStatus(page) {
  try {
    return await page.evaluate(() => {
      // === 1. SDK 框架变量（最可靠，由登录回调设置） ===
      // ACT framework — isLogin 可能是 bool/number/string
      if (window.ACT && window.ACT.var) {
        const v = window.ACT.var.isLogin;
        if (v === true || v === 1 || v === '1' || v === 'true') return true;
      }
      // Milo framework (WeGame events etc.)
      if (window.Act && (window.Act.isLogin === true || window.Act.isLogin === 1 || window.Act.isLogin === '1')) return true;

      // === 2. DOM 成对检测（严格：两个元素必须同时存在，一个可见一个隐藏） ===
      for (const [lid, uid] of [['logined', 'unlogin'], ['milo-logined', 'milo-unlogin']]) {
        const loginedEl = document.getElementById(lid);
        const unloginEl = document.getElementById(uid);
        if (loginedEl && unloginEl) {
          const loginedVisible = loginedEl.style.display !== 'none'
            && loginedEl.offsetParent !== null
            && !loginedEl.hidden;
          const unloginHidden = unloginEl.style.display === 'none'
            || unloginEl.offsetParent === null
            || unloginEl.hidden;
          if (loginedVisible && unloginHidden) return true;
        }
      }

      // 其他信号（iCheckIn、昵称、文本"注销"）容易误判，已移除
      return false;
    });
  } catch {
    return false;
  }
}

export async function waitForInitComplete(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      // 1. ACT 显式初始化标志
      if (window.ACT?.var?.isInit === true) return true;
      // 2. 用户数据已加载（打卡天数 / 积分 > 0）
      if (parseInt(window.ACT?.var?.iCheckIn) > 0) return true;
      if (Number(window.ACT?.var?.jScore) > 0) return true;
      // 3. 页面已渲染出用户信息
      if (document.querySelector('#sNickName')?.textContent?.trim()) return true;
      if (document.querySelector('.user-name')?.textContent?.trim()) return true;
      // 4. Milo 框架已绑定大区
      if (window.Act?.isBind === true) return true;
      // 5. 页面含 "注销" 说明已完成登录+初始化流程
      const text = document.body?.textContent || '';
      if (text.includes('注销') && (window.ACT || window.Act)) return true;
      return false;
    }).catch(() => false);
    if (ready) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Milo 框架: 等待异步登录回调完成
 * Milo.checkLogin() 是异步的，成功回调中设置 Act.isLogin = true
 * 无头模式下回调可能延迟，需要轮询等待
 */
export async function waitForMiloLogin(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await page.evaluate(() => {
      const actLogin = window.ACT?.var?.isLogin;
      const miloLogin = window.Act?.isLogin;
      return {
        isLogin: actLogin === true || actLogin === 1 || actLogin === '1'
              || miloLogin === true || miloLogin === 1 || miloLogin === '1',
        isBind: window.Act?.isBind === true,
        hasMilo: typeof window.Milo !== 'undefined',
        hasAct: typeof window.Act !== 'undefined' || typeof window.ACT !== 'undefined',
      };
    }).catch(() => ({}));

    if (status.isLogin) return true;

    // 5 秒后尝试 DOM 检测 (Cookie 已预加载，登录态应很快可用)
    if (Date.now() - start > 5000) {
      const domLogin = await page.evaluate(() => {
        // WeGame 活动: #logined / #unlogin
        const logined = document.getElementById('logined');
        const unlogin = document.getElementById('unlogin');
        if (logined && unlogin) {
          const loginedVisible = logined.style.display !== 'none'
            && logined.offsetParent !== null && !logined.hidden;
          const unloginHidden = unlogin.style.display === 'none'
            || unlogin.offsetParent === null || unlogin.hidden;
          if (loginedVisible && unloginHidden) return true;
        }
        // 周年庆活动: #milo-logined / #milo-unlogin
        const miloLogined = document.getElementById('milo-logined');
        const miloUnlogin = document.getElementById('milo-unlogin');
        if (miloLogined && miloUnlogin) {
          const loginedVisible = miloLogined.style.display !== 'none'
            && miloLogined.offsetParent !== null && !miloLogined.hidden;
          const unloginHidden = miloUnlogin.style.display === 'none'
            || miloUnlogin.offsetParent === null || miloUnlogin.hidden;
          if (loginedVisible && unloginHidden) return true;
        }
        return false;
      }).catch(() => false);
      if (domLogin) {
        // Force login flag on both Act (WeGame) and ACT.var (celebration/ACT+Milo hybrid)
        await page.evaluate(() => {
          if (window.Act) window.Act.isLogin = true;
          if (window.ACT?.var) window.ACT.var.isLogin = true;
        });
        return true;
      }
    }

    await sleep(1000);
  }

  // 最终兜底: 通过 checkLoginStatus 做全面检测
  const finalCheck = await checkLoginStatus(page).catch(() => false);
  if (finalCheck) {
    await page.evaluate(() => {
      if (window.Act) window.Act.isLogin = true;
      if (window.ACT?.var) window.ACT.var.isLogin = true;
    });
    return true;
  }
  return false;
}

export async function saveCookies(page, framework = 'act') {
  try {
    const cookies = await page.cookies();
    const file = getCookiesFile(framework);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cookies, null, 2), 'utf-8');
    log(`已保存 ${cookies.length} 个 Cookie (${framework})`);
  } catch (e) {
    log(`保存 Cookie 失败: ${e.message}`);
  }
}

/**
 * 从 cookies.json 恢复 Cookie 到浏览器上下文
 * 确保无头模式下页面能正确识别登录态
 */
export async function loadCookies(browser, framework = 'act') {
  const file = getCookiesFile(framework);
  if (!fs.existsSync(file)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    const validCookies = cookies.filter(c =>
      c && (c.domain || c.url) && c.name && c.value !== undefined
    );
    if (validCookies.length === 0) return false;
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await page.setCookie(...validCookies);
    log(`已恢复 ${validCookies.length} 个 Cookie (${framework})`);
    return true;
  } catch (e) {
    log(`恢复 Cookie 失败: ${e.message}`);
    return false;
  }
}

/**
 * 清空登录状态 — 删除 Chrome Profile 和 cookies.json
 * 用于用户主动登出或登录态异常时重置
 */
export function clearLoginState() {
  let cleared = [];

  // 删除所有 cookies.*.json 文件（按框架分离存储）
  if (fs.existsSync(DATA_DIR)) {
    const cookieFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('cookies.') && f.endsWith('.json'));
    for (const f of cookieFiles) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      cleared.push(f);
    }
  }

  // 递归删除 Chrome Profile 目录
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    cleared.push('chrome-profile');
  }

  return { cleared };
}
// ================================================================
//                    核心操作: submitFlow
// ================================================================

async function executeFlow(page, token, sData = {}) {
  return page.evaluate(
    (t, d, to) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ ok: false, code: -1, msg: '操作超时' });
        }, to);

        try {
          window.ACT.fun.submitFlow(
            t, d,
            (res) => {
              clearTimeout(timer);
              resolve({
                ok: true,
                code: 0,
                msg: (res && res.sMsg) || '成功',
              });
            },
            (res) => {
              clearTimeout(timer);
              resolve({
                ok: false,
                code: (res && res.iRet) || -1,
                msg: (res && res.sMsg) || '未知错误',
              });
            },
            false, false
          );
        } catch (e) {
          clearTimeout(timer);
          resolve({ ok: false, code: -2, msg: e.message });
        }
      });
    },
    token, sData, FLOW_TIMEOUT
  );
}

// ================================================================
//                    积分操作
// ================================================================

async function getCurrentScore(page) {
  return page.evaluate(() => {
    return {
      score: Number(window.ACT?.var?.jScore) || 0,
      predictionScore: Number(window.ACT?.var?.jPredictionScore) || 0,
    };
  });
}

async function refreshData(page, refreshToken) {
  try {
    await page.evaluate((token) => {
      return new Promise((resolve) => {
        window.ACT.fun.submitFlow(token, {}, (res) => {
          const data = res.details.jData;
          window.ACT.var.jScore = data.jScore;
          window.ACT.var.jPredictionScore = data.jPredictionScore;
          window.ACT.var.info = res.details;
          resolve(true);
        }, () => resolve(false), false);
      });
    }, refreshToken);
    await sleep(1500);
  } catch { /* ignore */ }
}

// ================================================================
//                    任务领取
// ================================================================

async function claimTaskGroup(page, tasks, groupName) {
  log(`  [${groupName}] 开始领取...`);
  let success = 0, skip = 0, fail = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const tag = `[${i + 1}/${tasks.length}]`;

    try {
      const result = await executeFlow(page, task.token, {});

      if (result.ok) {
        log(`    ${tag} OK ${task.name} - ${result.msg}`);
        success++;
      } else if (result.code === 101) {
        log(`    ${tag} LOCKED ${task.name} - 登录态失效`);
        fail++;
      } else {
        log(`    ${tag} SKIP ${task.name} - ${result.msg}`);
        skip++;
      }
    } catch (e) {
      log(`    ${tag} FAIL ${task.name} - ${e.message}`);
      fail++;
    }

    if (i < tasks.length - 1) await sleep(rand(2000, 5000));
  }

  log(`  ${groupName}: 成功 ${success} | 跳过 ${skip} | 失败 ${fail}`);
  return { success, skip, fail };
}

// ================================================================
//                    兑换奖励
// ================================================================

async function tryExchangeReward(page, config) {
  const { score } = await getCurrentScore(page);
  const { targetReward } = config;
  log(`  当前积分: ${score} | 兑换 ${targetReward.name} 需要: ${targetReward.cost}`);

  if (score < targetReward.cost) {
    log(`  积分不足，还差 ${targetReward.cost - score} 分`);
    return false;
  }

  log(`  积分足够! 尝试兑换 ${targetReward.name}...`);
  const result = await executeFlow(page, config.exchangeToken, { rewardId: targetReward.id });

  if (result.ok) {
    log(`  兑换成功! 获得 ${targetReward.name} (24小时内到账)`);
    return true;
  } else {
    log(`  兑换失败: ${result.msg} (code: ${result.code})`);
    return false;
  }
}

// ================================================================
//                Milo 框架引擎 (WeGame 等活动)
// ================================================================

/**
 * Milo 框架: 执行 API 调用
 * Milo.emit({ actId, token, sData, success, fail })
 */
async function executeFlowMilo(page, actId, token, sData = {}) {
  return page.evaluate(
    (aId, t, d, to) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ ok: false, code: -1, msg: '操作超时' });
        }, to);

        try {
          Milo.emit({
            actId: aId,
            token: t,
            sData: d,
            loading: false,
            success: function(res) {
              clearTimeout(timer);
              resolve({
                ok: true,
                code: 0,
                msg: (res && res.sMsg) || '成功',
                details: res,
              });
            },
            fail: function(res) {
              clearTimeout(timer);
              resolve({
                ok: false,
                code: (res && res.iRet) || -1,
                msg: (res && res.sMsg) || '未知错误',
                details: res,
              });
            }
          });
        } catch (e) {
          clearTimeout(timer);
          resolve({ ok: false, code: -2, msg: e.message });
        }
      });
    },
    actId, token, sData, FLOW_TIMEOUT
  );
}

/**
 * Milo 框架: 绑定大区 + 初始化数据
 * 先查询绑定状态 (token: config.queryBindToken)，
 * 如未绑定则提交绑定 (token: config.bindToken)，
 * 然后查询初始化数据 (token: config.initToken)
 */
async function initMiloData(page, config) {
  const actId = config.actId;

  // 先等 Milo SDK 真正就绪（不只是存在，emit 必须是函数）
  log('  [Milo] 等待 Milo SDK 就绪...');
  for (let i = 0; i < 15; i++) {
    const ready = await page.evaluate(() =>
      typeof window.Milo !== 'undefined' && typeof window.Milo.emit === 'function'
    ).catch(() => false);
    if (ready) { log('  [Milo] SDK 已就绪'); break; }
    await sleep(1000);
  }

  // 模拟人类操作后再调 API（触发 SDK 内部初始化）
  await humanizePage(page);
  await sleep(rand(500, 1500));

  // Step 1: 查询绑定大区 (失败则重试)
  log('  [Milo] 查询大区绑定状态...');
  let queryResult = await executeFlowMilo(page, actId, config.queryBindToken, { query: true });
  if (!queryResult.ok && queryResult.code === -1) {
    // 超时，重试一次
    log('  [Milo] 查询超时，等待后重试...');
    await sleep(3000);
    queryResult = await executeFlowMilo(page, actId, config.queryBindToken, { query: true });
  }
  if (!queryResult.ok) {
    // 尝试提交绑定
    log('  [Milo] 尝试提交大区绑定...');
    let bindResult = await executeFlowMilo(page, actId, config.bindToken, { query: false });
    if (!bindResult.ok && bindResult.code === -1) {
      log('  [Milo] 绑定超时，等待后重试...');
      await sleep(3000);
      bindResult = await executeFlowMilo(page, actId, config.bindToken, { query: false });
    }
    if (!bindResult.ok) {
      log(`  [Milo] 大区绑定失败: ${bindResult.msg}`);
      return false;
    }
    log('  [Milo] 大区绑定成功');
  } else {
    log('  [Milo] 大区已绑定');
  }

  // Step 2: 查询初始化数据 (积分 + 资格，失败则重试)
  log('  [Milo] 查询积分和资格数据...');
  let initResult = await executeFlowMilo(page, actId, config.initToken, {});
  if (!initResult.ok && initResult.code === -1) {
    log('  [Milo] 数据查询超时，等待后重试...');
    await sleep(3000);
    initResult = await executeFlowMilo(page, actId, config.initToken, {});
  }
  if (initResult.ok && initResult.details?.details?.jData) {
    const jData = initResult.details.details.jData;
    if (jData.iRet == 0) {
      const score = parseInt(jData.jf) || 0;
      log(`  [Milo] 当前积分: ${score}`);
      return { score, zgArr: jData.zg ? jData.zg.split(',') : [] };
    }
  }
  log(`  [Milo] 初始化数据查询失败: ${initResult.msg}`);
  return false;
}

/**
 * Milo 框架: 领取任务积分
 */
async function claimMiloTaskGroup(page, config, tasks, groupName) {
  log(`  [${groupName}] 开始领取...`);
  const actId = config.actId;
  let success = 0, skip = 0, fail = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const tag = `[${i + 1}/${tasks.length}]`;

    try {
      const result = await executeFlowMilo(page, actId, task.token, task.sData || {});

      if (result.ok) {
        log(`    ${tag} OK ${task.name} - ${result.msg}`);
        success++;
      } else if (result.code == 101) {
        log(`    ${tag} LOCKED ${task.name} - 登录态失效`);
        fail++;
      } else {
        log(`    ${tag} SKIP ${task.name} - ${result.msg}`);
        skip++;
      }
    } catch (e) {
      log(`    ${tag} FAIL ${task.name} - ${e.message}`);
      fail++;
    }

    if (i < tasks.length - 1) await sleep(rand(2000, 5000));
  }

  log(`  ${groupName}: 成功 ${success} | 跳过 ${skip} | 失败 ${fail}`);
  return { success, skip, fail };
}

/**
 * Milo 框架: 兑换奖励
 * Milo 兑换使用 exchangeToken + sData: { index: "N" }
 */
async function exchangeMiloReward(page, config) {
  const actId = config.actId;

  // 先刷新积分
  const initData = await initMiloData(page, config);
  const score = initData ? initData.score : 0;
  log(`  当前积分: ${score} | 兑换 ${config.targetReward.name} 需要: ${config.targetReward.cost}`);

  if (score < config.targetReward.cost) {
    log(`  积分不足，还差 ${config.targetReward.cost - score} 分`);
    return false;
  }

  log(`  积分足够! 尝试兑换 ${config.targetReward.name}...`);
  const result = await executeFlowMilo(page, actId, config.exchangeToken, {
    index: config.targetReward.exchangeIndex?.toString() || '1'
  });

  if (result.ok) {
    log(`  兑换成功! 获得 ${config.targetReward.name}`);
    return true;
  } else {
    log(`  兑换失败: ${result.msg} (code: ${result.code})`);
    return false;
  }
}

/**
 * Milo 框架: 完整领取流程
 */
export async function runClaimMilo(config) {
  logSep();
  log(`DNF ${config.name} - 自动领取 (Milo)`);
  logSep();

  const fw = getFramework(config);
  if (!(await ensureLoggedIn(config))) {
    return { error: '登录失败，请手动点击"QQ 登录"按钮完成登录后再试' };
  }

  let browser;
  try {
    browser = await launchBrowser(true);
    const page = await navigateToPage(browser, config.url, fw);

    // Step 1: 等待 Milo 异步登录回调完成
    log('[Step 1] 等待登录状态...');
    const isLoggedIn = await waitForMiloLogin(page, 30000);
    if (!isLoggedIn) {
      log('登录态已失效! 请先点击 QQ 登录重新登录');
      await browser.close();
      return { error: '登录态已失效', daily: { success: 0, skip: 0, fail: 0 }, weekly: { success: 0, skip: 0, fail: 0 }, oneTime: { success: 0, skip: 0, fail: 0 } };
    }
    log('登录状态正常');

    // Step 2: 初始化 Milo 数据 (绑定大区 + 查询积分 + 资格)
    log('[Step 2] 初始化活动数据...');
    let initData = await initMiloData(page, config);
    if (!initData) {
      log('数据初始化失败，尝试继续...');
      initData = { score: 0, zgArr: [] };
    } else {
      log(`当前积分: ${initData.score}`);
    }

    // Step 3: 领取一次性奖励 (全民礼包/回流礼包)
    if (config.giftTasks && config.giftTasks.length > 0) {
      log('[Step 3] 领取见面礼...');
      await claimMiloTaskGroup(page, config, config.giftTasks, '见面礼');
    }

    // Step 4: 领取任务积分
    log('[Step 4] 领取每日任务积分...');
    const daily = config.dailyTasks && config.dailyTasks.length > 0
      ? await claimMiloTaskGroup(page, config, config.dailyTasks, '每日任务')
      : { success: 0, skip: 0, fail: 0 };

    // Step 4b: 领取每周任务积分
    log('[Step 4b] 领取每周任务积分...');
    const weekly = config.weeklyTasks && config.weeklyTasks.length > 0
      ? await claimMiloTaskGroup(page, config, config.weeklyTasks, '每周任务')
      : { success: 0, skip: 0, fail: 0 };

    // Step 4c: 领取一次性任务积分
    log('[Step 4c] 领取一次性任务积分...');
    const oneTime = config.oneTimeTasks && config.oneTimeTasks.length > 0
      ? await claimMiloTaskGroup(page, config, config.oneTimeTasks, '一次性任务')
      : { success: 0, skip: 0, fail: 0 };

    // Step 5: 每日免费深渊抽奖 (不消耗积分，需要通关深渊资格 zgArr[2]>0)
    let lotteryResult = null;
    if (config.dailyLotteryToken) {
      log('[Step 5] 每日深渊抽奖...');
      // 刷新资格数据
      const freshData = await initMiloData(page, config);
      const zgArr = freshData ? freshData.zgArr : initData.zgArr;
      const abyssCount = parseInt(zgArr[2]) || 0;

      if (abyssCount > 0) {
        log(`  深渊抽奖次数: ${abyssCount}`);
        const result = await executeFlowMilo(page, config.actId, config.dailyLotteryToken, {});
        if (result.ok) {
          log(`  抽奖成功! ${result.msg}`);
          lotteryResult = result.msg;
        } else {
          log(`  抽奖失败: ${result.msg}`);
        }
      } else {
        log('  无深渊抽奖次数 (需每日通关4次深渊)');
      }
    }

    // Step 6: 尝试兑换目标奖励
    log('[Step 6] 检查积分兑换...');
    const exchanged = await exchangeMiloReward(page, config);

    // Step 7: 保存 Cookie
    await saveCookies(page, fw);

    // 最终结果
    const finalData = await initMiloData(page, config);
    logSep();
    log('执行完毕!');
    log(`  见面礼: ${config.giftTasks ? '已尝试' : '无'}`);
    log(`  每日任务: 成功${daily.success} 跳过${daily.skip} 失败${daily.fail}`);
    log(`  每周任务: 成功${weekly.success} 跳过${weekly.skip} 失败${weekly.fail}`);
    log(`  一次性任务: 成功${oneTime.success} 跳过${oneTime.skip} 失败${oneTime.fail}`);
    if (config.dailyLotteryToken) {
      log(`  深渊抽奖: ${lotteryResult || '无次数'}`);
    }
    log(`  积分兑换: ${exchanged ? '已兑换 ' + config.targetReward.name : '积分不足'}`);
    log(`  当前积分: ${finalData ? finalData.score : '?'}`);
    logSep();

    await sleep(500);
    await browser.close();

    return { daily, weekly, oneTime, exchanged, score: finalData ? finalData.score : 0 };

  } catch (e) {
    log(`脚本执行异常: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(0, 3).join('\n'));
    if (browser) await browser.close().catch(() => {});
    return { error: e.message, daily: { success: 0, skip: 0, fail: 0 }, weekly: { success: 0, skip: 0, fail: 0 }, oneTime: { success: 0, skip: 0, fail: 0 } };
  }
}

// ================================================================
//                    公开 API: 三大流程
// ================================================================

/**
 * 登录流程 - 打开浏览器进行 QQ 扫码登录
 * framework 参数决定 Cookie 存储到哪个框架文件
 */
export async function runLogin(url, additionalUrls = [], framework = 'act') {
  log(`启动浏览器进行 QQ 登录 (${framework})...`);
  log('请在弹出的浏览器窗口中完成 QQ 扫码登录');

  let browser;
  try {
    browser = await launchBrowser(false);
    const page = await navigateToPage(browser, url, framework);

    // 等待页面充分加载（QQ OAuth 重定向需要时间）
    log('等待页面加载...');
    await sleep(8000);

    const isLoggedIn = await checkLoginStatus(page);
    if (!isLoggedIn) {
      log('等待你完成 QQ 登录...');
      let waited = 0;
      while (waited < 180000) {
        await sleep(2000);
        waited += 2000;
        const loggedIn = await checkLoginStatus(page);
        if (loggedIn) break;
      }
    }

    const finalStatus = await checkLoginStatus(page);
    if (finalStatus) {
      log('QQ 登录成功!');
      log('等待页面数据初始化...');
      await waitForInitComplete(page, 20000);
      await saveCookies(page, framework);
      log('登录状态已保存');

      // 遍历其他活动页面，建立各自的 session
      const otherUrls = additionalUrls.filter(u => u && u !== url);
      if (otherUrls.length > 0) {
        log(`正在为 ${otherUrls.length} 个活动页面建立会话...`);
        for (const otherUrl of otherUrls) {
          try {
            log(`  访问: ${otherUrl}`);
            const otherPage = await navigateToPage(browser, otherUrl, framework);
            await humanizePage(otherPage);
            await sleep(rand(1000, 2000));
            const pageLogin = await checkLoginStatus(otherPage);
            if (!pageLogin) {
              await sleep(3000);
            }
            await saveCookies(otherPage, framework);
            await otherPage.close();
            log(`  ✓ 会话已建立`);
          } catch (e) {
            log(`  ✗ 访问失败: ${e.message}`);
          }
        }
      }

      log('所有活动会话已保存');
    } else {
      log('登录超时或未成功，请重试');
    }
  } catch (err) {
    log('登录流程异常: ' + err.message);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) { /* 可能已被关闭 */ }
    log('浏览器已关闭');
  }
}

/**
 * 前置登录检查 — 确保指定框架的登录信息存在
 * 如果没有 Cookie，自动弹出浏览器让用户登录
 * 返回 true = 已登录可继续，false = 登录失败应中止
 */
export async function ensureLoggedIn(config) {
  const fw = getFramework(config);
  const file = getCookiesFile(fw);

  // 验证 Cookie 文件是否包含有效的登录认证信息
  function validateCookies(filePath) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(data) || data.length === 0) return false;

      // 方式1：传统 QQ 登录 Cookie — uin + skey
      const uin = data.find(c => c.name === 'uin' && c.value && c.value !== 'undefined');
      const skey = data.find(c => c.name === 'skey' && c.value && c.value !== 'undefined');
      if (uin && skey) {
        log(`已检测到 ${fw} 框架有效登录信息 (uin + skey)`);
        return true;
      }

      // 方式2：ACT OAuth2 登录 Cookie — openid + access_token
      const openid = data.find(c => c.name === 'openid' && c.value && c.value !== 'undefined' && c.value !== '');
      const accessToken = data.find(c => c.name === 'access_token' && c.value && c.value !== 'undefined' && c.value !== '');
      if (openid && accessToken) {
        log(`已检测到 ${fw} 框架有效登录信息 (openid + access_token)`);
        return true;
      }

      // 方式3：备选组合 — p_skey + pt4_token
      const pskey = data.find(c => c.name === 'p_skey' && c.value && c.value !== 'undefined');
      const pt4 = data.find(c => c.name === 'pt4_token' && c.value && c.value !== 'undefined');
      if (pskey && pt4) {
        log(`已检测到 ${fw} 框架有效登录信息 (p_skey + pt4_token)`);
        return true;
      }

      log(`${fw} Cookie 文件存在但缺少有效认证 (uin=${!!uin}, skey=${!!skey}, openid=${!!openid}, access_token=${!!accessToken})`);
      return false;
    } catch {
      return false;
    }
  }

  if (fs.existsSync(file) && validateCookies(file)) {
    return true;
  }

  log(`未检测到 ${fw} 框架有效登录信息，正在打开浏览器进行登录...`);
  await runLogin(config.url, [], fw);

  // 再次检查是否登录成功
  if (fs.existsSync(file) && validateCookies(file)) {
    return true;
  }

  log(`${fw} 框架登录失败，请手动点击 QQ 登录后重试`);
  return false;
}

/**
 * 状态查询 - 查看指定活动的积分情况
 */
export async function runStatus(config) {
  logSep();
  log(`DNF ${config.name} - 状态查询`);
  logSep();

  const fw = getFramework(config);
  if (!(await ensureLoggedIn(config))) {
    return { loggedIn: false, error: '未登录' };
  }

  let browser;
  try {
    browser = await launchBrowser(true);
    const page = await navigateToPage(browser, config.url, fw);

    // Checkin 类型: 查询打卡天数
    if (config.type === 'checkin') {
      const isLoggedIn = await waitForMiloLogin(page, 30000);
      if (!isLoggedIn) {
        log('登录态已失效! 请先点击 QQ 登录');
        await browser.close();
        return { loggedIn: false };
      }

      const initOk = await waitForInitComplete(page, 20000);
      if (!initOk) {
        log('数据初始化超时，尝试继续读取...');
      }
      const checkInDays = await page.evaluate(() => {
        return parseInt(window.ACT?.var?.iCheckIn) || 0;
      }).catch(() => 0);
      log(`当前打卡天数: ${checkInDays}`);
      const milestones = config.milestones || [];
      for (const m of milestones) {
        const status = checkInDays >= m.days ? '✓ 已达成' : `还差${m.days - checkInDays}天`;
        log(`  ${m.name}: ${status}`);
      }
      await saveCookies(page, fw);
      await browser.close();
      return { loggedIn: true, checkInDays };
    }

    // Milo: wait for async login callback
    if (config.framework === 'milo') {
      const isLoggedIn = await waitForMiloLogin(page, 30000);
      if (!isLoggedIn) {
        log('登录态已失效! 请先点击 QQ 登录');
        await browser.close();
        return { loggedIn: false };
      }

      const initData = await initMiloData(page, config);
      if (initData) {
        log(`当前积分: ${initData.score}`);
        log(`距离 ${config.targetReward.name} (${config.targetReward.cost}分): 还差 ${Math.max(0, config.targetReward.cost - initData.score)} 分`);
        await saveCookies(page, fw);
        await browser.close();
        return { loggedIn: true, score: initData.score, target: config.targetReward };
      } else {
        log('数据查询失败');
        await browser.close();
        return { loggedIn: true, error: '数据查询失败' };
      }
    }

    // ACT framework: standard flow (多次检测，页面初始化可能较慢)
    let isLoggedIn = await checkLoginStatus(page);
    if (!isLoggedIn) {
      for (let retry = 1; retry <= 3; retry++) {
        log(`  等待页面加载，重新检测登录 (${retry}/3)...`);
        await sleep(4000);
        isLoggedIn = await checkLoginStatus(page);
        if (isLoggedIn) break;
      }
    }
    if (!isLoggedIn) {
      log('登录态已失效! 请先点击 QQ 登录');
      await browser.close();
      return { loggedIn: false };
    }

    const initOk = await waitForInitComplete(page, 20000);
    if (!initOk) {
      log('数据初始化超时，尝试继续读取...');
    }
    let { score, predictionScore } = await getCurrentScore(page).catch(() => ({ score: 0, predictionScore: 0 }));
    // 积分为 0 时主动调 refreshData 拉取数据
    if (score === 0 && config.refreshToken) {
      log('  积分数据为空，尝试主动刷新...');
      await refreshData(page, config.refreshToken);
      const refreshed = await getCurrentScore(page).catch(() => ({ score: 0, predictionScore: 0 }));
      score = refreshed.score;
      predictionScore = refreshed.predictionScore;
    }
    log(`当前积分: ${score}`);
    log(`预测积分: ${predictionScore}`);
    log(`距离 ${config.targetReward.name} (${config.targetReward.cost}分): 还差 ${Math.max(0, config.targetReward.cost - score)} 分`);
    await saveCookies(page, fw);
    await browser.close();
    return { loggedIn: true, score, predictionScore, target: config.targetReward };
  } catch (e) {
    log(`查询异常: ${e.message}`);
    if (browser) await browser.close().catch(() => {});
    return { loggedIn: false, error: e.message };
  }
}

/**
 * 自动领取 - 领取每日/每周任务积分并尝试兑换
 */
export async function runClaim(config) {
  logSep();
  log(`DNF ${config.name} - 自动领取`);
  logSep();

  const fw = getFramework(config);
  if (!(await ensureLoggedIn(config))) {
    return { error: '登录失败，请手动点击"QQ 登录"按钮完成登录后再试' };
  }

  let browser;
  try {
    browser = await launchBrowser(true);
    const page = await navigateToPage(browser, config.url, fw);

    // Step 1: 检查登录 (页面初始化可能较慢，多次检测)
    log('[Step 1] 检查登录状态...');
    let isLoggedIn = await checkLoginStatus(page);
    if (!isLoggedIn) {
      for (let retry = 1; retry <= 3; retry++) {
        log(`  等待页面加载，重新检测登录 (${retry}/3)...`);
        await sleep(4000);
        isLoggedIn = await checkLoginStatus(page);
        if (isLoggedIn) break;
      }
    }
    if (!isLoggedIn) {
      log('登录态已失效! 请先点击 QQ 登录重新登录');
      await browser.close();
      return { error: '登录态已失效', daily: { success: 0, skip: 0, fail: 0 }, weekly: { success: 0, skip: 0, fail: 0 } };
    }
    log('登录状态正常');

    // Step 2: 等待数据初始化
    log('[Step 2] 等待页面数据初始化...');
    const initOk = await waitForInitComplete(page, 20000);
    if (!initOk) {
      log('数据初始化超时，尝试继续执行...');
    } else {
      log('数据初始化完成');
    }

    let initialScore = await getCurrentScore(page);
    // 积分为 0 时主动调 refreshData 拉取数据
    if (initialScore.score === 0 && config.refreshToken) {
      log('  积分数据为空，尝试主动刷新...');
      await refreshData(page, config.refreshToken);
      initialScore = await getCurrentScore(page);
    }
    log(`当前积分: ${initialScore.score} | 预测积分: ${initialScore.predictionScore}`);

    // Step 3: 领取每日任务
    log('[Step 3] 领取每日任务积分...');
    const daily = await claimTaskGroup(page, config.dailyTasks, '每日任务');

    // Step 4: 领取每周任务
    log('[Step 4] 领取每周任务积分...');
    const weekly = config.weeklyTasks.length > 0
      ? await claimTaskGroup(page, config.weeklyTasks, '每周任务')
      : { success: 0, skip: 0, fail: 0 };

    // Step 5: 刷新数据 & 尝试兑换
    log('[Step 5] 检查积分兑换...');
    await refreshData(page, config.refreshToken);
    const exchanged = await tryExchangeReward(page, config);

    // Step 6: 保存 Cookie
    await saveCookies(page, fw);

    // 最终结果
    const finalScore = await getCurrentScore(page);
    logSep();
    log('执行完毕!');
    log(`  每日任务: 成功${daily.success} 跳过${daily.skip} 失败${daily.fail}`);
    log(`  每周任务: 成功${weekly.success} 跳过${weekly.skip} 失败${weekly.fail}`);
    log(`  积分兑换: ${exchanged ? '已兑换 ' + config.targetReward.name : '积分不足'}`);
    log(`  当前积分: ${finalScore.score}`);
    logSep();

    await sleep(500);
    await browser.close();

    return { daily, weekly, exchanged, score: finalScore.score };

  } catch (e) {
    log(`脚本执行异常: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(0, 3).join('\n'));
    if (browser) await browser.close().catch(() => {});
    return { error: e.message, daily: { success: 0, skip: 0, fail: 0 }, weekly: { success: 0, skip: 0, fail: 0 } };
  }
}

/**
 * 打卡活跃挑战 - 每日打卡 + 里程碑奖励领取
 * 适用于周年庆等"累计登录天数 → 领取里程碑奖励"类活动
 * config 需包含: checkInToken, checkInGiftToken, milestones[{index, days, name}]
 */
export async function runCheckInClaim(config) {
  logSep();
  log(`DNF ${config.name} - 打卡活跃挑战`);
  logSep();

  const fw = getFramework(config);
  if (!(await ensureLoggedIn(config))) {
    return { error: '登录失败，请手动点击"QQ 登录"按钮完成登录后再试', checkInDays: 0, claimed: [] };
  }

  let browser;
  try {
    browser = await launchBrowser(true);
    const page = await navigateToPage(browser, config.url, fw);

    // Step 1: 检查登录 (celebration 页面用 Milo SDK 做登录，需要异步等待)
    log('[Step 1] 检查登录状态...');
    const isLoggedIn = await waitForMiloLogin(page, 30000);
    if (!isLoggedIn) {
      log('登录态已失效! 请先重新登录');
      await browser.close();
      return { error: '登录态已失效', checkInDays: 0, claimed: [] };
    }
    log('登录状态正常');

    // Step 2: 等待数据初始化
    log('[Step 2] 等待页面数据初始化...');
    const initOk = await waitForInitComplete(page, 20000);
    if (!initOk) {
      log('数据初始化超时，尝试继续执行...');
    } else {
      log('数据初始化完成');
    }

    // Step 3: 读取当前打卡天数
    log('[Step 3] 读取打卡天数...');
    let checkInDays = await page.evaluate(() => {
      return parseInt(window.ACT?.var?.iCheckIn) || 0;
    });
    log(`  当前打卡天数: ${checkInDays}`);

    // Step 4: 执行每日打卡
    log('[Step 4] 执行每日打卡...');
    const checkInResult = await executeFlow(page, config.checkInToken, {});
    if (checkInResult.ok) {
      log(`  打卡成功! ${checkInResult.msg}`);
      // 尝试从返回数据更新天数
      const newDays = await page.evaluate(() => {
        return parseInt(window.ACT?.var?.iCheckIn) || 0;
      });
      if (newDays > checkInDays) {
        checkInDays = newDays;
        log(`  打卡后天数: ${checkInDays}`);
      }
    } else {
      log(`  打卡: ${checkInResult.msg} (可能今日已打卡)`);
    }

    // Step 5: 领取里程碑奖励
    log('[Step 5] 领取里程碑奖励...');
    const claimed = [];
    const milestones = config.milestones || [];

    for (const milestone of milestones) {
      if (checkInDays < milestone.days) {
        log(`  ${milestone.name}: 需要${milestone.days}天，还差${milestone.days - checkInDays}天`);
        continue;
      }

      const result = await executeFlow(page, config.checkInGiftToken, { index: String(milestone.index) });
      if (result.ok) {
        log(`  ${milestone.name}: 领取成功!`);
        claimed.push(milestone);
      } else {
        log(`  ${milestone.name}: ${result.msg}`);
      }
      await sleep(WAIT_AFTER_ACTION);
    }

    // 保存 Cookie
    await saveCookies(page, fw);

    // 最终结果
    logSep();
    log('执行完毕!');
    log(`  打卡天数: ${checkInDays}`);
    log(`  本次领取: ${claimed.length} 个里程碑奖励`);
    for (const m of claimed) {
      log(`    - ${m.name}`);
    }
    logSep();

    await sleep(500);
    await browser.close();

    return { checkInDays, claimed };

  } catch (e) {
    log(`脚本执行异常: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(0, 3).join('\n'));
    if (browser) await browser.close().catch(() => {});
    return { error: e.message, checkInDays: 0, claimed: [] };
  }
}

/**
 * 批量运行所有活跃事件
 */
export async function runAll(events) {
  const results = {};
  for (const config of events) {
    log(`\n>>> 开始处理: ${config.name}`);
    try {
      if (config.type === 'checkin') {
        results[config.id] = await runCheckInClaim(config);
      } else if (config.framework === 'milo') {
        results[config.id] = await runClaimMilo(config);
      } else {
        results[config.id] = await runClaim(config);
      }
    } catch (e) {
      log(`处理 ${config.name} 失败: ${e.message}`);
      results[config.id] = { error: e.message };
    }
  }
  return results;
}
