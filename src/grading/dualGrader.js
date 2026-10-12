/**
 * 双维度分级器 (V2 核心)
 *
 * 职责：
 *   1. 语言难度 Language Difficulty = 0.50×词汇难度 + 0.35×句子复杂度 + 0.15×文章长度
 *      词汇难度 = 平均词分×0.7 + 生词(≥3分)占比×5×0.3
 *   2. 领域难度 Domain Difficulty = 0.35×术语占比 + 0.25×术语深度 + 0.25×领域特异性 + 0.15×概念密度
 *   3. 四阶段学习轨道分配（通用基础/领域入门/领域专业/真实材料）
 *   4. 动态新词配额（按用户水平 A1→5-8 / A2→6-9 / B1→10-15 / B2→12-17 / C1-C2→15-20）
 *
 * 设计原则：算法复杂，界面简单
 * 一篇文章可能语言简单但专业性强（入门级技术文档），
 * 也可能语言复杂但领域通用（文学作品）。双维度拆开避免误判。
 */

import {
  TRACK,
  TRACK_CONFIG,
  NEW_WORD_QUOTA
} from '../data/models.js';

import {
  wordScoreFromRank,
  calcAverageWordScore,
  calcNewWordRatio,
  calcWordDifficulty,
  calcArticleSentenceComplexity,
  identifyTerms,
  calcTermDepth
} from '../data/dataDependencies.js';

// ============================================================
// 权重配置（集中管理，便于调参）
// ============================================================
export const LANG_WEIGHTS = {
  WORD: 0.50,        // 词汇难度
  SENTENCE: 0.35,   // 句子复杂度
  LENGTH: 0.15       // 文章长度
};

export const DOMAIN_WEIGHTS = {
  TERM_RATIO: 0.35,    // 术语占比
  TERM_DEPTH: 0.25,   // 术语深度
  DOMAIN_SPEC: 0.25,   // 领域特异性
  CONCEPT_DENSITY: 0.15 // 概念密度
};

// 领域 → 领域特异性基础分（0-5）
// 用于在词频信号之外补充领域先验：medical/science/law 天然领域强
export const DOMAIN_SPECIFICITY_BASE = {
  general: 0.5,
  culture: 1.0,
  business: 2.0,
  tech: 3.0,
  science: 3.5,
  medical: 4.0,
  law: 4.5,
  finance: 3.5
};

// 长度归一化基准：1000词为满分（5.0）
const LENGTH_NORMALIZER = 1000;

// ============================================================
// 子指标 1：文章长度评分（0-5）
// ============================================================
/**
 * 文章长度 → 0-5 难度分
 * <300词 → 1.5以下（短文，认知负荷低）
 * 300-600 → 1.5-3.0（中等）
 * 600-1000 → 3.0-5.0（长文）
 * >1000 → 5.0（封顶）
 *
 * @param {number} wordCount
 * @returns {number} 0-5
 */
export function calcLengthScore(wordCount) {
  if (!wordCount || wordCount <= 0) return 0;
  return Math.min(wordCount / LENGTH_NORMALIZER, 1) * 5;
}

// ============================================================
// 子指标 2：术语占比评分（0-5）
// ============================================================
/**
 * 术语占比 → 0-5
 * 术语占比 = 术语数 / 总词数，再×5映射到0-5
 *
 * 经验阈值：
 *   占比<2% → 0.5分以下（通用文）
 *   占比2-5% → 0.5-1.5（领域入门）
 *   占比5-10% → 1.5-3.0（领域专业）
 *   占比>10% → 3.0+（真实材料）
 *
 * @param {Array} terms - 术语列表
 * @param {number} wordCount - 总词数
 * @returns {number} 0-5
 */
export function calcTermRatioScore(terms, wordCount) {
  if (!terms || terms.length === 0 || !wordCount || wordCount <= 0) return 0;
  const ratio = terms.length / wordCount;
  return Math.min(ratio * 5, 5);
}

// ============================================================
// 子指标 3：术语深度评分（0-5）
// ============================================================
/**
 * 术语深度 → 0-5
 * 取所有术语 depth 的平均；若 terms 未带 depth 字段，
 * 用 freqRank 通过 calcTermDepth() 兜底计算
 *
 * @param {Array} terms - [{word, freqRank, depth?}]
 * @returns {number} 0-5
 */
