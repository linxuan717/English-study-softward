/**
 * 首页/统计页
 * 展示记忆模型统计 + 健康度 + 学习计划 + 今日复习概览 + 推荐文章
 */

import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { TRACK_CONFIG } from '../services/appService.js';

export default function Dashboard() {
  const { service, tick } = useApp();
  // tick 触发重新读取
  void tick;

  const stats = service.getMemoryStats();
  const health = service.getHealthScore();
  const plan = service.getStudyPlan();
  const overview = service.getReviewOverview();
  const recommendations = service.getRecommendedArticles(3);

  const healthPct = Math.round(health * 100);
  const healthColor = healthPct >= 70 ? 'var(--color-success)' : healthPct >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div>
      <div className="card">
        <h2>记忆健康度</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: healthColor }}>{healthPct}</div>
          <div style={{ flex: 1 }}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${healthPct}%`, background: healthColor }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>综合：已掌握占比40% + 平均EF20% + 不认识占比20% + 困难词占比20%</div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">总词卡</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.dueCount}</div>
          <div className="stat-label">今日待复习</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.graduated}</div>
          <div className="stat-label">已毕业</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.hardWords}</div>
          <div className="stat-label">困难词</div>
        </div>
      </div>

      <div className="card">
        <h2>队列分布</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div>不认识队列：{stats.queueDistribution.not_known}</div>
          <div>记错队列：{stats.queueDistribution.remembered_wrong}</div>
          <div>已学队列：{stats.queueDistribution.learned}</div>
        </div>
        <h2 style={{ marginTop: 16 }}>阶段分布</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div>新词：{stats.stageDistribution.new}</div>
          <div>能再认：{stats.stageDistribution.recognize}</div>
          <div>能回忆：{stats.stageDistribution.recall}</div>
          <div>已掌握：{stats.stageDistribution.mastered}</div>
        </div>
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          平均EF：{stats.avgEF.toFixed(2)} · 平均间隔：{stats.avgInterval.toFixed(1)}天 · 总遗忘：{stats.totalForgetCount}次
        </div>
      </div>

      <div className="card">
        <h2>今日复习概览</h2>
        {overview.totalDue > 0 ? (
          <>
            <div style={{ fontSize: 15, marginBottom: 8 }}>待复习 {overview.totalDue} 张，预计 {overview.estimatedTime.minutes} 分钟</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
              <span>不认识：{overview.byQueue.not_known}</span>
              <span>记错：{overview.byQueue.remembered_wrong}</span>
              <span>已学：{overview.byQueue.learned}</span>
              <span>困难词：{overview.hardWords}</span>
            </div>
            <Link to="/review" className="btn btn-primary" style={{ marginTop: 12, display: 'inline-block' }}>开始复习</Link>
          </>
        ) : (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-icon">✓</div>
            <p>今日复习已完成</p>
            <Link to="/articles" className="btn btn-primary" style={{ marginTop: 12 }}>去阅读新文章</Link>
          </div>
        )}
      </div>

      <div className="card">
        <h2>学习建议</h2>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary)' }}>{plan.overall}</div>
        {plan.focus.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>重点：</div>
            <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
              {plan.focus.map((f, i) => <li key={i} style={{ fontSize: 14, marginBottom: 4 }}>{f}</li>)}
            </ul>
          </>
        )}
        {plan.warnings.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--color-danger)', marginBottom: 4 }}>注意：</div>
            <ul style={{ paddingLeft: 20 }}>
              {plan.warnings.map((w, i) => <li key={i} style={{ fontSize: 14, color: 'var(--color-danger)' }}>{w}</li>)}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h2>推荐文章</h2>
        {recommendations.length > 0 ? (
          <div className="article-list">
            {recommendations.map((rec, i) => {
              const a = rec.article;
              const track = TRACK_CONFIG[a.track];
              return (
                <Link key={a.id} to={`/article/${a.id}`} className="article-item" style={{ textDecoration: 'none' }}>
                  <h3>{a.title}</h3>
                  <div className="article-meta">
                    <span className={`track-badge track-${a.track}`}>{track.name} {track.targetLevel}</span>
                    <span>语言难度 {a.langDifficulty.toFixed(1)}/5</span>
                    <span>领域难度 {a.domainDifficulty.toFixed(1)}/5</span>
                    <span style={{ color: 'var(--color-primary)' }}>{rec.reason}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><p>暂无推荐文章</p></div>
        )}
      </div>
    </div>
  );
}
