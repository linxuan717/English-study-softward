/**
 * 文章阅读页（核心页面）
 *
 * 功能：
 *   1. 调用 dualGrader 显示双维度难度
 *   2. 调用 phraseManager 高亮短语
 *   3. 调用 ttsController 朗读（单句点击播放 + 整篇连续 + 高亮当前句）
 *   4. 点词查义弹窗 + 自动记录到复习系统（Layer 1 文章内复习）
 *   5. 阅读完成后进入文章后测试（Layer 2）
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { TRACK_CONFIG } from '../services/appService.js';
import WordPopup from '../components/WordPopup.jsx';
import TTSBar from '../components/TTSBar.jsx';

export default function ArticleReader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { service, tts, updateTtsState, refresh, setCurrentArticleId } = useApp();

  const [popup, setPopup] = useState(null); // { word, sentence }
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [showPostTest, setShowPostTest] = useState(false);
  const contentRef = useRef(null);

  const article = service.getArticle(id);

  useEffect(() => {
    if (article) {
      setCurrentArticleId(article.id);
      // 准备 TTS
      service.prepareTTS(article);
      // 设置 TTS 回调
      tts.onSentenceStart = (idx) => {
        setSpeakingIdx(idx);
        // 滚动到当前句
        const el = contentRef.current?.querySelector(`[data-idx="${idx}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      tts.onArticleEnd = () => {
        setSpeakingIdx(-1);
        updateTtsState();
      };
      updateTtsState();
    }
    return () => {
      tts.stop();
      tts.onSentenceStart = () => {};
      tts.onArticleEnd = () => {};
      setSpeakingIdx(-1);
    };
  }, [id]);

  if (!article) {
    return (
      <div className="empty-state">
        <div className="empty-icon">?</div>
        <p>文章不存在</p>
        <Link to="/articles" className="btn btn-primary" style={{ marginTop: 12 }}>返回文章列表</Link>
      </div>
    );
  }

  const track = TRACK_CONFIG[article.track];
  const sentences = article.sentences || [];

  // ---- 单句播放 ----
  const handleSentenceClick = (idx) => {
    tts.playSentence(idx);
    setSpeakingIdx(idx);
    setTimeout(updateTtsState, 50);
  };

  // ---- 难度点阵 ----
  const renderDots = (score) => {
    const filled = Math.round(score);
    return (
      <span className="difficulty-dots">
        {[0,1,2,3,4].map(i => <span key={i} className={`difficulty-dot ${i < filled ? 'active' : ''}`} />)}
      </span>
    );
  };

  return (
    <div className="article-reader" style={{ paddingBottom: 80 }}>
      <Link to="/articles" style={{ fontSize: 13, marginBottom: 12, display: 'inline-block' }}>← 返回列表</Link>

      <h1>{article.title}</h1>
      <div className="meta">
        <span className={`track-badge track-${article.track}`}>{track.name} {track.targetLevel}</span>
        <span>领域：{article.domain}</span>
        <span>约 {article.wordCount} 词</span>
        <span className="difficulty-bar">语言难度 {renderDots(article.langDifficulty)} {article.langDifficulty.toFixed(1)}</span>
        <span className="difficulty-bar">领域难度 {renderDots(article.domainDifficulty)} {article.domainDifficulty.toFixed(1)}</span>
      </div>

      <div className="card" style={{ background: 'var(--color-primary-light)', padding: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--color-primary)' }}>
          点击单词查看释义并加入复习 · 点击句子播放朗读 · 紫色为短语
        </p>
      </div>

      {/* 文章正文：按句子渲染，每句可点击播放 + 短语高亮 + 点词查义 */}
      <div className="article-content" ref={contentRef}>
        {sentences.map((s, idx) => (
          <span
            key={idx}
            className={`sentence ${speakingIdx === idx ? 'speaking' : ''}`}
            data-idx={idx}
            onClick={(e) => {
              // 短语优先：点击短语弹窗
              if (e.target.dataset.phrase) {
                e.stopPropagation();
                setPopup({ word: e.target.dataset.phrase, sentence: s });
                return;
              }
              // 单词：点击弹窗
              if (e.target.dataset.word) {
                e.stopPropagation();
                setPopup({ word: e.target.dataset.word, sentence: s });
                return;
              }
              // 句子空白处：播放该句
              handleSentenceClick(idx);
            }}
            style={{ marginRight: 4 }}
            dangerouslySetInnerHTML={{ __html: renderSentence(service, s) }}
          />
        ))}
      </div>

      {/* 阅读完成按钮 */}
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button className="btn btn-primary" onClick={() => setShowPostTest(true)}>
          完成阅读，进入文章后测试
        </button>
      </div>

      {/* 文章后测试引导 */}
      {showPostTest && (
        <PostTestPrompt article={article} service={service} onGoReview={() => navigate('/review')} />
      )}

      {/* 点词弹窗 */}
      {popup && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          articleId={article.id}
          onClose={() => setPopup(null)}
        />
      )}

      {/* TTS 控制条 */}
      <TTSBar />
    </div>
  );
}

