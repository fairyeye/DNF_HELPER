import React from 'react';
import { invoke } from '../ipc';

export default function Titlebar() {
  return (
    <div className="titlebar">
      <span className="titlebar-title">TX 游戏活动助手</span>
      <div className="titlebar-btns">
        <button className="tb-btn" onClick={() => invoke('window-minimize')} title="最小化">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="tb-btn" onClick={() => invoke('window-maximize')} title="最大化">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="tb-btn close" onClick={() => invoke('window-close')} title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
