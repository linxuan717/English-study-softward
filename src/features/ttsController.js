/**
 * TTS 语音朗读控制器 (V1)
 *
 * 技术方案：浏览器原生 Web Speech API（零成本零延迟）
 * 后续可接入 Azure / Google TTS 获取更自然语音
 *
 * 功能：
 *   1. 单句朗读：点击播放按钮朗读该句，朗读时高亮当前句
 *   2. 整篇朗读：连续朗读逐句推进高亮，支持暂停/继续/上一句/下一句
 *   3. 语速5档：0.6x慢速 / 0.8x稍慢 / 1.0x正常 / 1.2x稍快 / 1.5x快速
 *   4. 句子分割：缩写白名单(Mr./Dr./e.g.等)，支持外部传入预分割句子
 *   5. 词级高亮：onboundary事件逐词高亮，不支持时fallback为句子级高亮
 */

import { splitSentences } from '../grading/dualGrader.js';

// ============================================================
// 语速档位预设
// ============================================================
export const SPEED_PRESETS = {
  SLOW: 0.6,      // 零基础，能听清每个音节
  SLIGHT_SLOW: 0.8, // 初级，基本能跟上
  NORMAL: 1.0,    // 母语者正常语速
  SLIGHT_FAST: 1.2, // 进阶，训练听力
  FAST: 1.5       // 高级，模拟真实语速
};

export const SPEED_LABELS = {
  0.6: '慢速',
  0.8: '稍慢',
  1.0: '正常',
  1.2: '稍快',
  1.5: '快速'
};

// 默认语言（英语学习软件）
const DEFAULT_LANG = 'en-US';

// ============================================================
// TTSController 类
// ============================================================
export class TTSController {
  /**
   * @param {Object} [options]
   * @param {string} [options.lang] - 语言代码，默认 'en-US'
   * @param {SpeechSynthesisVoice} [options.voice] - 指定语音
   * @param {number} [options.rate] - 初始语速，默认 1.0
   * @param {Function} [options.onSentenceStart] - 句子开始回调 (idx, sentence)
   * @param {Function} [options.onSentenceEnd] - 句子结束回调 (idx)
   * @param {Function} [options.onWordHighlight] - 词级高亮回调 (sentenceIdx, wordStart, wordEnd, word)
   * @param {Function} [options.onArticleEnd] - 整篇结束回调
   * @param {Function} [options.onBoundaryUnsupported] - 浏览器不支持word boundary时回调
   */
  constructor(options = {}) {
    this.lang = options.lang || DEFAULT_LANG;
    this.voice = options.voice || null;
    this.rate = options.rate || SPEED_PRESETS.NORMAL;

    // 回调
    this.onSentenceStart = options.onSentenceStart || (() => {});
    this.onSentenceEnd = options.onSentenceEnd || (() => {});
    this.onWordHighlight = options.onWordHighlight || (() => {});
    this.onArticleEnd = options.onArticleEnd || (() => {});
    this.onBoundaryUnsupported = options.onBoundaryUnsupported || (() => {});

    // 状态
    this.sentences = [];
    this.currentIndex = 0;
    this.mode = 'idle';       // 'idle' | 'sentence' | 'article'
    this.isPlaying = false;
    this.isPaused = false;

    // 当前 utterance
    this._utterance = null;
    this._boundarySupported = true; // 是否支持词级 boundary
    this._currentSentenceWords = []; // 当前句子的词位置映射

    // 检测 Web Speech API 支持
    this._supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (!this._supported) {
      console.warn('[TTS] 浏览器不支持 Web Speech API，语音功能不可用');
    }
  }

  // ============================================================
  // 句子管理
  // ============================================================
  /**
   * 设置朗读内容
   * @param {string|Array<string>} content - 原文或预分割句子数组
   */
  setContent(content) {
    if (Array.isArray(content)) {
      // 外部预分割的句子数组（优先使用，最准确）
      this.sentences = content.filter(s => s && s.trim().length > 0);
    } else if (typeof content === 'string') {
      // 原文 → 内置分句（缩写白名单）
      this.sentences = splitSentences(content);
    } else {
      this.sentences = [];
    }
    this.currentIndex = 0;
  }

  /**
   * 获取句子数量
   */
  getSentenceCount() {
    return this.sentences.length;
  }

  /**
   * 获取当前句子索引
   */
  getCurrentIndex() {
    return this.currentIndex;
  }

