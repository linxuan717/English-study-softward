/**
 * 文章难度评估 (V1 保留，供 dualGrader 调用)
 *
 * 设计意图：
 *   V1 单独的文章难度评估模块，封装一篇文章的完整评估流程。
 *   V2 内部委托给 dualGrader.gradeArticle()，本模块提供有状态的服务层。
 *
 * 核心职责：
 *   1. 单篇文章 → 语言难度 + 领域难度 + 轨道分配
 *   2. 文章难度排序（按语言/领域/综合）
 *   3. 文章难度分布统计
 *   4. 文章库筛选（按轨道/难度区间）
 */

import { TRACK, TRACK_CONFIG } from '../data/models.js';
import {
  gradeArticle,
  gradeLanguageDifficulty,
  gradeDomainDifficulty,
  assignTrack,
  extractWordsFromContent,
  splitSentences
} from './dualGrader.js';
import { WordGrader } from './wordGrader.js';

// ============================================================
// 综合难度计算权重（语言 vs 领域）
// ============================================================
// V1 用等权 0.5/0.5，因为双维度是独立信号，没有理由偏向任一维度
// 实际推荐时由 evaluateArticleFit 分维度判断，综合分仅用于排序参考
export const COMBINED_WEIGHTS = {
  LANGUAGE: 0.5,
  DOMAIN: 0.5
};

// ============================================================
// ArticleGrader 类：有状态的文章评估器
// ============================================================
export class ArticleGrader {
  /**
   * @param {Object} [freqRanks] - 词频查找表
   */
  constructor(freqRanks = {}) {
    this.wordGrader = new WordGrader(freqRanks);
    this.freqRanks = freqRanks;
    this._cache = new Map(); // 文章评分缓存
  }

  /**
   * 加载词频表
   */
  loadFrequencyRanks(freqRanks) {
    this.freqRanks = { ...this.freqRanks, ...freqRanks };
    this.wordGrader.loadFrequencyRanks(freqRanks);
    this._cache.clear();
  }

  /**
   * 评估单篇文章
   *
   * @param {Object} article - Article 或 ARTICLE_SCHEMA 对象
   * @param {Object} [options] - { forceRecompute }
   * @returns {{langDifficulty, domainDifficulty, combined, track, breakdown, words}}
   */
  gradeArticle(article, options = {}) {
    // 缓存命中
    const cacheKey = article.id || article.title;
    if (!options.forceRecompute && cacheKey && this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    // 预提取词汇（dualGrader 内部也会兜底分词，但提前做可复用给 wordGrader）
    const words = article.words || extractWordsFromContent(article.content, this.freqRanks);

    // 调用 dualGrader
    const result = gradeArticle(article, {
      words,
      freqRanks: this.freqRanks,
      forceRecompute: options.forceRecompute
    });

    // 综合难度（仅用于排序参考）
    const combined = COMBINED_WEIGHTS.LANGUAGE * result.langDifficulty +
                     COMBINED_WEIGHTS.DOMAIN * result.domainDifficulty;

    // 词汇统计（复用 wordGrader）
    const wordStats = this.wordGrader.gradeWords(words);

    const full = {
      ...result,
      combined,
      words,
      wordStats
    };

    if (cacheKey) this._cache.set(cacheKey, full);
    return full;
  }

  /**
   * 批量评估文章
   * @param {Array} articles
   * @returns {Array} 评估结果数组
   */
  gradeArticles(articles) {
    return articles.map(a => this.gradeArticle(a));
  }

  /**
   * 按综合难度排序
   * @param {Array} articles
   * @param {string} [dimension] - 'combined' | 'language' | 'domain'
   * @param {boolean} [ascending]
   * @returns {Array} 排序后的 [{ article, grade }]
   */
  rankByDifficulty(articles, dimension = 'combined', ascending = true) {
    const graded = articles.map(a => {
      const g = this.gradeArticle(a);
      return { article: a, grade: g };
    });

    graded.sort((a, b) => {
      let av, bv;
      if (dimension === 'language') {
        av = a.grade.langDifficulty; bv = b.grade.langDifficulty;
      } else if (dimension === 'domain') {
        av = a.grade.domainDifficulty; bv = b.grade.domainDifficulty;
      } else {
        av = a.grade.combined; bv = b.grade.combined;
      }
      return ascending ? av - bv : bv - av;
    });

    return graded;
  }

  /**
   * 按轨道筛选文章
   * @param {Array} articles
   * @param {number} track - 1-4
   * @returns {Array}
   */
  filterByTrack(articles, track) {
    return articles.filter(a => {
      const g = this.gradeArticle(a);
      return g.track === track;
    });
  }

  /**
   * 按难度区间筛选
   * @param {Array} articles
   * @param {Object} range - { langMin, langMax, domainMin, domainMax }
   * @returns {Array}
   */
  filterByDifficultyRange(articles, range = {}) {
    const {
      langMin = 0, langMax = 5,
      domainMin = 0, domainMax = 5
    } = range;

    return articles.filter(a => {
      const g = this.gradeArticle(a);
      return g.langDifficulty >= langMin && g.langDifficulty <= langMax &&
             g.domainDifficulty >= domainMin && g.domainDifficulty <= domainMax;
    });
  }

  /**
   * 文章库难度分布统计
   * @param {Array} articles
   * @returns {{byTrack:Object, byLangTier:Object, byDomainTier:Object, avgLang:number, avgDomain:number}}
   */
  getDistribution(articles) {
    if (!articles || articles.length === 0) {
      return { byTrack: {}, byLangTier: {}, byDomainTier: {}, avgLang: 0, avgDomain: 0 };
    }

    const byTrack = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const byLangTier = { easy: 0, medium: 0, hard: 0, very_hard: 0 };
    const byDomainTier = { general: 0, intro: 0, professional: 0, authentic: 0 };

    let sumLang = 0, sumDomain = 0;

    for (const a of articles) {
      const g = this.gradeArticle(a);
      sumLang += g.langDifficulty;
      sumDomain += g.domainDifficulty;
      byTrack[g.track] = (byTrack[g.track] || 0) + 1;

      // 语言难度分档：0-1.5易 / 1.5-3中 / 3-4难 / 4-5极难
      if (g.langDifficulty < 1.5) byLangTier.easy++;
      else if (g.langDifficulty < 3) byLangTier.medium++;
      else if (g.langDifficulty < 4) byLangTier.hard++;
      else byLangTier.very_hard++;

      // 领域难度分档：按轨道映射
      if (g.domainDifficulty < 0.5) byDomainTier.general++;
      else if (g.domainDifficulty < 2.0) byDomainTier.intro++;
      else if (g.domainDifficulty < 3.5) byDomainTier.professional++;
      else byDomainTier.authentic++;
    }

    const n = articles.length;
    return {
      byTrack,
      byLangTier,
      byDomainTier,
      avgLang: sumLang / n,
      avgDomain: sumDomain / n,
      count: n
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache.clear();
  }
}

// ============================================================
// 工厂函数
// ============================================================
export function createArticleGrader(freqRanks) {
  return new ArticleGrader(freqRanks);
}

// ============================================================
// 默认导出
// ============================================================
export default {
  ArticleGrader,
  createArticleGrader,
  COMBINED_WEIGHTS
};
