/**
 * Background Service Worker：发布任务编排器（v0.3 重写）。
 *
 * 设计要点（解决「多平台漏发」）：
 * MV3 的 Service Worker 在长时间 await（等某个平台填充完成）时会被浏览器回收，
 * 旧实现把任务和 Promise resolver 全放在内存里，SW 一死整个循环就断了——
 * 表现为「勾选了 N 个平台，实际只同步了两三个」。
 *
 * 新实现：
 * 1. 任务持久化到 chrome.storage.session，SW 被杀后重启可恢复；
 * 2. 执行改为「事件驱动泵」：每打开一个平台的标签页就落库返回，
 *    由 content 脚本的 GET_FILL_TASK / FILL_RESULT / PING 消息唤醒继续推进；
 * 3. chrome.alarms 作为兜底看门狗，处理 content 脚本丢失的极端情况；
 * 4. 全链路写日志（含各平台结果），存 chrome.storage.local 供弹窗导出排查。
 */
'use strict';

importScripts('../common/platforms.js');

const PLATFORMS = self.MULTIPOST_PLATFORMS || [];
const FILL_TIMEOUT_MS = 150 * 1000; // 公众号需要「取 token → 跳编辑页」两跳，留足时间
const JOB_KEY = 'mpJob';
const LOG_KEY = 'mpLogs';
const MAX_LOGS = 800;

/* ================= 诊断日志 ================= */
let logBuf = [];
let logFlushTimer = null;
let logsLoaded = false;

async function ensureLogsLoaded() {
  if (logsLoaded) return;
  logsLoaded = true;
  try {
    const o = await chrome.storage.local.get(LOG_KEY);
    logBuf = Array.isArray(o[LOG_KEY]) ? o[LOG_KEY] : [];
  } catch (_) {
    logBuf = [];
  }
}

/**
 * 写一条日志。level: info | warn | error
 * 平台失败、任务流转、图床上传结果均落日志，弹窗可一键导出 .txt 排查。
 */
function log(level, platform, message, detail) {
  logBuf.push({
    t: Date.now(),
    level,
    platform: platform || '',
    message: String(message == null ? '' : message),
    detail: detail == null ? null : String(detail).slice(0, 2000)
  });
  if (logBuf.length > MAX_LOGS) logBuf = logBuf.slice(-MAX_LOGS);
  clearTimeout(logFlushTimer);
  logFlushTimer = setTimeout(flushLogs, 400);
}

async function flushLogs() {
  try {
    await chrome.storage.local.set({ [LOG_KEY]: logBuf });
  } catch (_) { /* ignore */ }
}

/* ================= 任务状态（持久化） ================= */
let job = null;

async function loadJob() {
  if (job) return job;
  try {
    const o = await chrome.storage.session.get(JOB_KEY);
    job = o[JOB_KEY] || null;
  } catch (_) {
    job = null;
  }
  return job;
}

async function saveJob() {
  try {
    await chrome.storage.session.set({ [JOB_KEY]: job });
  } catch (_) { /* ignore */ }
}

function snapshot() {
  return job ? JSON.parse(JSON.stringify(job)) : null;
}

function broadcast(payload) {
  try {
    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
  } catch (_) { /* popup 未打开等 */ }
}

function broadcastJob() {
  broadcast({ type: 'JOB_UPDATED', job: snapshot() });
}

/* ================= 执行泵 ================= */
let pumping = false;
let pumpQueued = false;

function schedulePump() {
  if (pumping) {
    pumpQueued = true;
    return;
  }
  pump().finally(() => {
    if (pumpQueued) {
      pumpQueued = false;
      schedulePump();
    }
  });
}

