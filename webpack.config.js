/**
 * @file webpack.config.js
 * @description High-performance Webpack configuration for Electron architecture.
 * Features: Multi-target compilation (Main, Preload, Renderer), strict mode, path alias resolution.
 */

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const isEnvProduction = process.env.NODE_ENV === 'production';

// 公共编译配方 (Shared TypeScript Resolver)
const commonConfig = {
  mode: isEnvProduction ? 'production' : 'development',
  devtool: isEnvProduction ? 'source-map' : 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'mitt': require.resolve('mitt')
    }
  },
  // 商业级防泄露优化: 即使报错也不要将源目录物理层次暴露给前端
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename], // 只要 config 改变就刷新构建缓存
    },
  },
};

// ============================================
// 1. Main Process (核心主进程管控)
// ============================================
const mainConfig = {
  ...commonConfig,
  target: 'electron-main',
  entry: {
    index: './src/main/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: '[name].js',
    clean: true // 每次编译前自动清理残留
  }
};

// ============================================
// 2. Preload Process (安全的沙盒防线)
// ============================================
const preloadConfig = {
  ...commonConfig,
  target: 'electron-preload',
  entry: {
    index: './src/preload/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/preload'),
    filename: '[name].js',
    clean: true
  },
};

// ============================================
// 3. Renderer Process (界面 UI / DOM 层)
// ============================================
const rendererConfig = {
  ...commonConfig,
  target: 'electron-renderer', // 使用 electron-renderer 以便直接在 UI 里调用 IPC (根据隔离安全级别可调整为 web)
  entry: {
    index: './src/renderer/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: '[name].js',
    clean: true
  },
  // 为了安全，UI 层不应该把 fs 和 child_process 强行打包进去，保持环境隔离
  externals: {
    fs: 'commonjs fs',
    path: 'commonjs path',
    child_process: 'commonjs child_process'
  },
  plugins: [
    // 复制静态 HTML/CSS 到 dist/renderer（clean:true 会清空目录，必须每次重新复制）
    new CopyPlugin({
      patterns: [
        { from: 'src/renderer/views', to: 'views' },
        { from: 'src/renderer/assets', to: 'assets' }
      ]
    })
  ]
};

module.exports = [mainConfig, preloadConfig, rendererConfig];
