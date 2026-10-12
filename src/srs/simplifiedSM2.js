/**
 * 简化版 SM-2 间隔重复算法
 *
 * 核心特性：
 * 1. 3级映射（不认识/记错了/学会了 → quality 0/2/4）
 * 2. 分队列差异化惩罚（记错了 EF降0.10，不认识 EF降0.20）
 * 3. 困难词淘汰（连续失败≥10次标记困难词）
 * 4. 毕业判定（间隔≥90天 + 连续正确≥5次）
 *
 * 算法复杂，界面简单：3个按钮背后是完整的 EF/间隔/队列调度逻辑
 */

import { SM2_CONFIG, QUEUE, STAGE } from '../data/models.js';

// ============================================================
// 核心算法：处理一次复习评分
// ============================================================
/**
 * 根据用户的复习操作，更新 WordCard 的 SM-2 状态
 *
 * @param {WordCard} card - 词汇卡片
 * @param {string} grade - 用户操作：'not_known' | 'remembered_wrong' | 'learned'
 * @param {Object} [context] - 可选，本次复习的语境 { sentence, articleId }
 * @returns {Object} 更新结果 { card, passed, newInterval, newEF, queue, graduated }
 */
export function review(card, grade, context = null) {
  const cfg = SM2_CONFIG.QUALITY_MAP[grade];
  if (!cfg) {
    throw new Error(`无效的评分等级: ${grade}，应为 not_known/remembered_wrong/learned`);
  }

  const { quality, penalty, bonus } = cfg;
  const passed = quality >= 3; // quality ≥ 3 为及格

  // 记录遇见次数
  card.metCount++;

  // 保存当前间隔（用于及格时计算下个间隔）
  const prevInterval = card.sm2.interval;
  const prevReps = card.sm2.reps;

  if (!passed) {
    // -------- 不及格：不认识 / 记错了 --------
    card.sm2.reps = 0;
    card.sm2.interval = SM2_CONFIG.FAIL_INTERVAL; // 重置为1天

    // EF 下降（按惩罚力度）
    card.sm2.ef = Math.max(
      SM2_CONFIG.MIN_EF,
      card.sm2.ef - penalty
    );

    // 队列归属：不认识 vs 记错了
    if (grade === 'not_known') {
      card.queue = QUEUE.NOT_KNOWN;
      card.forgetCount++;
      card.recallStreak = 0;
      card.consecutiveFailures++;
      card.consecutiveCorrect = 0;
    } else { // remembered_wrong
      card.queue = QUEUE.REMEMBERED_WRONG;
      // 记错了有部分记忆痕迹，recallStreak 不归零只减半
      card.recallStreak = Math.floor(card.recallStreak / 2);
      card.consecutiveFailures++;
      card.consecutiveCorrect = 0;
    }

    // 困难词判定
    card.checkHardWord();

  } else {
    // -------- 及格：学会了 --------
    // 间隔计算（注意：先算 interval 再 reps++）
    if (prevReps === 0) {
      // 第1次正确：1天
      card.sm2.interval = SM2_CONFIG.FIRST_INTERVAL;
    } else if (prevReps === 1) {
      // 第2次正确：3天（原版6天，简化缩短）
      card.sm2.interval = SM2_CONFIG.SECOND_INTERVAL;
    } else {
      // 后续：上轮间隔 × EF
      card.sm2.interval = Math.round(prevInterval * card.sm2.ef);
    }

    // reps++（在算完 interval 之后）
    card.sm2.reps = prevReps + 1;

    // EF 上升
    card.sm2.ef = Math.min(
      SM2_CONFIG.MAX_EF,
      card.sm2.ef + (bonus || SM2_CONFIG.LEARNED_BONUS)
    );

    // 队列归属：已学
    card.queue = QUEUE.LEARNED;
    card.recallStreak++;
    card.consecutiveCorrect++;
    card.consecutiveFailures = 0;

    // 更新掌握阶段
    card.updateStage();

    // 毕业判定
    card.checkGraduation();
  }

  // 记录上次复习时间
  card.sm2.lastReview = Date.now();

  // 计算下次到期时间
  card.sm2.dueDate = Date.now() + card.sm2.interval * 24 * 60 * 60 * 1000;

  // 添加语境记录（如有）
  if (context && context.sentence) {
    card.addContext(
      context.sentence,
      context.articleId,
      passed // 正确回忆时标记 correctReview
    );
  }

  return {
    card,
    passed,
    newInterval: card.sm2.interval,
    newEF: card.sm2.ef,
    queue: card.queue,
    stage: card.stage,
    graduated: card.graduated,
    isHardWord: card.isHardWord
  };
}

