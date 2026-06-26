import React from 'react';
import EventCard from './EventCard';

export default function EventGrid({ events, isRunning, onRun, onQuery, onRemove, onOpenUrl }) {
  if (events.length === 0) {
    return (
      <div className="event-grid">
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p>暂无活动配置</p>
          <p className="empty-hint">点击上方「添加活动」导入 JSON 配置文件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="event-grid">
      {events.map(evt => (
        <EventCard
          key={evt.id}
          evt={evt}
          isRunning={isRunning}
          onRun={onRun}
          onQuery={onQuery}
          onRemove={onRemove}
          onOpenUrl={onOpenUrl}
        />
      ))}
    </div>
  );
}