async function pump() {
  pumping = true;
  try {
    while (true) {
      await loadJob();
      if (!job || job.status !== 'running') return;

      // 1) 当前有平台正在填充：检查是否超时；未超时则等待事件唤醒
      const cur = job.platforms.find((p) => p.status === 'filling');
      if (cur) {
        const elapsed = Date.now() - (cur.startedAt || job.startedAt);
        if (elapsed <= FILL_TIMEOUT_MS) return;
        cur.status = 'error';
        cur.message = '等待编辑器加载超时（150 秒），请到该标签页手动粘贴内容';
        log('error', cur.id, '填充超时', cur.editorUrl);
        await saveJob();
        broadcastJob();
        continue; // 推进下一个平台
      }

      // 2) 取下一个待处理平台
      const next = job.platforms.find((p) => p.status === 'pending');
      if (!next) {
        await finishJob();
        return;
      }

      next.status = 'filling';
      next.startedAt = Date.now();

      // 复制模式平台（小红书/微博/X 等）：popup 已把内容写入剪贴板，
      // 只需打开页面并提示用户粘贴，无需 content 脚本填充。
      if (next.mode === 'copy') {
        next.status = 'done';
        next.message = '内容已在剪贴板，请在页面中 Ctrl+V 粘贴后发布';
        log('info', next.id, '复制模式：内容已复制，打开页面待粘贴', next.editorUrl);
        await saveJob();
        broadcastJob();
        try {
          await chrome.tabs.create({ url: next.editorUrl, active: true });
        } catch (err) {
          next.status = 'error';
          next.message = '打开页面失败：' + (err && err.message ? err.message : err);
          log('error', next.id, next.message);
          await saveJob();
          broadcastJob();
        }
        continue;
      }

      // 3) 打开编辑页，落库后即返回，等待 content 脚本事件驱动
      next.status = 'filling';
      await saveJob();
      broadcastJob();
      try {
        const tab = await chrome.tabs.create({ url: next.editorUrl, active: true });
        next.tabId = tab.id;
        log('info', next.id, '已打开编辑页', next.editorUrl);
        await saveJob();
        broadcastJob();
      } catch (err) {
        next.status = 'error';
        next.message = '打开编辑页失败：' + (err && err.message ? err.message : err);
        log('error', next.id, next.message);
        await saveJob();
        broadcastJob();
        continue;
      }
      await new Promise((r) => setTimeout(r, 800)); // 平台间稍作间隔
      // 循环下一轮会发现 filling 并 return，等 FILL_RESULT 唤醒
    }
  } finally {
    pumping = false;
  }
}

async function finishJob() {
  job.status = 'done';
  job.finishedAt = Date.now();
  const okList = job.platforms.filter((p) => p.status === 'done');
  const errList = job.platforms.filter((p) => p.status === 'error');
  log('info', '', `任务完成：成功 ${okList.length} / 失败 ${errList.length}，共 ${job.platforms.length} 个平台`);
  for (const p of errList) {
    log('error', p.id, `失败原因：${p.message || '未知'}`);
  }
  await saveJob();
  broadcastJob();
  await saveHistory();
}

async function saveHistory() {
  if (!job) return;
  const entry = {
    jobId: job.id,
    title: job.title,
    markdown: job.markdown,
    themeId: job.themeId || null,
    finishedAt: job.finishedAt,
    platforms: job.platforms.map((p) => ({ id: p.id, name: p.name, status: p.status, message: p.message }))
  };
  try {
    const { history = [] } = await chrome.storage.local.get('history');
    history.unshift(entry);
    await chrome.storage.local.set({ history: history.slice(0, 10) });
  } catch (_) { /* ignore */ }
}

async function startJob({ title, markdown, platformIds, themeId }) {
  await loadJob();
  if (job && job.status === 'running') {
    broadcast({ type: 'JOB_UPDATED', job: snapshot(), error: '已有同步任务在进行中' });
    return;
  }
  const platforms = (platformIds || [])
    .map((id) => PLATFORMS.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => ({
      id: p.id,
      name: p.name,
      editorUrl: p.editorUrl,
      mode: p.mode || 'fill',
      status: 'pending', // pending | filling | done | error
      message: '',
      tabId: null,
      startedAt: null
    }));

  job = {
    id: 'job-' + Date.now(),
    title,
    markdown,
    themeId: themeId || null,
    startedAt: Date.now(),
    finishedAt: null,
    status: platforms.length ? 'running' : 'done',
    platforms
  };
  log('info', '', `开始新任务（${platforms.length} 个平台${themeId ? '，主题 ' + themeId : ''}）：${title}`);
  await saveJob();
  broadcastJob();
  schedulePump();
}

/* ================= 主世界填充（CM6/CM5 直写） ================= */