export function calcTermDepthScore(terms) {
  if (!terms || terms.length === 0) return 0;
  const depths = terms.map(t => {
    if (typeof t.depth === 'number') return t.depth;
    return calcTermDepth(t.freqRank);
  });
  return depths.reduce((s, d) => s + d, 0) / depths.length;
}

// ============================================================
// 子指标 4：领域特异性评分（0-5）
// ============================================================
/**
 * 领域特异性 → 0-5
 *
 * 双信号融合：
 *   1. 领域先验（DOMAIN_SPECIFICITY_BASE[domain]）：领域本身的专业强度
 *   2. 非通用词占比（freqRank>5000 的词占比）：实证信号
 *
 * 公式：specificity = 0.5 × domainBase + 0.5 × nonGeneralRatio×5
 * 领域先验和实证信号各占一半，避免单一信号失真
 *
 * @param {string} domain - 领域标签
 * @param {Array} words - [{word, freqRank}]
 * @returns {number} 0-5
 */
export function calcDomainSpecificity(domain, words) {
  const domainBase = DOMAIN_SPECIFICITY_BASE[domain] != null
    ? DOMAIN_SPECIFICITY_BASE[domain]
    : 1.5; // 未知领域给中间偏低分

  if (!words || words.length === 0) {
    return domainBase; // 无词列表时退化为纯领域先验
  }

  const nonGeneralCount = words.filter(
    w => w.freqRank == null || w.freqRank > 5000
  ).length;
  const nonGeneralRatio = nonGeneralCount / words.length;

  return Math.min(
    0.5 * domainBase + 0.5 * (nonGeneralRatio * 5),
    5
  );
}

// ============================================================
// 子指标 5：概念密度评分（0-5）
// ============================================================
/**
 * 概念密度 → 0-5
 *
 * 概念密度 = 每句平均术语数，越高说明信息越密集
 *   <0.5 术语/句 → 1.0以下（叙述性，概念稀疏）
 *   0.5-1.5 术语/句 → 1.0-3.0（一般说明文）
 *   >1.5 术语/句 → 3.0-5.0（高密度技术文档）
 *
 * @param {Array} terms - 术语列表
 * @param {Array} sentences - 句子数组
 * @returns {number} 0-5
 */
export function calcConceptDensity(terms, sentences) {
  if (!terms || terms.length === 0) return 0;
  if (!sentences || sentences.length === 0) return 0;

  const termsPerSentence = terms.length / sentences.length;
  return Math.min(termsPerSentence * 3, 5); // 1.67术语/句即满负荷
}

// ============================================================
// 主算法 1：语言难度评分
// ============================================================
/**
 * 计算语言难度（0-5）
 *
 * 公式：0.50×词汇难度 + 0.35×句子复杂度 + 0.15×文章长度
 * 词汇难度 = 平均词分×0.7 + 生词(≥3分)占比×5×0.3
 *
 * @param {Object} params
 * @param {Array} [params.words] - [{word, freqRank}]，与 content 二选一
 * @param {string} [params.content] - 原文（words 缺失时降级分词）
 * @param {Array} [params.sentences] - 句子数组（缺失时降级分句）
 * @param {number} [params.wordCount] - 词数（缺失时由 content 估算）
 * @param {Object} [params.freqRanks] - 词频表（content 分词时查表用）
 * @returns {{score:number, breakdown:Object}} 0-5 分 + 各子指标明细
 */
export function gradeLanguageDifficulty({
  words,
  content,
  sentences,
  wordCount,
  freqRanks
}) {
  // ---- 1. 准备 words ----
  let wordList = words;
  if (!wordList) {
    wordList = extractWordsFromContent(content, freqRanks);
  }
  const wc = wordCount || wordList.length;

  // ---- 2. 准备 sentences ----
  let sentenceList = sentences;
  if (!sentenceList || sentenceList.length === 0) {
    sentenceList = splitSentences(content);
  }

  // ---- 3. 子指标：词汇难度（已封装在 dataDependencies）----
  const wordDifficulty = calcWordDifficulty(wordList);

  // ---- 4. 子指标：句子复杂度 ----
  const sentenceComplexity = calcArticleSentenceComplexity(sentenceList);

  // ---- 5. 子指标：文章长度 ----
  const lengthScore = calcLengthScore(wc);

  // ---- 6. 加权汇总 ----
  const score = clamp5(
    LANG_WEIGHTS.WORD * wordDifficulty +
    LANG_WEIGHTS.SENTENCE * sentenceComplexity +
    LANG_WEIGHTS.LENGTH * lengthScore
  );

  return {
    score,
    breakdown: {
      wordDifficulty,
      sentenceComplexity,
      lengthScore,
      weights: { ...LANG_WEIGHTS }
    }
  };
}

