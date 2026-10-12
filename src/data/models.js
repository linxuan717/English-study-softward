/**
 * 数据模型定义
 * 包含 WordCard / Article / User 三大模型 + SM2_CONFIG 配置
 *
 * 设计原则：算法复杂，界面简单；V1做减法，后续做加法
 */

// ============================================================
// SM-2 算法配置（简化版，3级映射）
// ============================================================
export const SM2_CONFIG = {
  // EF（易度因子）范围
  INITIAL_EF: 2.5,        // 初始易度因子，沿用原版 SM-2 默认值
  MIN_EF: 1.3,            // EF 下限，防止算法陷入无限重置
  MAX_EF: 2.8,            // EF 上限（简化版设为2.8，完整版为3.0）

  // 间隔基准
  FIRST_INTERVAL: 1,      // 第1次正确：1天
  SECOND_INTERVAL: 3,     // 第2次正确：3天（原版6天，简化缩短）
  FAIL_INTERVAL: 1,       // 不及格时重置为1天

  // EF 调整幅度
  LEARNED_BONUS: 0.05,            // 学会了 → EF升0.05
  REMEMBERED_WRONG_PENALTY: 0.10, // 记错了 → EF降0.10（惩罚较轻，有部分记忆痕迹）
  NOT_KNOWN_PENALTY: 0.20,        // 不认识 → EF降0.20（惩罚较重，需从头学起）

  // 3级映射：用户操作 → 内部 quality 评分
  QUALITY_MAP: {
    not_known: { quality: 0, penalty: 0.20 },         // 不认识
    remembered_wrong: { quality: 2, penalty: 0.10 }, // 记错了
    learned: { quality: 4, bonus: 0.05 }              // 学会了
  },

  // 毕业条件（V2.1 放宽：90天 + 连续正确5次）
  GRADUATION_INTERVAL: 90,      // 间隔 ≥ 90天
  GRADUATION_STREAK: 5,         // 连续正确 ≥ 5次

  // 困难词淘汰机制
  HARD_WORD_FAIL_THRESHOLD: 10, // 连续失败 ≥ 10次 → 标记为困难词

  // 语境带回配置
  CONTEXTS_MAX: 5,              // contexts 数组上限5个，FIFO淘汰最早的

  // 掌握阶段阈值（基于 recallStreak）
  STAGE_THRESHOLDS: {
    new: { min: 0, max: 0 },        // recallStreak = 0
    recognize: { min: 1, max: 2 },  // recallStreak 1-2
    recall: { min: 3, max: 4 },     // recallStreak 3-4
    mastered: { min: 5, max: Infinity } // recallStreak 5+
  }
};

// ============================================================
// 队列类型枚举
// ============================================================
export const QUEUE = {
  NOT_KNOWN: 'not_known',           // 不认识队列，优先级最高
  REMEMBERED_WRONG: 'remembered_wrong', // 记错队列，优先级高
  LEARNED: 'learned'                 // 已学队列，优先级低
};

// 队列优先级（数值越大优先级越高）
export const QUEUE_PRIORITY = {
  not_known: 3,
  remembered_wrong: 2,
  learned: 1
};

// ============================================================
// 掌握阶段枚举
// ============================================================
export const STAGE = {
  NEW: 'new',           // 新词/眼熟 → 再认题
  RECOGNIZE: 'recognize', // 能再认 → 回忆题
  RECALL: 'recall',     // 能回忆 → 填空题
  MASTERED: 'mastered'  // 已掌握 → 搭配题
};

// 阶段对应的题型
export const STAGE_QUESTION_TYPE = {
  new: 'recognition',    // 再认题：给词，4选1选意思
  recognize: 'recall',   // 回忆题：给词，不给选项，自判
  recall: 'blank',       // 填空题：原句挖空，回忆或选词
  mastered: 'collocation' // 搭配题：给词，选正确搭配
};

// ============================================================
// 学习轨道枚举
// ============================================================
export const TRACK = {
  GENERAL: 1,      // 通用基础 A1-A2，领域难度 0-0.5
  INTRO: 2,        // 领域入门 A2-B1，领域难度 0.5-2.0
  PROFESSIONAL: 3, // 领域专业 B1-B2，领域难度 2.0-4.0
  AUTHENTIC: 4     // 真实材料 B2-C2，领域难度 3.5-5.0
};

// 轨道配置
export const TRACK_CONFIG = {
  1: {
    name: '通用基础',
    targetLevel: 'A1-A2',
    domainRange: [0, 0.5],
    newWordRange: [5, 8],
    maxLength: 300,
    focus: '核心500-1500词量'
  },
  2: {
    name: '领域入门',
    targetLevel: 'A2-B1',
    domainRange: [0.5, 2.0],
    newWordRange: [8, 12],
    maxLength: 600,
    focus: '领域核心术语 + 通用混合'
  },
  3: {
    name: '领域专业',
    targetLevel: 'B1-B2',
    domainRange: [2.0, 4.0],
    newWordRange: [10, 15],
    maxLength: 1000,
    focus: '专业术语深度 + 行业表达'
  },
  4: {
    name: '真实材料',
    targetLevel: 'B2-C2',
    domainRange: [3.5, 5.0],
    newWordRange: [15, 20],
    focus: '真实语言环境适应'
  }
};

