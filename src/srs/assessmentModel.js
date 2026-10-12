/**
 * 双层评估模型 + 按掌握阶段轮换题型
 *
 * V2.1 关键修正：认识后**不显示词义**，先自评（学会了/记错了），
 * 选完后才显示词义供对照。避免"看到答案才想起"的假阳性。
 *
 * 4种题型按掌握阶段轮换：
 *   new (recallStreak=0)       → 再认题：给词，4选1选意思
 *   recognize (recallStreak=1-2) → 回忆题：给词，不给选项，自判
 *   recall (recallStreak=3-4)    → 填空题：原句挖空，回忆或选词
 *   mastered (recallStreak=5+)   → 搭配题：给词，选正确搭配
 *
 * 设计要点：从"给答案选"到"自己回忆"再到"应用语境"，
 * 认知负荷逐步升高，与测试效应一致
 */

import { STAGE, STAGE_QUESTION_TYPE, QUEUE } from '../data/models.js';
import { review as sm2Review } from './simplifiedSM2.js';

// ============================================================
// 题型枚举
// ============================================================
export const QUESTION_TYPE = {
  RECOGNITION: 'recognition',  // 再认题
  RECALL: 'recall',            // 回忆题
  BLANK: 'blank',              // 填空题
  COLLOCATION: 'collocation'   // 搭配题
};

// ============================================================
// 1. 双层判断流程
// ============================================================

/**
 * 评估会话状态机
 * 管理双层判断的状态流转
 */
export class AssessmentSession {
  /**
   * @param {WordCard} card - 待评估的卡片
   */
  constructor(card) {
    this.card = card;
    this.phase = 'layer1';     // layer1 → layer2 → result
    this.showTranslation = false; // 是否已显示词义
    this.grade = null;          // 最终评分 not_known/remembered_wrong/learned
    this.questionType = this._determineQuestionType();
  }

  /**
   * 根据掌握阶段确定题型
   */
  _determineQuestionType() {
    return STAGE_QUESTION_TYPE[this.card.stage] || QUESTION_TYPE.RECOGNITION;
  }

  /**
   * 第一层：用户选择"认识"或"不认识"
   *
   * 认识 → 不显示词义，进入第二层自评
   * 不认识 → 直接显示词义，只给"学会了"按钮
   *
   * @param {boolean} known - 用户是否认识
   * @returns {Object} 流转结果
   */
  layer1(known) {
    if (this.phase !== 'layer1') {
      throw new Error('当前不在第一层判断阶段');
    }

    if (known) {
      // 认识 → 不显示词义，进入第二层自评
      this.phase = 'layer2';
      this.showTranslation = false;
      return {
        phase: 'layer2',
        showTranslation: false,
        buttons: ['learned', 'remembered_wrong'],
        prompt: '请自评：意思完全正确，还是记错了？'
      };
    } else {
      // 不认识 → 直接显示词义，只给"学会了"按钮
      this.showTranslation = true;
      this.phase = 'result_pending';
      this.grade = 'not_known';
      return {
        phase: 'result_pending',
        showTranslation: true,
        buttons: ['learned'],
        prompt: '查看词义后，确认是否学会了'
      };
    }
  }

  /**
   * 第二层：用户自评"学会了"或"记错了"
   * 选完后显示词义供对照
   *
   * @param {string} choice - 'learned' | 'remembered_wrong'
   * @returns {Object} 流转结果
   */
  layer2(choice) {
    if (this.phase !== 'layer2') {
      throw new Error('当前不在第二层判断阶段');
    }

    // 选完后才显示词义，供对照确认
    this.showTranslation = true;
    this.grade = choice; // 'learned' 或 'remembered_wrong'
    this.phase = 'result_pending';

    return {
      phase: 'result_pending',
      showTranslation: true,
      buttons: [],
      prompt: '请对照词义确认',
      pendingGrade: choice
    };
  }