/**
 * 渲染单个句子：用 phraseManager 高亮短语 + 每个单词可点击
 */
function renderSentence(service, sentence) {
  // 先用 phraseManager 获取短语高亮 spans
  const spans = service.phraseManager.buildHighlightSpans(sentence);
  let html = '';
  let lastEnd = 0;

  if (spans.length === 0) {
    // 无短语，按单词分割
    return renderWordsClickable(sentence);
  }

  for (const span of spans) {
    // 前面普通文本 → 按词可点击
    html += renderWordsClickable(sentence.substring(lastEnd, span.start));
    // 短语高亮
    const phraseText = escapeHtml(sentence.substring(span.start, span.end));
    html += `<span class="phrase-highlight" data-phrase="${escapeAttr(span.phrase)}" data-meaning="${escapeAttr(span.meaning)}" style="color: ${span.color}; cursor: pointer; font-weight: 500; background: rgba(155,89,182,0.1); padding: 1px 2px; border-radius: 2px;">${phraseText}</span>`;
    lastEnd = span.end;
  }
  html += renderWordsClickable(sentence.substring(lastEnd));
  return html;
}

/**
 * 将文本按词包裹为可点击 span
 */
function renderWordsClickable(text) {
  if (!text) return '';
  // 英文词 + 标点分别处理
  return text.replace(/([a-zA-Z]+(?:-[a-zA-Z]+)*)/g, (match) => {
    return `<span data-word="${escapeAttr(match)}" style="cursor: pointer;">${escapeHtml(match)}</span>`;
  }).replace(/([^\w<>]+|<[^>]+>)/g, (m) => {
    // 标点和标签原样
    if (m.startsWith('<')) return m;
    return escapeHtml(m);
  });
}

function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(s) { return s.replace(/"/g,'&quot;'); }

/**
 * 文章后测试提示弹窗
 */
function PostTestPrompt({ article, service, onGoReview }) {
  const lookedUp = service.coordinator.layer1?.getLookedUpCards() || [];
  return (
    <div className="word-popup-overlay" onClick={onGoReview}>
      <div className="word-popup" onClick={e => e.stopPropagation()}>
        <h2>文章后测试</h2>
        <p style={{ margin: '12px 0', color: 'var(--color-text-secondary)' }}>
          阅读完成。你在这篇文章中查了 <strong>{lookedUp.length}</strong> 个词。
        </p>
        <p style={{ margin: '12px 0', color: 'var(--color-text-secondary)', fontSize: 14 }}>
          将进入复习页集中测试本篇生词（最多3轮），未掌握的词转入跨文章长期复习队列。
        </p>
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onGoReview}>稍后再说</button>
          <button className="btn btn-primary" onClick={onGoReview}>开始测试</button>
        </div>
      </div>
    </div>
  );
}