// ============================================================
// 主算法 2：领域难度评分
// ============================================================
/**
 * 计算领域难度（0-5）
 *
 * 公式：0.35×术语占比 + 0.25×术语深度 + 0.25×领域特异性 + 0.15×概念密度
 * 非通用词（freqRank>5000）占比越高，领域特异性越强
 *
 * @param {Object} params
 * @param {Array} [params.terms] - 预标注术语 [{word, freqRank, depth?}]
 * @param {Array} [params.words] - [{word, freqRank}]（terms 缺失时识别用）
 * @param {string} [params.domain] - 领域标签
 * @param {Array} [params.sentences] - 句子数组（概念密度用）
 * @param {number} [params.wordCount] - 词数
 * @param {string} [params.content] - 原文（兜底分词）
 * @param {Object} [params.freqRanks] - 词频表
 * @returns {{score:number, breakdown:Object}} 0-5 分 + 各子指标明细
 */
export function gradeDomainDifficulty({
  terms,
  words,
  domain = 'general',
  sentences,
  wordCount,
  content,
  freqRanks
}) {
  // ---- 1. 准备 words ----
  let wordList = words;
  if (!wordList) {
    wordList = extractWordsFromContent(content, freqRanks);
  }
  const wc = wordCount || wordList.length;

  // ---- 2. 准备 terms ----
  let termList = terms;
  if (!termList || termList.length === 0) {
    termList = identifyTerms(wordList);
  }

  // ---- 3. 准备 sentences ----
  let sentenceList = sentences;
  if (!sentenceList || sentenceList.length === 0) {
    sentenceList = splitSentences(content);
  }

  // ---- 4. 子指标 ----
  const termRatioScore = calcTermRatioScore(termList, wc);
  const termDepthScore = calcTermDepthScore(termList);
  const domainSpecScore = calcDomainSpecificity(domain, wordList);
  const conceptDensityScore = calcConceptDensity(termList, sentenceList);

  // ---- 5. 加权汇总 ----
  const score = clamp5(
    DOMAIN_WEIGHTS.TERM_RATIO * termRatioScore +
    DOMAIN_WEIGHTS.TERM_DEPTH * termDepthScore +
    DOMAIN_WEIGHTS.DOMAIN_SPEC * domainSpecScore +
    DOMAIN_WEIGHTS.CONCEPT_DENSITY * conceptDensityScore
  );

  return {
    score,
    breakdown: {
      termRatioScore,
      termDepthScore,
      domainSpecScore,
      conceptDensityScore,
      weights: { ...DOMAIN_WEIGHTS },
      termCount: termList.length,
      wordCount: wc
    }
  };
}

// ============================================================
// 主算法 3：综合评分（语言 + 领域双维度）
// ============================================================
/**
 * 对一篇文章进行双维度评分
 *
 * @param {Object} article - Article 或符合 ARTICLE_SCHEMA 的对象
 * @param {Object} [options]
 * @param {Array} [options.words] - 预提取的 [{word, freqRank}]
 * @param {Object} [options.freqRanks] - 词频表
 * @param {boolean} [options.forceRecompute] - 强制重算（即使 article 已有预标注分数）
 * @returns {{langDifficulty:number, domainDifficulty:number, track:number, breakdown:Object}}
 */
export function gradeArticle(article, options = {}) {
  const { words, freqRanks, forceRecompute } = options;

  // 已有预标注且不强制重算 → 直接用
  if (!forceRecompute &&
      article.langDifficulty > 0 &&
      article.domainDifficulty > 0) {
    const track = assignTrack(article.domainDifficulty, article);
    return {
      langDifficulty: article.langDifficulty,
      domainDifficulty: article.domainDifficulty,
      track,
      breakdown: { precomputed: true }
    };
  }

  // 准备通用参数
  const commonParams = {
    words: words || null,
    content: article.content,
    sentences: article.sentences,
    wordCount: article.wordCount,
    freqRanks: freqRanks || null
  };

  // 语言难度
  const langResult = gradeLanguageDifficulty(commonParams);

  // 领域难度
  const domainResult = gradeDomainDifficulty({
    ...commonParams,
    terms: article.terms,
    domain: article.domain
  });

  // 轨道分配
  const track = assignTrack(domainResult.score, article);

  return {
    langDifficulty: langResult.score,
    domainDifficulty: domainResult.score,
    track,
    breakdown: {
      language: langResult.breakdown,
      domain: domainResult.breakdown
    }
  };
}

