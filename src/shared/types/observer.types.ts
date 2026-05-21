/**
 * WebView 健康状态
 */
export enum WebViewHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNRESPONSIVE = 'unresponsive',
  CRASHED = 'crashed'
}

/**
 * 登录状态
 */
export enum LoginState {
  UNKNOWN = 'unknown',
  LOGGED_IN = 'logged_in',
  LOGGED_OUT = 'logged_out'
}

/**
 * 观测器状态
 */
export interface ObserverState {
  isRunning: boolean;
  lastCheckTime: number;
  checkCount: number;
  errorCount: number;
  avgCheckDuration: number;
}

/**
 * 心跳数据
 */
export interface HeartbeatData {
  webViewId?: number;
  timestamp: number;
  health: WebViewHealth;
  observerStates: Record<string, ObserverState>;
  memoryUsage?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
  pageInfo?: {
    url: string;
    title: string;
    readyState: DocumentReadyState;
  };
}

/**
 * 状态变化事件数据
 */
export interface StateChangeEvent<T> {
  previousState: T | null;
  currentState: T;
  confidence: number;
  consecutiveMatches: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 检测结果
 */
export interface DetectionResult<T> {
  state: T;
  confidence: number;
  metadata?: Record<string, unknown>;
}

/**
 * 观测器配置
 */
export interface ObserverConfig {
  /** 检查间隔 (毫秒) */
  checkInterval?: number;
  /** 防抖次数 (状态变化需要连续匹配的次数) */
  debounceThreshold?: number;
  /** 防抖重置超时 (毫秒) */
  debounceResetTimeout?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 最大错误重试次数 */
  maxErrorRetries?: number;
  /** 心跳间隔 (毫秒) */
  heartbeatInterval?: number;
}

/**
 * IPC 事件类型映射
 */
export interface IpcEventMap {
  // 状态变化事件
  'account-state-change': StateChangeEvent<LoginState>;
  'danmaku-detected': { content: string; sender?: string };
  'subtitle-detected': { text: string };
  'lottery-detected': { type: 'red_packet' | 'lottery'; elementPath: string };
  
  // 心跳事件
  'webview-heartbeat': HeartbeatData;
  'webview-ready': { timestamp: number; observers: string[] };
  'webview-error': { error: string; stack?: string; timestamp: number };
  
  // 命令响应
  'heartbeat-response': { timestamp: number };
  'automation-result': { success: boolean; data?: unknown; error?: string };
}
