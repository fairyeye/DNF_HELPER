import React from 'react';
import { invoke } from '../ipc';

export default function Titlebar() {
  return (
    <div className="titlebar">
      <span className="titlebar-title">TX 游戏活动助手</span>
      <div className="titlebar-btns">
        <button className="tb-btn" onClick={() => invoke('window-minimize')} title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <button className="tb-btn" onClick={() => invoke('window-maximize')} title="最大化">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>
        <button className="tb-btn close" onClick={() => invoke('window-close')} title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
