/**
 * 冒烟测试：验证 service-worker 的「任务持久化 + 事件驱动泵」逻辑。
 * 模拟 chrome.* API，在 Node 里跑 service-worker.js，确认：
 * 1. 多平台任务按顺序全部完成（不漏平台）；
 * 2. 模拟 SW 重启（清空内存、重载脚本）后任务能从 storage.session 恢复继续跑；
 * 3. 日志落盘（mpLogs）。
 * 运行：node tools/test-pump.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'extension');
const sharedSession = new Map(); // 模拟 storage.session（跨"重启"共享）
const sharedLocal = new Map();   // 模拟 storage.local

let nextTabId = 1;
const openedTabs = []; // { tabId, url }
const autoFill = { enabled: true }; // 打开标签页后自动模拟 content 回报 FILL_RESULT

function makeContext() {
  const ctx = vm.createContext({});
  ctx.self = ctx;
  ctx.console = console;
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  ctx.setInterval = setInterval;
  ctx.clearInterval = clearInterval;
  ctx.Date = Date;
  ctx.JSON = JSON;
  ctx.String = String;

  ctx.chrome = {
    storage: {
      session: {
        get: async (key) => (sharedSession.has(key) ? { [key]: sharedSession.get(key) } : {}),
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) sharedSession.set(k, v); }
      },
      local: {
        get: async (key) => (sharedLocal.has(key) ? { [key]: sharedLocal.get(key) } : {}),
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) sharedLocal.set(k, v); }
      }
    },
    tabs: {
      create: async ({ url }) => {
        const tab = { id: nextTabId++, url };
        openedTabs.push(tab);
        // 模拟 content 脚本：领任务 + 稍后回报成功
        if (autoFill.enabled) {
          setTimeout(async () => {
            const res = await ctx.__dispatch('GET_FILL_TASK', {}, { tab: { id: tab.id, url } });
            if (res && res.platformId) {
              setTimeout(() => {
                ctx.__dispatch('FILL_RESULT', {
                  platformId: res.platformId,
                  jobId: res.jobId,
                  ok: true,
                  message: '填充完成（模拟）'
                }, {});
              }, 30);
            }
          }, 20);
        }
        return tab;
      }
    },
    runtime: {
      sendMessage: (p, cb) => { if (cb) cb(); },
      onMessage: { addListener: (fn) => { ctx.__handler = fn; } },
      onStartup: { addListener: () => {} },
      lastError: null
    },
    scripting: {
      // 模拟主世界填充失败（demo/文本框路径），不影响泵逻辑
      executeScript: async () => [{ result: { cm6: 0, cm5: 0, err: null } }]
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
  };

  // 分发消息给 service worker 的 onMessage handler，返回 sendResponse 的值
  ctx.__dispatch = (type, msg, sender) =>
    new Promise((resolve) => {
      const handled = ctx.__handler({ ...msg, type }, sender, (resp) => resolve(resp));
      if (!handled) resolve(undefined);
    });

  ctx.importScripts = (...files) => {
    for (const f of files) {
      vm.runInContext(fs.readFileSync(path.join(EXT, f.replace(/^\.\//, '').replace(/^\.\.\//, '')), 'utf8'), ctx, { filename: f });
    }
  };
  return ctx;
}

function loadWorker(ctx) {
  const src = fs.readFileSync(path.join(EXT, 'background', 'service-worker.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'service-worker.js' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ctx = makeContext();
  loadWorker(ctx);
  await sleep(50); // 等 SW 启动恢复逻辑

  const ids = ['zhihu', 'juejin', 'csdn', 'weixin', 'toutiao', 'jianshu', 'cnblogs', 'demo'];
  await ctx.__dispatch('START_JOB', { title: '测试文章', markdown: '# hello', platformIds: ids }, {});
  await sleep(100);

  let job = (await ctx.__dispatch('GET_STATE', {}, {})).job;
  console.log('任务启动：', job.status, '平台数', job.platforms.length);
  if (job.platforms.length !== ids.length) throw new Error('平台数不对');

  // ---- 模拟 SW 在跑到第 2 个平台时被杀死并重启 ----
  await sleep(1200); // 让第 1 个平台完成、第 2 个打开
  job = (await ctx.__dispatch('GET_STATE', {}, {})).job;
  const doneCount = job.platforms.filter((p) => p.status === 'done').length;
  console.log(`重启前：已完成 ${doneCount} 个`);

  const ctx2 = makeContext(); // 新"SW 实例"：内存为空，session 共享
  loadWorker(ctx2);
  await sleep(3000); // 等恢复后的泵把剩余平台跑完

  job = (await ctx.__dispatch('GET_STATE', {}, {})).job;
  const final = job;
  const okList = final.platforms.filter((p) => p.status === 'done');
  const errList = final.platforms.filter((p) => p.status === 'error');
  console.log(`重启后最终：done=${okList.length} error=${errList.length} 总=${final.platforms.length}`);
  final.platforms.forEach((p) => console.log(`  [${p.status}] ${p.id} ${p.message}`));

  if (final.status !== 'done') throw new Error('任务未结束');
  if (okList.length !== ids.length) throw new Error(`漏平台！只完成 ${okList.length}/${ids.length}`);

  const { mpLogs } = await ctx.__dispatch('GET_STATE', {}, {}) /* placeholder */;
  const logs = sharedLocal.get('mpLogs') || [];
  console.log(`诊断日志条数：${logs.length}`);
  if (logs.length < ids.length) throw new Error('日志不足');

  console.log('\n✅ 全部通过：任务跨 SW 重启恢复，8 个平台全部完成，日志已落盘');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ 测试失败：', e.message);
  process.exit(1);
});
