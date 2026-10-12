/**
 * 文章列表页
 * 按轨道分组展示文章，点击进入阅读，支持导入/删除文章
 */

import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { TRACK, TRACK_CONFIG } from '../services/appService.js';

const MOCK_IDS = new Set(['art_001', 'art_002', 'art_003', 'art_004', 'art_005']);

export default function ArticleList() {
  const { service, user, refresh } = useApp();
  const [showImport, setShowImport] = useState(false);

  const tracks = [TRACK.GENERAL, TRACK.INTRO, TRACK.PROFESSIONAL, TRACK.AUTHENTIC];

  const handleRemove = (id) => {
    if (confirm('确定删除这篇文章？')) {
      service.removeArticle(id);
      refresh();
    }
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>文章库</h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              当前轨道：{TRACK_CONFIG[user.currentTrack].name} · 按难度从低到高排列
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowImport(true)}>
            + 导入文章
          </button>
        </div>
      </div>

      {tracks.map(track => {
        const articles = service.getArticlesByTrack(track);
        if (articles.length === 0) return null;
        const cfg = TRACK_CONFIG[track];
        const locked = track > user.currentTrack + 1;

        return (
          <div key={track} className="card">
            <h2>
              轨道{track} · {cfg.name}
              <span className={`track-badge track-${track}`} style={{ marginLeft: 8 }}>{cfg.targetLevel}</span>
            </h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              {cfg.focus} · 新词{cfg.newWordRange[0]}-{cfg.newWordRange[1]}个/篇 · {cfg.maxLength}词以内
            </p>
            <div className="article-list">
              {articles.map(a => {
                const isCustom = !MOCK_IDS.has(a.id);
                return (
                  <div key={a.id} className="article-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Link to={`/article/${a.id}`} style={{ textDecoration: 'none', opacity: locked ? 0.5 : 1, flex: 1 }}>
                      <h3>{a.title}</h3>
                      <div className="article-meta">
                        <span>领域：{a.domain}</span>
                        <span>语言难度 {a.langDifficulty.toFixed(1)}/5</span>
                        <span>领域难度 {a.domainDifficulty.toFixed(1)}/5</span>
                        <span>约 {a.wordCount} 词</span>
                        {isCustom && <span style={{ color: 'var(--color-info)' }}>· 已导入</span>}
                      </div>
                    </Link>
                    {isCustom && (
                      <button className="btn" style={{ marginLeft: 12, padding: '4px 10px', fontSize: 12 }} onClick={(e) => { e.preventDefault(); handleRemove(a.id); }}>
                        删除
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={() => { refresh(); setShowImport(false); }} />}
    </div>
  );
}

/**
 * 导入文章弹窗
 * 支持：粘贴文本 / 上传文件 / JSON格式
 */
function ImportModal({ onClose, onImported }) {
  const { service } = useApp();
  const [mode, setMode] = useState('text'); // text | json
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setText(ev.target.result);
      // 根据文件扩展名自动切换模式
      if (file.name.endsWith('.json')) setMode('json');
      else setMode('text');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleImport = () => {
    const res = service.importArticles(text);
    setResult(res);
    if (res.success) {
      setTimeout(onImported, 1000);
    }
  };

  const textPlaceholder = mode === 'text'
    ? '第一行是文章标题，第二行开始是正文。例如：\n\nMy Day\nI get up at seven. I eat breakfast at eight...'
    : '粘贴 JSON，支持单个对象或数组：\n\n{\n  "title": "标题",\n  "content": "正文",\n  "domain": "tech"\n}';

  return (
    <div className="word-popup-overlay" onClick={onClose}>
      <div className="word-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>导入文章</h2>

        {/* 模式切换 */}
        <div className="btn-group" style={{ margin: '12px 0' }}>
          <button className={mode === 'text' ? 'btn btn-primary' : 'btn'} onClick={() => setMode('text')}>纯文本</button>
          <button className={mode === 'json' ? 'btn btn-primary' : 'btn'} onClick={() => setMode('json')}>JSON</button>
        </div>

        {/* 文件上传 */}
        <div style={{ margin: '12px 0' }}>
          <button className="btn" onClick={() => fileRef.current?.click()}>📁 选择文件（.txt / .json）</button>
          <input ref={fileRef} type="file" accept=".txt,.json,text/plain,application/json" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        {/* 文本输入 */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={textPlaceholder}
          style={{ width: '100%', minHeight: 180, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
        />

        {/* 结果提示 */}
        {result && (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 'var(--radius-sm)',
            background: result.success ? 'var(--color-primary-light)' : '#FEE2E2',
            color: result.success ? 'var(--color-primary)' : 'var(--color-danger)',
            fontSize: 14
          }}>
            {result.success
              ? `✓ 成功导入 ${result.count} 篇文章`
              : `✗ 导入失败：${result.error}`}
          </div>
        )}

        <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={!text.trim()}>导入</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 12 }}>
          导入后会自动评分（语言难度+领域难度）、分句，并归入对应学习轨道
        </p>
      </div>
    </div>
  );
}
