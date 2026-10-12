/**
 * 应用服务层 - 桥接算法层与 React 前端
 *
 * 职责：
 *   1. 初始化所有算法实例（TTSController / PhraseManager / UserAssessor / MemoryModel / ReviewScheduler / ReviewCoordinator）
 *   2. 提供 V1 最小模拟数据（文章库 + 用户 + 词卡 + 短语词典）
 *   3. localStorage 持久化（用户学习状态 + 词卡）
 *   4. 对外暴露统一的 service 接口供 Context 调用
 *
 * 算法层文件均为纯 ES 模块，Vite 原生支持直接 import
 */

import { WordCard, Article, User, TRACK, TRACK_CONFIG, QUEUE, STAGE } from '../data/models.js';
import { review as sm2Review, getDueCards, getCardStatus } from '../srs/simplifiedSM2.js';
import { AssessmentSession, generateQuestion, handleObjectiveResult, handleDualLayerResult, QUESTION_TYPE } from '../srs/assessmentModel.js';
import { ReviewCoordinator, InArticleReview, PostArticleTest, CrossArticleReview } from '../srs/threeLayerReview.js';
import { MemoryModel } from '../srs/memoryModel.js';
import { ReviewScheduler } from '../srs/reviewScheduler.js';
import { TTSController, SPEED_PRESETS } from '../features/ttsController.js';
import { PhraseManager } from '../features/phraseManager.js';
import { UserAssessor } from '../grading/userAssessor.js';
import { gradeArticle, evaluateArticleFit, splitSentences, calcEffectiveNewWordQuota } from '../grading/dualGrader.js';
import freqRanksData from '../data/frequencyRanks.json';

// ============================================================
// 1. 模拟数据 - 短语词典
// ============================================================
const PHRASE_DICT = [
  {
    phrase: 'look up', type: 'phrasal_verb', frequency: 1200,
    meanings: [
      { meaning: '查阅，查找', contextKeywords: ['word', 'information', 'book', 'dictionary', 'online'] },
      { meaning: '仰望', contextKeywords: ['sky', 'ceiling', 'stars', 'god'] }
    ]
  },
  {
    phrase: 'give up', type: 'phrasal_verb', frequency: 1500,
    meanings: [{ meaning: '放弃', contextKeywords: [] }]
  },
  {
    phrase: 'break the ice', type: 'idiom', frequency: 8000,
    meanings: [{ meaning: '打破僵局，缓和气氛', contextKeywords: [] }]
  },
  {
    phrase: 'heavy rain', type: 'collocation', frequency: 3000,
    meanings: [{ meaning: '大雨', contextKeywords: [] }]
  },
  {
    phrase: 'make decision', type: 'collocation', frequency: 2500,
    meanings: [{ meaning: '做决定', contextKeywords: [] }]
  },
  {
    phrase: 'turn on', type: 'phrasal_verb', frequency: 2000,
    meanings: [
      { meaning: '打开（设备）', contextKeywords: ['light', 'tv', 'computer', 'machine'] },
      { meaning: '对…产生兴趣', contextKeywords: ['excite', 'interest'] }
    ]
  }
];

// ============================================================
// 2. 模拟数据 - 文章库（覆盖4个轨道）
// ============================================================
const MOCK_ARTICLES = [
  // ---- 轨道1 通用基础 ----
  {
    id: 'art_001',
    title: 'My Daily Routine',
    domain: 'general',
    track: 1,
    content: `I wake up at seven every morning. First, I wash my face and brush my teeth. Then I eat breakfast. I usually have bread and milk. After breakfast, I go to work. I take the bus to my office. The bus comes at eight. I work from nine to five. I eat lunch at noon. In the evening, I go home and cook dinner. I read a book before I sleep. I sleep at ten. This is my daily routine. I like my simple life.`,
    tags: ['beginner', 'daily']
  },
  {
    id: 'art_002',
    title: 'A Trip to the Park',
    domain: 'general',
    track: 1,
    content: `Today is Sunday. The sun is shining. My family goes to the park. The park is near our home. We walk there in ten minutes. Many people are in the park. Some children play games. Some people run on the path. My father sits under a tree. My mother reads a book. My sister and I fly a kite. The kite flies high. We are very happy. At noon we eat sandwiches. We go home at three. It is a good day.`,
    tags: ['beginner', 'daily']
  },
  // ---- 轨道2 领域入门 ----
  {
    id: 'art_003',
    title: 'Introduction to Computers',
    domain: 'tech',
    track: 2,
    content: `A computer is a machine that can store and process information. It has several important parts. The CPU is the brain of the computer. It does all the calculations. Memory stores data while the computer is running. The hard drive keeps data even when the power is off. You can use a keyboard and a mouse to give commands to the computer. The screen shows the results. Today, computers are everywhere. People use them at work and at home. The internet connects computers around the world. You can look up information online in seconds. Computers have changed how we live and work. They make many tasks faster and easier. Learning to use a computer is an important skill in the modern world.`,
    terms: [
      { word: 'cpu', freqRank: 18000, depth: 2.5 },
      { word: 'memory', freqRank: 900, depth: 1.5 },
      { word: 'hard drive', freqRank: 25000, depth: 3.0 },
      { word: 'keyboard', freqRank: 12000, depth: 2.0 },
      { word: 'internet', freqRank: 3000, depth: 1.8 }
    ],
    tags: ['tech', 'intro']
  },
  // ---- 轨道3 领域专业 ----
  {
    id: 'art_004',
    title: 'Understanding Neural Networks',
    domain: 'tech',
    track: 3,
    content: `Neural networks are a class of machine learning models inspired by the structure of biological neurons. A typical neural network consists of an input layer, one or more hidden layers, and an output layer. Each layer contains multiple neurons, and each neuron applies a mathematical function to its inputs. The connections between neurons have weights, which are adjusted during the training process through a method called backpropagation. The activation function determines whether a neuron should fire. Common activation functions include the sigmoid function and the ReLU function. During training, the network minimizes a loss function that measures the difference between predictions and actual values. Gradient descent is the optimization algorithm used to update the weights. Neural networks have achieved remarkable results in image recognition, natural language processing, and speech recognition. However, they require large amounts of labeled data and significant computational resources to train effectively.`,
    terms: [
      { word: 'neural', freqRank: 8000, depth: 4.0 },
      { word: 'neuron', freqRank: 20000, depth: 4.0 },
      { word: 'backpropagation', freqRank: 99999, depth: 5.0 },
      { word: 'activation', freqRank: 6000, depth: 3.5 },
      { word: 'sigmoid', freqRank: 99000, depth: 5.0 },
      { word: 'gradient', freqRank: 7000, depth: 3.8 },
      { word: 'optimization', freqRank: 4000, depth: 3.0 }
    ],
    tags: ['tech', 'advanced']
  },
  // ---- 轨道4 真实材料 ----
  {
    id: 'art_005',
    title: 'The Future of Artificial Intelligence',
    domain: 'tech',
    track: 4,
    content: `The rapid advancement of artificial intelligence has precipitated a paradigm shift across virtually every industry. Machine learning algorithms, particularly deep neural architectures, have demonstrated unprecedented capabilities in pattern recognition, natural language understanding, and autonomous decision-making. However, this technological revolution is not without its challenges. The black-box nature of deep learning models raises significant concerns regarding interpretability and accountability. Furthermore, the computational infrastructure required for training sophisticated models entails substantial energy consumption, exacerbating environmental sustainability issues. Ethical considerations surrounding algorithmic bias, data privacy, and the potential displacement of human workers necessitate rigorous regulatory frameworks. The convergence of quantum computing and machine learning may eventually mitigate these computational bottlenecks, though such integration remains largely theoretical at present. Ultimately, the trajectory of artificial intelligence will depend not merely on technological breakthroughs, but on our collective ability to align these powerful systems with human values and societal welfare.`,
    isAuthentic: true,
    tags: ['authentic', 'editorial']
  }
];

