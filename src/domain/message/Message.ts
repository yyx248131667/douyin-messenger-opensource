export type MessageStatus = 'pending' | 'processing' | 'success' | 'failed' | 'dead-letter';

export interface Message {
  id: string;             // 唯一消息ID
  accountId: string;      // 绑定的发信号
  accountName?: string;   // 绑定的发信号显示名称
  content: string;        // 消息正文内容
  timestamp: number;      // 创建时间
  status: MessageStatus;  // 状态流转
  retryCount: number;     // 已重试次数
  maxRetries: number;     // 最大允许的重试次数
  priority: number;       // 优先级 (数字越大越优先，如AI回关感谢弹幕 > 随机群发弹幕)
  nextRetryTime: number;  // 下次重试的毫秒时间戳，应对退避算法
}
