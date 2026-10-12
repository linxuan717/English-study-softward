/**
 * 复习页（核心页面）
 *
 * 对接：
 *   - reviewScheduler.buildDailyQueue() → 今日复习队列
 *   - assessmentModel.generateQuestion() → 按掌握阶段生成题型
 *   - simplifiedSM2.review() → 更新 SM-2 状态
 *
 * 流程：展示队列 → 逐张卡片答题 → 显示结果 → 下一张 → 完成
 */

import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import ReviewCard from '../components/ReviewCard.jsx';

export default function ReviewSession() {
  const { service, refresh } = useApp();
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [started, setStarted] = useState(false);

  const overview = service.getReviewOverview();

  // 开始复习
  const handleStart = () => {
    const q = service.getTodayReviewQueue();
    setQueue(q);
    setIdx(0);
    setResults([]);
    setStarted(true);
  };

  // 当前卡片 + 题目
  const currentCard = queue[idx];
  const currentQuestion = useMemo(() => {
    if (!currentCard) return null;
    return service.generateQuestionFor(currentCard);
  }, [currentCard, service]);

  // 处理单张答题结果
  const handleResult = (result) => {
    setResults(prev => [...prev, { cardId: currentCard.id, word: currentCard.word, ...result }]);
    setIdx(prev => prev + 1);
    refresh();
  };

  // 完成统计
  if (started && idx >= queue.length) {
    const passed = results.filter(r => r.passed).length;
    const pct = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
    return (
      <div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>复习完成</h2>
          <div style={{ fontSize: 48, fontWeight: 700, color: pct >= 70 ? 'var(--color-success)' : 'var(--color-warning)' }}>{pct}%</div>
          <p style={{ margin: '12px 0', color: 'var(--color-text-secondary)' }}>
            共 {results.length} 张 · 正确 {passed} · 错误 {results.length - passed}
          </p>
          <div style={{ textAlign: 'left', maxWidth: 400, margin: '0 auto' }}>
            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>本次复习详情</h3>
            {results.map((r, i) => (
              <div key={i} style={{ fontSize: 13, padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span>{r.word}</span>
                <span style={{ color: r.passed ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {r.passed ? '✓ 学会了' : r.queue === 'remembered_wrong' ? '✗ 记错了' : '✗ 不认识'}
                </span>
              </div>
            ))}
          </div>
          <div className="btn-group" style={{ justifyContent: 'center', marginTop: 24 }}>
            <Link to="/" className="btn">返回首页</Link>
            <Link to="/articles" className="btn btn-primary">去读文章</Link>
          </div>
        </div>
      </div>
    );
  }

  // 未开始
  if (!started) {
    return (
      <div>
        <div className="card">
          <h2>今日复习</h2>
          {overview.totalDue > 0 ? (
            <>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{overview.totalDue}</div>
                  <div className="stat-label">待复习</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{overview.estimatedTime.minutes}</div>
                  <div className="stat-label">预计分钟</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{overview.byQueue.not_known}</div>
                  <div className="stat-label">不认识</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{overview.hardWords}</div>
                  <div className="stat-label">困难词</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                排序：逾期天数×1.0 + EF差距×2.0 + 遗忘次数×0.5 + 困难词+5 + 阶段权重
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                <span>新词：{overview.byStage.new}</span>
                <span>能再认：{overview.byStage.recognize}</span>
                <span>能回忆：{overview.byStage.recall}</span>
                <span>已掌握：{overview.byStage.mastered}</span>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleStart}>开始复习</button>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <p>今日复习已完成</p>
              <Link to="/articles" className="btn btn-primary" style={{ marginTop: 12 }}>去阅读新文章</Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 答题中
  const progressPct = queue.length > 0 ? Math.round((idx / queue.length) * 100) : 0;
  return (
    <div>
      <div className="card" style={{ padding: '12px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
          <span>进度：{idx + 1} / {queue.length}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {currentCard ? (
        <ReviewCard card={currentCard} question={currentQuestion} onResult={handleResult} />
      ) : (
        <div className="empty-state"><p>无待复习卡片</p></div>
      )}
    </div>
  );
}