  // ============================================================
  // 语速控制
  // ============================================================
  /**
   * 设置语速
   * @param {number} rate - 0.6 / 0.8 / 1.0 / 1.2 / 1.5
   */
  setRate(rate) {
    this.rate = rate;
    // 如果正在播放，需要重新创建utterance以应用新语速
    if (this.isPlaying && !this.isPaused) {
      const idx = this.currentIndex;
      this._stopInternal();
      this._playAtIndex(idx, false);
    }
  }

  /**
   * 获取当前语速标签
   */
  getRateLabel() {
    return SPEED_LABELS[this.rate] || '自定义';
  }

  /**
   * 切换到下一档语速
   */
  cycleSpeed() {
    const presets = [0.6, 0.8, 1.0, 1.2, 1.5];
    const idx = presets.indexOf(this.rate);
    const next = presets[(idx + 1) % presets.length];
    this.setRate(next);
    return next;
  }

  // ============================================================
  // 语音选择
  // ============================================================
  /**
   * 设置语音
   * @param {SpeechSynthesisVoice} voice
   */
  setVoice(voice) {
    this.voice = voice;
  }

  /**
   * 获取可用语音列表
   * @returns {Array<SpeechSynthesisVoice>}
   */
  getVoices() {
    if (!this._supported) return [];
    return window.speechSynthesis.getVoices().filter(v =>
      v.lang.startsWith('en')
    );
  }

  /**
   * 选择最佳英语语音
   */
  selectBestVoice() {
    const voices = this.getVoices();
    if (voices.length === 0) return null;
    // 优先 en-US，其次 en-GB
    const preferred = voices.find(v => v.lang === 'en-US') ||
                      voices.find(v => v.lang === 'en-GB') ||
                      voices[0];
    this.voice = preferred;
    return preferred;
  }

  // ============================================================
  // 播放控制
  // ============================================================
  /**
   * 朗读单个句子
   * @param {number} idx - 句子索引
   */
  playSentence(idx) {
    if (!this._supported || idx < 0 || idx >= this.sentences.length) return;
    this._stopInternal();
    this.mode = 'sentence';
    this.currentIndex = idx;
    this._playAtIndex(idx, false);
  }

  /**
   * 整篇朗读（从当前句或指定句开始）
   * @param {number} [startIdx=0]
   */
  playArticle(startIdx = 0) {
    if (!this._supported || this.sentences.length === 0) return;
    this._stopInternal();
    this.mode = 'article';
    this.currentIndex = startIdx;
    this._playAtIndex(startIdx, true);
  }

  /**
   * 暂停
   */
  pause() {
    if (!this._supported || !this.isPlaying || this.isPaused) return;
    window.speechSynthesis.pause();
    this.isPaused = true;
  }

  /**
   * 继续
   */
  resume() {
    if (!this._supported || !this.isPaused) return;
    window.speechSynthesis.resume();
    this.isPaused = false;
  }

  /**
   * 下一句
   */
  next() {
    if (!this._supported) return;
    const nextIdx = this.currentIndex + 1;
    if (nextIdx >= this.sentences.length) return;
    this._stopInternal();
    this.currentIndex = nextIdx;
    this._playAtIndex(nextIdx, this.mode === 'article');
  }

