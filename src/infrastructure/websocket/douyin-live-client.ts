/**
 * @file douyin-live-client.ts
 * @description 商业级纯血 Node.js Native WebSocket 弹幕客户端。
 * 彻底抛弃了 Python (server.py)，实现了高性能的多路复用连接与 Protobuf 数据流反序列化。
 */

import WebSocket from 'ws';
import zlib from 'zlib';
import path from 'path';
import protobuf from 'protobufjs';
import { DouyinSignService } from '../../main/plugins/douyin-sec/sign-service';

export interface DouyinLiveClientConfig {
  roomId: string;
  liveId: string;
  userId: string;
  ttwid: string;
  cookiesStr: string;
  userAgent: string;
}

export class DouyinLiveClient {
  private ws: WebSocket | null = null;
  private root: protobuf.Root | null = null;
  private config: DouyinLiveClientConfig;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(config: DouyinLiveClientConfig) {
    this.config = config;
  }

  /**
   * 初始化 Protobuf 文件加载
   */
  private async initProtobuf(): Promise<void> {
    if (this.root) return;
    try {
      // 在生产环境中路径可能会变，此处理想状态在 src 下有 protobuf 目录
      const protoPath = path.join(__dirname, '..', 'protobuf', 'Live.proto');
      this.root = await protobuf.load(protoPath);
      console.log('[DouyinLiveClient] Protobuf 模型 Live.proto 解析完成');
    } catch (e) {
      console.error('[DouyinLiveClient] 加载 Protobuf 文件失败. 可能是打包后路径错误:', e);
      throw e;
    }
  }

