/**
 * 记忆状态模型 (V1 保留)
 *
 * 封装 WordCard 的记忆状态查询与统计，
 * 为上层（复习调度、用户仪表盘）提供便捷接口。
 *
 * 核心职责：
 *   1. 单词记忆状态查询（是否到期、队列归属、阶段）
 *   2. 批量统计（队列分布、阶段分布、毕业率、困难词率）
 *   3. 记忆健康度评估（综合指标）
 */

import { QUEUE, STAGE, SM2_CONFIG } from '../data/models.js';

// ============================================================
// MemoryModel 类
// ============================================================
export class MemoryModel {
  /**
   * @param {Array<WordCard>} cards - 用户的所有词汇卡片
   */
  constructor(cards = []) {
    this.cards = cards;
  }

  setCards(cards) { this.cards = cards; }

  // ---- 单卡查询 ----

  isDue(card, now = Date.now()) {
    return (card.sm2.dueDate || 0) <= now;
  }

  isGraduated(card) { return card.graduated; }
  isHardWord(card) { return card.isHardWord; }

  getOverdueDays(card, now = Date.now()) {
    const due = card.sm2.dueDate || now;
    return Math.max(0, (now - due) / (24 * 60 * 60 * 1000));
  }

  // ---- 批量筛选 ----

  getDueCards(now = Date.now()) {
    return this.cards.filter(c => this.isDue(c, now) && !c.graduated);
  }

  getCardsByQueue(queue) {
    return this.cards.filter(c => c.queue === queue);
  }

  getCardsByStage(stage) {
    return this.cards.filter(c => c.stage === stage);
  }

  getHardWords() {
    return this.cards.filter(c => c.isHardWord);
  }

  getGraduatedCards() {
    return this.cards.filter(c => c.graduated);
  }

  // ---- 统计 ----

  getStats() {
    const total = this.cards.length;
    if (total === 0) {
      return this._emptyStats();
    }

    const queueDist = { not_known: 0, remembered_wrong: 0, learned: 0 };
    const stageDist = { new: 0, recognize: 0, recall: 0, mastered: 0 };
    let graduated = 0, hardWords = 0, dueCount = 0;
    let sumEF = 0, sumInterval = 0, totalForget = 0;

    const now = Date.now();
    for (const c of this.cards) {
      queueDist[c.queue] = (queueDist[c.queue] || 0) + 1;
      stageDist[c.stage] = (stageDist[c.stage] || 0) + 1;
      if (c.graduated) graduated++;
      if (c.isHardWord) hardWords++;
      if (this.isDue(c, now) && !c.graduated) dueCount++;
      sumEF += c.sm2.ef;
      sumInterval += c.sm2.interval;
      totalForget += c.forgetCount;
    }

    return {
      total,
      queueDistribution: queueDist,
      stageDistribution: stageDist,
      graduated,
      graduatedRate: graduated / total,
      hardWords,
      hardWordRate: hardWords / total,
      dueCount,
      avgEF: sumEF / total,
      avgInterval: sumInterval / total,
      totalForgetCount: totalForget,
      avgForgetCount: totalForget / total
    };
  }

  /**
   * 记忆健康度评分（0-1）
   * 综合指标：
   *   - 已掌握占比（mastered + graduated）权重 0.4
   *   - 平均 EF（越高越好，归一化到0-1）权重 0.2
   *   - 不认识队列占比（越低越好）权重 0.2
   *   - 困难词占比（越低越好）权重 0.2
   */
  getHealthScore() {
    const stats = this.getStats();
    if (stats.total === 0) return 0;

    const masteredRatio = (stats.stageDistribution.mastered / stats.total) * 0.4;
    const efScore = ((stats.avgEF - SM2_CONFIG.MIN_EF) /
                    (SM2_CONFIG.MAX_EF - SM2_CONFIG.MIN_EF)) * 0.2;
    const notKnownPenalty = (1 - stats.queueDistribution.not_known / stats.total) * 0.2;
    const hardWordPenalty = (1 - stats.hardWordRate) * 0.2;

    return Math.max(0, Math.min(1, masteredRatio + efScore + notKnownPenalty + hardWordPenalty));
  }

  _emptyStats() {
    return {
      total: 0,
      queueDistribution: { not_known: 0, remembered_wrong: 0, learned: 0 },
      stageDistribution: { new: 0, recognize: 0, recall: 0, mastered: 0 },
      graduated: 0, graduatedRate: 0,
      hardWords: 0, hardWordRate: 0,
      dueCount: 0,
      avgEF: 0, avgInterval: 0,
      totalForgetCount: 0, avgForgetCount: 0
    };
  }
}

export function createMemoryModel(cards) {
  return new MemoryModel(cards);
}

export default { MemoryModel, createMemoryModel };