/**
 * 在页面主世界执行的填充函数（chrome.scripting world:'MAIN'）。
 * 关键：CodeMirror 6（掘金 bytemd、CSDN 新编辑器）把 EditorView 实例挂在
 * DOM 对象属性 cmView 上，该属性只有页面主世界可见，内容脚本隔离世界读不到——
 * 所以必须在主世界 dispatch。CodeMirror 5 同理（el.CodeMirror）。
 * 返回 { cm6, cm5, err }。
 */
function mpMainWorldFiller(md) {
  const out = { cm6: 0, cm5: 0, pasted: 0, err: null };
  try {
    const seen = new Set();
    const nodes = document.querySelectorAll('.cm-editor, .cm-content');
    for (const el of nodes) {
      let v = null;
      try {
        const cv = el.cmView;
        if (cv) v = (cv.view && typeof cv.view.dispatch === 'function') ? cv.view : cv;
      } catch (_) { /* ignore */ }
      if (v && typeof v.dispatch === 'function' && v.state && v.state.doc && !seen.has(v)) {
        seen.add(v);
        try {
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: md } });
          if (v.state.doc.toString().length > 0) out.cm6++;
        } catch (_) { /* ignore */ }
      }
    }
    if (out.cm6 > 0) return out;
    for (const el of document.querySelectorAll('.CodeMirror')) {
      try {
        if (el.CodeMirror && typeof el.CodeMirror.setValue === 'function') {
          el.CodeMirror.setValue(md);
          el.CodeMirror.refresh && el.CodeMirror.refresh();
          out.cm5++;
        }
      } catch (_) { /* ignore */ }
    }
    if (out.cm5 > 0) return out;
    // 兜底：CM 实例属性不可见（cmView/CodeMirror 拿不到）时，
    // 在主世界对 .cm-content 派发合成 paste —— CM6 原生 paste 处理器会同步应用文本。
    // 只执行一次，防止轮询重复插入。
    if (!window.__mpPastedOnce && md && md.length) {
      const cm = document.querySelector('.cm-content[contenteditable="true"]');
      if (cm) {
        try {
          cm.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', md);
          cm.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          window.__mpPastedOnce = true;
          if ((cm.textContent || '').length > 0) out.pasted++;
        } catch (_) { /* ignore */ }
      }
    }
  } catch (e) {
    out.err = String((e && e.message) || e);
  }
  return out;
}

async function mainWorldFill(sender, markdown) {
  if (!sender.tab || sender.tab.id == null) return { ok: false, error: 'no tab' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: mpMainWorldFiller,
      args: [String(markdown || '')]
    });
    const r = results && results[0] && results[0].result;
    if (r && (r.cm6 > 0 || r.cm5 > 0 || r.pasted > 0)) {
      return { ok: true, cm6: r.cm6, cm5: r.cm5 };
    }
    return { ok: false, error: r && r.err ? r.err : 'not found' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * 在页面主世界执行的富文本填充（chrome.scripting world:'MAIN'）。
 * 背景：公众号 ProseMirror 等受控编辑器会把隔离世界的 DOM 直写回滚，且内容脚本
 * 世界的焦点/execCommand 易被页面抢占，导致内容写进标题框等错误容器。
 * 主世界执行：按 selectors 定位可见正文容器 → 合成 paste → 校验 → insertHTML 兜底。
 * 返回 { ok, how, err }。
 */
function mpMainWorldRichFiller(selectors, html, text) {
  const out = { ok: false, how: '', err: null };
  try {
    let el = null;
    for (const sel of (selectors || [])) {
      try {
        for (const c of document.querySelectorAll(sel)) {
          const r = c.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el = c; break; }
        }
      } catch (_) { /* 非法选择器忽略 */ }
      if (el) break;
    }
    if (!el) { out.err = 'no editor'; return out; }
    el.focus();
    try {
      const dt = new DataTransfer();
      if (html != null && html.length) dt.setData('text/html', html);
      if (text != null && text.length) dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (_) { /* ignore */ }
    if ((el.textContent || '').trim().length > 0) { out.ok = true; out.how = 'paste'; return out; }
    // paste 未被识别 → execCommand insertHTML（主世界同步执行，焦点不会被抢占）
    el.focus();
    document.execCommand('selectAll', false, null);
    const htmlPayload = (html && html.length) ? html
      : String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, htmlPayload);
    out.ok = (el.textContent || '').trim().length > 0;
    out.how = out.ok ? 'insertHTML' : '';
    if (!out.ok) out.err = 'paste 与 insertHTML 均未生效';
  } catch (e) {
    out.err = String((e && e.message) || e);
  }
  return out;
}