// ============================================================
// 主算法 4：四阶段学习轨道分配
// ============================================================
/**
 * 根据领域难度 + 文章特征分配学习轨道
 *
 * 领域难度数值范围（V2.1）：
 *   轨道1 通用基础  → 0-0.5   (A1-A2)
 *   轨道2 领域入门  → 0.5-2.0 (A2-B1)
 *   轨道3 领域专业  → 2.0-4.0 (B1-B2)
 *   轨道4 真实材料  → 3.5-5.0 (B2-C2)
 *
 * 注意：轨道3与轨道4在 3.5-4.0 有重叠区间。
 * 区分依据是"是否未改写原文"：
 *   - article.tags 含 'authentic' 或 article.isAuthentic === true → 轨道4
 *   - 否则 ≥3.5 → 轨道4（默认按真实材料处理，因难度已达真实材料门槛）
 *
 * @param {number} domainDifficulty - 领域难度 0-5
 * @param {Object} [article] - 文章对象（用于查 authentic 标记）
 * @returns {number} 1-4 轨道编号
 */
export function assignTrack(domainDifficulty, article = {}) {
  // 显式 authentic 标记 → 强制轨道4
  const isAuthentic = article.isAuthentic === true ||
    (Array.isArray(article.tags) && article.tags.includes('authentic'));
  if (isAuthentic) return TRACK.AUTHENTIC;

  if (domainDifficulty < 0.5) return TRACK.GENERAL;
  if (domainDifficulty < 2.0) return TRACK.INTRO;
  if (domainDifficulty < 3.5) return TRACK.PROFESSIONAL;
  return TRACK.AUTHENTIC;
}

// ============================================================
// 主算法 5：动态新词配额
// ============================================================
/**
 * 按用户水平计算本篇新词配额
 *
 *   A1 → 5-8     认知负荷最低，保证完成率
 *   A2 → 6-9     略增，基础词汇已稳固
 *   B1 → 10-15   可吸收更多新词
 *   B2 → 12-17   高级阶段，接受挑战
 *   C1-C2 → 15-20 大量接触真实材料
 *
 * @param {string} level - 用户水平 A1/A2/B1/B2/C1-C2
 * @returns {{min:number, max:number}}
 */
export function calcNewWordQuota(level) {
  const range = NEW_WORD_QUOTA[level] || NEW_WORD_QUOTA.A1;
  return { min: range[0], max: range[1] };
}

/**
 * 根据文章轨道和用户水平综合给出实际新词上限
 * 取用户配额与轨道配额的交集（较小者），避免超载
 *
 * @param {string} userLevel
 * @param {number} track - 1-4
 * @returns {{min:number, max:number}}
 */
export function calcEffectiveNewWordQuota(userLevel, track) {
  const userQuota = calcNewWordQuota(userLevel);
  const trackCfg = TRACK_CONFIG[track] || TRACK_CONFIG[1];
  const trackQuota = { min: trackCfg.newWordRange[0], max: trackCfg.newWordRange[1] };

  // 取两者 max 的较小者作为下限，min 的较小者作为上限
  // 这样既尊重用户认知水平，又尊重轨道定位
  return {
    min: Math.min(userQuota.min, trackQuota.min),
    max: Math.min(userQuota.max, trackQuota.max)
  };
}

// ============================================================
// 主算法 6：文章与用户匹配度评估
// ============================================================
/**
 * 评估一篇文章是否适合当前用户
 *
 * 匹配条件：
 *   1. 轨道匹配：article.track == user.currentTrack 或可降级（如用户在T3，可读T2复习）
 *   2. 语言难度匹配：article.langDifficulty 在用户水平的可接受区间
 *   3. 新词配额：article.newWordCount 不超过 calcEffectiveNewWordQuota 上限
 *
 * @param {Object} article - 文章对象（需已评分）
 * @param {Object} user - User 对象
 * @returns {{fit:boolean, reason:string, suggestions:Object}}
 */
