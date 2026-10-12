/**
 * 完整版 SM-2 间隔重复算法 (V1 保留，后续升级用)
 *
 * 与 simplifiedSM2.js 的区别：
 *   - 评分：完整 0-5 六级（vs 简化版 3 级映射）
 *   - 第二次间隔：6天（vs 简化版 3天）
 *   - EF 上限：3.0（vs 简化版 2.8）
 *   - EF 调整：完整公式 EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))
 *
 * V1 不使用本模块，V2+ 升级时切换到此实现。
 * 完整版提供更精确的间隔控制，但需要用户做 6 级评分，认知负荷更高。
 */

import { SM2_CONFIG } from '../data/models.js';

// 完整版 SM-2 配置（覆盖简化版的值）
export const FULL_SM2_CONFIG = {
  INITIAL_EF: 2.5,
  MIN_EF: 1.3,
  MAX_EF: 3.0,          // 完整版上限3.0（简化版2.8）
  FIRST_INTERVAL: 1,
  SECOND_INTERVAL: 6,   // 完整版第二次6天（简化版3天）
  FAIL_INTERVAL: 1
};

// 完整版 0-5 六级评分
export const QUALITY_GRADES = {
  BLACKOUT: 0,      // 完全不认识
  WRONG: 1,         // 答错了，但看到答案能想起
  WRONG_BUT_EASY: 2, // 答错了，但觉得简单
  CORRECT_HARD: 3,  // 答对了，但很费劲
  CORRECT: 4,       // 答对了，有些犹豫
  PERFECT: 5        // 答对了，毫不费力
};

/**
 * 完整版 SM-2 核心算法
 *
 * @param {WordCard} card
 * @param {number} quality - 0-5 评分
 * @returns {Object} 更新结果
 */
export function review(card, quality) {
  if (quality < 0 || quality > 5) {
    throw new Error('quality 必须在 0-5 之间');
  }

  const prevInterval = card.sm2.interval;
  const prevReps = card.sm2.reps;
  const passed = quality >= 3;

  card.metCount++;

  if (!passed) {
    // 不及格：重置
    card.sm2.reps = 0;
    card.sm2.interval = FULL_SM2_CONFIG.FAIL_INTERVAL;
    card.consecutiveFailures++;
    card.consecutiveCorrect = 0;
    card.recallStreak = 0;
  } else {
    // 及格：推进间隔
    if (prevReps === 0) {
      card.sm2.interval = FULL_SM2_CONFIG.FIRST_INTERVAL;
    } else if (prevReps === 1) {
      card.sm2.interval = FULL_SM2_CONFIG.SECOND_INTERVAL;
    } else {
      card.sm2.interval = Math.round(prevInterval * card.sm2.ef);
    }
    card.sm2.reps = prevReps + 1;
    card.consecutiveCorrect++;
    card.consecutiveFailures = 0;
    card.recallStreak++;
    card.updateStage();
    card.checkGraduation();
  }

  // 完整版 EF 调整公式
  const efDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  card.sm2.ef = Math.max(
    FULL_SM2_CONFIG.MIN_EF,
    Math.min(FULL_SM2_CONFIG.MAX_EF, card.sm2.ef + efDelta)
  );

  card.sm2.lastReview = Date.now();
  card.sm2.dueDate = Date.now() + card.sm2.interval * 24 * 60 * 60 * 1000;

  return {
    card,
    passed,
    newInterval: card.sm2.interval,
    newEF: card.sm2.ef,
    graduated: card.graduated
  };
}

export default { review, FULL_SM2_CONFIG, QUALITY_GRADES };