// 动态新词配额（按用户水平）
export const NEW_WORD_QUOTA = {
  A1: [5, 8],
  A2: [6, 9],
  B1: [10, 15],
  B2: [12, 17],
  'C1-C2': [15, 20]
};

// 同篇复习上限
export const MAX_SAME_ARTICLE_ROUNDS = 3;

// ============================================================
// WordCard - 词汇卡片模型
// ============================================================
export class WordCard {
  /**
   * @param {Object} opts
   * @param {string} opts.id - 唯一ID
   * @param {string} opts.word - 单词或短语（短语以本身为key，如 "look up"）
   * @param {string} [opts.pos] - 词性
   * @param {string} [opts.translation] - 中文翻译
   * @param {string} [opts.phonetic] - 音标
   * @param {number} [opts.freqRank] - COCA词频排名
   * @param {boolean} [opts.isPhrase] - 是否短语卡片
   * @param {Array} [opts.meanings] - 多义数组（短语支持），每项 {meaning, contextKeywords[]}
   */
  constructor(opts = {}) {
    this.id = opts.id || generateId('word');
    this.word = opts.word || '';
    this.pos = opts.pos || '';
    this.translation = opts.translation || '';
    this.phonetic = opts.phonetic || '';
    this.freqRank = opts.freqRank || null;
    this.isPhrase = opts.isPhrase || false;
    this.meanings = opts.meanings || []; // 短语多义

    // SM-2 状态
    this.sm2 = {
      reps: 0,              // 连续正确次数
      ef: SM2_CONFIG.INITIAL_EF, // 易度因子
      interval: 0,          // 当前间隔（天）
      dueDate: null,        // 下次到期日期（时间戳）
      lastReview: null     // 上次复习时间（时间戳）
    };

    // 队列归属
    this.queue = QUEUE.NOT_KNOWN;

    // 掌握阶段
    this.stage = STAGE.NEW;
    this.recallStreak = 0;        // 连续正确回忆次数，决定阶段晋升
    this.forgetCount = 0;         // 总遗忘次数
    this.metCount = 0;            // 总遇见次数
    this.consecutiveFailures = 0; // 连续失败次数（用于困难词判定）
    this.consecutiveCorrect = 0;  // 连续正确次数（用于毕业判定）

    // 困难词与毕业
    this.isHardWord = false;
    this.graduated = false;

    // 语境记录（上限5个，FIFO淘汰）
    // 每条：{ sentence, articleId, ts, correctReview }
    this.contexts = [];
  }

  /**
   * 添加语境记录，超过上限时FIFO淘汰最早的
   * @param {string} sentence - 原句
   * @param {string} articleId - 文章ID
   * @param {boolean} correctReview - 是否来自一次正确回忆
   */
  addContext(sentence, articleId, correctReview = false) {
    const ctx = {
      sentence,
      articleId,
      ts: Date.now(),
      correctReview
    };
    this.contexts.push(ctx);
    // FIFO 淘汰最早的
    while (this.contexts.length > SM2_CONFIG.CONTEXTS_MAX) {
      this.contexts.shift();
    }
  }

  /**
   * 获取优先展示的语境（最近一次 correctReview 标记的原句）
   * 无 correctReview 则返回最新一条
   */
  getPreferredContext() {
    if (this.contexts.length === 0) return null;
    // 优先 correctReview
    for (let i = this.contexts.length - 1; i >= 0; i--) {
      if (this.contexts[i].correctReview) return this.contexts[i];
    }
    // 回退到最新一条
    return this.contexts[this.contexts.length - 1];
  }

  /**
   * 根据 recallStreak 更新掌握阶段
   */
  updateStage() {
    if (this.recallStreak >= SM2_CONFIG.STAGE_THRESHOLDS.mastered.min) {
      this.stage = STAGE.MASTERED;
    } else if (this.recallStreak >= SM2_CONFIG.STAGE_THRESHOLDS.recall.min) {
      this.stage = STAGE.RECALL;
    } else if (this.recallStreak >= SM2_CONFIG.STAGE_THRESHOLDS.recognize.min) {
      this.stage = STAGE.RECOGNIZE;
    } else {
      this.stage = STAGE.NEW;
    }
  }

  /**
   * 检查是否满足毕业条件
   * 间隔 ≥ 90天 + 连续正确 ≥ 5次
   */
  checkGraduation() {
    if (this.graduated) return true;
    if (this.sm2.interval >= SM2_CONFIG.GRADUATION_INTERVAL &&
        this.consecutiveCorrect >= SM2_CONFIG.GRADUATION_STREAK) {
      this.graduated = true;
    }
    return this.graduated;
  }

