/**
 * 用户水平评估 + 文章推荐 (V1 保留)
 *
 * 设计意图：
 *   V1 单独的用户评估与推荐模块，综合用户的学习数据给出水平判断和文章推荐。
 *   V2 与 dualGrader + articleGrader 协同工作。
 *
 * 核心职责：
 *   1. 用户水平评估（A1/A2/B1/B2/C1-C2）基于多信号融合
 *   2. 轨道进阶判定（是否可进入下一轨道）
 *   3. 文章推荐（按匹配度排序）
 *   4. 学习建议生成
 */

import {
  TRACK,
  TRACK_CONFIG,
  NEW_WORD_QUOTA,
  STAGE
} from '../data/models.js';
import {
  evaluateArticleFit,
  calcEffectiveNewWordQuota
} from './dualGrader.js';

// ============================================================
// 水平评估配置
// ============================================================
// 各水平对应的词汇量门槛（COCA高频词覆盖率近似）
export const LEVEL_VOCAB_THRESHOLDS = {
  A1: 500,         // 核心高频500词
  A2: 1500,        // 扩展到1500词
  B1: 3000,        // 中级3000词
  B2: 5000,        // 高级5000词
  'C1-C2': 8000    // 精通级8000+词
};

// 轨道进阶条件：每个轨道毕业需要达到的指标
export const TRACK_PROMOTION_CRITERIA = {
  1: { // 通用基础 → 领域入门
    minVocab: 1500,         // 至少掌握1500词
    minCorrectRate: 0.80,   // 近7天正确率≥80%
    minMasteredRatio: 0.6,  // 已掌握词汇占比≥60%
    targetLevel: 'A2'
  },
  2: { // 领域入门 → 领域专业
    minVocab: 3000,
    minCorrectRate: 0.80,
    minMasteredRatio: 0.55,
    targetLevel: 'B1'
  },
  3: { // 领域专业 → 真实材料
    minVocab: 5000,
    minCorrectRate: 0.85,
    minMasteredRatio: 0.55,
    targetLevel: 'B2'
  },
  4: { // 真实材料（已顶级，无进阶）
    minVocab: Infinity,
    minCorrectRate: 1.0,
    minMasteredRatio: 1.0,
    targetLevel: 'C1-C2'
  }
};

// 推荐排序权重
export const RECOMMEND_WEIGHTS = {
  FIT: 0.4,           // 匹配度（基础分）
  NOVELTY: 0.25,      // 新鲜度（未读优先）
  CHALLENGE: 0.2,    // 适度挑战（中等难度优先）
  DOMAIN_MATCH: 0.15 // 领域匹配
};

// ============================================================
// UserAssessor 类
// ============================================================
export class UserAssessor {
  /**
   * @param {Object} [options]
   * @param {Array} [options.articleLibrary] - 文章库
   * @param {Object} [options.freqRanks] - 词频表
   */
  constructor(options = {}) {
    this.articleLibrary = options.articleLibrary || [];
    this.freqRanks = options.freqRanks || {};
  }

  /**
   * 加载文章库
   */
  loadArticleLibrary(articles) {
    this.articleLibrary = articles;
  }

