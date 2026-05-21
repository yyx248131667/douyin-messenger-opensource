/**
 * @file index.ts
 * @description Application Main Entrypoint (开源版)
 */

import { AppLifecycle } from './lifecycle/app-lifecycle';
import { ProtocolGuard } from './security/protocol-guard';
import { MainIpcHandler } from './ipc/main-handler';
import { GlobalAutomationService } from './services/global-automation.service';
import { ScriptService } from './services/script.service';
import { BtoolsService } from './services/btools.service';

// Force UTF-8
process.env.LANG = 'zh_CN.UTF-8';
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001'); } catch(e) {}
}

const safeLog = (prefix: string, args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ?
    (a instanceof Error ? a.stack || a.message : JSON.stringify(a)) : String(a)).join(' ');
  process.stdout.write(Buffer.from((prefix ? prefix + ' ' : '') + msg + '\n', 'utf8'));
};

console.log = (...args: any[]) => safeLog('', args);
console.warn = (...args: any[]) => safeLog('[WARN]', args);
console.error = (...args: any[]) => safeLog('[ERROR]', args);

console.log('=================================');
console.log('  Douyin Messenger - Open Source  ');
console.log('=================================');

AppLifecycle.initialize();
ProtocolGuard.initialize();
MainIpcHandler.register();

GlobalAutomationService.init();
ScriptService.init();
BtoolsService.init();