  /**
   * 检查是否应标记为困难词
   * 连续失败 ≥ 10次
   */
  checkHardWord() {
    if (this.consecutiveFailures >= SM2_CONFIG.HARD_WORD_FAIL_THRESHOLD) {
      this.isHardWord = true;
    }
    return this.isHardWord;
  }

  /**
   * 序列化为普通对象（用于持久化）
   */
  toJSON() {
    return {
      id: this.id,
      word: this.word,
      pos: this.pos,
      translation: this.translation,
      phonetic: this.phonetic,
      freqRank: this.freqRank,
      isPhrase: this.isPhrase,
      meanings: this.meanings,
      sm2: this.sm2,
      queue: this.queue,
      stage: this.stage,
      recallStreak: this.recallStreak,
      forgetCount: this.forgetCount,
      metCount: this.metCount,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveCorrect: this.consecutiveCorrect,
      isHardWord: this.isHardWord,
      graduated: this.graduated,
      contexts: this.contexts
    };
  }

  /**
   * 从普通对象恢复
   */
  static fromJSON(obj) {
    const card = new WordCard(obj);
    Object.assign(card, obj);
    return card;
  }
}

// ============================================================
// Article - 文章模型
// ============================================================
export class Article {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {string} opts.title
   * @param {string} opts.content - 原文
   * @param {string} [opts.domain] - 领域分类
   * @param {number} [opts.track] - 学习轨道 1-4
   * @param {number} [opts.langDifficulty] - 语言难度评分
   * @param {number} [opts.domainDifficulty] - 领域难度评分
   * @param {Array} [opts.sentences] - 预分割的句子数组
   * @param {Array} [opts.terms] - 术语列表 [{word, freqRank, depth}]
   * @param {Array} [opts.phrases] - 短语列表 [{phrase, type, meanings}]
   * @param {number} [opts.newWordCount] - 新词数量
   * @param {Array} [opts.tags] - 标签
   */
  constructor(opts = {}) {
    this.id = opts.id || generateId('article');
    this.title = opts.title || '';
    this.content = opts.content || '';
    this.domain = opts.domain || 'general';
    this.track = opts.track || TRACK.GENERAL;
    this.langDifficulty = opts.langDifficulty || 0;
    this.domainDifficulty = opts.domainDifficulty || 0;
    this.sentences = opts.sentences || [];   // 预分割句子（可选，否则运行时分割）
    this.terms = opts.terms || [];           // 术语标注
    this.phrases = opts.phrases || [];       // 短语标注
    this.newWordCount = opts.newWordCount || 0;
    this.tags = opts.tags || [];
    this.wordCount = opts.wordCount || (opts.content ? opts.content.split(/\s+/).length : 0);
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(obj) {
    return new Article(obj);
  }
}

// ============================================================
// User - 用户模型
// ============================================================
export class User {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {string} [opts.level] - 水平评估 A1/A2/B1/B2/C1-C2
   * @param {number} [opts.currentTrack] - 当前轨道 1-4
   * @param {string} [opts.domain] - 当前学习领域
   * @param {number} [opts.learnedWordCount] - 已学词数
   * @param {Object} [opts.queueCounts] - 各队列词数
   * @param {Object} [opts.stageProgress] - 各阶段词数
   */
  constructor(opts = {}) {
    this.id = opts.id || generateId('user');
    this.level = opts.level || 'A1';
    this.currentTrack = opts.currentTrack || TRACK.GENERAL;
    this.domain = opts.domain || 'general';
    this.learnedWordCount = opts.learnedWordCount || 0;
    this.queueCounts = opts.queueCounts || {
      not_known: 0,
      remembered_wrong: 0,
      learned: 0
    };
    this.stageProgress = opts.stageProgress || {
      new: 0,
      recognize: 0,
      recall: 0,
      mastered: 0
    };
    // 进阶判定数据
    this.correctRate7d = opts.correctRate7d || 0; // 近7天正确率
    this.trackProgress = opts.trackProgress || {}; // 各轨道进度
  }

  /**
   * 获取该用户水平对应的新词配额
   */
  getNewWordQuota() {
    const range = NEW_WORD_QUOTA[this.level] || NEW_WORD_QUOTA.A1;
    return { min: range[0], max: range[1] };
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(obj) {
    return new User(obj);
  }
}

// ============================================================
// 辅助：ID 生成器
// ============================================================
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// 默认导出汇总
// ============================================================
export default {
  SM2_CONFIG,
  QUEUE,
  QUEUE_PRIORITY,
  STAGE,
  STAGE_QUESTION_TYPE,
  TRACK,
  TRACK_CONFIG,
  NEW_WORD_QUOTA,
  MAX_SAME_ARTICLE_ROUNDS,
  WordCard,
  Article,
  User
};