export function evaluateArticleFit(article, user) {
  const suggestions = {};

  // 1. 轨道匹配
  const articleTrack = article.track || TRACK.GENERAL;
  const userTrack = user.currentTrack || TRACK.GENERAL;

  if (articleTrack > userTrack) {
    // 文章轨道高于用户当前轨道 → 不匹配
    return {
      fit: false,
      reason: `文章轨道(${TRACK_CONFIG[articleTrack].name})高于用户当前轨道(${TRACK_CONFIG[userTrack].name})，需先在当前轨道积累`,
      suggestions: { recommendLowerTrack: true }
    };
  }

  // 2. 新词配额检查
  const quota = calcEffectiveNewWordQuota(user.level, articleTrack);
  if (article.newWordCount > quota.max) {
    return {
      fit: false,
      reason: `文章新词数(${article.newWordCount})超过用户配额上限(${quota.max})`,
      suggestions: { reduceNewWords: true, quota }
    };
  }

  // 3. 语言难度区间检查（粗匹配）
  // 用户水平对应的语言难度可接受区间（经验值）
  const levelLangRange = {
    A1: [0, 1.5],
    A2: [1.0, 2.5],
    B1: [2.0, 3.5],
    B2: [3.0, 4.5],
    'C1-C2': [3.5, 5.0]
  };
  const range = levelLangRange[user.level] || levelLangRange.A1;
  if (article.langDifficulty > range[1] + 0.5) {
    return {
      fit: false,
      reason: `文章语言难度(${article.langDifficulty.toFixed(2)})超出用户水平(${user.level})可接受上限`,
      suggestions: { recommendEasier: true, levelRange: range }
    };
  }

  return {
    fit: true,
    reason: '匹配',
    suggestions: { quota }
  };
}

// ============================================================
// 辅助：从原文提取词汇（降级方案）
// ============================================================
/**
 * 简单分词 + 词频查表
 *
 * V1 用正则分词（按空白和标点），V2 可接入 NLP 分词器
 * 大小写归一化，去除纯标点
 *
 * @param {string} content
 * @param {Object} [freqRanks] - { word: rank } 查找表
 * @returns {Array<{word, freqRank}>}
 */
export function extractWordsFromContent(content, freqRanks) {
  if (!content) return [];
  // 匹配英文字母词（含连字符），过滤纯数字和单字符
  const tokens = content.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) || [];
  const filtered = tokens.filter(t => t.length > 1);

  // 去重并查表
  const seen = new Set();
  const words = [];
  for (const t of filtered) {
    if (seen.has(t)) continue;
    seen.add(t);
    words.push({
      word: t,
      freqRank: freqRanks ? (freqRanks[t] || 99999) : null
    });
  }
  return words;
}

// ============================================================
// 辅助：句子分割（降级方案）
// ============================================================
// 缩写白名单：分句时这些缩写后的点不视为句子边界
const ABBREV_WHITELIST = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr',
  'st', 'ave', 'blvd',
  'e.g', 'i.e', 'etc', 'vs', 'cf',
  'u.s', 'u.k', 'e.u',
  'inc', 'ltd', 'co', 'corp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
]);

/**
 * 简化分句：按 . ! ? 分割，但跳过缩写后的点
 *
 * @param {string} content
 * @returns {Array<string>} 句子数组
 */
export function splitSentences(content) {
  if (!content) return [];

  // 先按句末标点切分
  const raw = content.split(/(?<=[.!?])\s+/);

  const sentences = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i].trim();
    if (!s) continue;

    // 检查是否以缩写结尾（如 "Mr." "e.g."）
    // 如果是，合并下一段
    const lastWord = s.toLowerCase().match(/([a-z.]+)$/);
    if (lastWord && ABBREV_WHITELIST.has(lastWord[1].replace(/\.$/, ''))) {
      // 标记合并到下一段
      raw[i + 1] = s + ' ' + (raw[i + 1] || '');
      continue;
    }
    sentences.push(s);
  }

  return sentences;
}

// ============================================================
// 辅助：数值钳制
// ============================================================
function clamp5(n) {
  return Math.max(0, Math.min(5, n));
}

// ============================================================
// 默认导出
// ============================================================
export default {
  // 权重
  LANG_WEIGHTS,
  DOMAIN_WEIGHTS,
  DOMAIN_SPECIFICITY_BASE,
  // 子指标
  calcLengthScore,
  calcTermRatioScore,
  calcTermDepthScore,
  calcDomainSpecificity,
  calcConceptDensity,
  // 主算法
  gradeLanguageDifficulty,
  gradeDomainDifficulty,
  gradeArticle,
  assignTrack,
  calcNewWordQuota,
  calcEffectiveNewWordQuota,
  evaluateArticleFit,
  // 辅助
  extractWordsFromContent,
  splitSentences
};
