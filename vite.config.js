import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置
// 算法层 src/ 下的 .js 文件是纯 ES 模块，Vite 原生支持直接 import
// TTS 用的 Web Speech API 是浏览器原生 API，无需额外配置
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  // 算法层文件在 src/ 下，与 React 组件共用同一 src/ 目录
  // resolve.alias 可按需添加，V1 不需要
});