async function mainWorldRichFill(sender, { selectors, html, text }) {
  if (!sender.tab || sender.tab.id == null) return { ok: false, error: 'no tab' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: mpMainWorldRichFiller,
      args: [Array.isArray(selectors) ? selectors : [], String(html || ''), String(text || '')]
    });
    const r = results && results[0] && results[0].result;
    if (r && r.ok) return { ok: true, how: r.how };
    return { ok: false, error: (r && r.err) || 'not found' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* ================= 图床上传 ================= */
/**
 * 为 catbox.moe 请求补齐浏览器指纹头（Referer/Origin/UA）。
 * 背景：SW 发出的 fetch 带 Origin: chrome-extension:// 且无 Referer，
 * 会被 catbox 风控以 "Invalid uploader" 拒收；这三项是浏览器禁止在 fetch
 * 里手动设置的头，只能通过 declarativeNetRequest 会话规则改写。
 */
async function ensureCatboxHeaders() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ['mp-catbox-headers'],
      addRules: [{
        id: 'mp-catbox-headers',
        priority: 1,
        condition: { urlFilter: '||catbox.moe/', resourceTypes: ['xmlhttprequest'] },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://catbox.moe/' },
            { header: 'Origin', operation: 'set', value: 'https://catbox.moe' },
            { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }
          ]
        }
      }]
    });
  } catch (_) { /* 环境不支持 DNR 时静默跳过（测试 mock / 老版本浏览器） */ }
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** 按点分路径从 JSON 对象取值，如 'data.url' */
function pickPath(obj, path) {
  try {
    return String(path || 'data.url').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  } catch (_) { return undefined; }
}

