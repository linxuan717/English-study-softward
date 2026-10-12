/**
 * 点词查义弹窗
 * 阅读时点击单词/短语弹出释义 + 加入复习按钮
 */

import { useApp } from '../context/AppContext.jsx';

export default function WordPopup({ word, sentence, articleId, onClose }) {
  const { service, refresh } = useApp();
  const info = service.lookupWord(word);
  const card = service.getOrCreateCard(word, sentence, articleId);
  const status = service.getCardStatus(card);

  const handleAddToReview = () => {
    // 确保词卡在复习队列中（getOrCreateCard 已创建）
    refresh();
    onClose();
  };

  return (
    <div className="word-popup-overlay" onClick={onClose}>
      <div className="word-popup" onClick={e => e.stopPropagation()}>
        <div className="word-head">
          <span className="word-text">{info.word}</span>
          {info.phonetic && <span className="word-phonetic">{info.phonetic}</span>}
          {info.pos && <span className="word-pos">{info.pos}</span>}
          {info.isPhrase && <span className="track-badge track-2">短语</span>}
        </div>

        <div className="word-translation">
          {info.translation}
        </div>

        {sentence && (
          <div className="word-context">原句：{sentence}</div>
        )}

        {/* 算法状态（不暴露给普通用户看，但开发者可见） */}
        <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 12 }}>
          阶段：{status.stage} · 队列：{status.queue} · EF：{status.ef} · 间隔：{status.interval}天 · 已复习：{status.reps}次
        </div>

        <div className="btn-group" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={handleAddToReview}>
            {card.metCount > 0 ? '已在复习队列' : '加入复习'}
          </button>
        </div>
      </div>
    </div>
  );
}
