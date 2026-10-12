/**
 * 数据依赖清单 + 文章标注方案 + V1最小数据集
 *
 * 整个系统隐含依赖大量外部数据，本文件统一管理：
 * 1. 词频→词分映射函数（分级算法的核心前置）
 * 2. 句子复杂度近似算法（语言难度的子指标）
 * 3. 术语识别策略（领域难度的子指标）
 * 4. 9项数据依赖清单
 * 5. 文章标注schema
 * 6. V1最小数据集定义
 */

import { SM2_CONFIG } from './models.js';

// ============================================================
// 1. 词频 → 词分映射函数
// ============================================================
/**
 * COCA词频排名 → 0-5 分的难度评分
 *
 * 映射逻辑：词频排名越靠前（越常见），难度分越低
 *   rank=1（最常见词）→ score≈0
 *   rank=500（常见词）→ score≈3.0
 *   rank=5000（不太常见）→ score≈5.0
 *   rank>5000（罕见/专业词）→ score=5.0（封顶）
 *
 * 公式：score = clamp(5 - log2(rank/500), 0, 5)
 *   rank=1:    5 - log2(1/500)   = 5 - log2(0.002) = 5 - (-8.97) = 13.97 → clamp → 5.0
 *   rank=500:  5 - log2(1)        = 5 - 0 = 5.0
 *   等等，这个公式在 rank=500 时就到5了，太快了。
 *
 * 修正公式：score = clamp(5 * log2(rank + 1) / log2(5001), 0, 5)
 *   rank=1:    5 * log2(2)/log2(5001)   = 5 * 1 / 12.29 = 0.41
 *   rank=100:  5 * log2(101)/log2(5001) = 5 * 6.66 / 12.29 = 2.71
 *   rank=500:  5 * log2(501)/log2(5001) = 5 * 8.97 / 12.29 = 3.65
 *   rank=1000: 5 * log2(1001)/log2(5001)= 5 * 9.97 / 12.29 = 4.06
 *   rank=5000: 5 * log2(5001)/log2(5001)= 5.0
 *   rank>5000: 5.0（封顶）
 *
 * 这个分布更合理：常见词分低，罕见词分高，中间平滑过渡
 *
 * @param {number} rank - COCA词频排名（1=最常见）
 * @returns {number} 0-5 的难度分
 */
export function wordScoreFromRank(rank) {
  if (rank == null || rank <= 0) return 2.5; // 未知词给中间分
  if (rank > 5000) return 5.0;              // 罕见/专业词封顶
  const score = 5 * Math.log2(rank + 1) / Math.log2(5001);
  return Math.max(0, Math.min(5, score));
}

/**
 * 批量计算文章的平均词分
 * @param {Array<{word, freqRank}>} words - 文章词汇列表
 * @returns {number} 平均词分（0-5）
 */
export function calcAverageWordScore(words) {
  if (!words || words.length === 0) return 0;
  const total = words.reduce((sum, w) => sum + wordScoreFromRank(w.freqRank), 0);
  return total / words.length;
}

/**
 * 计算生词占比（词分≥3分的词占比）
 * 用于词汇难度公式：词汇难度 = 平均词分×0.7 + 生词占比×5×0.3
 * @param {Array<{word, freqRank}>} words
 * @returns {number} 0-1 的比例
 */
export function calcNewWordRatio(words) {
  if (!words || words.length === 0) return 0;
  const newWords = words.filter(w => wordScoreFromRank(w.freqRank) >= 3);
  return newWords.length / words.length;
}

/**
 * 计算词汇难度（语言难度公式的子指标）
 * 词汇难度 = 平均词分 × 0.7 + 生词占比 × 5 × 0.3
 * @param {Array<{word, freqRank}>} words
 * @returns {number} 0-5 的词汇难度分
 */
export function calcWordDifficulty(words) {
  const avgScore = calcAverageWordScore(words);
  const newRatio = calcNewWordRatio(words);
  return avgScore * 0.7 + newRatio * 5 * 0.3;
}