/** 单个图床的上传尝试。返回 { ok, url } 或 { ok: false, error } */
async function uploadViaProvider(provider, cfg, { blob, dataUrl, fileName }) {
  const form = new FormData();
  const headers = {};
  let url;
  let parseMode = 'json'; // catbox 返回纯文本直链，其余为 JSON

  switch (provider) {
    case 'catbox': {
      // Catbox.moe：免注册、无数量限制、单图最大 200MB、永久有效
      url = 'https://catbox.moe/user/api.php';
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', blob, fileName || 'image.png');
      parseMode = 'text';
      // catbox 反滥用风控（Invalid uploader）会校验请求来源指纹；
      // Referer/Origin/UA 由 ensureCatboxHeaders 通过 DNR 会话规则统一补齐
      break;
    }
    case 'freeimage': {
      // freeimage.host：免注册可用（内置公共 Key，可替换成自己的免费 Key），永久有效
      url = 'https://freeimage.host/api/1/upload';
      form.append('action', 'upload');
      form.append('source', blob, fileName || 'image.png');
      form.append('format', 'json');
      form.append('key', (cfg.freeimageKey || '').trim() || '6d207e02198a847aa98d0a2a901485a5');
      break;
    }
    case 'imgbb': {
      // imgbb.com：免费注册拿 API Key，无数量限制、单图 32MB、永久有效
      const key = (cfg.imgbbKey || '').trim();
      if (!key) {
        return { ok: false, error: 'ImgBB 需要先免费注册获取 API Key（api.imgbb.com → Dashboard → API），填到图床设置里即可' };
      }
      url = 'https://api.imgbb.com/1/upload?key=' + encodeURIComponent(key);
      form.append('image', String(dataUrl).split(',')[1] || ''); // imgbb 接受 base64 字段
      break;
    }
    case 'smms': {
      // SM.MS：匿名上传已收紧（返回"未授权"），现需免费 Token（Basic 认证）
      url = 'https://sm.ms/api/v2/upload';
      form.append('file', blob, fileName || 'image.png');
      const token = (cfg.smmsToken || '').trim();
      if (token) headers.Authorization = /^Basic\s/i.test(token) ? token : 'Basic ' + token;
      break;
    }
    default: {
      // 自定义接口
      url = cfg.customUrl;
      if (!url) {
        return { ok: false, error: '未配置自定义图床地址，请到弹窗「图床设置」里配置' };
      }
      if (cfg.customHeaderName && cfg.customHeaderValue) {
        headers[cfg.customHeaderName] = cfg.customHeaderValue;
      }
      form.append('file', blob, fileName || 'image.png');
    }
  }

  let respText;
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: form });
    respText = await resp.text();
  } catch (err) {
    const msg = '上传请求失败：' + (err && err.message ? err.message : err) +
      (provider === 'catbox' ? '（catbox.moe 在部分网络下 SSL 握手失败或被拦截）' : '');
    return { ok: false, error: msg };
  }

  // 按图床解析返回
  let link = null;
  let rawHint = '';
  if (parseMode === 'text') {
    link = (respText || '').trim();
    if (link && !/^https?:\/\//.test(link)) link = null;
    if (!link) {
      // catbox 风控拒收的典型响应："Invalid uploader"（与配置无关，IP/请求特征被反滥用系统拦截）
      if (/invalid uploader/i.test(respText)) {
        return { ok: false, error: 'catbox 风控拦截（Invalid uploader）：请求被其反滥用系统拒收，与配置无关，已自动改用其他图床' };
      }
      rawHint = respText;
    }
  } else {
    let respJson = null;
    try { respJson = JSON.parse(respText); } catch (_) { /* ignore */ }
    if (provider === 'smms') {
      link = respJson && respJson.data && (respJson.data.url || respJson.data.link);
      // SM.MS 匿名上传已停用：明确提示去领免费 Token
      if (!link && respJson && /未授权|unauthorized/i.test(respJson.message || '')) {
        return { ok: false, error: 'SM.MS 匿名上传已被官方停用（返回"未授权"）：到 sm.ms 免费注册 → Dashboard → API Keys 领取 Token 填入图床设置' };
      }
    } else if (provider === 'freeimage') {
      link = pickPath(respJson, 'image.url');
    } else if (provider === 'imgbb') {
      link = pickPath(respJson, 'data.url');
    } else {
      link = pickPath(respJson, cfg.customJsonPath);
    }
    if (!link || typeof link !== 'string') rawHint = respText;
  }

  if (!link) {
    return { ok: false, error: '上传返回中未找到图片链接：' + String(rawHint || respText).slice(0, 200) };
  }
  return { ok: true, url: link };
}

/**
 * 图床上传（带自动兜底链）：
 * 选中图床上传失败时，自动依次尝试其他可用图床（免配置的 catbox/freeimage 优先），
 * 需要密钥的 imgbb/smms 仅在已配置时参与兜底。任一成功即返回，并注明是否走了兜底。
 * 解决 catbox 风控拦截（Invalid uploader）/ SSL 失败导致的「图片上传报错」。
 */
async function uploadImage({ dataUrl, fileName }) {
  let cfg = {};
  try { ({ bedConfig: cfg = {} } = await chrome.storage.local.get('bedConfig')); } catch (_) { /* ignore */ }
  const provider = cfg.provider || 'catbox';
  const blob = dataUrlToBlob(dataUrl);
  await ensureCatboxHeaders();

  // 兜底链：catbox 风控激进（Invalid uploader），免密钥的 freeimage 排最前，
  // 选中图床失败后按此顺序依次尝试；需密钥的仅在已配置时参与
  const chain = [provider];
  for (const p of ['freeimage', 'catbox', 'imgbb', 'smms']) {
    if (chain.includes(p)) continue;
    // 未配置密钥的图床不参与兜底（必然失败，跳过）
    if (p === 'imgbb' && !(cfg.imgbbKey || '').trim()) continue;
    if (p === 'smms' && !(cfg.smmsToken || '').trim()) continue;
    chain.push(p);
  }

  const attempts = [];
  for (const p of chain) {
    log('info', '', `图床上传开始（${p}${p === provider ? '' : '，兜底'}，${fileName || 'image'}，${Math.round(blob.size / 1024)}KB）`);
    const r = await uploadViaProvider(p, cfg, { blob, dataUrl, fileName });
    if (r.ok) {
      if (p !== provider) log('info', '', `${provider} 失败后由 ${p} 兜底成功：${r.url}`);
      return {
        ok: true,
        url: r.url,
        provider: p,
        note: p === provider ? '' : `${provider} 失败，已自动改用 ${p}`
      };
    }
    attempts.push(p + ': ' + r.error);
    log('error', '', `图床 ${p} 上传失败：${r.error}`);
  }
  const err = '所有可用图床均上传失败。' + attempts.join(' | ');
  log('error', '', err);
  return { ok: false, error: err.slice(0, 600) };
}