  /**
   * result_pending 阶段：用户确认（学会了/查看完毕）
   * 不认识→学会了 / 第二层学会了 / 第二层记错了
   *
   * @param {string} [confirmGrade] - 确认的评分（不认识路径下用户可能改为"学会了"）
   * @returns {Object} 最终评估结果
   */
  confirm(confirmGrade = null) {
    if (this.phase !== 'result_pending') {
      throw new Error('当前不在确认阶段');
    }

    // 不认识路径：用户看完词义后选"学会了"
    if (this.grade === 'not_known' && confirmGrade === 'learned') {
      this.grade = 'learned';
    }

    // 第二层路径：grade 已在 layer2 确定
    this.phase = 'completed';

    return {
      phase: 'completed',
      grade: this.grade,
      showTranslation: true
    };
  }

  /**
   * 获取当前会话状态（用于 UI 渲染）
   */
  getState() {
    return {
      card: this.card,
      phase: this.phase,
      showTranslation: this.showTranslation,
      grade: this.grade,
      questionType: this.questionType,
      stage: this.card.stage
    };
  }
}

// ============================================================
// 2. 题型生成器
// ============================================================

/**
 * 再认题（4选1）
 * 给词，4个选项选意思
 *
 * @param {WordCard} card - 目标词卡片
 * @param {Array<WordCard>} distractorPool - 干扰项词池
 * @returns {Object} 题目 { type, word, options[], correctIndex, context }
 */
export function generateRecognition(card, distractorPool = []) {
  const correct = card.translation || card.meanings?.[0]?.meaning || '';

  // 从干扰项池中取3个干扰项的翻译
  const distractors = [];
  const pool = [...distractorPool].filter(c => c.id !== card.id && c.translation);
  // 随机打乱
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const c of pool) {
    if (distractors.length >= 3) break;
    const trans = c.translation || c.meanings?.[0]?.meaning;
    if (trans && trans !== correct && !distractors.includes(trans)) {
      distractors.push(trans);
    }
  }

  // 不足3个时用占位（V1简化，实际应有足够词库）
  while (distractors.length < 3) {
    distractors.push(`[干扰项${distractors.length + 1}]`);
  }

  const options = [...distractors, correct];
  // 打乱选项顺序
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return {
    type: QUESTION_TYPE.RECOGNITION,
    word: card.word,
    phonetic: card.phonetic,
    options,
    correctIndex: options.indexOf(correct),
    context: card.getPreferredContext()
  };
}

/**
 * 回忆题（自判）
 * 给词，不给选项，用户自判认识与否
 * 走双层判断流程
 *
 * @param {WordCard} card
 * @returns {Object} 题目
 */
export function generateRecall(card) {
  return {
    type: QUESTION_TYPE.RECALL,
    word: card.word,
    phonetic: card.phonetic,
    translation: null, // 不显示，等用户自评后才显示
    context: card.getPreferredContext(),
    // 走双层判断：认识→学会了/记错了；不认识→显示词义→学会了
    assessmentFlow: 'dual_layer'
  };
}

/**
 * 填空题（原句挖空）
 * 从语境中取原句，挖空目标词
 *
 * @param {WordCard} card
 * @param {Array<WordCard>} distractorPool - 选词选项的干扰项
 * @returns {Object} 题目
 */
export function generateBlank(card, distractorPool = []) {
  const ctx = card.getPreferredContext();
  if (!ctx || !ctx.sentence) {
    // 无语境则降级为回忆题
    return generateRecall(card);
  }

  const sentence = ctx.sentence;
  const target = card.word;

  // 挖空目标词（不区分大小写匹配）
  const blanked = sentence.replace(
    new RegExp(`\\b${escapeRegex(target)}\\b`, 'i'),
    '_____'
  );

  // 生成选项（选词填空模式）
  const correct = target;
  const distractors = [];
  const pool = [...distractorPool].filter(c => c.id !== card.id && c.word !== target);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const c of pool) {
    if (distractors.length >= 3) break;
    if (c.word && c.word !== target && !distractors.includes(c.word)) {
      distractors.push(c.word);
    }
  }
  while (distractors.length < 3) {
    distractors.push(`[选项${distractors.length + 1}]`);
  }

  const options = [...distractors, correct];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return {
    type: QUESTION_TYPE.BLANK,
    word: card.word,
    sentence: blanked,
    originalSentence: sentence,
    options,
    correctIndex: options.indexOf(correct),
    context: ctx
  };
}

