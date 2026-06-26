import React from 'react';
import { Card, Divider, Button, Title } from 'animal-island-ui';

function taskCount(tasks) { return (tasks || []).length; }
function taskPoints(tasks) { return (tasks || []).reduce((s, t) => s + (t.points || 0), 0); }
function rewardText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  return r.name || r.id || JSON.stringify(r);
}

export default function EventCard({ evt, isRunning, onRun, onQuery, onRemove, onOpenUrl }) {
  const isActive = evt._active;
  const disabled = !isActive || isRunning;
  const isCheckIn = evt.type === 'checkin';

  const dCount = taskCount(evt.dailyTasks);
  const wCount = taskCount(evt.weeklyTasks);
  const oCount = taskCount(evt.oneTimeTasks);
  const dPts = taskPoints(evt.dailyTasks);
  const wPts = taskPoints(evt.weeklyTasks);
  const oPts = taskPoints(evt.oneTimeTasks);
  const reward = rewardText(evt.targetReward);

  let infoLines = [];
  if (isCheckIn) {
    const msArr = evt.milestones || [];
    const msStr = msArr.map(m => m.days + '天').join(' / ');
    if (evt._checkInDays !== undefined) infoLines.push('已打卡 ' + evt._checkInDays + ' 天');
    infoLines.push('里程碑: ' + msStr);
  } else {
    if (reward) infoLines.push(reward);
    if (dCount > 0) infoLines.push('每日任务 ' + dCount + ' 个 (' + dPts + '分/天)');
    if (wCount > 0) infoLines.push('每周任务 ' + wCount + ' 个 (' + wPts + '分/周)');
    if (oCount > 0) infoLines.push('一次性任务 ' + oCount + ' 个 (' + oPts + '分)');
  }

  let progressPct = 0;
  if (isCheckIn) {
    const maxDays = Math.max(1, ...(evt.milestones || []).map(m => m.days));
    progressPct = Math.min(100, Math.round(((evt._checkInDays || 0) / maxDays) * 100));
  } else {
    progressPct = isActive ? 100 : 0;
  }

  return (
    <div className={'event-card-wrapper' + (isActive ? '' : ' expired')}>
      <Card>
        <div className="event-card-inner">
          <div className="event-card-top">
            <Title size="small">{evt.name}</Title>
            <span className={'card-status-tag' + (isActive ? ' active' : '')}>
              {isActive ? '进行中' : '已过期'}
            </span>
          </div>

          <div className="event-card-date">{evt.startDate} 至 {evt.endDate}</div>

          <div className="event-card-info">
            {infoLines.map((line, i) => (
              <div key={i} className="event-card-info-line">{line}</div>
            ))}
          </div>

          <Divider type="dashed-teal" />

          <div className="event-card-progress">
            <div className="progress-track">
              <div
                className={'progress-fill' + (isActive ? '' : ' dim')}
                style={{ width: progressPct + '%' }}
              />
            </div>
          </div>

          <div className="event-card-actions">
            <Button
              type={isActive ? 'primary' : 'default'}
              size="small"
              disabled={disabled}
              onClick={() => onRun(evt.id)}
            >
              {isActive ? '▶ 运行' : '▶ 重新运行'}
            </Button>
            <Button size="small" ghost disabled={!evt.url} onClick={() => onOpenUrl(evt.id)}>
              打开
            </Button>
            <Button size="small" ghost disabled={disabled} onClick={() => onQuery(evt.id)}>
              查询
            </Button>
            <Button
              size="small"
              danger
              ghost
              disabled={isRunning}
              onClick={() => onRemove(evt.id)}
            >
              删除
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
