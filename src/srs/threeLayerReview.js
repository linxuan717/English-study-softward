/**
 * 三层复习系统
 *
 * Layer 1 文章内复习：
 *   阅读时点词查义自动记录，段末/章末重复不认识的词
 *   不动 SM-2 状态，只做即时重复，始终在原句中展示
 *
 * Layer 2 文章后测试：
 *   完成阅读后自动进入，集中测试本篇生词，最多3轮
 *   不认识和记错的词分别进入不同队列，带回原句语境
 *   3轮后仍未掌握 → 转入跨文章队列
 *
 * Layer 3 跨文章复习：
 *   每日复习队列，简化版 SM-2 调度
 *   排序：逾期天数×1.0 + EF差距×2.0 + 遗忘次数×0.5 + 困难词+5 + 阶段权重
 *   语境：优先带回 correctReview 标记的原句
 *   出口：间隔≥90天 + 连续正确≥5次 → 毕业
 */

import {
  WordCard, Article, User,
  QUEUE, STAGE, STAGE_QUESTION_TYPE,
  SM2_CONFIG, MAX_SAME_ARTICLE_ROUNDS
} from '../data/models.js';
import {
  review as sm2Review,
  calcPriority,
  getDueCards,
  getCardsByQueue
} from './simplifiedSM2.js';
import {
  generateQuestion,
  handleObjectiveResult,
  handleDualLayerResult,
  AssessmentSession,
  QUESTION_TYPE
} from './assessmentModel.js';

// ============================================================
// Layer 1: 文章内复习
// ============================================================

/**
 * 文章内复习管理器
 * 记录阅读时点击查义的词，段末重复不认识的词
 * 不动 SM-2 状态，只做即时重复
 */
export class InArticleReview {
  constructor(article) {
    this.articleId = article.id;
    this.lookedUpWords = [];  // 阅读中查过的词 [{ card, sentence, paragraphIndex, ts }]
    this.currentParagraph = 0;
    this.pendingReview = [];  // 待段末重复的词
  }

  /**
   * 用户点击单词查看释义时调用
   * @param {WordCard} card
   * @param {string} sentence - 该词所在的原句
   * @param {number} paragraphIndex - 段落序号
   */
  recordLookup(card, sentence, paragraphIndex) {
    this.lookedUpWords.push({
      card,
      sentence,
      paragraphIndex,
      ts: Date.now()
    });
  }

  /**
   * 段落结束时，获取该段中查过但还不认识的词
   * 用于段末重复展示
   * @param {number} paragraphIndex
   * @returns {Array} 待重复的词 [{ word, translation, sentence }]
   */
  getParagraphEndReview(paragraphIndex) {
    return this.lookedUpWords
      .filter(item => item.paragraphIndex === paragraphIndex)
      .map(item => ({
        word: item.card.word,
        translation: item.card.translation,
        sentence: item.sentence
      }));
  }

  /**
   * 章末重复：获取全部查过的词（用于整篇结束前的提示）
   * 不动 SM-2 状态
   * @returns {Array}
   */
  getChapterEndReview() {
    return this.lookedUpWords.map(item => ({
      word: item.card.word,
      translation: item.card.translation,
      sentence: item.sentence
    }));
  }

  /**
   * 获取本篇查过的词卡片列表（供 Layer 2 使用）
   * @returns {Array<WordCard>}
   */
  getLookedUpCards() {
    return this.lookedUpWords.map(item => item.card);
  }
}

// ============================================================
// Layer 2: 文章后测试
// ============================================================

/**
 * 文章后测试管理器
 * 集中测试本篇生词，最多3轮，分队列处理
 */
export class PostArticleTest {
  /**
   * @param {Article} article
   * @param {Array<WordCard>} cards - 本篇生词卡片
   * @param {Object} pools - { distractorPool, collocations }
   */
  constructor(article, cards, pools = {}) {
    this.article = article;
    this.pools = pools;
    this.maxRounds = MAX_SAME_ARTICLE_ROUNDS; // 3轮
    this.currentRound = 0;
    this.testQueue = [...cards];    // 待测试队列
    this.results = [];               // 每轮结果
    this.pendingCards = [];          // 3轮后仍未掌握，转 Layer 3
  }

  /**
   * 开始下一轮测试
   * @returns {Array<Object>} 本轮题目列表
   */
  startRound() {
    if (this.currentRound >= this.maxRounds) {
      // 超过3轮，剩余的转入 Layer 3
      this.pendingCards = [...this.testQueue];
      return null; // 测试结束
    }

    this.currentRound++;
    const questions = this.testQueue.map(card =>
      generateQuestion(card, this.pools)
    );

    return questions;
  }

  /**
   * 处理一轮中每个词的测试结果
   * 将结果映射到 SM-2 评分
   *
   * @param {WordCard} card
   * @param {string} grade - 'learned' | 'remembered_wrong' | 'not_known'
   * @param {Object} [context] - 语境 { sentence, articleId }
   * @returns {Object} SM-2 更新结果
   */
  handleResult(card, grade, context = null) {
    const ctx = context || {
      sentence: card.getPreferredContext()?.sentence,
      articleId: this.article.id
    };

    const result = sm2Review(card, grade, ctx);

    // 记录本轮结果
    this.results.push({
      round: this.currentRound,
      cardId: card.id,
      word: card.word,
      grade,
      passed: result.passed,
      queue: result.queue
    });

    return result;
  }

