/**
 * 复习调度器 (V1 保留)
 *
 * 封装 simplifiedSM2.calcPriority + getDueCards，
 * 提供面向上层的"今日复习队列"构建接口。
 *
 * 核心职责：
 *   1. 构建今日复习队列（按优先级排序）
 *   2. 控制每日复习量上限（避免认知过载）
 *   3. 分队列组织复习批次
 *   4. 复习进度跟踪
 */

import { calcPriority, getDueCards } from './simplifiedSM2.js';
import { QUEUE, STAGE } from '../data/models.js';

// 每日复习量上限（避免认知过载）
export const DAILY_LIMITS = {
  NEW_CARDS: 20,         // 每日新词上限
  REVIEW_CARDS: 100,     // 每日复习卡片上限
  HARD_WORD_CARDS: 30    // 困难词每日上限（避免卡在困难词上）
};

// 批次大小（一次展示多少张卡）
export const BATCH_SIZE = 10;

// ============================================================
// ReviewScheduler 类
// ============================================================
export class ReviewScheduler {
  /**
   * @param {Array<WordCard>} cards - 用户的所有词汇卡片
   * @param {Object} [options]
   * @param {number} [options.dailyLimit=100]
   * @param {number} [options.batchSize=10]
   */
  constructor(cards = [], options = {}) {
    this.cards = cards;
    this.dailyLimit = options.dailyLimit || DAILY_LIMITS.REVIEW_CARDS;
    this.batchSize = options.batchSize || BATCH_SIZE;
    this._currentBatch = null;
    this._batchIndex = 0;
  }

  setCards(cards) {
    this.cards = cards;
    this._currentBatch = null;
    this._batchIndex = 0;
  }

  // ============================================================
  // 1. 构建今日复习队列
  // ============================================================
  /**
   * 构建今日复习队列
   *
   * 排序逻辑（来自 simplifiedSM2.calcPriority）：
   *   逾期天数×1.0 + EF差距×2.0 + 遗忘次数×0.5 + 困难词+5 + 阶段权重
   *
   * 队列内再按队列类型分组：
   *   不认识队列 → 记错队列 → 已学队列
   *
   * @param {number} [now=Date.now()]
   * @returns {Array<WordCard>} 排序后的今日复习卡片
   */
  buildDailyQueue(now = Date.now()) {
    // 获取所有到期卡片（排除已毕业）
    const due = getDueCards(this.cards, now);

    // 按优先级排序
    const sorted = due.sort((a, b) => calcPriority(b, now) - calcPriority(a, now));

    // 分队列：不认识优先，记错次之，已学最后
    const notKnown = sorted.filter(c => c.queue === QUEUE.NOT_KNOWN);
    const rememberedWrong = sorted.filter(c => c.queue === QUEUE.REMEMBERED_WRONG);
    const learned = sorted.filter(c => c.queue === QUEUE.LEARNED);

    // 困难词单独提取（优先处理但不超限）
    const hardWords = sorted.filter(c => c.isHardWord).slice(0, DAILY_LIMITS.HARD_WORD_CARDS);

    // 组合最终队列：困难词 → 不认识 → 记错 → 已学
    const queue = [
      ...hardWords.filter(c => !notKnown.includes(c) && !rememberedWrong.includes(c)),
      ...notKnown,
      ...rememberedWrong,
      ...learned
    ].slice(0, this.dailyLimit);

    return queue;
  }

  // ============================================================
  // 2. 批次管理
  // ============================================================
  /**
   * 获取下一批次
   * @returns {Array<WordCard>|null}
   */
  nextBatch() {
    if (!this._currentBatch) {
      this._currentBatch = this.buildDailyQueue();
      this._batchIndex = 0;
    }

    const start = this._batchIndex * this.batchSize;
    if (start >= this._currentBatch.length) return null;

    const batch = this._currentBatch.slice(start, start + this.batchSize);
    this._batchIndex++;
    return batch;
  }

  /**
   * 重置批次（重新开始）
   */
  resetBatch() {
    this._currentBatch = null;
    this._batchIndex = 0;
  }

  /**
   * 获取批次进度
   */
  getBatchProgress() {
    if (!this._currentBatch) return { total: 0, completed: 0, remaining: 0 };
    return {
      total: this._currentBatch.length,
      completed: this._batchIndex * this.batchSize,
      remaining: Math.max(0, this._currentBatch.length - this._batchIndex * this.batchSize)
    };
  }

  // ============================================================
  // 3. 今日复习概览
  // ============================================================
  /**
   * 获取今日复习概览
   */
  getDailyOverview(now = Date.now()) {
    const queue = this._currentBatch || this.buildDailyQueue(now);
    return {
      totalDue: queue.length,
      byQueue: {
        not_known: queue.filter(c => c.queue === QUEUE.NOT_KNOWN).length,
        remembered_wrong: queue.filter(c => c.queue === QUEUE.REMEMBERED_WRONG).length,
        learned: queue.filter(c => c.queue === QUEUE.LEARNED).length
      },
      byStage: {
        new: queue.filter(c => c.stage === STAGE.NEW).length,
        recognize: queue.filter(c => c.stage === STAGE.RECOGNIZE).length,
        recall: queue.filter(c => c.stage === STAGE.RECALL).length,
        mastered: queue.filter(c => c.stage === STAGE.MASTERED).length
      },
      hardWords: queue.filter(c => c.isHardWord).length,
      estimatedTime: this._estimateTime(queue)
    };
  }

  /**
   * 估算复习时间（粗略）
   * 每张卡约 15 秒（含阅读+答题）
   * @private
   */
  _estimateTime(queue) {
    const secondsPerCard = 15;
    const totalSeconds = queue.length * secondsPerCard;
    return {
      minutes: Math.ceil(totalSeconds / 60),
      seconds: totalSeconds
    };
  }
}

export function createReviewScheduler(cards, options) {
  return new ReviewScheduler(cards, options);
}

export default { ReviewScheduler, createReviewScheduler, DAILY_LIMITS, BATCH_SIZE };
