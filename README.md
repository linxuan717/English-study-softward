# 英语学习软件 - English Learning App

基于双维度分级 + 四阶段学习轨道 + 三层复习系统 + 简化版 SM-2 间隔重复算法的英语学习 Web 应用。

## 核心特性

- **双维度分级**：语言难度（词汇+句子+长度）+ 领域难度（术语+深度+特异性）
- **四阶段学习轨道**：通用基础 → 领域入门 → 领域专业 → 真实材料
- **动态新词配额**：按水平控制每篇新词数量（A1: 5-8 → C1-C2: 15-20）
- **双层评估 + 题型轮换**：再认题 → 回忆题 → 填空题 → 搭配题
- **三层复习系统**：文章内即时重复 → 文章后集中测试 → 跨文章 SM-2 调度
- **简化版 SM-2**：3 级映射（不认识/记错了/学会了），分队列差异化惩罚
- **TTS 语音朗读**：单句/整篇/5 档调速，浏览器原生 Web Speech API
- **短语高亮**：紫色统一高亮，点击查义，纳入复习系统
- **文章导入**：支持纯文本和 JSON 格式导入，自动评分分句

## 技术栈

- React 18 + Vite
- react-router-dom（路由）
- 原生 CSS（无 UI 框架依赖）
- Context API（状态管理）
- localStorage（数据持久化）
- 浏览器 Web Speech API（TTS）

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

## 项目结构

```
src/
├── main.jsx                    # React 入口
├── App.jsx                     # 路由配置
├── styles.css                  # 全局样式
├── context/
│   └── AppContext.jsx          # 全局状态
├── services/
│   └── appService.js           # 算法层桥接 + 数据管理
├── components/
│   ├── Layout.jsx              # 顶部导航
│   ├── TTSBar.jsx              # TTS 控制条
│   ├── WordPopup.jsx           # 点词查义弹窗
│   └── ReviewCard.jsx          # 复习卡片
├── pages/
│   ├── Dashboard.jsx           # 统计首页
│   ├── ArticleList.jsx         # 文章列表（含导入）
│   ├── ArticleReader.jsx       # 文章阅读
│   ├── ReviewSession.jsx       # 复习
│   └── Settings.jsx            # 设置
├── data/                       # 数据层（模型 + 词频表）
├── srs/                        # 间隔重复系统（SM-2 + 三层复习 + 评估）
├── grading/                    # 分级机制（双维度 + 轨道 + 新词配额）
└── features/                   # 功能模块（TTS + 短语）
```

## 部署到服务器

```bash
# 本地构建
npm run build

# 上传 dist/ 到服务器（见 deploy.sh）
./deploy.sh

# 配置 nginx（见 nginx-english-app.conf）
```

## 设计原则

算法复杂，界面简单；V1 做减法，后续做加法。