  /**
   * 一轮结束后，筛选仍未掌握的词进入下一轮
   */
  filterForNextRound() {
    const masteredIds = this.results
      .filter(r => r.round === this.currentRound && r.passed)
      .map(r => r.cardId);

    this.testQueue = this.testQueue.filter(c => !masteredIds.includes(c.id));
  }

  /**
   * 获取测试摘要
   * @returns {Object} { totalRounds, totalCards, mastered, pending, byQueue }
   */
  getSummary() {
    const allCards = new Map();
    for (const r of this.results) {
      if (!allCards.has(r.cardId)) {
        allCards.set(r.cardId, { word: r.word, finalGrade: r.grade, queue: r.queue });
      } else {
        // 更新为最后一次结果
        allCards.set(r.cardId, { word: r.word, finalGrade: r.grade, queue: r.queue });
      }
    }

    const byQueue = { not_known: 0, remembered_wrong: 0, learned: 0 };
    for (const c of allCards.values()) {
      byQueue[c.queue] = (byQueue[c.queue] || 0) + 1;
    }

    return {
      totalRounds: this.currentRound,
      totalCards: allCards.size,
      mastered: byQueue.learned,
      pending: this.pendingCards.length,
      byQueue
    };
  }

  /**
   * 测试是否完成（3轮 或 所有词已掌握）
   */
  isComplete() {
    return this.currentRound >= this.maxRounds || this.testQueue.length === 0;
  }
}

// ============================================================
// Layer 3: 跨文章复习
// ============================================================

/**
 * 跨文章复习管理器
 * 每日复习队列，简化版 SM-2 调度
 */
export class CrossArticleReview {
  /**
   * @param {Array<WordCard>} allCards - 所有卡片
   */
  constructor(allCards) {
    this.allCards = allCards;
  }

  /**
   * 获取今日待复习卡片（按优先级排序）
   * 排序公式：逾期天数×1.0 + EF差距×2.0 + 遗忘次数×0.5 + 困难词+5 + 阶段权重
   *
   * @param {number} [limit] - 最多返回数量
   * @returns {Array<WordCard>}
   */
  getTodayReview(limit = null) {
    return getDueCards(this.allCards, limit);
  }

  /**
   * 按队列分组获取卡片
   */
  getByQueue() {
    return {
      notKnown: getCardsByQueue(this.allCards, QUEUE.NOT_KNOWN),
      rememberedWrong: getCardsByQueue(this.allCards, QUEUE.REMEMBERED_WRONG),
      learned: getCardsByQueue(this.allCards, QUEUE.LEARNED)
    };
  }

  /**
   * 处理一次跨文章复习
   * 带回 correctReview 标记的原句语境
   *
   * @param {WordCard} card
   * @param {string} grade
   * @returns {Object} SM-2 更新结果
   */
  handleReview(card, grade) {
    const ctx = card.getPreferredContext();
    const context = ctx ? {
      sentence: ctx.sentence,
      articleId: ctx.articleId
    } : null;

    return sm2Review(card, grade, context);
  }

  /**
   * 获取复习统计
   */
  getStats() {
    const due = this.getTodayReview();
    const queues = this.getByQueue();
    const graduated = this.allCards.filter(c => c.graduated).length;

    return {
      totalCards: this.allCards.length,
      dueToday: due.length,
      graduated,
      active: this.allCards.length - graduated,
      byQueue: {
        notKnown: queues.notKnown.length,
        rememberedWrong: queues.rememberedWrong.length,
        learned: queues.learned.length
      },
      hardWords: this.allCards.filter(c => c.isHardWord).length
    };
  }
}

// ============================================================
// 三层复习协调器
// ============================================================

/**
 * 协调三层复习的整体流程
 */
export class ReviewCoordinator {
  /**
   * @param {User} user
   * @param {Array<WordCard>} allCards
   */
  constructor(user, allCards) {
    this.user = user;
    this.allCards = allCards;
    this.layer1 = null;  // InArticleReview
    this.layer2 = null;  // PostArticleTest
    this.layer3 = new CrossArticleReview(allCards);
  }

  /**
   * 开始一篇文章的学习
   * 初始化 Layer 1
   */
  startArticle(article) {
    this.layer1 = new InArticleReview(article);
    this.currentArticle = article;
    return this.layer1;
  }

  /**
   * 完成阅读，进入 Layer 2 文章后测试
   */
  finishReading(cards, pools = {}) {
    if (!this.layer1) {
      throw new Error('请先开始文章阅读');
    }

    // 合并 Layer 1 查过的词 + 文章标注的生词
    const lookedUp = this.layer1.getLookedUpCards();
    const allCards = [...new Set([...lookedUp, ...cards])];

    this.layer2 = new PostArticleTest(this.currentArticle, allCards, pools);
    return this.layer2;
  }

  /**
   * 完成 Layer 2 后，将未掌握的词转入 Layer 3
   */
  transferToLongTerm() {
    if (!this.layer2) return;

    const pending = this.layer2.pendingCards;
    // 这些词已在 SM-2 中有状态，Layer 3 会自动调度
    // 这里只需确保它们在 allCards 中
    for (const card of pending) {
      if (!this.allCards.find(c => c.id === card.id)) {
        this.allCards.push(card);
      }
    }
    // 更新 Layer 3 引用
    this.layer3 = new CrossArticleReview(this.allCards);
  }

  /**
   * 获取今日复习计划
   */
  getDailyPlan(limit = null) {
    return this.layer3.getTodayReview(limit);
  }
}

// ============================================================
// 默认导出
// ============================================================
export default {
  InArticleReview,
  PostArticleTest,
  CrossArticleReview,
  ReviewCoordinator
};
