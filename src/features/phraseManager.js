/**
 * 短语识别高亮 + 短语转复习卡片 (V2)
 *
 * V1 统一高亮：所有短语/固定搭配用紫色高亮
 * V2+ 三色分类：短语动词(粉色) / 固定搭配(蓝色) / 习语(橙色)
 *
 * 短语优先级排序：词数降序 → 类型(习语>短语动词>搭配) → 频率升序(罕见优先)
 * 短语多义：meanings数组 + contextKeywords 上下文匹配，无命中回退首义
 * 短语转复习卡片：以短语本身为key，与单词走同一套三层复习 + SM-2 调度
 */

import { WordCard, STAGE } from '../data/models.js';

// ============================================================
// 短语类型枚举
// ============================================================
export const PHRASE_TYPE = {
  PHRASAL_VERB: 'phrasal_verb',  // 短语动词 look up, give in
  COLLOCATION: 'collocation',    // 固定搭配 make decision, heavy rain
  IDIOM: 'idiom'                 // 习语 break the ice
};

// 类型优先级（数值越高优先级越高，用于排序）
export const TYPE_PRIORITY = {
  idiom: 3,           // 习语最优先（最不容易与其他词重叠）
  phrasal_verb: 2,    // 短语动词次之
  collocation: 1      // 搭配最低
};

// V2+ 三色分类（V1 统一紫色）
export const TYPE_COLORS = {
  v1_unified: '#9B59B6',       // V1 统一紫色
  phrasal_verb: '#E91E63',     // V2 粉色
  collocation: '#3498DB',      // V2 蓝色
  idiom: '#FF9800'             // V2 橙色
};

// ============================================================
// PhraseManager 类
// ============================================================
export class PhraseManager {
  /**
   * @param {Object} [options]
   * @param {Array} [options.phraseDict] - 短语词典
   *   [{ phrase: 'look up', type: 'phrasal_verb', frequency: 1200,
   *      meanings: [{ meaning: '查阅', contextKeywords: ['book','information','word'] },
   *                   { meaning: '仰望', contextKeywords: ['sky','ceiling','god'] }] }]
   * @param {boolean} [options.useV2Colors=false] - 是否启用V2三色分类
   * @param {number} [options.contextWindow=50] - 多义匹配的上下文窗口（字符数）
   */
  constructor(options = {}) {
    this.phraseDict = options.phraseDict || [];
    this.useV2Colors = options.useV2Colors || false;
    this.contextWindow = options.contextWindow || 50;

    // 构建查找索引
    this._buildIndex();
  }

  /**
   * 加载/更新短语词典
   */
  loadDictionary(dict) {
    this.phraseDict = dict;
    this._buildIndex();
  }

  /**
   * 构建短语查找索引
   * 按词数降序排列，便于"更长优先匹配"
   * @private
   */
  _buildIndex() {
    // 为每个短语添加词数信息
    const enriched = this.phraseDict.map(entry => ({
      ...entry,
      _wordCount: entry.phrase.split(/\s+/).length,
      _lowerPhrase: entry.phrase.toLowerCase(),
      _typePriority: TYPE_PRIORITY[entry.type] || 0,
      _frequency: entry.frequency || 99999
    }));

    // 按优先级排序：词数降序 → 类型优先级降序 → 频率升序
    enriched.sort((a, b) => {
      if (b._wordCount !== a._wordCount) return b._wordCount - a._wordCount;
      if (b._typePriority !== a._typePriority) return b._typePriority - a._typePriority;
      return a._frequency - b._frequency;
    });

    this._sortedDict = enriched;
  }

  // ============================================================
  // 1. 短语识别
  // ============================================================
  /**
   * 在文本中识别所有短语
   *
   * 匹配策略：
   *   1. 遍历文本的每个位置，尝试匹配词典中的短语
   *   2. 更长的短语优先（_sortedDict 已按词数降序排好）
   *   3. 已匹配的区域不再参与后续匹配（避免重叠）
   *
   * @param {string} text - 原文
   * @returns {Array} 匹配结果 [{phrase, type, start, end, entry, meaning}]
   */
  identifyPhrases(text) {
    if (!text || this._sortedDict.length === 0) return [];

    const lowerText = text.toLowerCase();
    const matches = [];
    const occupied = []; // 已匹配区间 [{start, end}]

    // 遍历每个位置
    for (let i = 0; i < lowerText.length; i++) {
      // 跳过已占用位置
      if (this._isOccupied(i, occupied)) continue;

      // 尝试匹配词典中的短语（已按优先级排序）
      for (const entry of this._sortedDict) {
        const phrase = entry._lowerPhrase;
        // 检查边界：短语后不能跟字母（避免 "look" 匹配 "looking"）
        const end = i + phrase.length;
        if (end > lowerText.length) continue;

        // 前后边界检查
        if (i > 0 && /[a-z]/.test(lowerText[i - 1])) continue;
        if (end < lowerText.length && /[a-z]/.test(lowerText[end])) continue;

        // 精确匹配
        const substr = lowerText.substring(i, end);
        if (substr === phrase) {
          // 多义消解
          const context = this._extractContext(text, i, end);
          const meaning = this.resolveMeaning(entry, context);

          matches.push({
            phrase: entry.phrase,
            type: entry.type,
            start: i,
            end: end,
            entry,
            meaning: meaning.meaning,
            meaningIndex: meaning.index
          });

          occupied.push({ start: i, end });
          i = end - 1; // 跳过已匹配区域
          break; // 匹配到最长短语后不再尝试更短的
        }
      }
    }

    return matches;
  }