  // ============================================================
  // 1. 用户水平评估
  // ============================================================
  /**
   * 综合评估用户水平
   *
   * 多信号融合：
   *   1. 词汇量信号：learnedWordCount vs LEVEL_VOCAB_THRESHOLDS
   *   2. 正确率信号：correctRate7d
   *   3. 掌握度信号：stageProgress 中 mastered 占比
   *   4. 队列健康度：not_known 队列占比（过高说明超前了）
   *
   * @param {Object} user - User 对象
   * @param {Array} [wordCards] - 用户的所有 WordCard（可选，用于精确统计）
   * @returns {{level:string, confidence:number, signals:Object, suggestion:string}}
   */
  assessLevel(user, wordCards = []) {
    const signals = {};

    // ---- 信号1：词汇量 ----
    const vocabCount = user.learnedWordCount || wordCards.filter(c => c.metCount > 0).length;
    const vocabLevel = inferLevelFromVocab(vocabCount);
    signals.vocab = {
      value: vocabCount,
      inferredLevel: vocabLevel,
      weight: 0.4
    };

    // ---- 信号2：正确率 ----
    const correctRate = user.correctRate7d || 0;
    const rateLevel = inferLevelFromCorrectRate(correctRate);
    signals.correctRate = {
      value: correctRate,
      inferredLevel: rateLevel,
      weight: 0.3
    };

    // ---- 信号3：掌握度 ----
    let masteredRatio = 0;
    if (wordCards.length > 0) {
      const mastered = wordCards.filter(c => c.stage === STAGE.MASTERED).length;
      masteredRatio = mastered / wordCards.length;
    } else {
      const sp = user.stageProgress || {};
      const total = (sp.new || 0) + (sp.recognize || 0) + (sp.recall || 0) + (sp.mastered || 0);
      masteredRatio = total > 0 ? (sp.mastered || 0) / total : 0;
    }
    const masteryLevel = inferLevelFromMastery(masteredRatio);
    signals.mastery = {
      value: masteredRatio,
      inferredLevel: masteryLevel,
      weight: 0.2
    };

    // ---- 信号4：队列健康度 ----
    const qc = user.queueCounts || {};
    const totalQueued = (qc.not_known || 0) + (qc.remembered_wrong || 0) + (qc.learned || 0);
    const notKnownRatio = totalQueued > 0 ? (qc.not_known || 0) / totalQueued : 0;
    // not_known 占比过高（>0.4）说明内容超前，应降级
    const queuePenalty = notKnownRatio > 0.4 ? -1 : 0;
    signals.queueHealth = {
      value: notKnownRatio,
      penalty: queuePenalty,
      weight: 0.1
    };

    // ---- 综合判定 ----
    // 各信号给出 level index (0-4)，加权平均
    const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1-C2'];
    const toIdx = lvl => levelOrder.indexOf(lvl);

    let weightedSum = 0;
    let totalWeight = 0;
    for (const key of ['vocab', 'correctRate', 'mastery']) {
      const s = signals[key];
      weightedSum += toIdx(s.inferredLevel) * s.weight;
      totalWeight += s.weight;
    }
    // 队列健康度作为修正项
    weightedSum += queuePenalty * signals.queueHealth.weight;
    totalWeight += signals.queueHealth.weight;

    const avgIdx = weightedSum / totalWeight;
    const finalIdx = Math.max(0, Math.min(levelOrder.length - 1, Math.round(avgIdx)));
    const finalLevel = levelOrder[finalIdx];

    // 置信度：信号一致性越高，置信度越高
    const levels = [vocabLevel, rateLevel, masteryLevel].map(toIdx);
    const variance = calcVariance(levels);
    const confidence = Math.max(0, 1 - variance * 2); // 方差越小置信度越高

    // 建议
    let suggestion;
    if (notKnownRatio > 0.4) {
      suggestion = '不认识队列占比过高，建议降级复习巩固基础词汇';
    } else if (correctRate < 0.6) {
      suggestion = '近期正确率偏低，建议回到稍易文章巩固';
    } else if (correctRate > 0.9 && masteredRatio > 0.5) {
      suggestion = '掌握度良好，可尝试进阶到下一轨道';
    } else {
      suggestion = '保持当前节奏继续学习';
    }

    return {
      level: finalLevel,
      confidence,
      signals,
      suggestion
    };
  }

  // ============================================================
  // 2. 轨道进阶判定
  // ============================================================
  /**
   * 检查用户是否满足进入下一轨道的条件
   *
   * 进阶逻辑（设计文档）：
   *   - 必须先在"通用基础"积累到 A2 才能进"领域入门"
   *   - 领域入门积累足够领域词汇后进"领域专业"
   *   - 最终挑战"真实材料"
   *
   * @param {Object} user
   * @param {Array} [wordCards]
   * @returns {{canPromote:boolean, criteria:Object, missing:Array, nextTrack:number}}
   */
  checkTrackPromotion(user, wordCards = []) {
    const currentTrack = user.currentTrack || TRACK.GENERAL;
    const criteria = TRACK_PROMOTION_CRITERIA[currentTrack];

    if (!criteria || currentTrack >= TRACK.AUTHENTIC) {
      return {
        canPromote: false,
        criteria: null,
        missing: ['已在最高轨道，无法进阶'],
        nextTrack: null
      };
    }

    // 计算实际指标
    const vocabCount = user.learnedWordCount || wordCards.filter(c => c.metCount > 0).length;
    const correctRate = user.correctRate7d || 0;

    let masteredRatio = 0;
    if (wordCards.length > 0) {
      const mastered = wordCards.filter(c => c.stage === STAGE.MASTERED).length;
      masteredRatio = mastered / wordCards.length;
    }

    // 检查各条件
    const checks = {
      vocab: vocabCount >= criteria.minVocab,
      correctRate: correctRate >= criteria.minCorrectRate,
      masteredRatio: masteredRatio >= criteria.minMasteredRatio
    };

    const missing = [];
    if (!checks.vocab) missing.push(`词汇量不足：${vocabCount}/${criteria.minVocab}`);
    if (!checks.correctRate) missing.push(`正确率不足：${(correctRate * 100).toFixed(0)}%/${(criteria.minCorrectRate * 100)}%`);
    if (!checks.masteredRatio) missing.push(`掌握度不足：${(masteredRatio * 100).toFixed(0)}%/${(criteria.minMasteredRatio * 100)}%`);

    const canPromote = missing.length === 0;

    return {
      canPromote,
      criteria,
      checks,
      missing,
      nextTrack: canPromote ? currentTrack + 1 : null,
      currentStats: { vocabCount, correctRate, masteredRatio }
    };
  }

