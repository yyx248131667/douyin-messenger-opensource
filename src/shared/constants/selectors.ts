/**
 * @file selectors.ts
 * @description All constant DOM selectors used for operations and observers across platforms.
 */

export const DouyinSelectors = {
  chatInputs: [
    'div[data-e2e="living-chat-input"]',
    'div[contenteditable="true"][data-e2e*="chat"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="说点什么"]',
    'textarea',
    'input[type="text"]'
  ],
  sendButtons: [
    'button[data-e2e="living-chat-send-btn"]',
    'div[data-e2e="living-chat-send-btn"]',
    '[data-e2e="living-chat-send-btn"]',
    'button[data-e2e*="send"]',
    '[data-e2e*="send"]'
  ],
  closeButtons: [
    '[class*="close"]',
    '[class*="Close"]',
    '[aria-label="关闭"]',
    '[aria-label="close"]',
    'button[class*="modal"] [class*="close"]',
    '[class*="result"] [class*="close"]',
    '[class*="Result"] [class*="Close"]',
    '[class*="mask"]',
    '[class*="overlay"]'
  ],
  login: {
    avatar: [
      '[data-e2e="user-avatar"]',
      'img[src*="avatar"]'
    ],
    loginBtn: [
      '[data-e2e="login-btn"]'
    ]
  }
};