// ============================================================
// 批量复习调度
// ============================================================
/**
 * 计算复习优先级（加权评分公式）
 *
 * 公式：逾期天数×1.0 + EF差距×2.0 + 遗忘次数×0.5 + 困难词+5 + 阶段权重
 *
 * @param {WordCard} card
 * @returns {number} 优先级分数（越高越优先）
 */
export function calcPriority(card) {
  const now = Date.now();
  const due = card.sm2.dueDate || now;
  const overdueDays = Math.max(0, (now - due) / (24 * 60 * 60 * 1000));

  const efGap = SM2_CONFIG.MAX_EF - card.sm2.ef; // EF 越低，差距越大，优先级越高

  const forgetPenalty = card.forgetCount * 0.5;

  const hardWordBonus = card.isHardWord ? 5 : 0;

  // 阶段权重：新词优先复习，已掌握的低优先级
  const stageWeight = {
    [STAGE.NEW]: 3,
    [STAGE.RECOGNIZE]: 2,
    [STAGE.RECALL]: 1.5,
    [STAGE.MASTERED]: 0.5
  }[card.stage] || 1;

  return (
    overdueDays * 1.0 +
    efGap * 2.0 +
    forgetPenalty +
    hardWordBonus +
    stageWeight
  );
}

/**
 * 获取今日待复习的卡片列表（按优先级排序）
 *
 * @param {Array<WordCard>} cards - 所有卡片
 * @param {number} [limit] - 最多返回数量
 * @returns {Array<WordCard>} 按优先级降序排列的待复习卡片
 */
export function getDueCards(cards, limit = null) {
  const now = Date.now();

  const due = cards.filter(card => {
    if (card.graduated) return false; // 已毕业的不复习
    if (!card.sm2.dueDate) return true; // 无到期时间（新词）需复习
    return card.sm2.dueDate <= now;   // 已到期
  });

  // 按优先级降序排序
  due.sort((a, b) => calcPriority(b) - calcPriority(a));

  return limit ? due.slice(0, limit) : due;
}

/**
 * 获取指定队列的卡片
 * @param {Array<WordCard>} cards
 * @param {string} queue - QUEUE 枚举值
 * @returns {Array<WordCard>}
 */
export function getCardsByQueue(cards, queue) {
  return cards.filter(card => card.queue === queue && !card.graduated);
}

// ============================================================
// 辅助：创建新卡片
// ============================================================
/**
 * 创建一个新的词汇卡片
 * @param {Object} opts - 同 WordCard 构造参数
 * @returns {WordCard}
 */
export function createCard(opts) {
  // 动态导入避免循环依赖
  const { WordCard } = require('../data/models.js');
  return new WordCard(opts);
}

// ============================================================
// 算法状态查询
// ============================================================
/**
 * 获取卡片的算法状态摘要
 * @param {WordCard} card
 * @returns {Object} 状态摘要
 */
export function getCardStatus(card) {
  return {
    word: card.word,
    stage: card.stage,
    queue: card.queue,
    ef: card.sm2.ef.toFixed(2),
    interval: card.sm2.interval,
    reps: card.sm2.reps,
    recallStreak: card.recallStreak,
    forgetCount: card.forgetCount,
    metCount: card.metCount,
    isHardWord: card.isHardWord,
    graduated: card.graduated,
    dueDate: card.sm2.dueDate
      ? new Date(card.sm2.dueDate).toLocaleDateString('zh-CN')
      : null,
    contexts: card.contexts.length
  };
}

// ============================================================
// 默认导出
// ============================================================
export default {
  review,
  calcPriority,
  getDueCards,
  getCardsByQueue,
  createCard,
  getCardStatus
};
