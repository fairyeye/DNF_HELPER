import React, { useRef, useEffect } from 'react';

export default function LogPanel({ logLines, logExpanded, onToggle, onClear }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logLines]);

  const activeCount = logLines.length;

  return (
    <div className={'log-panel' + (logExpanded ? ' expanded' : '')}>
      <div className="log-header" onClick={onToggle}>
        <div className="log-dot" />
        <span className="log-label">运行日志</span>
        <div className="log-sep" />
        <span className="log-meta">{activeCount > 0 ? activeCount + ' 条日志' : '就绪'}</span>
        <div className="log-spacer" />
        <button className="log-clear-btn" onClick={(e) => { e.stopPropagation(); onClear(); }}>
          清空
        </button>
        <span className="log-toggle">{logExpanded ? '▼' : '▲'}</span>
      </div>
      <div className="log-body" ref={bodyRef}>
        {logLines.map((line, i) => (
          <div key={i} className={'log-line' + (line.cls ? ' ' + line.cls : '')}>
            [{line.time}] {line.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