/**
 * 搭配题
 * 给词，选正确搭配
 *
 * @param {WordCard} card
 * @param {Array} collocations - 该词的搭配列表 [{ collocation, correct: bool }]
 * @returns {Object} 题目
 */
export function generateCollocation(card, collocations = []) {
  if (!collocations || collocations.length === 0) {
    // 无搭配数据则降级为填空题
    return generateBlank(card);
  }

  const correctCollocations = collocations.filter(c => c.correct);
  const wrongCollocations = collocations.filter(c => !c.correct);

  if (correctCollocations.length === 0) {
    return generateBlank(card);
  }

  const target = correctCollocations[0];
  const distractors = wrongCollocations.slice(0, 3);

  // 不足3个干扰项时补充
  while (distractors.length < 3) {
    distractors.push({ collocation: `[干扰搭配${distractors.length + 1}]`, correct: false });
  }

  const options = [...distractors.map(d => d.collocation), target.collocation];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return {
    type: QUESTION_TYPE.COLLOCATION,
    word: card.word,
    prompt: '选择正确的搭配',
    options,
    correctIndex: options.indexOf(target.collocation),
    context: card.getPreferredContext()
  };
}

// ============================================================
// 3. 题型调度
// ============================================================

/**
 * 根据卡片掌握阶段生成对应题型
 *
 * @param {WordCard} card
 * @param {Object} pools - { distractorPool, collocations }
 * @returns {Object} 题目
 */
export function generateQuestion(card, pools = {}) {
  const type = STAGE_QUESTION_TYPE[card.stage] || QUESTION_TYPE.RECOGNITION;

  switch (type) {
    case QUESTION_TYPE.RECOGNITION:
      return generateRecognition(card, pools.distractorPool);
    case QUESTION_TYPE.RECALL:
      return generateRecall(card);
    case QUESTION_TYPE.BLANK:
      return generateBlank(card, pools.distractorPool);
    case QUESTION_TYPE.COLLOCATION:
      return generateCollocation(card, pools.collocations);
    default:
      return generateRecognition(card, pools.distractorPool);
  }
}

// ============================================================
// 4. 评分处理（将题型结果映射到 SM-2 评分）
// ============================================================

/**
 * 处理再认题/填空题/搭配题的结果
 * 选对 → learned / 选错 → remembered_wrong
 *
 * @param {WordCard} card
 * @param {boolean} correct - 是否选对
 * @param {Object} [context] - 语境
 * @returns {Object} SM-2 更新结果
 */
export function handleObjectiveResult(card, correct, context = null) {
  const grade = correct ? 'learned' : 'remembered_wrong';
  return sm2Review(card, grade, context);
}

/**
 * 处理回忆题的双层判断结果
 * 走 AssessmentSession 流程后，将最终 grade 传给 SM-2
 *
 * @param {WordCard} card
 * @param {string} grade - 'learned' | 'remembered_wrong' | 'not_known'
 * @param {Object} [context]
 * @returns {Object} SM-2 更新结果
 */
export function handleDualLayerResult(card, grade, context = null) {
  return sm2Review(card, grade, context);
}

// ============================================================
// 辅助
// ============================================================

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 默认导出
// ============================================================
export default {
  QUESTION_TYPE,
  AssessmentSession,
  generateRecognition,
  generateRecall,
  generateBlank,
  generateCollocation,
  generateQuestion,
  handleObjectiveResult,
  handleDualLayerResult
};