// ============================================================
// 2. 句子复杂度近似算法（V1简化版）
// ============================================================
/**
 * V1 句子复杂度近似计算
 *
 * 完整版应包含从句数、依赖树深度等 NLP 指标。
 * V1 简化用：句长（词数）+ 平均词长 + 从句标记近似
 *
 * 公式：complexity = clamp(句子词数/20 * 0.6 + 平均词长/8 * 0.4, 0, 5)
 *   - 20词的句子约满负荷，40词+ 封顶
 *   - 平均8字母/词为满分
 *
 * @param {string} sentence - 单句
 * @returns {number} 0-5 的复杂度分
 */
export function calcSentenceComplexity(sentence) {
  if (!sentence) return 0;
  const words = sentence.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  const wordCount = words.length;
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / wordCount;

  // 从句标记近似：逗号数/句子数作为从句密度近似
  const clauseMarkers = (sentence.match(/,/g) || []).length;
  const clauseFactor = Math.min(clauseMarkers / 3, 1); // 3个逗号满负荷

  const complexity =
    Math.min(wordCount / 20, 1) * 0.5 +
    Math.min(avgWordLen / 8, 1) * 0.3 +
    clauseFactor * 0.2;

  return Math.max(0, Math.min(5, complexity * 5));
}

/**
 * 计算文章整体句子复杂度（所有句子的平均）
 * @param {Array<string>} sentences
 * @returns {number} 0-5
 */
export function calcArticleSentenceComplexity(sentences) {
  if (!sentences || sentences.length === 0) return 0;
  const total = sentences.reduce((sum, s) => sum + calcSentenceComplexity(s), 0);
  return total / sentences.length;
}

// ============================================================
// 3. 术语识别策略（V1简化版）
// ============================================================
/**
 * V1 术语识别近似
 *
 * 策略：词频排名 > 5000 的词视为术语/非通用词
 * （V2 可接入专业术语词典提升准确性）
 *
 * @param {Array<{word, freqRank}>} words
 * @returns {Array} 术语列表 [{word, freqRank, depth}]
 */
export function identifyTerms(words) {
  return words
    .filter(w => w.freqRank == null || w.freqRank > 5000)
    .map(w => ({
      word: w.word,
      freqRank: w.freqRank || 99999,
      depth: w.freqRank ? Math.min((w.freqRank - 5000) / 10000, 1) * 5 : 5
    }));
}

/**
 * 术语深度近似计算
 * 词频越低（排名越大），术语深度越高
 * @param {number} freqRank
 * @returns {number} 0-5
 */
export function calcTermDepth(freqRank) {
  if (freqRank == null) return 5;
  if (freqRank <= 5000) return 0;
  return Math.min((freqRank - 5000) / 10000, 1) * 5;
}

// ============================================================
// 4. 数据依赖清单（9项）
// ============================================================
export const DATA_DEPENDENCIES = {
  // --- V1 必需（最小数据集） ---
  frequencyRanks: {
    name: 'COCA词频排名表',
    purpose: '词分计算、术语识别、领域特异性',
    v1Required: true,
    source: 'COCA语料库词频统计',
    filePath: 'src/data/frequencyRanks.json',
    format: '{ "word": rank_number, ... }',
    fallback: '未知词默认rank=99999'
  },

  chineseDict: {
    name: '中文翻译词典',
    purpose: '每个词/短语的中文释义',
    v1Required: true,
    source: '预置高频词库(5000词) + 词典API(有道/金山)兜底',
    filePath: 'src/data/chineseDict.json',
    format: '{ "word": { "translation": "...", "pos": "n.", "phonetic": "..." } }',
    fallback: 'API查询失败时显示"暂无释义"'
  },

  articleLibrary: {
    name: '文章库',
    purpose: '学习内容载体',
    v1Required: true,
    source: '人工采集 + 标注50-100篇（分四轨道）',
    filePath: 'src/data/articles/',
    format: '每篇JSON，符合ARTICLE_SCHEMA',
    fallback: '无'
  },

  sentenceComplexity: {
    name: '句子复杂度模型',
    purpose: '语言难度的子指标',
    v1Required: true,
    source: '内置近似算法（句长+词长+逗号密度）',
    filePath: '本文件 calcSentenceComplexity()',
    format: '函数，输入句子输出0-5分',
    fallback: '降级为纯句长近似'
  },

  // --- V2 可推迟 ---
  termDictionary: {
    name: '术语词典/领域分类',
    purpose: '领域难度、术语识别精确化',
    v1Required: false,
    source: 'V2接入专业术语词典',
    v1Fallback: '词频>5000近似识别'
  },

  collocationCorpus: {
    name: '搭配语料库',
    purpose: '搭配题、短语识别',
    v1Required: false,
    source: 'V2接入COCA搭配数据',
    v1Fallback: 'V1不做搭配题(stage<mastered时不会触发)'
  },

  phraseDictionary: {
    name: '短语词典',
    purpose: '短语识别高亮',
    v1Required: true,
    source: '预置高频500短语表',
    filePath: 'src/data/phraseDict.json',
    format: '[{ "phrase": "look up", "type": "phrasal_verb", "meanings": [...] }]',
    fallback: '无匹配则不高亮'
  },

  nlpTokenizer: {
    name: 'NLP分词/词性标注',
    purpose: '填空题生成、句子分割精确化',
    v1Required: false,
    source: 'V2接入compromise.js等轻量NLP库',
    v1Fallback: '正则分词+缩写白名单分句'
  },

  ttsEngine: {
    name: 'TTS语音引擎',
    purpose: '语音朗读',
    v1Required: true,
    source: '浏览器原生Web Speech API',
    filePath: 'src/features/ttsController.js',
    format: '内置实现，零成本零延迟',
    fallback: '不支持时降级为句子级高亮'
  }
};