  /**
   * 启动直播间长连接监听
   */
  public async start(): Promise<void> {
    await this.initProtobuf();

    const signature = DouyinSignService.generateWsSignature(this.config.roomId, this.config.userId);
    if (!signature) {
      throw new Error('无法生成 WebSocket 连接所需的安全 Signature');
    }

    const wssParams = new URLSearchParams({
      app_name: 'douyin_web',
      version_code: '180800',
      webcast_sdk_version: '1.0.15',
      update_version_code: '1.0.15',
      compress: 'gzip',
      device_platform: 'web',
      cookie_enabled: 'true',
      screen_width: '1707',
      screen_height: '960',
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Mozilla',
      browser_version: this.config.userAgent.split('Mozilla/')[1] || '5.0',
      browser_online: 'true',
      tz_name: 'Etc/GMT-8',
      cursor: 't-1688172813959_r-1_d-1_u-1_h-1', // 初始默认时间游标
      internal_ext: '',
      host: 'https://live.douyin.com',
      aid: '6383',
      live_id: '1',
      did_rule: '3',
      endpoint: 'live_pc',
      support_wrds: '1',
      user_unique_id: this.config.userId,
      im_path: '/webcast/im/fetch/',
      identity: 'audience',
      need_persist_msg_count: '15',
      insert_task_id: '',
      live_reason: '',
      room_id: this.config.roomId,
      heartbeatDuration: '0',
      signature: signature
    });

    const wssUrl = `wss://webcast100-ws-web-hl.douyin.com/webcast/im/push/v2/?${wssParams.toString()}`;

    console.log(`[DouyinLiveClient] 正在为房间号 ${this.config.roomId} 建立 WSS 链路...`);
    
    this.ws = new WebSocket(wssUrl, {
      headers: {
        'Pragma': 'no-cache',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'User-Agent': this.config.userAgent,
        'Cache-Control': 'no-cache',
        ...(this.config.cookiesStr ? { 'Cookie': this.config.cookiesStr } : {})
      },
      origin: 'https://live.douyin.com',
      rejectUnauthorized: false
    });

    // Cookie injection has been moved to constructor options

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data as Buffer));
    this.ws.on('error', (err) => this.onError(err));
    this.ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
  }

  private onOpen() {
    console.log(`[DouyinLiveClient] ### WebSocket 通道开启 (Room: ${this.config.roomId}) ###`);
    this.startPing();
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        if (!this.root || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const PushFrame = this.root.lookupType('PushFrame');
        const frame = PushFrame.create({ payloadType: 'hb' });
        const buffer = PushFrame.encode(frame).finish();
        
        // 抖音特定 opcode
        this.ws.send(buffer, { binary: true });
      } catch (err) {
        console.error('[DouyinLiveClient] 发送心跳包抛出异常:', err);
      }
    }, 10000); // 抖音服务端心跳包维持要求通常在10秒左右
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async onMessage(message: Buffer) {
    if (!this.root) return;

    try {
      const PushFrame = this.root.lookupType('PushFrame');
      const frame: any = PushFrame.decode(message);

      // 解压 payload (GZIP)
      let originBytes: Buffer;
      try {
         originBytes = zlib.gunzipSync(frame.payload as Uint8Array);
      } catch (e) {
          // payload 不一定是 gzip 压缩的，也可能是明文
          originBytes = Buffer.from(frame.payload);
      }

      const LiveResponse = this.root.lookupType('LiveResponse');
      const response: any = LiveResponse.decode(originBytes);

      // Ack 防中断确认 (抖音规定如果 needAck 为 true 则必须原路返回内部拓展字段包)
      if (response.needAck && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const sFrame = PushFrame.create({
          payloadType: 'ack',
          payload: Buffer.from(response.internalExt || '', 'utf-8'),
          logId: frame.logId
        });
        const sBuffer = PushFrame.encode(sFrame).finish();
        this.ws.send(sBuffer, { binary: true });
      }

      // 开始遍历弹幕和各路消息
      for (const item of response.messagesList) {
        this.dispatchMessage(item);
      }

    } catch (err) {
      console.error('[DouyinLiveClient] 报文解包解析异常:', err);
    }
  }

  private dispatchMessage(item: any) {
    if (!this.root) return;
    
    try {
      if (item.method === 'WebcastGiftMessage') {
        const GiftMessage = this.root.lookupType('GiftMessage');
        const msg: any = GiftMessage.decode(item.payload);
        console.log(`[礼物] ${msg.user?.nickname} 送给 ${msg.toUser?.nickname} ${msg.gift?.name} x ${msg.comboCount}`);
        // 可以触发基于 IPC 转发或者全局 EventBus 广播
      } 
      else if (item.method === 'WebcastChatMessage') {
        const ChatMessage = this.root.lookupType('ChatMessage');
        const msg: any = ChatMessage.decode(item.payload);
        console.log(`[弹幕] ${msg.user?.nickname}: ${msg.content}`);
      } 
      else if (item.method === 'WebcastMemberMessage') {
        const MemberMessage = this.root.lookupType('MemberMessage');
        const msg: any = MemberMessage.decode(item.payload);
        console.log(`[进场] 大哥 ${msg.user?.nickname} 进入了直播间`);
      } 
      else if (item.method === 'WebcastLikeMessage') {
        const LikeMessage = this.root.lookupType('LikeMessage');
        const msg: any = LikeMessage.decode(item.payload);
        console.log(`[点赞] ${msg.user?.nickname} 点赞了 ${msg.count} 次`);
      }
    } catch (err) {
      console.log(`[DouyinLiveClient] 无法处理 Method: ${item.method}`);
    }
  }

  private onError(err: Error) {
    console.error(`[DouyinLiveClient] ### WebSocket 发生错误 (Room: ${this.config.roomId}) ###`, err);
  }

  private onClose(code: number, reason: string) {
    console.warn(`[DouyinLiveClient] ### WebSocket 已关闭状态 (Room: ${this.config.roomId}, Code: ${code}, Reason: ${reason}) ###`);
    this.stopPing();
    this.ws = null;

    // 生产环境中，此处可以加上断线自动重连指数退避策略机制 (Exponential Backoff Reconnect)
  }

  public stop() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