// ============================================================
// 3. 模拟数据 - 预置中文词典
// 覆盖5篇模拟文章中出现的所有生词，确保复习题有真实中文选项
// ============================================================
const CHINESE_DICT = {
  // ---- 日常基础（文章1、2）----
  wake: { translation: '醒来', pos: 'v.', phonetic: '/weɪk/' },
  morning: { translation: '早晨', pos: 'n.', phonetic: '/ˈmɔːrnɪŋ/' },
  breakfast: { translation: '早餐', pos: 'n.', phonetic: '/ˈbrekfəst/' },
  usually: { translation: '通常', pos: 'adv.', phonetic: '/ˈjuːʒuəli/' },
  routine: { translation: '常规，日常', pos: 'n.', phonetic: '/ruːˈtiːn/' },
  sandwich: { translation: '三明治', pos: 'n.', phonetic: '/ˈsænwɪtʃ/' },
  wash: { translation: '洗', pos: 'v.', phonetic: '/wɑːʃ/' },
  face: { translation: '脸', pos: 'n.', phonetic: '/feɪs/' },
  brush: { translation: '刷', pos: 'v.', phonetic: '/brʌʃ/' },
  teeth: { translation: '牙齿', pos: 'n.', phonetic: '/tiːθ/' },
  bread: { translation: '面包', pos: 'n.', phonetic: '/bred/' },
  milk: { translation: '牛奶', pos: 'n.', phonetic: '/mɪlk/' },
  bus: { translation: '公交车', pos: 'n.', phonetic: '/bʌs/' },
  office: { translation: '办公室', pos: 'n.', phonetic: '/ˈɔːfɪs/' },
  noon: { translation: '中午', pos: 'n.', phonetic: '/nuːn/' },
  evening: { translation: '晚上', pos: 'n.', phonetic: '/ˈiːvnɪŋ/' },
  cook: { translation: '做饭', pos: 'v.', phonetic: '/kʊk/' },
  dinner: { translation: '晚餐', pos: 'n.', phonetic: '/ˈdɪnər/' },
  sunday: { translation: '星期天', pos: 'n.', phonetic: '/ˈsʌndeɪ/' },
  shining: { translation: '闪耀的', pos: 'adj.', phonetic: '/ˈʃaɪnɪŋ/' },
  family: { translation: '家庭', pos: 'n.', phonetic: '/ˈfæməli/' },
  near: { translation: '附近', pos: 'adv.', phonetic: '/nɪr/' },
  minute: { translation: '分钟', pos: 'n.', phonetic: '/ˈmɪnɪt/' },
  many: { translation: '许多', pos: 'adj.', phonetic: '/ˈmeni/' },
  people: { translation: '人们', pos: 'n.', phonetic: '/ˈpiːpl/' },
  children: { translation: '孩子们', pos: 'n.', phonetic: '/ˈtʃɪldrən/' },
  games: { translation: '游戏', pos: 'n.', phonetic: '/ɡeɪmz/' },
  father: { translation: '父亲', pos: 'n.', phonetic: '/ˈfɑːðər/' },
  mother: { translation: '母亲', pos: 'n.', phonetic: '/ˈmʌðər/' },
  sister: { translation: '姐妹', pos: 'n.', phonetic: '/ˈsɪstər/' },
  fly: { translation: '飞', pos: 'v.', phonetic: '/flaɪ/' },
  kite: { translation: '风筝', pos: 'n.', phonetic: '/kaɪt/' },
  happy: { translation: '快乐的', pos: 'adj.', phonetic: '/ˈhæpi/' },
  simple: { translation: '简单的', pos: 'adj.', phonetic: '/ˈsɪmpl/' },
  life: { translation: '生活', pos: 'n.', phonetic: '/laɪf/' },

  // ---- 技术入门（文章3）----
  computer: { translation: '电脑', pos: 'n.', phonetic: '/kəmˈpjuːtər/' },
  machine: { translation: '机器', pos: 'n.', phonetic: '/məˈʃiːn/' },
  process: { translation: '处理，过程', pos: 'v./n.', phonetic: '/ˈprɑːses/' },
  store: { translation: '存储', pos: 'v.', phonetic: '/stɔːr/' },
  information: { translation: '信息', pos: 'n.', phonetic: '/ˌɪnfərˈmeɪʃn/' },
  connect: { translation: '连接', pos: 'v.', phonetic: '/kəˈnekt/' },
  network: { translation: '网络', pos: 'n.', phonetic: '/ˈnetwɜːrk/' },
  important: { translation: '重要的', pos: 'adj.', phonetic: '/ɪmˈpɔːrtnt/' },
  parts: { translation: '部件', pos: 'n.', phonetic: '/pɑːrts/' },
  cpu: { translation: '中央处理器', pos: 'n.', phonetic: '/ˌsiː piː ˈjuː/' },
  brain: { translation: '大脑', pos: 'n.', phonetic: '/breɪn/' },
  calculations: { translation: '计算', pos: 'n.', phonetic: '/ˌkælkjuˈleɪʃnz/' },
  memory: { translation: '内存，记忆', pos: 'n.', phonetic: '/ˈmeməri/' },
  data: { translation: '数据', pos: 'n.', phonetic: '/ˈdeɪtə/' },
  running: { translation: '运行', pos: 'v.', phonetic: '/ˈrʌnɪŋ/' },
  hard: { translation: '硬的', pos: 'adj.', phonetic: '/hɑːrd/' },
  drive: { translation: '驱动器', pos: 'n.', phonetic: '/draɪv/' },
  keeps: { translation: '保持', pos: 'v.', phonetic: '/kiːps/' },
  power: { translation: '电源，力量', pos: 'n.', phonetic: '/ˈpaʊər/' },
  keyboard: { translation: '键盘', pos: 'n.', phonetic: '/ˈkiːbɔːrd/' },
  mouse: { translation: '鼠标', pos: 'n.', phonetic: '/maʊs/' },
  commands: { translation: '命令', pos: 'n.', phonetic: '/kəˈmændz/' },
  screen: { translation: '屏幕', pos: 'n.', phonetic: '/skriːn/' },
  shows: { translation: '显示', pos: 'v.', phonetic: '/ʃoʊz/' },
  results: { translation: '结果', pos: 'n.', phonetic: '/rɪˈzʌlts/' },
  today: { translation: '今天', pos: 'n.', phonetic: '/təˈdeɪ/' },
  everywhere: { translation: '到处', pos: 'adv.', phonetic: '/ˈevriwer/' },
  work: { translation: '工作', pos: 'n./v.', phonetic: '/wɜːrk/' },
  home: { translation: '家', pos: 'n.', phonetic: '/hoʊm/' },
  internet: { translation: '互联网', pos: 'n.', phonetic: '/ˈɪntərnet/' },
  around: { translation: '围绕', pos: 'prep.', phonetic: '/əˈraʊnd/' },
  world: { translation: '世界', pos: 'n.', phonetic: '/wɜːrld/' },
  online: { translation: '在线的', pos: 'adj.', phonetic: '/ˌɑːnˈlaɪn/' },
  seconds: { translation: '秒', pos: 'n.', phonetic: '/ˈsekəndz/' },
  changed: { translation: '改变了', pos: 'v.', phonetic: '/tʃeɪndʒd/' },
  live: { translation: '生活', pos: 'v.', phonetic: '/lɪv/' },
  faster: { translation: '更快', pos: 'adv.', phonetic: '/ˈfæstər/' },
  easier: { translation: '更容易', pos: 'adj.', phonetic: '/ˈiːziər/' },
  learning: { translation: '学习', pos: 'n.', phonetic: '/ˈlɜːrnɪŋ/' },
  skill: { translation: '技能', pos: 'n.', phonetic: '/skɪl/' },
  modern: { translation: '现代的', pos: 'adj.', phonetic: '/ˈmɑːdərn/' },

  // ---- 技术专业（文章4）----
  neural: { translation: '神经的', pos: 'adj.', phonetic: '/ˈnʊrəl/' },
  networks: { translation: '网络', pos: 'n.', phonetic: '/ˈnetwɜːrks/' },
  class: { translation: '类，类别', pos: 'n.', phonetic: '/klæs/' },
  machine: { translation: '机器', pos: 'n.', phonetic: '/məˈʃiːn/' },
  models: { translation: '模型', pos: 'n.', phonetic: '/ˈmɑːdlz/' },
  inspired: { translation: '启发，灵感来自', pos: 'v.', phonetic: '/ɪnˈspaɪərd/' },
  structure: { translation: '结构', pos: 'n.', phonetic: '/ˈstrʌktʃər/' },
  biological: { translation: '生物的', pos: 'adj.', phonetic: '/ˌbaɪəˈlɑːdʒɪkl/' },
  neurons: { translation: '神经元', pos: 'n.', phonetic: '/ˈnʊrɑːnz/' },
  typical: { translation: '典型的', pos: 'adj.', phonetic: '/ˈtɪpɪkl/' },
  consists: { translation: '包含', pos: 'v.', phonetic: '/kənˈsɪsts/' },
  input: { translation: '输入', pos: 'n.', phonetic: '/ˈɪnpʊt/' },
  layer: { translation: '层', pos: 'n.', phonetic: '/ler/' },
  hidden: { translation: '隐藏的', pos: 'adj.', phonetic: '/ˈhɪdn/' },
  output: { translation: '输出', pos: 'n.', phonetic: '/ˈaʊtpʊt/' },
  each: { translation: '每个', pos: 'adj.', phonetic: '/iːtʃ/' },
  contains: { translation: '包含', pos: 'v.', phonetic: '/kənˈteɪnz/' },
  multiple: { translation: '多个', pos: 'adj.', phonetic: '/ˈmʌltəpl/' },
  neuron: { translation: '神经元', pos: 'n.', phonetic: '/ˈnʊrɑːn/' },
  applies: { translation: '应用', pos: 'v.', phonetic: '/əˈplaɪz/' },
  mathematical: { translation: '数学的', pos: 'adj.', phonetic: '/ˌmæθəˈmætɪkl/' },
  function: { translation: '函数，功能', pos: 'n.', phonetic: '/ˈfʌŋkʃn/' },
  inputs: { translation: '输入', pos: 'n.', phonetic: '/ˈɪnpʊts/' },
  connections: { translation: '连接', pos: 'n.', phonetic: '/kəˈnekʃnz/' },
  between: { translation: '在…之间', pos: 'prep.', phonetic: '/bɪˈtwiːn/' },
  weights: { translation: '权重', pos: 'n.', phonetic: '/weɪts/' },
  adjusted: { translation: '调整', pos: 'v.', phonetic: '/əˈdʒʌstɪd/' },
  during: { translation: '在…期间', pos: 'prep.', phonetic: '/ˈdʊrɪŋ/' },
  method: { translation: '方法', pos: 'n.', phonetic: '/ˈmeθəd/' },
  called: { translation: '称为', pos: 'v.', phonetic: '/kɔːld/' },
  backpropagation: { translation: '反向传播', pos: 'n.', phonetic: '/ˌbækˌprɑːpəˈɡeɪʃn/' },
  activation: { translation: '激活', pos: 'n.', phonetic: '/ˌæktɪˈveɪʃn/' },
  determines: { translation: '决定', pos: 'v.', phonetic: '/dɪˈtɜːrmɪnz/' },
  whether: { translation: '是否', pos: 'conj.', phonetic: '/ˈweðər/' },
  fire: { translation: '触发，点火', pos: 'v.', phonetic: '/faɪər/' },
  common: { translation: '常见的', pos: 'adj.', phonetic: '/ˈkɑːmən/' },
  functions: { translation: '函数', pos: 'n.', phonetic: '/ˈfʌŋkʃnz/' },
  include: { translation: '包括', pos: 'v.', phonetic: '/ɪnˈkluːd/' },
  sigmoid: { translation: 'S型函数', pos: 'n.', phonetic: '/ˈsɪɡmɔɪd/' },
  relu: { translation: '修正线性单元', pos: 'n.', phonetic: '/ˈriːluː/' },
  minimizes: { translation: '最小化', pos: 'v.', phonetic: '/ˈmɪnɪmaɪzɪz/' },
  loss: { translation: '损失', pos: 'n.', phonetic: '/lɔːs/' },
  measures: { translation: '衡量', pos: 'v.', phonetic: '/ˈmeʒərz/' },
  difference: { translation: '差异', pos: 'n.', phonetic: '/ˈdɪfrəns/' },
  predictions: { translation: '预测', pos: 'n.', phonetic: '/prɪˈdɪkʃnz/' },
  actual: { translation: '实际的', pos: 'adj.', phonetic: '/ˈæktʃuəl/' },
  values: { translation: '值', pos: 'n.', phonetic: '/ˈvæljuːz/' },
  gradient: { translation: '梯度', pos: 'n.', phonetic: '/ˈɡreɪdiənt/' },
  descent: { translation: '下降', pos: 'n.', phonetic: '/dɪˈsent/' },
  optimization: { translation: '优化', pos: 'n.', phonetic: '/ˌɑːptɪmaɪˈzeɪʃn/' },
  algorithm: { translation: '算法', pos: 'n.', phonetic: '/ˈælgərɪðəm/' },
  update: { translation: '更新', pos: 'v.', phonetic: '/ˌʌpˈdeɪt/' },
  achieved: { translation: '取得', pos: 'v.', phonetic: '/əˈtʃiːvd/' },
  remarkable: { translation: '显著的', pos: 'adj.', phonetic: '/rɪˈmɑːrkəbl/' },
  results: { translation: '结果', pos: 'n.', phonetic: '/rɪˈzʌlts/' },
  image: { translation: '图像', pos: 'n.', phonetic: '/ˈɪmɪdʒ/' },
  recognition: { translation: '识别', pos: 'n.', phonetic: '/ˌrekəɡˈnɪʃn/' },
  natural: { translation: '自然的', pos: 'adj.', phonetic: '/ˈnætʃrəl/' },
  language: { translation: '语言', pos: 'n.', phonetic: '/ˈlæŋɡwɪdʒ/' },
  processing: { translation: '处理', pos: 'n.', phonetic: '/ˈprɑːsesɪŋ/' },
  speech: { translation: '语音', pos: 'n.', phonetic: '/spiːtʃ/' },
  however: { translation: '然而', pos: 'adv.', phonetic: '/haʊˈevər/' },
  require: { translation: '需要', pos: 'v.', phonetic: '/rɪˈkwaɪər/' },
  large: { translation: '大的', pos: 'adj.', phonetic: '/lɑːrdʒ/' },
  amounts: { translation: '数量', pos: 'n.', phonetic: '/əˈmaʊnts/' },
  labeled: { translation: '标注的', pos: 'adj.', phonetic: '/ˈleɪbld/' },
  significant: { translation: '重要的，显著的', pos: 'adj.', phonetic: '/sɪɡˈnɪfɪkənt/' },
  resources: { translation: '资源', pos: 'n.', phonetic: '/ˈriːsɔːrsɪz/' },
  train: { translation: '训练', pos: 'v.', phonetic: '/treɪn/' },
  effectively: { translation: '有效地', pos: 'adv.', phonetic: '/ɪˈfektɪvli/' },

  // ---- 真实材料（文章5）----
  rapid: { translation: '快速的', pos: 'adj.', phonetic: '/ˈræpɪd/' },
  advancement: { translation: '进步，发展', pos: 'n.', phonetic: '/ədˈvænsmənt/' },
  artificial: { translation: '人工的', pos: 'adj.', phonetic: '/ˌɑːrtɪˈfɪʃl/' },
  intelligence: { translation: '智能', pos: 'n.', phonetic: '/ɪnˈtelɪdʒəns/' },
  precipitated: { translation: '促成， precipitated', pos: 'v.', phonetic: '/prɪˈsɪpɪteɪtɪd/' },
  paradigm: { translation: '范式', pos: 'n.', phonetic: '/ˈpærədaɪm/' },
  shift: { translation: '转变', pos: 'n.', phonetic: '/ʃɪft/' },
  across: { translation: '横跨', pos: 'prep.', phonetic: '/əˈkrɔːs/' },
  virtually: { translation: '几乎，实际上', pos: 'adv.', phonetic: '/ˈvɜːrtʃuəli/' },
  every: { translation: '每个', pos: 'adj.', phonetic: '/ˈevri/' },
  industry: { translation: '行业', pos: 'n.', phonetic: '/ˈɪndəstri/' },
  algorithms: { translation: '算法', pos: 'n.', phonetic: '/ˈælgərɪðəmz/' },
  particularly: { translation: '特别地', pos: 'adv.', phonetic: '/pərˈtɪkjələrli/' },
  deep: { translation: '深的', pos: 'adj.', phonetic: '/diːp/' },
  architectures: { translation: '架构', pos: 'n.', phonetic: '/ˈɑːrkɪtektʃərz/' },
  demonstrated: { translation: '展示了', pos: 'v.', phonetic: '/ˈdemənstreɪtɪd/' },
  unprecedented: { translation: '前所未有的', pos: 'adj.', phonetic: '/ʌnˈpresɪdentɪd/' },
  capabilities: { translation: '能力', pos: 'n.', phonetic: '/ˌkeɪpəˈbɪlətiz/' },
  pattern: { translation: '模式', pos: 'n.', phonetic: '/ˈpætərn/' },
  understanding: { translation: '理解', pos: 'n.', phonetic: '/ˌʌndərˈstændɪŋ/' },
  autonomous: { translation: '自主的', pos: 'adj.', phonetic: '/ɔːˈtɑːnəməs/' },
  decision: { translation: '决策', pos: 'n.', phonetic: '/dɪˈsɪʒn/' },
  making: { translation: '制定', pos: 'n.', phonetic: '/ˈmeɪkɪŋ/' },
  technological: { translation: '技术的', pos: 'adj.', phonetic: '/ˌteknəˈlɑːdʒɪkl/' },
  revolution: { translation: '革命', pos: 'n.', phonetic: '/ˌrevəˈluːʃn/' },
  without: { translation: '没有', pos: 'prep.', phonetic: '/wɪˈðaʊt/' },
  challenges: { translation: '挑战', pos: 'n.', phonetic: '/ˈtʃælɪndʒɪz/' },
  black: { translation: '黑色的', pos: 'adj.', phonetic: '/blæk/' },
  box: { translation: '盒子', pos: 'n.', phonetic: '/bɑːks/' },
  nature: { translation: '性质', pos: 'n.', phonetic: '/ˈneɪtʃər/' },
  raises: { translation: '引发', pos: 'v.', phonetic: '/ˈreɪzɪz/' },
  concerns: { translation: '担忧', pos: 'n.', phonetic: '/kənˈsɜːrnz/' },
  regarding: { translation: '关于', pos: 'prep.', phonetic: '/rɪˈɡɑːrdɪŋ/' },
  interpretability: { translation: '可解释性', pos: 'n.', phonetic: '/ɪnˌtɜːrprɪtəˈbɪləti/' },
  accountability: { translation: '问责性', pos: 'n.', phonetic: '/əˌkaʊntəˈbɪləti/' },
  furthermore: { translation: '此外', pos: 'adv.', phonetic: '/ˌfɜːrðərˈmɔːr/' },
  computational: { translation: '计算的', pos: 'adj.', phonetic: '/ˌkɑːmpjuˈteɪʃənl/' },
  infrastructure: { translation: '基础设施', pos: 'n.', phonetic: '/ˈɪnfrəstrʌktʃər/' },
  required: { translation: '需要的', pos: 'adj.', phonetic: '/rɪˈkwaɪərd/' },
  sophisticated: { translation: '复杂的，精密的', pos: 'adj.', phonetic: '/səˈfɪstɪkeɪtɪd/' },
  entails: { translation: '需要，牵涉', pos: 'v.', phonetic: '/ɪnˈteɪlz/' },
  substantial: { translation: '大量的', pos: 'adj.', phonetic: '/səbˈstænʃl/' },
  energy: { translation: '能源', pos: 'n.', phonetic: '/ˈenərdʒi/' },
  consumption: { translation: '消耗', pos: 'n.', phonetic: '/kənˈsʌmpʃn/' },
  exacerbating: { translation: '加剧', pos: 'v.', phonetic: '/ɪɡˈzæsərbeɪtɪŋ/' },
  environmental: { translation: '环境的', pos: 'adj.', phonetic: '/ɪnˌvaɪrənˈmentl/' },
  sustainability: { translation: '可持续性', pos: 'n.', phonetic: '/səˌsteɪnəˈbɪləti/' },
  issues: { translation: '问题', pos: 'n.', phonetic: '/ˈɪʃuːz/' },
  ethical: { translation: '伦理的', pos: 'adj.', phonetic: '/ˈeθɪkl/' },
  considerations: { translation: '考虑因素', pos: 'n.', phonetic: '/kənˌsɪdəˈreɪʃnz/' },
  surrounding: { translation: '周围的', pos: 'adj.', phonetic: '/səˈraʊndɪŋ/' },
  algorithmic: { translation: '算法的', pos: 'adj.', phonetic: '/ˌælɡəˈrɪðmɪk/' },
  bias: { translation: '偏见', pos: 'n.', phonetic: '/ˈbaɪəs/' },
  privacy: { translation: '隐私', pos: 'n.', phonetic: '/ˈpraɪvəsi/' },
  potential: { translation: '潜在的', pos: 'adj.', phonetic: '/pəˈtenʃl/' },
  displacement: { translation: '替代，位移', pos: 'n.', phonetic: '/dɪsˈpleɪsmənt/' },
  human: { translation: '人类的', pos: 'adj.', phonetic: '/ˈhjuːmən/' },
  workers: { translation: '工人', pos: 'n.', phonetic: '/ˈwɜːrkərz/' },
  necessitate: { translation: '使成为必要', pos: 'v.', phonetic: '/nəˈsesɪteɪt/' },
  rigorous: { translation: '严格的', pos: 'adj.', phonetic: '/ˈrɪɡərəs/' },
  regulatory: { translation: '监管的', pos: 'adj.', phonetic: '/ˈreɡjələtɔːri/' },
  frameworks: { translation: '框架', pos: 'n.', phonetic: '/ˈfreɪmwɜːrks/' },
  convergence: { translation: '融合，收敛', pos: 'n.', phonetic: '/kənˈvɜːrdʒəns/' },
  quantum: { translation: '量子的', pos: 'adj.', phonetic: '/ˈkwɑːntəm/' },
  computing: { translation: '计算', pos: 'n.', phonetic: '/kəmˈpjuːtɪŋ/' },
  may: { translation: '可能', pos: 'modal', phonetic: '/meɪ/' },
  eventually: { translation: '最终', pos: 'adv.', phonetic: '/ɪˈventʃuəli/' },
  mitigate: { translation: '减轻', pos: 'v.', phonetic: '/ˈmɪtɪɡeɪt/' },
  these: { translation: '这些', pos: 'pron.', phonetic: '/ðiːz/' },
  bottlenecks: { translation: '瓶颈', pos: 'n.', phonetic: '/ˈbɑːtlneks/' },
  though: { translation: '虽然', pos: 'conj.', phonetic: '/ðoʊ/' },
  such: { translation: '这样的', pos: 'adj.', phonetic: '/sʌtʃ/' },
  integration: { translation: '集成', pos: 'n.', phonetic: '/ˌɪntɪˈɡreɪʃn/' },
  remains: { translation: '仍然是', pos: 'v.', phonetic: '/rɪˈmeɪnz/' },
  largely: { translation: '主要地', pos: 'adv.', phonetic: '/ˈlɑːrdʒli/' },
  theoretical: { translation: '理论的', pos: 'adj.', phonetic: '/ˌθiːəˈretɪkl/' },
  present: { translation: '目前', pos: 'n.', phonetic: '/ˈpreznt/' },
  ultimately: { translation: '最终', pos: 'adv.', phonetic: '/ˈʌltɪmətli/' },
  trajectory: { translation: '轨迹', pos: 'n.', phonetic: '/trəˈdʒektəri/' },
  will: { translation: '将', pos: 'modal', phonetic: '/wɪl/' },
  depend: { translation: '依赖', pos: 'v.', phonetic: '/dɪˈpend/' },
  merely: { translation: '仅仅', pos: 'adv.', phonetic: '/ˈmɪrli/' },
  breakthroughs: { translation: '突破', pos: 'n.', phonetic: '/ˈbreɪkθruːz/' },
  collective: { translation: '集体的', pos: 'adj.', phonetic: '/kəˈlektɪv/' },
  ability: { translation: '能力', pos: 'n.', phonetic: '/əˈbɪləti/' },
  align: { translation: '使一致', pos: 'v.', phonetic: '/əˈlaɪn/' },
  powerful: { translation: '强大的', pos: 'adj.', phonetic: '/ˈpaʊərfl/' },
  systems: { translation: '系统', pos: 'n.', phonetic: '/ˈsɪstəmz/' },
  values: { translation: '价值观', pos: 'n.', phonetic: '/ˈvæljuːz/' },
  societal: { translation: '社会的', pos: 'adj.', phonetic: '/səˈsaɪətl/' },
  welfare: { translation: '福祉', pos: 'n.', phonetic: '/ˈwelfer/' }
};

