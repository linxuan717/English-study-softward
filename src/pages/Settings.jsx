/**
 * 设置页
 * 语速 / 语音 / 用户水平 / 轨道 / 重置数据
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { TRACK, TRACK_CONFIG, SPEED_PRESETS } from '../services/appService.js';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1-C2'];

export default function Settings() {
  const { service, user, refresh } = useApp();
  const [voices, setVoices] = useState(service.getAvailableVoices());

  const handleLevelChange = (level) => {
    service.setUserLevel(level);
    refresh();
  };

  const handleTrackChange = (track) => {
    service.setUserTrack(parseInt(track));
    refresh();
  };

  const handleRateChange = (rate) => {
    service.setTTSRate(parseFloat(rate));
    refresh();
  };

  const handleReset = () => {
    if (confirm('确定要重置所有学习数据吗？此操作不可撤销。')) {
      service.resetAll();
      refresh();
    }
  };

  return (
    <div>
      <div className="card">
        <h2>用户水平</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>影响每篇文章新词配额和文章推荐</p>
        <div className="btn-group">
          {LEVELS.map(l => (
            <button key={l} className={user.level === l ? 'btn btn-primary' : 'btn'} onClick={() => handleLevelChange(l)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>学习轨道</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>四阶段：通用基础 → 领域入门 → 领域专业 → 真实材料</p>
        <div className="btn-group">
          {[TRACK.GENERAL, TRACK.INTRO, TRACK.PROFESSIONAL, TRACK.AUTHENTIC].map(t => (
            <button key={t} className={user.currentTrack === t ? 'btn btn-primary' : 'btn'} onClick={() => handleTrackChange(t)}>
              {TRACK_CONFIG[t].name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>TTS 语音设置</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>使用浏览器原生 Web Speech API，零成本零延迟</p>

        <label style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>语速</label>
        <div className="btn-group" style={{ marginBottom: 16 }}>
          {[
            { v: SPEED_PRESETS.SLOW, l: '0.6x' },
            { v: SPEED_PRESETS.SLIGHT_SLOW, l: '0.8x' },
            { v: SPEED_PRESETS.NORMAL, l: '1.0x' },
            { v: SPEED_PRESETS.SLIGHT_FAST, l: '1.2x' },
            { v: SPEED_PRESETS.FAST, l: '1.5x' }
          ].map(o => (
            <button key={o.v} className={service.settings.ttsRate === o.v ? 'btn btn-primary' : 'btn'} onClick={() => handleRateChange(o.v)}>{o.l}</button>
          ))}
        </div>

        {voices.length > 0 && (
          <>
            <label style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>语音</label>
            <select className="speed-select" onChange={e => { const v = voices.find(v => v.name === e.target.value); if (v) { service.setTTSVoice(v); refresh(); } }} defaultValue="">
              <option value="" disabled>选择语音</option>
              {voices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
            </select>
          </>
        )}
      </div>

      <div className="card">
        <h2>数据管理</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          学习数据保存在浏览器 localStorage 中，清除浏览器数据将丢失
        </p>
        <button className="btn btn-danger" onClick={handleReset}>重置所有学习数据</button>
      </div>
    </div>
  );
}
