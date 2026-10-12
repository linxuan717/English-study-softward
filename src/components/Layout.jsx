/**
 * 布局组件 - 顶部导航 + 内容区
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { TRACK_CONFIG } from '../services/appService.js';

export default function Layout() {
  const { user } = useApp();
  const trackName = TRACK_CONFIG[user.currentTrack]?.name || '通用基础';

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>英语学习</h1>
        <nav>
          <ul className="nav-links">
            <li><NavLink to="/" end>首页</NavLink></li>
            <li><NavLink to="/articles">文章</NavLink></li>
            <li><NavLink to="/review">复习</NavLink></li>
            <li><NavLink to="/settings">设置</NavLink></li>
          </ul>
        </nav>
        <div className="user-badge">
          <span className="level">{user.level}</span>
          <span>{trackName}</span>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