// ============================================================
// 5. 文章标注Schema
// ============================================================
export const ARTICLE_SCHEMA = {
  id: 'string (必填, 唯一)',
  title: 'string (必填)',
  content: 'string (必填, 原文)',
  domain: 'string (必填, 如 "tech"/"business"/"medical"/"general")',
  track: 'number 1-4 (必填, 对应四阶段轨道)',
  langDifficulty: 'number 0-5 (可选, 未填则运行时计算)',
  domainDifficulty: 'number 0-5 (可选, 未填则运行时计算)',
  sentences: 'Array<string> (可选, 预分割句子, 未填则运行时分割)',
  terms: 'Array<{word, freqRank, depth}> (可选, 术语标注)',
  phrases: 'Array<{phrase, type, meanings}> (可选, 短语标注)',
  newWordCount: 'number (可选, 新词数, 运行时按用户水平动态计算)',
  tags: 'Array<string> (可选, 如 ["beginner","daily"])',
  wordCount: 'number (可选, 词数, 未填则自动统计)'
};

// ============================================================
// 6. V1最小数据集
// ============================================================
export const V1_MINIMAL_DATASET = {
  frequencyRanks: {
    description: 'COCA词频排名表',
    minSize: '前10000高频词',
    format: 'JSON { "the": 1, "be": 2, ... }',
    note: '未知词默认rank=99999'
  },

  chineseDict: {
    description: '预置中文翻译词典',
    minSize: '高频5000词',
    format: 'JSON { "the": {translation, pos, phonetic}, ... }',
    note: '超出5000词的走词典API兜底'
  },

  articles: {
    description: '人工标注文章库',
    minSize: '50-100篇（每轨道10-25篇）',
    distribution: {
      track1_general: '15-25篇 (A1-A2, <300词)',
      track2_intro: '15-25篇 (A2-B1, <600词)',
      track3_professional: '10-20篇 (B1-B2, <1000词)',
      track4_authentic: '10-30篇 (B2-C2, 原文)'
    },
    domains: ['general', 'tech', 'business', 'medical', 'science', 'culture'],
    note: '每篇需标注domain/track，难度可运行时计算或人工预标注'
  },

  phrases: {
    description: '高频短语表',
    minSize: '500条',
    format: 'JSON [{ phrase, type, meanings: [{meaning, contextKeywords}] }]',
    types: ['phrasal_verb', 'collocation', 'idiom'],
    note: 'V1统一高亮，V2按type分色'
  }
};

// ============================================================
// 默认导出
// ============================================================
export default {
  wordScoreFromRank,
  calcAverageWordScore,
  calcNewWordRatio,
  calcWordDifficulty,
  calcSentenceComplexity,
  calcArticleSentenceComplexity,
  identifyTerms,
  calcTermDepth,
  DATA_DEPENDENCIES,
  ARTICLE_SCHEMA,
  V1_MINIMAL_DATASET
};
