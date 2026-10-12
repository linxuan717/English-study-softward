/**
 * 全局应用状态 Context
 *
 * 持有 AppService 单例，为所有页面提供统一的算法层访问入口。
 * V1 用 Context API 足够，无需 Redux。
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { getAppService, SPEED_PRESETS } from '../services/appService.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const service = useMemo(() => getAppService(), []);

  // ---- 触发重渲染的状态 ----
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  // ---- TTS 状态 ----
  const [ttsState, setTtsState] = useState(service.tts.getState());
  const updateTtsState = useCallback(() => setTtsState(service.tts.getState()), [service]);

  // ---- 当前阅读的文章 ----
  const [currentArticleId, setCurrentArticleId] = useState(null);

  const value = useMemo(() => ({
    service,
    refresh,
    tick,
    // TTS
    tts: service.tts,
    ttsState,
    updateTtsState,
    // 当前阅读
    currentArticleId,
    setCurrentArticleId,
    // 便捷访问
    user: service.user,
    articles: service.articles,
    wordCards: service.wordCards
  }), [service, refresh, tick, ttsState, updateTtsState, currentArticleId]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp 必须在 AppProvider 内使用');
  }
  return ctx;
}

export { SPEED_PRESETS };
