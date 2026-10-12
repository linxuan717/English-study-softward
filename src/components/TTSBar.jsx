/**
 * TTS 控制条
 * 浮动在底部，提供单句/整篇播放、暂停、上下句、调速
 *
 * 对接 TTSController（Web Speech API）
 */

import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { SPEED_PRESETS } from '../services/appService.js';

const SPEED_OPTIONS = [
  { value: SPEED_PRESETS.SLOW, label: '0.6x 慢速' },
  { value: SPEED_PRESETS.SLIGHT_SLOW, label: '0.8x 稍慢' },
  { value: SPEED_PRESETS.NORMAL, label: '1.0x 正常' },
  { value: SPEED_PRESETS.SLIGHT_FAST, label: '1.2x 稍快' },
  { value: SPEED_PRESETS.FAST, label: '1.5x 快速' }
];

export default function TTSBar() {
  const { tts, ttsState, updateTtsState } = useApp();
  const [voices, setVoices] = useState([]);

  // 监听语音列表加载（异步）
  useEffect(() => {
    const loadVoices = () => setVoices(tts.getVoices());
    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [tts]);

  // 组件卸载时停止朗读
  useEffect(() => () => tts.stop(), [tts]);

  if (!tts._supported) {
    return (
      <div className="tts-bar">
        <span className="tts-info">浏览器不支持语音朗读</span>
      </div>
    );
  }

  // 无内容时不显示
  if (ttsState.sentenceCount === 0) return null;

  const handlePlayArticle = () => {
    if (ttsState.isPlaying && !ttsState.isPaused) {
      tts.pause();
    } else if (ttsState.isPaused) {
      tts.resume();
    } else {
      tts.playArticle(ttsState.currentIndex);
    }
    setTimeout(updateTtsState, 50);
  };

  const handleSpeedChange = (e) => {
    tts.setRate(parseFloat(e.target.value));
    setTimeout(updateTtsState, 50);
  };

  const handleVoiceChange = (e) => {
    const v = voices.find(v => v.name === e.target.value);
    if (v) tts.setVoice(v);
  };

  return (
    <div className="tts-bar">
      <div className="tts-info">
        {ttsState.isPlaying ? (ttsState.isPaused ? '已暂停' : '朗读中') : '就绪'}
        {' · '}
        句 {ttsState.currentIndex + 1}/{ttsState.sentenceCount}
      </div>
      <div className="tts-controls">
        <button className="btn" onClick={() => { tts.prev(); setTimeout(updateTtsState, 50); }} disabled={ttsState.currentIndex === 0}>上一句</button>
        <button className="btn btn-primary" onClick={handlePlayArticle}>
          {ttsState.isPaused ? '继续' : ttsState.isPlaying ? '暂停' : '整篇朗读'}
        </button>
        <button className="btn" onClick={() => { tts.stop(); setTimeout(updateTtsState, 50); }}>停止</button>
        <button className="btn" onClick={() => { tts.next(); setTimeout(updateTtsState, 50); }} disabled={ttsState.currentIndex >= ttsState.sentenceCount - 1}>下一句</button>
      </div>
      <select className="speed-select" value={ttsState.rate} onChange={handleSpeedChange}>
        {SPEED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {voices.length > 0 && (
        <select className="speed-select" onChange={handleVoiceChange} defaultValue="">
          <option value="" disabled>选择语音</option>
          {voices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
        </select>
      )}
    </div>
  );
}
