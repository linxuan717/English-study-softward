/**
 * 词汇难度评估 (V1 保留，供 dualGrader 调用)
 *
 * 设计意图：
 *   V1 单独的词汇难度评估模块，封装词频查表 + 词分计算 + 词汇分布统计。
 *   V2 后由 dualGrader.gradeLanguageDifficulty() 调用，本模块作为底层服务。
 *
 * 核心职责：
 *   1. 词频查表（带缓存）
 *   2. 单词 → 0-5 词分
 *   3. 词汇列表 → 难度分布统计
 *   4. 单词难度分级（高频/中频/低频/术语）
 */

import {
  wordScoreFromRank,
  calcAverageWordScore,
  calcNewWordRatio,
  calcWordDifficulty
} from '../data/dataDependencies.js';

// ============================================================
// 词汇难度分级阈值
// ============================================================
export const WORD_TIER = {
  HIGH_FREQ: 'high_freq',    // 高频词：词分 < 2.0（rank < ~200）
  MID_FREQ: 'mid_freq',      // 中频词：词分 2.0-3.5（rank 200-2000）
  LOW_FREQ: 'low_freq',      // 低频词：词分 3.5-4.5（rank 2000-5000）
  TERM: 'term'               // 术语/罕见词：词分 ≥ 4.5（rank > 5000）
};

export const WORD_TIER_THRESHOLDS = {
  high_freq: { max: 2.0 },
  mid_freq: { min: 2.0, max: 3.5 },
  low_freq: { min: 3.5, max: 4.5 },
  term: { min: 4.5 }
};

// ============================================================
// WordGrader 类：带状态的词汇评估器
// ============================================================
export class WordGrader {
  /**
   * @param {Object} [freqRanks] - { word: rank } 词频查找表
   */
  constructor(freqRanks = {}) {
    this.freqRanks = freqRanks;
    this._cache = new Map(); // 词分缓存，避免重复计算
  }

  /**
   * 加载/更新词频表
   * @param {Object} freqRanks
   */
  loadFrequencyRanks(freqRanks) {
    this.freqRanks = { ...this.freqRanks, ...freqRanks };
    this._cache.clear();
  }

  /**
   * 查询单词的词频排名
   * @param {string} word
   * @returns {number} COCA词频排名（未知返回99999）
   */
  getFreqRank(word) {
    if (!word) return 99999;
    const w = word.toLowerCase();
    return this.freqRanks[w] || 99999;
  }

  /**
   * 评估单词难度（0-5）
   * @param {string} word
   * @returns {number} 0-5 词分
   */
  gradeWord(word) {
    if (this._cache.has(word)) return this._cache.get(word);
    const rank = this.getFreqRank(word);
    const score = wordScoreFromRank(rank);
    this._cache.set(word, score);
    return score;
  }

  /**
   * 批量评估词汇难度
   * @param {Array<string|{word, freqRank}>} words
   * @returns {{avgScore:number, distribution:Object, newWordRatio:number, difficulty:number}}
   */
  gradeWords(words) {
    if (!words || words.length === 0) {
      return { avgScore: 0, distribution: {}, newWordRatio: 0, difficulty: 0 };
    }

    // 归一化为 [{word, freqRank}] 格式
    const wordList = words.map(w => {
      if (typeof w === 'string') {
        return { word: w, freqRank: this.getFreqRank(w) };
      }
      return {
        word: w.word,
        freqRank: w.freqRank != null ? w.freqRank : this.getFreqRank(w.word)
      };
    });

    const avgScore = calcAverageWordScore(wordList);
    const newWordRatio = calcNewWordRatio(wordList);
    const difficulty = calcWordDifficulty(wordList);
    const distribution = this.getDistribution(wordList);

    return { avgScore, distribution, newWordRatio, difficulty };
  }

  /**
   * 单词难度分级
   * @param {string} word
   * @returns {{tier:string, score:number, freqRank:number}}
   */
  classifyWord(word) {
    const score = this.gradeWord(word);
    const freqRank = this.getFreqRank(word);

    let tier;
    if (score < WORD_TIER_THRESHOLDS.high_freq.max) {
      tier = WORD_TIER.HIGH_FREQ;
    } else if (score < WORD_TIER_THRESHOLDS.mid_freq.max) {
      tier = WORD_TIER.MID_FREQ;
    } else if (score < WORD_TIER_THRESHOLDS.low_freq.max) {
      tier = WORD_TIER.LOW_FREQ;
    } else {
      tier = WORD_TIER.TERM;
    }

    return { tier, score, freqRank };
  }

  /**
   * 词汇分布统计
   * @param {Array<{word, freqRank}>} wordList
   * @returns {Object} { high_freq, mid_freq, low_freq, term } 各档占比
   */
  getDistribution(wordList) {
    const dist = {
      high_freq: 0,
      mid_freq: 0,
      low_freq: 0,
      term: 0
    };
    if (!wordList || wordList.length === 0) return dist;

    for (const w of wordList) {
      const rank = w.freqRank != null ? w.freqRank : this.getFreqRank(w.word);
      const score = wordScoreFromRank(rank);
      if (score < WORD_TIER_THRESHOLDS.high_freq.max) dist.high_freq++;
      else if (score < WORD_TIER_THRESHOLDS.mid_freq.max) dist.mid_freq++;
      else if (score < WORD_TIER_THRESHOLDS.low_freq.max) dist.low_freq++;
      else dist.term++;
    }

    // 转为占比
    const total = wordList.length;
    for (const k of Object.keys(dist)) {
      dist[k] = dist[k] / total;
    }
    return dist;
  }

  /**
   * 从文本中提取生词（词分≥3的词）
   * @param {Array<{word, freqRank}>} wordList
   * @returns {Array<{word, freqRank, score}>}
   */
  extractNewWords(wordList) {
    if (!wordList) return [];
    return wordList
      .map(w => {
        const rank = w.freqRank != null ? w.freqRank : this.getFreqRank(w.word);
        const score = wordScoreFromRank(rank);
        return { word: w.word, freqRank: rank, score };
      })
      .filter(w => w.score >= 3)
      .sort((a, b) => b.score - a.score); // 难度从高到低
  }
}

// ============================================================
// 工厂函数
// ============================================================
/**
 * 创建一个 WordGrader 实例
 * @param {Object} [freqRanks]
 * @returns {WordGrader}
 */
export function createWordGrader(freqRanks) {
  return new WordGrader(freqRanks);
}

// ============================================================
// 默认导出
// ============================================================
export default {
  WordGrader,
  createWordGrader,
  WORD_TIER,
  WORD_TIER_THRESHOLDS
};