/* ================= 看门狗 ================= */
chrome.alarms.create('mp-watchdog', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mp-watchdog') schedulePump();
});

/* ================= SW 启动恢复 ================= */
chrome.runtime.onStartup.addListener(() => schedulePump());
loadJob().then((j) => {
  if (j && j.status === 'running') {
    log('info', '', 'Service Worker 重启，恢复未完成的同步任务');
    schedulePump();
  }
});

/* ================= 消息路由 ================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'START_JOB':
      startJob(msg).catch((err) => log('error', '', '任务启动失败：' + err));
      sendResponse({ ok: true });
      break;

    case 'GET_STATE':
      loadJob().then((j) => sendResponse({ job: j ? snapshot() : null }));
      return true;

    case 'UPLOAD_IMAGE':
      uploadImage(msg).then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;

    case 'MAIN_WORLD_FILL':
      mainWorldFill(sender, msg.markdown).then(sendResponse);
      return true;

    case 'MAIN_WORLD_FILL_RICH':
      mainWorldRichFill(sender, msg).then(sendResponse);
      return true;

    case 'LOAD_MATHJAX':
      // 把 MathJax 注入发起请求的 content script 所在的隔离世界（与内容脚本
      // 共享同一隔离世界，注入后 self.MathJax 直接可用）。执行 files 注入
      // 不受页面 CSP 限制。懒加载：仅在文章含公式时才会走到这里。
      (async () => {
        try {
          if (!sender.tab || sender.tab.id == null) return sendResponse({ ok: false, error: 'no tab' });
          await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            files: ['vendor/mathjax/tex-svg.js']
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;

    case 'LOG':
      ensureLogsLoaded().then(() => {
        log(msg.level || 'info', msg.platform || '', msg.message || '', msg.detail);
      });
      sendResponse({ ok: true });
      break;

    case 'GET_FILL_TASK': {
      // 仅当该标签页确实由当前任务打开时，才下发任务
      loadJob().then((j) => {
        let task = null;
        if (j && j.status === 'running' && sender.tab && sender.tab.id != null) {
          const p = j.platforms.find(
            (x) => x.tabId === sender.tab.id && (x.status === 'pending' || x.status === 'filling')
          );
          if (p) {
            if (p.status === 'pending') {
              p.status = 'filling';
              p.startedAt = Date.now();
              saveJob().then(broadcastJob);
            }
            log('info', p.id, '内容脚本领取到填充任务', sender.tab.url);
            task = {
              jobId: j.id,
              platformId: p.id,
              article: { title: j.title, markdown: j.markdown, themeId: j.themeId || null }
            };
          }
        }
        sendResponse(task);
        schedulePump();
      });
      return true;
    }

    case 'FILL_RESULT': {
      loadJob().then((j) => {
        if (j) {
          const p = j.platforms.find((x) => x.id === msg.platformId);
          if (p && (p.status === 'filling' || p.status === 'pending')) {
            p.status = msg.ok ? 'done' : 'error';
            p.message = msg.message || '';
            log(msg.ok ? 'info' : 'error', p.id, (msg.ok ? '填充完成：' : '填充失败：') + (msg.message || ''));
            saveJob().then(broadcastJob);
          }
        }
        schedulePump();
      });
      sendResponse({ ok: true });
      break;
    }

    case 'PING':
      // content 脚本填充期间的心跳：既保活 SW，也驱动超时检查
      schedulePump();
      sendResponse({ ok: true });
      break;
  }
  return false;
});
