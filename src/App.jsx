/**
 * 根组件 - 路由配置
 *
 * 路由：
 *   /              → Dashboard（统计首页 + 推荐）
 *   /articles      → ArticleList（文章库）
 *   /article/:id   → ArticleReader（阅读 + TTS + 点词 + 短语高亮）
 *   /review        → ReviewSession（今日复习 + 双层判断 + 4题型）
 *   /settings      → Settings（语速/水平/轨道/重置）
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ArticleList from './pages/ArticleList.jsx';
import ArticleReader from './pages/ArticleReader.jsx';
import ReviewSession from './pages/ReviewSession.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/articles" element={<ArticleList />} />
            <Route path="/article/:id" element={<ArticleReader />} />
            <Route path="/review" element={<ReviewSession />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
