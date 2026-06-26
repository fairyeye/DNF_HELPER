import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Loading } from 'animal-island-ui';
import { invoke, on, openExternal } from './ipc';
import Titlebar from './components/Titlebar';
import Header from './components/Header';
import EventGrid from './components/EventGrid';
import LogPanel from './components/LogPanel';
import LoginModal from './components/LoginModal';

function classifyLog(msg) {
  const m = msg.toLowerCase();
  if (m.includes('成功') || m.includes('✓') || m.includes('已保存') || m.includes('完成')) return 'ok';
  if (m.includes('失败') || m.includes('错误') || m.includes('异常') || m.includes('失效')) return 'err';
  if (m.includes('等待') || m.includes('超时') || m.includes('不足') || m.includes('跳过')) return 'warn';
  return '';
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginStatus, setLoginStatus] = useState({});
  const [logLines, setLogLines] = useState([]);
  const [logExpanded, setLogExpanded] = useState(true);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [headerStatus, setHeaderStatus] = useState('待命');
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // ── Log helper ──
  const addLog = useCallback((msg, cls) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const autoClass = cls || classifyLog(msg);
    setLogLines(prev => [...prev, { time, msg, cls: autoClass }]);
    setLogExpanded(true);
  }, []);

  // ── Refresh events ──
  const refreshEvents = useCallback(() => {
    invoke('list-events').then(list => {
      setEvents(list);
      return list;
    }).catch(err => {
      addLog('加载活动列表失败: ' + err.message, 'err');
      return [];
    }).finally(() => {
      setLoading(false);
    });
  }, [addLog]);

  // ── Check login ──
  const checkLogin = useCallback((evtList) => {
    const list = evtList || eventsRef.current;
    const frameworks = [];
    const seen = {};
    for (const evt of list) {
      const fw = evt.framework === 'milo' || evt.type === 'checkin' ? 'milo' : 'act';
      if (!seen[fw]) { seen[fw] = true; frameworks.push(fw); }
    }
    if (frameworks.length === 0) frameworks.push('act', 'milo');

    invoke('check-all-logins', frameworks).then(res => {
      setLoginStatus(res);
    });
  }, []);

  // ── IPC listeners ──
  useEffect(() => {
    const offEngineReady = on('engine-ready', (_e, info) => {
      if (info.error) {
        addLog('引擎加载失败: ' + info.error, 'err');
      }
      refreshEvents();
      checkLogin();
    });

    const offBotLog = on('bot-log', (_e, msg) => {
      addLog(msg);
    });

    // Trigger engine init
    invoke('renderer-ready');

    return () => {
      offEngineReady();
      offBotLog();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run single event ──
  const runSingle = useCallback((eventId) => {
    setIsRunning(true);
    setHeaderStatus('执行中...');
    addLog('════════ 开始运行 ════════');
    invoke('run-event', eventId).then(res => {
      if (res.error) { addLog('执行失败: ' + res.error, 'err'); return; }
      showRunResult(res);
      if (res.result && res.result.checkInDays !== undefined) {
        setEvents(prev => prev.map(e =>
          e.id === eventId ? { ...e, _checkInDays: res.result.checkInDays } : e
        ));
      }
      addLog('════════ 运行结束 ════════');
    }).finally(() => {
      setIsRunning(false);
      setHeaderStatus('待命');
    });
  }, [addLog]);

  // ── Run all ──
  const runAll = useCallback(() => {
    setIsRunning(true);
    setHeaderStatus('执行中...');
    addLog('════════ 一键运行全部活动 ════════');
    invoke('run-all').then(res => {
      if (res.error) { addLog('错误: ' + res.error, 'err'); return; }
      if (res.results) {
        for (const id in res.results) {
          showRunResult({ result: res.results[id] });
        }
      }
      addLog('════════ 全部完成 ════════');
    }).finally(() => {
      setIsRunning(false);
      setHeaderStatus('待命');
    });
  }, [addLog]);

  // ── Show run result ──
  function showRunResult(res) {
    if (res.error) { addLog('执行失败: ' + res.error, 'err'); return; }
    const r = res.result;
    if (!r) { addLog('未获取到执行结果', 'warn'); return; }
    if (r.error) addLog('执行出错: ' + r.error, 'err');
    if (r.daily) addLog('  每日任务: 成功' + r.daily.success + ' 跳过' + r.daily.skip + ' 失败' + r.daily.fail, r.daily.fail > 0 ? 'warn' : 'ok');
    if (r.weekly) addLog('  每周任务: 成功' + r.weekly.success + ' 跳过' + r.weekly.skip + ' 失败' + r.weekly.fail, r.weekly.fail > 0 ? 'warn' : 'ok');
    if (r.oneTime) addLog('  一次性任务: 成功' + r.oneTime.success + ' 跳过' + r.oneTime.skip + ' 失败' + r.oneTime.fail, r.oneTime.fail > 0 ? 'warn' : 'ok');
    if (r.score !== undefined) addLog('  当前积分: ' + r.score, 'ok');
    if (r.exchanged) addLog('  奖励已兑换!', 'ok');
    if (r.checkInDays !== undefined && !r.error) addLog('  打卡天数: ' + r.checkInDays, 'ok');
    if (r.claimed && r.claimed.length > 0) {
      addLog('  本次领取: ' + r.claimed.length + ' 个里程碑奖励', 'ok');
      r.claimed.forEach(c => addLog('    - ' + c.name, 'ok'));
    } else if (r.claimed && r.claimed.length === 0 && !r.error) {
      addLog('  无可领取的里程碑奖励', 'warn');
    }
  }

  // ── Login ──
  const doLogin = useCallback(() => {
    const list = eventsRef.current;
    if (list.length === 0) { addLog('请先添加一个活动配置', 'warn'); return; }
    const active = list.filter(e => e._active);
    const all = active.length > 0 ? active : list;

    const groups = {};
    for (const evt of all) {
      const fw = evt.framework === 'milo' || evt.type === 'checkin' ? 'milo' : 'act';
      if (!groups[fw]) groups[fw] = [];
      groups[fw].push(evt.url);
    }

    setLoginModalOpen(true);
    let hasError = false;
    const keys = Object.keys(groups);
    let idx = 0;

    function loginNext() {
      if (idx >= keys.length) {
        setLoginModalOpen(false);
        if (!hasError) addLog('所有框架登录状态已保存', 'ok');
        checkLogin();
        return;
      }
      const fw = keys[idx++];
      const urls = groups[fw];
      const fwLabel = fw === 'milo' ? 'Milo' : 'ACT';
      addLog('正在为 ' + fwLabel + ' 框架打开浏览器登录...');
      invoke('login', urls[0], urls.slice(1), fw).then(res => {
        if (res.error) { addLog(fwLabel + ' 登录失败: ' + res.error, 'err'); hasError = true; }
        else addLog(fwLabel + ' 登录成功!', 'ok');
        loginNext();
      });
    }
    loginNext();
  }, [addLog, checkLogin]);

  // ── Clear login ──
  const clearLogin = useCallback(() => {
    setConfirmDialog({
      message: '确定要清空所有登录信息吗？\n（将删除 Cookie 和浏览器缓存，需要重新登录）',
      onYes: () => {
        invoke('clear-login').then(res => {
          if (res.error) addLog('清空失败: ' + res.error, 'err');
          else addLog('登录信息已清空', 'ok');
          checkLogin();
        });
      },
    });
  }, [addLog, checkLogin]);

  // ── Query status ──
  const queryStatus = useCallback((eventId) => {
    setIsRunning(true);
    setHeaderStatus('执行中...');
    const evt = eventsRef.current.find(e => e.id === eventId);
    const isCheckIn = evt && evt.type === 'checkin';
    addLog('── 查询 ' + (evt ? evt.name : eventId) + ' ' + (isCheckIn ? '打卡天数' : '积分') + ' ──');
    invoke('status', eventId).then(res => {
      if (res.error) { addLog('查询失败: ' + res.error, 'err'); return; }
      if (!res.result) return;
      const r = res.result;
      if (r.error) addLog('查询异常: ' + r.error, 'err');
      else if (r.loggedIn === false) addLog('未登录，请先点击 QQ登录', 'warn');
      else if (isCheckIn && r.checkInDays !== undefined) {
        addLog('当前打卡天数: ' + r.checkInDays, 'ok');
        setEvents(prev => prev.map(e =>
          e.id === eventId ? { ...e, _checkInDays: r.checkInDays } : e
        ));
      } else if (r.score !== undefined) {
        addLog('当前积分: ' + r.score, 'ok');
        if (r.predictionScore !== undefined) addLog('预测积分: ' + r.predictionScore, 'ok');
        if (r.target) {
          const diff = Math.max(0, r.target.cost - r.score);
          addLog('目标 ' + r.target.name + '(' + r.target.cost + '分) ' + (diff > 0 ? '还差 ' + diff + ' 分' : '已达成!'), diff > 0 ? 'warn' : 'ok');
        }
      }
    }).finally(() => {
      setIsRunning(false);
      setHeaderStatus('待命');
    });
  }, [addLog]);

  // ── Add event ──
  const addEvent = useCallback(() => {
    invoke('add-event').then(res => {
      if (res.canceled) return;
      if (res.error) { addLog(res.error, 'err'); return; }
      addLog('已添加活动: ' + res.event.name, 'ok');
      refreshEvents().then(list => checkLogin(list));
    });
  }, [addLog, refreshEvents, checkLogin]);

  // ── Remove event ──
  const removeEvent = useCallback((eventId) => {
    const evt = eventsRef.current.find(e => e.id === eventId);
    if (!evt) return;
    setConfirmDialog({
      message: '确定删除活动 "' + evt.name + '" ?',
      onYes: () => {
        invoke('remove-event', eventId).then(res => {
          if (res.error) addLog('删除失败: ' + res.error, 'err');
          else { addLog('已删除: ' + evt.name, 'ok'); refreshEvents(); }
        });
      },
    });
  }, [addLog, refreshEvents]);

  // ── Open events dir ──
  const openEventsDir = useCallback(() => { invoke('open-events-dir'); }, []);

  // ── Open URL ──
  const openUrl = useCallback((eventId) => {
    const evt = eventsRef.current.find(e => e.id === eventId);
    if (evt && evt.url) openExternal(evt.url);
  }, []);

  // ── Confirm dialog handlers ──
  const handleConfirmOk = useCallback(() => {
    if (confirmDialog?.onYes) confirmDialog.onYes();
    setConfirmDialog(null);
  }, [confirmDialog]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  return (
    <div className="app-root">
      <Loading active={loading} />

      <Titlebar />

      <Header
        headerStatus={headerStatus}
        loginStatus={loginStatus}
        isRunning={isRunning}
        onLogin={doLogin}
        onClearLogin={clearLogin}
        onAddEvent={addEvent}
        onOpenDir={openEventsDir}
        onRunAll={runAll}
      />

      <EventGrid
        events={events}
        isRunning={isRunning}
        onRun={runSingle}
        onQuery={queryStatus}
        onRemove={removeEvent}
        onOpenUrl={openUrl}
      />

      <LogPanel
        logLines={logLines}
        logExpanded={logExpanded}
        onToggle={() => setLogExpanded(prev => !prev)}
        onClear={() => setLogLines([])}
      />

      <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />

      <Modal
        open={!!confirmDialog}
        title="确认操作"
        onClose={handleConfirmCancel}
        onOk={handleConfirmOk}
        maskClosable={true}
        typewriter={false}
        width={400}
      >
        <div style={{ whiteSpace: 'pre-line', textAlign: 'center', padding: '10px 0' }}>
          {confirmDialog?.message || ''}
        </div>
      </Modal>
    </div>
  );
}