  // ============================================================
  // 3. 文章推荐
  // ============================================================
  /**
   * 为用户推荐文章
   *
   * 推荐策略：
   *   1. 候选池：用户当前轨道 + 低一轨道（用于复习）
   *   2. 过滤：通过 evaluateArticleFit
   *   3. 排序：匹配度 + 新鲜度 + 适度挑战 + 领域匹配
   *
   * @param {Object} user
   * @param {Object} [options]
   * @param {Array} [options.readArticleIds] - 已读文章ID列表
   * @param {number} [options.limit=10] - 返回数量
   * @param {string} [options.preferDomain] - 偏好领域
   * @returns {Array} 推荐列表 [{article, score, reason}]
   */
  recommendArticles(user, options = {}) {
    const {
      readArticleIds = [],
      limit = 10,
      preferDomain = null
    } = options;

    const readSet = new Set(readArticleIds);
    const currentTrack = user.currentTrack || TRACK.GENERAL;

    // 候选池：当前轨道 + 低一轨道
    const candidateTracks = [currentTrack];
    if (currentTrack > TRACK.GENERAL) {
      candidateTracks.push(currentTrack - 1);
    }

    // 过滤候选
    const candidates = this.articleLibrary.filter(a => {
      const track = a.track || TRACK.GENERAL;
      return candidateTracks.includes(track);
    });

    // 评分排序
    const scored = candidates.map(article => {
      const fit = evaluateArticleFit(article, user);
      if (!fit.fit) {
        return { article, score: 0, reason: fit.reason, skipped: true };
      }

      // 新鲜度：未读 = 1.0，已读 = 0.3
      const isRead = readSet.has(article.id);
      const novelty = isRead ? 0.3 : 1.0;

      // 适度挑战：难度在用户水平区间的中间值最优
      const userLevelRange = getLevelDifficultyRange(user.level);
      const mid = (userLevelRange[0] + userLevelRange[1]) / 2;
      const challenge = 1 - Math.abs(article.langDifficulty - mid) / 5;

      // 领域匹配
      const domainMatch = (preferDomain && article.domain === preferDomain) ? 1.0 :
                         (article.domain === user.domain) ? 0.8 : 0.5;

      const score =
        RECOMMEND_WEIGHTS.FIT * 1.0 +          // fit通过即满分
        RECOMMEND_WEIGHTS.NOVELTY * novelty +
        RECOMMEND_WEIGHTS.CHALLENGE * challenge +
        RECOMMEND_WEIGHTS.DOMAIN_MATCH * domainMatch;

      return {
        article,
        score,
        reason: isRead ? '复习推荐' : '新文章推荐',
        breakdown: { novelty, challenge, domainMatch }
      };
    });

    // 过滤不匹配的，按分数降序
    const sorted = scored
      .filter(r => !r.skipped)
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, limit);
  }

  /**
   * 推荐下一篇精读文章（单个最优推荐）
   */
  recommendNext(user, options = {}) {
    const recs = this.recommendArticles(user, { ...options, limit: 1 });
    return recs[0] || null;
  }

  // ============================================================
  // 4. 学习建议生成
  // ============================================================
  /**
   * 基于用户当前状态生成学习建议
   *
   * @param {Object} user
   * @param {Array} [wordCards]
   * @returns {{overall:string, focus:Array, warnings:Array}}
   */
  generateStudyPlan(user, wordCards = []) {
    const levelAssessment = this.assessLevel(user, wordCards);
    const promotion = this.checkTrackPromotion(user, wordCards);

    const focus = [];
    const warnings = [];

    // 队列健康度检查
    const qc = user.queueCounts || {};
    const totalQueued = (qc.not_known || 0) + (qc.remembered_wrong || 0) + (qc.learned || 0);
    const notKnownRatio = totalQueued > 0 ? (qc.not_known || 0) / totalQueued : 0;

    if (notKnownRatio > 0.4) {
      warnings.push(`不认识队列占比过高(${(notKnownRatio * 100).toFixed(0)}%)，建议回到低难度文章巩固`);
    }

    // 正确率检查
    if ((user.correctRate7d || 0) < 0.6) {
      warnings.push('近7天正确率低于60%，建议降低文章难度');
      focus.push('复习不认识队列中的词汇');
    } else if ((user.correctRate7d || 0) > 0.9) {
      focus.push('正确率优秀，可尝试挑战更高难度文章');
    }

    // 进阶建议
    if (promotion.canPromote) {
      focus.push(`满足进阶条件，可进入${TRACK_CONFIG[promotion.nextTrack].name}轨道`);
    } else if (promotion.missing.length > 0 && (user.currentTrack || 1) < TRACK.AUTHENTIC) {
      focus.push(`继续在当前轨道积累：${promotion.missing.join('；')}`);
    }

    // 词汇量建议
    const quota = calcEffectiveNewWordQuota(user.level, user.currentTrack);
    focus.push(`每日新词控制在${quota.min}-${quota.max}个`);

    // 总体建议
    let overall;
    if (warnings.length > 0) {
      overall = '当前学习节奏偏快，建议适当降速巩固';
    } else if (focus.some(f => f.includes('进阶'))) {
      overall = '学习状态良好，可考虑进阶';
    } else {
      overall = '保持当前学习节奏';
    }

    return {
      overall,
      focus,
      warnings,
      levelAssessment,
      promotionStatus: promotion
    };
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据词汇量推断水平
 */
function inferLevelFromVocab(count) {
  if (count >= LEVEL_VOCAB_THRESHOLDS['C1-C2']) return 'C1-C2';
  if (count >= LEVEL_VOCAB_THRESHOLDS.B2) return 'B2';
  if (count >= LEVEL_VOCAB_THRESHOLDS.B1) return 'B1';
  if (count >= LEVEL_VOCAB_THRESHOLDS.A2) return 'A2';
  return 'A1';
}

/**
 * 根据正确率推断水平
 * 高正确率（>0.85）→ 当前水平稳定，可能更高
 * 中等（0.65-0.85）→ 当前水平
 * 低（<0.65）→ 低于当前标注水平
 */
function inferLevelFromCorrectRate(rate) {
  if (rate >= 0.9) return 'C1-C2';
  if (rate >= 0.8) return 'B2';
  if (rate >= 0.7) return 'B1';
  if (rate >= 0.6) return 'A2';
  return 'A1';
}

/**
 * 根据掌握度推断水平
 */
function inferLevelFromMastery(ratio) {
  if (ratio >= 0.7) return 'C1-C2';
  if (ratio >= 0.55) return 'B2';
  if (ratio >= 0.4) return 'B1';
  if (ratio >= 0.25) return 'A2';
  return 'A1';
}

/**
 * 获取水平对应的语言难度区间
 */
function getLevelDifficultyRange(level) {
  const ranges = {
    A1: [0, 1.5],
    A2: [1.0, 2.5],
    B1: [2.0, 3.5],
    B2: [3.0, 4.5],
    'C1-C2': [3.5, 5.0]
  };
  return ranges[level] || ranges.A1;
}

/**
 * 计算方差（用于置信度评估）
 */
function calcVariance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const sumSq = arr.reduce((s, x) => s + (x - mean) ** 2, 0);
  return sumSq / arr.length;
}

// ============================================================
// 工厂函数
// ============================================================
export function createUserAssessor(options) {
  return new UserAssessor(options);
}

// ============================================================
// 默认导出
// ============================================================
export default {
  UserAssessor,
  createUserAssessor,
  LEVEL_VOCAB_THRESHOLDS,
  TRACK_PROMOTION_CRITERIA,
  RECOMMEND_WEIGHTS
};