  /**
   * 检查位置是否已被占用
   * @private
   */
  _isOccupied(pos, occupied) {
    for (const range of occupied) {
      if (pos >= range.start && pos < range.end) return true;
    }
    return false;
  }

  /**
   * 提取短语周围的上下文
   * @private
   */
  _extractContext(text, start, end) {
    const windowStart = Math.max(0, start - this.contextWindow);
    const windowEnd = Math.min(text.length, end + this.contextWindow);
    return text.substring(windowStart, windowEnd).toLowerCase();
  }

  // ============================================================
  // 2. 多义消解
  // ============================================================
  /**
   * 根据上下文消解短语多义
   *
   * 算法：
   *   1. 遍历 meanings 数组
   *   2. 对每个 meaning，统计 contextKeywords 在上下文中出现的次数
   *   3. 选关键词匹配数最多的 meaning
   *   4. 无命中或平局时回退到首义（meanings[0]）
   *
   * @param {Object} entry - 短语词典条目
   * @param {string} context - 上下文文本（小写）
   * @returns {{meaning:string, index:number, matchedKeywords:Array}}
   */
  resolveMeaning(entry, context) {
    const meanings = entry.meanings || [];
    if (meanings.length === 0) {
      return { meaning: '', index: -1, matchedKeywords: [] };
    }
    if (meanings.length === 1) {
      return { meaning: meanings[0].meaning, index: 0, matchedKeywords: [] };
    }

    let bestIdx = 0;
    let bestScore = 0;
    let bestKeywords = [];

    for (let i = 0; i < meanings.length; i++) {
      const m = meanings[i];
      const keywords = m.contextKeywords || [];
      let score = 0;
      const matched = [];

      for (const kw of keywords) {
        if (context.includes(kw.toLowerCase())) {
          score++;
          matched.push(kw);
        }
      }

      // 严格大于才更新（平局保持首义）
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestKeywords = matched;
      }
    }

