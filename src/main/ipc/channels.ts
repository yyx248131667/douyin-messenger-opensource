/**
 * @file channels.ts
 * @description 所有 IPC 通道名的唯一注册中心。
 * 
 * ⚠️ 规则：任何新增的 IPC 通道必须在此文件注册，禁止硬编码字符串！
 * 使用方式：import { IpcChannels } from './channels';
 */

export const IpcChannels = {
  // ==================== App Lifecycle ====================
  APP_READY: 'app-ready',
  APP_QUIT: 'app-quit',
  
  // ==================== Page / Tab Interactions ====================
  PAGE_ACTION: 'page-action',
  PAGE_ACTION_RESULT: 'page-action-result',
  API_ACTION_ACK: 'API_ACTION_ACK',
  UI_SWITCH_TAB: 'ui-switch-tab',
  
  // ==================== Account State ====================
  ACCOUNT_STATE_CHANGE: 'account-state-change',
  
  // ==================== Account CRUD ====================
  READ_ACCOUNTS: 'read-accounts',
  SAVE_ACCOUNTS: 'save-accounts',
  CLEAR_PARTITION_STORAGE: 'clear-partition-storage',
  GET_NATIVE_COOKIE_TOKENS: 'get-native-cookie-tokens',
  
  // ==================== Webview Management ====================
  WEBVIEW_FOCUS: 'webview-focus',
  WEBVIEW_RELOAD: 'webview-reload',
  WEBVIEW_CLEAR_CACHE: 'webview-clear-cache',

  // ==================== Automation ====================
  START_GLOBAL_SEND: 'start-global-send',
  STOP_GLOBAL_SEND: 'stop-global-send',
  GLOBAL_SEND_STOPPED: 'global-send-stopped',
  ROTATE_ADVANCE: 'rotate-advance',  // 轮转推进：通知渲染进程切换到下一个话术包并重启
  UPDATE_GLOBAL_SCRIPTS: 'update-global-scripts',
  QUEUE_STATS_GET: 'queue-stats-get',
  LIVE_STATUS_OFFLINE: 'live-status-offline',
  OFFLINE_PROTECTION_DISCONNECT: 'offline-protection-disconnect',  // 下播5分钟保护：断开网络
  
  // ==================== Config & Storage ====================
  CONFIG_GET: 'config-get',
  CONFIG_SET: 'config-set',
  GET_GIFTS_LIST: 'get-gifts-list',
  
  // ==================== Legacy / Migration ====================
  GET_LEGACY_METADATA: 'get-legacy-metadata',
  GET_LEGACY_ACCOUNTS: 'get-legacy-accounts',
  
  // ==================== Network ====================
  GET_NETWORK_STATE: 'get-network-state',
  NETWORK_STATE_CHANGE: 'network-state-change',

  // ==================== Signing ====================
  REQUEST_A_BOGUS: 'request-a-bogus',
  
  // ==================== Random Module ====================
  OPEN_RANDOM_WINDOW: 'open-random-window',
  HIDE_RANDOM_WINDOW: 'hide-random-window',
  SET_RANDOM_ALWAYS_ON_TOP: 'set-random-always-on-top',
  EXECUTE_RANDOM_SEND: 'execute-random-send',
  PUSH_RANDOM_LOG: 'push-random-log',

  // ==================== Gift Module ====================
  OPEN_GIFT_WINDOW: 'open-gift-window',
  HIDE_GIFT_WINDOW: 'hide-gift-window',
  SET_GIFT_ALWAYS_ON_TOP: 'set-gift-always-on-top',
  
  // ==================== Lottery Module ====================
  OPEN_LOTTERY_WINDOW: 'open-lottery-window',
  HIDE_LOTTERY_WINDOW: 'hide-lottery-window',
  SET_LOTTERY_ALWAYS_ON_TOP: 'set-lottery-always-on-top',
  EXECUTE_WEBVIEW_JS: 'execute-webview-js',
  REQUEST_ACCOUNTS: 'request-accounts',
  RECEIVE_ACCOUNTS: 'receive-accounts',
  
  // ==================== Lottery ====================
  CHECK_AND_CLAIM_LOTTERY: 'check-and-claim-lottery',
  
  // ==================== Debug & Log ====================
  LOG_MESSAGE: 'log-message',
  RENDERER_LOG: 'renderer-log',
  EXECUTE_MAIN_WORLD: 'execute-main-world',

  // ==================== Verification ====================
  OPEN_VERIFY_WINDOW: 'open-verify-window',
  SOLVE_IFRAME_CAPTCHA: 'solve-iframe-captcha',

  // ==================== License / Activation ====================
  LICENSE_GET_MACHINE_CODE: 'license-get-machine-code',
  LICENSE_ACTIVATE: 'license-activate',
  LICENSE_CHECK_STATUS: 'license-check-status',
  LICENSE_ACTIVATION_DONE: 'license-activation-done'
};
