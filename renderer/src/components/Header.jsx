import React from 'react';
import { Button, Title } from 'animal-island-ui';

export default function Header({
  loginStatus,
  isRunning,
  onLogin,
  onClearLogin,
  onAddEvent,
  onOpenDir,
  onRunAll,
}) {
  const frameworks = Object.keys(loginStatus);
  const loggedInAny = frameworks.some(k => loginStatus[k]);
  const loggedInParts = frameworks.filter(k => loginStatus[k]).map(k => k === 'milo' ? 'Milo' : 'ACT');

  let statusText = '待命';
  let statusCls = 'status-tag';
  if (isRunning) {
    statusText = '执行中...';
    statusCls += ' status-yellow';
  } else if (loggedInAny) {
    statusText = '已连接 · ' + loggedInParts.join('/');
    statusCls += ' status-teal';
  } else if (frameworks.length > 0) {
    statusText = '未登录';
    statusCls += ' status-red';
  }

  return (
    <div className="app-header">
      <div className="header-left">
        <Title size="middle">控制中心</Title>
        <span className="version-tag">TX Helper v1.0</span>
        <span className={statusCls}>{statusText}</span>
      </div>
      <div className="header-right">
        <Button size="small" ghost disabled={isRunning} onClick={onLogin}>QQ登录</Button>
        <Button size="small" ghost disabled={isRunning} onClick={onClearLogin}>清空登录</Button>
        <Button size="small" ghost onClick={onAddEvent}>添加活动</Button>
        <Button size="small" ghost onClick={onOpenDir}>活动目录</Button>
        <Button type="primary" size="middle" disabled={isRunning} onClick={onRunAll}>
          ⚡ 一键运行
        </Button>
      </div>
    </div>
  );
}