  /**
   * 上一句
   */
  prev() {
    if (!this._supported) return;
    const prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) return;
    this._stopInternal();
    this.currentIndex = prevIdx;
    this._playAtIndex(prevIdx, this.mode === 'article');
  }

  /**
   * 停止
   */
  stop() {
    this._stopInternal();
    this.mode = 'idle';
    this.currentIndex = 0;
  }

  /**
   * 获取当前播放状态
   */
  getState() {
    return {
      mode: this.mode,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentIndex: this.currentIndex,
      sentenceCount: this.sentences.length,
      rate: this.rate,
      rateLabel: this.getRateLabel(),
      boundarySupported: this._boundarySupported
    };
  }

  // ============================================================
  // 内部实现
  // ============================================================

  /**
   * 在指定索引处播放
   * @param {number} idx
   * @param {boolean} continueToNext - 是否在结束后播放下一句（article模式）
   * @private
   */
  _playAtIndex(idx, continueToNext) {
    if (idx < 0 || idx >= this.sentences.length) {
      this.isPlaying = false;
      this.onArticleEnd();
      return;
    }

    const sentence = this.sentences[idx];
    this.currentIndex = idx;
    this.isPlaying = true;
    this.isPaused = false;

    // 预计算词位置（用于 boundary → word 映射）
    this._currentSentenceWords = this._buildWordMap(sentence);

    // 通知句子开始
    this.onSentenceStart(idx, sentence);

    // 创建 utterance
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = this.lang;
    utterance.rate = this.rate;
    if (this.voice) utterance.voice = this.voice;

    // 词级高亮（如果支持）
    let boundaryFired = false;
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        boundaryFired = true;
        const wordInfo = this._mapCharIndexToWord(event.charIndex, event.charLength || 0);
        if (wordInfo) {
          this.onWordHighlight(idx, wordInfo.start, wordInfo.end, wordInfo.word);
        }
      }
    };

    utterance.onend = () => {
      this.onSentenceEnd(idx);

      if (continueToNext && this.isPlaying && !this.isPaused) {
        // 继续下一句
        const nextIdx = idx + 1;
        if (nextIdx < this.sentences.length) {
          this._playAtIndex(nextIdx, true);
        } else {
          // 整篇结束
          this.isPlaying = false;
          this.mode = 'idle';
          this.onArticleEnd();
        }
      } else if (this.mode === 'sentence') {
        // 单句模式，播完即停
        this.isPlaying = false;
        this.mode = 'idle';
      }

      // 检测 boundary 是否被支持（如果整句播完都没触发 word boundary）
      if (!boundaryFired && this._boundarySupported) {
        this._boundarySupported = false;
        this.onBoundaryUnsupported();
      }
    };

    utterance.onerror = (event) => {
      console.error('[TTS] 朗读错误:', event.error);
      this.isPlaying = false;
      this.isPaused = false;
      // 某些错误（如 interrupted）是正常的，由 _stopInternal 触发
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        this.mode = 'idle';
      }
    };

    this._utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  /**
   * 内部停止（不重置 mode）
   * @private
   */
  _stopInternal() {
    if (!this._supported) return;
    this.isPlaying = false;
    this.isPaused = false;
    window.speechSynthesis.cancel(); // 取消当前朗读
    this._utterance = null;
  }

  /**
   * 构建句子的词位置映射
   * 返回 [{start, end, word}] 数组，start/end 为字符索引
   * @private
   */
  _buildWordMap(sentence) {
    const words = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(sentence)) !== null) {
      words.push({
        start: match.index,
        end: match.index + match[0].length,
        word: match[0]
      });
    }
    return words;
  }

  /**
   * 将 boundary 的 charIndex 映射到具体的词
   * @private
   */
  _mapCharIndexToWord(charIndex, charLength) {
    // 方法1：如果有 charLength，尝试精确匹配
    if (charLength > 0) {
      const exact = this._currentSentenceWords.find(
        w => w.start === charIndex || (w.start <= charIndex && w.end >= charIndex + charLength)
      );
      if (exact) return exact;
    }
    // 方法2：找包含 charIndex 的词
    const containing = this._currentSentenceWords.find(
      w => w.start <= charIndex && w.end > charIndex
    );
    if (containing) return containing;

    // 方法3：找最接近的词（前一个）
    let closest = null;
    let minDist = Infinity;
    for (const w of this._currentSentenceWords) {
      const dist = Math.abs(w.start - charIndex);
      if (dist < minDist) {
        minDist = dist;
        closest = w;
      }
    }
    return closest;
  }
}

// ============================================================
// 工厂函数
// ============================================================
/**
 * 创建 TTS 控制器实例
 * @param {Object} options - 同 TTSController 构造参数
 * @returns {TTSController}
 */
export function createTTSController(options) {
  return new TTSController(options);
}

/**
 * 检测浏览器是否支持 TTS
 */
export function isTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * 等待语音列表加载（异步，部分浏览器需异步加载）
 * @returns {Promise<Array<SpeechSynthesisVoice>>}
 */
export function waitForVoices() {
  return new Promise((resolve) => {
    if (!isTTSSupported()) {
      resolve([]);
      return;
    }
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    // 等待 voiceschanged 事件
    window.speechSynthesis.onvoiceschanged = () => {
      voices = window.speechSynthesis.getVoices();
      resolve(voices);
    };
    // 超时兜底
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

// ============================================================
// 默认导出
// ============================================================
export default {
  TTSController,
  createTTSController,
  isTTSSupported,
  waitForVoices,
  SPEED_PRESETS,
  SPEED_LABELS
};