    return {
      meaning: meanings[bestIdx].meaning,
      index: bestIdx,
      matchedKeywords: bestKeywords
    };
  }

  // ============================================================
  // 3. 高亮范围构建
  // ============================================================
  /**
   * 构建高亮 span 列表（供 UI 渲染）
   *
   * V1：所有短语统一紫色
   * V2+：按类型分色
   *
   * @param {string} text - 原文
   * @returns {Array} [{start, end, phrase, type, color, meaning, meaningIndex}]
   */
  buildHighlightSpans(text) {
    const phrases = this.identifyPhrases(text);
    const colorKey = this.useV2Colors ? 'type' : 'v1_unified';

    return phrases.map(p => ({
      start: p.start,
      end: p.end,
      phrase: p.phrase,
      type: p.type,
      color: this.useV2Colors
        ? (TYPE_COLORS[p.type] || TYPE_COLORS.v1_unified)
        : TYPE_COLORS.v1_unified,
      meaning: p.meaning,
      meaningIndex: p.meaningIndex
    }));
  }

  /**
   * 构建带高亮的 HTML（直接渲染用）
   *
   * @param {string} text - 原文
   * @returns {string} HTML 字符串，短语包裹在 <span class="phrase-highlight" ...> 中
   */
  buildHighlightedHTML(text) {
    const spans = this.buildHighlightSpans(text);
    if (spans.length === 0) return escapeHtml(text);

    let result = '';
    let lastEnd = 0;

    for (const span of spans) {
      // 前面的普通文本
      result += escapeHtml(text.substring(lastEnd, span.start));
      // 短语高亮
      const phraseText = escapeHtml(text.substring(span.start, span.end));
      result += `<span class="phrase-highlight" ` +
                `data-phrase="${escapeAttr(span.phrase)}" ` +
                `data-type="${span.type}" ` +
                `data-meaning="${escapeAttr(span.meaning)}" ` +
                `style="color: ${span.color}; cursor: pointer; font-weight: 500;">${phraseText}</span>`;
      lastEnd = span.end;
    }
    // 末尾文本
    result += escapeHtml(text.substring(lastEnd));

    return result;
  }

  // ============================================================
  // 4. 短语转复习卡片
  // ============================================================
  /**
   * 将识别出的短语转换为 WordCard 复习卡片
   *
   * 短语卡片特征：
   *   - isPhrase = true
   *   - word = 短语本身（如 "look up"），作为唯一 key
   *   - translation = 上下文消解后的释义
   *   - meanings = 全部多义数组（供后续复习时按上下文消解）
   *   - stage = 'new' / recallStreak = 0（与单词同路径晋升）
   *
   * @param {Array} phrases - identifyPhrases() 的返回值
   * @param {string} articleId - 文章ID（用于语境记录）
   * @param {string} sentence - 出现的原句
   * @returns {Array<WordCard>} WordCard 数组
   */
  toWordCards(phrases, articleId = '', sentence = '') {
    const seen = new Set(); // 同篇去重（同短语只创建一张卡）
    const cards = [];

    for (const p of phrases) {
      // 以短语本身为 key 去重
      if (seen.has(p.phrase)) continue;
      seen.add(p.phrase);

      const card = new WordCard({
        word: p.phrase,
        translation: p.meaning,
        isPhrase: true,
        meanings: p.entry.meanings || []
      });

      // 初始化阶段（与单词同路径）
      card.stage = STAGE.NEW;
      card.recallStreak = 0;

      // 记录首次遇见的语境
      if (sentence) {
        card.addContext(sentence, articleId, false);
      }

      cards.push(card);
    }

    return cards;
  }

  /**
   * 一站式：从文本提取短语并转为复习卡片
   * @param {string} text - 原文
   * @param {string} articleId
   * @param {string} sentence - 包含短语的句子
   * @returns {Array<WordCard>}
   */
  extractAndConvert(text, articleId = '', sentence = '') {
    const phrases = this.identifyPhrases(text);
    return this.toWordCards(phrases, articleId, sentence);
  }

  // ============================================================
  // 5. 统计信息
  // ============================================================
  /**
   * 获取文本中短语的统计信息
   * @param {string} text
   * @returns {{total:number, byType:Object, uniquePhrases:Array}}
   */
  getStats(text) {
    const phrases = this.identifyPhrases(text);
    const byType = {
      phrasal_verb: 0,
      collocation: 0,
      idiom: 0
    };
    const uniqueSet = new Set();

    for (const p of phrases) {
      byType[p.type] = (byType[p.type] || 0) + 1;
      uniqueSet.add(p.phrase);
    }

    return {
      total: phrases.length,
      byType,
      uniqueCount: uniqueSet.size,
      uniquePhrases: Array.from(uniqueSet)
    };
  }
}

// ============================================================
// HTML 转义辅助
// ============================================================
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// 工厂函数
// ============================================================
/**
 * 创建 PhraseManager 实例
 * @param {Object} options - 同 PhraseManager 构造参数
 * @returns {PhraseManager}
 */
export function createPhraseManager(options) {
  return new PhraseManager(options);
}

/**
 * V1 默认短语词典样例（实际使用时应加载完整短语表）
 */
export const SAMPLE_PHRASE_DICT = [
  {
    phrase: 'look up',
    type: PHRASE_TYPE.PHRASAL_VERB,
    frequency: 1200,
    meanings: [
      { meaning: '查阅，查找', contextKeywords: ['book', 'information', 'word', 'dictionary', 'internet'] },
      { meaning: '仰望', contextKeywords: ['sky', 'ceiling', 'stars', 'god', 'sun'] }
    ]
  },
  {
    phrase: 'give in',
    type: PHRASE_TYPE.PHRASAL_VERB,
    frequency: 1800,
    meanings: [
      { meaning: '屈服，让步', contextKeywords: ['pressure', 'demand', 'argument', 'fight', 'refuse'] },
      { meaning: '提交', contextKeywords: ['report', 'homework', 'application', 'submit'] }
    ]
  },
  {
    phrase: 'break the ice',
    type: PHRASE_TYPE.IDIOM,
    frequency: 5000,
    meanings: [
      { meaning: '打破僵局，活跃气氛', contextKeywords: ['party', 'meeting', 'stranger', 'silence', 'conversation'] }
    ]
  },
  {
    phrase: 'make decision',
    type: PHRASE_TYPE.COLLOCATION,
    frequency: 800,
    meanings: [
      { meaning: '做决定', contextKeywords: ['choice', 'option', 'plan', 'future', 'important'] }
    ]
  },
  {
    phrase: 'heavy rain',
    type: PHRASE_TYPE.COLLOCATION,
    frequency: 600,
    meanings: [
      { meaning: '大雨', contextKeywords: ['weather', 'storm', 'umbrella', 'wet', 'pour'] }
    ]
  }
];

// ============================================================
// 默认导出
// ============================================================
export default {
  PhraseManager,
  createPhraseManager,
  PHRASE_TYPE,
  TYPE_PRIORITY,
  TYPE_COLORS,
  SAMPLE_PHRASE_DICT
};