// ============================================================
// 4. localStorage 持久化
// ============================================================
const STORAGE_KEY = 'ela_user_state_v1';
const CARDS_KEY = 'ela_word_cards_v1';
const SETTINGS_KEY = 'ela_settings_v1';
const ARTICLES_KEY = 'ela_custom_articles_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { console.warn('[Storage] 保存用户状态失败', e); }
}

function loadCards() {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return arr.map(obj => WordCard.fromJSON(obj));
  } catch { return []; }
}

function saveCards(cards) {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards.map(c => c.toJSON())));
  } catch (e) { console.warn('[Storage] 保存词卡失败', e); }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { ttsRate: 1.0, ttsVoice: null };
  } catch { return { ttsRate: 1.0, ttsVoice: null }; }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { console.warn('[Storage] 保存设置失败', e); }
}

function loadCustomArticles() {
  try {
    const raw = localStorage.getItem(ARTICLES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomArticles(articles) {
  try {
    localStorage.setItem(ARTICLES_KEY, JSON.stringify(articles));
  } catch (e) { console.warn('[Storage] 保存文章失败', e); }
}

// ============================================================
// 5. AppService - 核心服务对象
// ============================================================
class AppService {
  constructor() {
    // ---- 词频表 ----
    this.freqRanks = freqRanksData;

    // ---- 算法实例 ----
    this.tts = new TTSController({ rate: loadSettings().ttsRate });
    this.phraseManager = new PhraseManager({ phraseDict: PHRASE_DICT });
    this.userAssessor = new UserAssessor({ freqRanks: this.freqRanks });

    // ---- 模拟文章库 + 用户导入文章（转为 Article 对象 + 运行时评分）----
    const allRaw = [...MOCK_ARTICLES, ...loadCustomArticles()];
    this.articles = allRaw.map(raw => {
      const article = new Article(raw);
      // 运行时评分（无预标注时调用 gradeArticle）
      if (!article.langDifficulty || !article.domainDifficulty) {
        const result = gradeArticle(article, { freqRanks: this.freqRanks, forceRecompute: true });
        article.langDifficulty = result.langDifficulty;
        article.domainDifficulty = result.domainDifficulty;
        article.track = result.track;
      }
      // 预分割句子
      if (!article.sentences || article.sentences.length === 0) {
        article.sentences = splitSentences(article.content);
      }
      return article;
    });

    // 加载文章库到 assessor
    this.userAssessor.loadArticleLibrary(this.articles);

    // ---- 用户状态 ----
    const saved = loadState();
    this.user = saved ? User.fromJSON(saved) : new User({
      id: 'user_001',
      level: 'A1',
      currentTrack: TRACK.GENERAL,
      domain: 'general',
      learnedWordCount: 0,
      correctRate7d: 0.75
    });

    // ---- 词卡集合 ----
    this.wordCards = loadCards();

    // ---- 刷新已有词卡的翻译（解决旧占位符翻译问题）----
    let cardsChanged = false;
    for (const card of this.wordCards) {
      if (!card.translation || card.translation.startsWith('（')) {
        const dictEntry = CHINESE_DICT[card.word.toLowerCase()];
        if (dictEntry) {
          card.translation = dictEntry.translation;
          if (!card.phonetic) card.phonetic = dictEntry.phonetic;
          cardsChanged = true;
        }
      }
    }
    if (cardsChanged) saveCards(this.wordCards);

    // ---- 衍生实例（依赖 cards）----
    this.memoryModel = new MemoryModel(this.wordCards);
    this.reviewScheduler = new ReviewScheduler(this.wordCards);
    this.coordinator = new ReviewCoordinator(this.user, this.wordCards);

    // ---- 已读文章 ----
    this.readArticleIds = saved?.readArticleIds || [];

    // ---- 设置 ----
    this.settings = loadSettings();
  }

  // ============================================================
  // 文章相关
  // ============================================================
  getArticles() {
    return this.articles;
  }

  getArticle(id) {
    return this.articles.find(a => a.id === id) || null;
  }

  getArticlesByTrack(track) {
    return this.articles.filter(a => a.track === track);
  }

  /**
   * 导入文章
   * 支持两种格式：
   *   1. 纯文本：第一行是标题，后面是正文（自动评分+分句）
   *   2. JSON：符合 ARTICLE_SCHEMA 的对象或对象数组
   *
   * @param {string} text - 用户输入的文本
   * @returns {{success:boolean, count:number, error?:string, articles?:Array}}
   */
  importArticles(text) {
    if (!text || !text.trim()) {
      return { success: false, count: 0, error: '内容不能为空' };
    }

    const trimmed = text.trim();
    let imported = [];

    // ---- 尝试解析为 JSON ----
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of arr) {
          if (!item.title || !item.content) continue;
          imported.push(item);
        }
      } catch (e) {
        return { success: false, count: 0, error: 'JSON 格式错误：' + e.message };
      }
    } else {
      // ---- 纯文本：第一行标题，后面正文 ----
      const lines = trimmed.split('\n');
      const title = lines[0].trim().slice(0, 100) || '未命名文章';
      const content = lines.slice(1).join('\n').trim();
      if (!content) {
        return { success: false, count: 0, error: '正文不能为空' };
      }
      imported.push({
        title,
        content,
        domain: 'general',
        tags: ['imported']
      });
    }

    if (imported.length === 0) {
      return { success: false, count: 0, error: '没有有效的文章数据' };
    }

    // ---- 转为 Article 对象并评分 ----
    const newArticles = imported.map(raw => {
      const article = new Article({
        ...raw,
        id: raw.id || `art_import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      });
      // 运行时评分
      const result = gradeArticle(article, { freqRanks: this.freqRanks, forceRecompute: true });
      article.langDifficulty = result.langDifficulty;
      article.domainDifficulty = result.domainDifficulty;
      article.track = result.track;
      // 预分割句子
      article.sentences = splitSentences(article.content);
      return article;
    });

    // ---- 合并到文章库并持久化 ----
    this.articles = [...this.articles, ...newArticles];
    this.userAssessor.loadArticleLibrary(this.articles);

    // 只持久化用户导入的（排除内置 MOCK_ARTICLES）
    const customIds = new Set(MOCK_ARTICLES.map(a => a.id));
    const customArticles = this.articles
      .filter(a => !customIds.has(a.id))
      .map(a => a.toJSON());
    saveCustomArticles(customArticles);

    return { success: true, count: newArticles.length, articles: newArticles };
  }

  /**
   * 删除用户导入的文章（内置文章不可删除）
   */
  removeArticle(id) {
    const isBuiltin = MOCK_ARTICLES.some(a => a.id === id);
    if (isBuiltin) {
      return { success: false, error: '内置文章不可删除' };
    }
    this.articles = this.articles.filter(a => a.id !== id);
    this.userAssessor.loadArticleLibrary(this.articles);
    // 持久化
    const customIds = new Set(MOCK_ARTICLES.map(a => a.id));
    const customArticles = this.articles
      .filter(a => !customIds.has(a.id))
      .map(a => a.toJSON());
    saveCustomArticles(customArticles);
    return { success: true };
  }

  /** 获取推荐文章 */
  getRecommendedArticles(limit = 10) {
    return this.userAssessor.recommendArticles(this.user, {
      readArticleIds: this.readArticleIds,
      limit
    });
  }

  /** 标记文章已读 */
  markArticleRead(articleId) {
    if (!this.readArticleIds.includes(articleId)) {
      this.readArticleIds.push(articleId);
      this._persistUser();
    }
  }

  // ============================================================
  // 阅读 + TTS
  // ============================================================
  /** 为 TTS 准备文章句子 */
  prepareTTS(article) {
    this.tts.setContent(article.sentences || splitSentences(article.content));
  }

  /** 获取短语高亮 HTML */
  getHighlightedHTML(text) {
    return this.phraseManager.buildHighlightedHTML(text);
  }

  /** 查词（先查中文词典，再降级） */
  lookupWord(word) {
    const lower = word.toLowerCase();
    // 短语词典
    const phraseEntry = this.phraseManager.phraseDict.find(
      p => p.phrase === lower
    );
    if (phraseEntry) {
      return {
        word: phraseEntry.phrase,
        translation: phraseEntry.meanings[0]?.meaning || '',
        isPhrase: true,
        meanings: phraseEntry.meanings
      };
    }
    // 中文词典
    const entry = CHINESE_DICT[lower];
    if (entry) {
      return { word: lower, ...entry, isPhrase: false };
    }
    // 词频
    const rank = this.freqRanks[lower] || 99999;
    return {
      word: lower,
      translation: rank < 5000 ? '（通用词，暂无预置翻译）' : '（生词，需词典API）',
      isPhrase: false,
      freqRank: rank
    };
  }

  // ============================================================
  // 词卡管理
  // ============================================================
  /** 查找或创建词卡（阅读时点词） */
  getOrCreateCard(word, sentence = '', articleId = '') {
    const lower = word.toLowerCase();
    let card = this.wordCards.find(c => c.word === lower);
    if (!card) {
      const lookup = this.lookupWord(word);
      card = new WordCard({
        word: lower,
        translation: lookup.translation || '',
        phonetic: lookup.phonetic || '',
        freqRank: lookup.freqRank || this.freqRanks[lower] || null,
        isPhrase: lookup.isPhrase || false,
        meanings: lookup.meanings || []
      });
      if (sentence) card.addContext(sentence, articleId, false);
      this.wordCards.push(card);
      this._persistCards();
    } else if (sentence && !card.contexts.find(c => c.sentence === sentence)) {
      card.addContext(sentence, articleId, false);
      this._persistCards();
    }
    return card;
  }

  /** 获取所有词卡 */
  getAllCards() {
    return this.wordCards;
  }

  /** 获取词卡状态摘要 */
  getCardStatus(card) {
    return getCardStatus(card);
  }

  // ============================================================
  // 复习相关
  // ============================================================
  /** 获取今日复习队列 */
  getTodayReviewQueue(limit = null) {
    return this.reviewScheduler.buildDailyQueue();
  }

  /** 获取今日复习概览 */
  getReviewOverview() {
    return this.reviewScheduler.getDailyOverview();
  }

  /** 生成复习题目 */
  generateQuestionFor(card) {
    // 干扰项池：优先用已有词卡，不足时从词典补充，确保总有3个真实干扰项
    const cardPool = this.wordCards.filter(c => c.id !== card.id && c.translation);

    // 从词典生成补充干扰项（转为临时 WordCard 结构）
    const dictEntries = Object.entries(CHINESE_DICT)
      .filter(([w]) => w !== card.word.toLowerCase())
      .map(([word, info]) => ({
        id: `dict_${word}`,
        word,
        translation: info.translation,
        phonetic: info.phonetic,
        isPhrase: false
      }));

    // 合并并打乱
    const distractorPool = [...cardPool, ...dictEntries].sort(() => Math.random() - 0.5);

    return generateQuestion(card, { distractorPool });
  }

  /** 处理客观题结果（再认/填空/搭配） */
  handleObjectiveReview(card, correct, context = null) {
    const result = handleObjectiveResult(card, correct, context);
    this._persistCards();
    this._refreshDerived();
    return result;
  }

  /** 处理回忆题双层判断结果 */
  handleDualLayerReview(card, grade, context = null) {
    const result = handleDualLayerResult(card, grade, context);
    this._persistCards();
    this._refreshDerived();
    return result;
  }

  /** 创建评估会话（回忆题双层判断） */
  createAssessmentSession(card) {
    return new AssessmentSession(card);
  }

  // ============================================================
  // 统计 + 学习计划
  // ============================================================
  getMemoryStats() {
    return this.memoryModel.getStats();
  }

  getHealthScore() {
    return this.memoryModel.getHealthScore();
  }

  getStudyPlan() {
    // 更新 user 的队列/阶段统计
    this._syncUserStats();
    return this.userAssessor.generateStudyPlan(this.user, this.wordCards);
  }

  getLevelAssessment() {
    this._syncUserStats();
    return this.userAssessor.assessLevel(this.user, this.wordCards);
  }

  getTrackPromotion() {
    this._syncUserStats();
    return this.userAssessor.checkTrackPromotion(this.user, this.wordCards);
  }

  // ============================================================
  // 用户设置
  // ============================================================
  setTTSRate(rate) {
    this.tts.setRate(rate);
    this.settings.ttsRate = rate;
    saveSettings(this.settings);
  }

  setTTSVoice(voice) {
    this.tts.setVoice(voice);
    this.settings.ttsVoice = voice ? { name: voice.name, lang: voice.lang } : null;
    saveSettings(this.settings);
  }

  getAvailableVoices() {
    return this.tts.getVoices();
  }

  setUserLevel(level) {
    this.user.level = level;
    this._persistUser();
  }

  setUserTrack(track) {
    this.user.currentTrack = track;
    this._persistUser();
  }

  // ============================================================
  // 内部辅助
  // ============================================================
  _syncUserStats() {
    this.user.learnedWordCount = this.wordCards.filter(c => c.metCount > 0).length;
    const qc = { not_known: 0, remembered_wrong: 0, learned: 0 };
    const sp = { new: 0, recognize: 0, recall: 0, mastered: 0 };
    for (const c of this.wordCards) {
      if (qc[c.queue] != null) qc[c.queue]++;
      if (sp[c.stage] != null) sp[c.stage]++;
    }
    this.user.queueCounts = qc;
    this.user.stageProgress = sp;
  }

  _refreshDerived() {
    this.memoryModel.setCards(this.wordCards);
    this.reviewScheduler.setCards(this.wordCards);
    this.coordinator = new ReviewCoordinator(this.user, this.wordCards);
  }

  _persistUser() {
    this._syncUserStats();
    saveState({ ...this.user.toJSON(), readArticleIds: this.readArticleIds });
  }

  _persistCards() {
    saveCards(this.wordCards);
  }

  /** 重置所有数据（设置页用） */
  resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CARDS_KEY);
    localStorage.removeItem(ARTICLES_KEY);
    this.user = new User({ id: 'user_001', level: 'A1', currentTrack: TRACK.GENERAL, correctRate7d: 0.75 });
    this.wordCards = [];
    this.readArticleIds = [];
    // 恢复文章库为内置文章
    this.articles = MOCK_ARTICLES.map(raw => {
      const article = new Article(raw);
      const result = gradeArticle(article, { freqRanks: this.freqRanks, forceRecompute: true });
      article.langDifficulty = result.langDifficulty;
      article.domainDifficulty = result.domainDifficulty;
      article.track = result.track;
      article.sentences = splitSentences(article.content);
      return article;
    });
    this.userAssessor.loadArticleLibrary(this.articles);
    this._refreshDerived();
  }
}

// ============================================================
// 单例
// ============================================================
let _instance = null;

export function getAppService() {
  if (!_instance) {
    _instance = new AppService();
  }
  return _instance;
}

export { TRACK, TRACK_CONFIG, QUEUE, STAGE, QUESTION_TYPE, SPEED_PRESETS };
