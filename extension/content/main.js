/**
 * 内容脚本主入口：
 * 1. 按 hostname 匹配适配器；
 * 2. 向 background 领取填充任务；
 * 3. 执行填充并显示「可拖拽 / 可关闭 / 可最小化」的进度浮层；
 * 4. 富文本平台按所选主题内联样式（mdnice 思路）；
 * 5. 填充期间发送心跳（保活 background 并驱动超时检查），全链路上报诊断日志。
 */
(function () {
  'use strict';
  if (window.__MULTIPOST_MAIN__) return; // 防重复注入
  window.__MULTIPOST_MAIN__ = true;

  // 后台探测本标签页内容脚本是否存活（扩展重载后旧脚本失联，
  // background 用它快速判失败，避免每平台白等 150 秒超时）
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'MP_PING') sendResponse({ pong: true });
      return false; // 同步应答，无需保持消息端口
    });
  } catch (_) { /* ignore */ }

  const U = self.__MULTIPOST_UTIL__;
  const ADAPTERS = self.__MULTIPOST_ADAPTERS__ || [];
  const THEMES = self.MULTIPOST_THEMES || [];

  function pickAdapter() {
    for (const ad of ADAPTERS) {
      if (typeof ad.match === 'function') {
        try { if (ad.match(location.href)) return ad; } catch (_) { /* ignore */ }
        continue;
      }
      const hosts = ad.hosts || [];
      const host = location.hostname;
      const hit = hosts.some((h) => host === h || host.endsWith('.' + h));
      if (hit) return ad;
    }
    return null;
  }

  /** 诊断日志上报（background 持久化，弹窗可导出） */
  function mpLog(level, message, detail) {
    try {
      chrome.runtime.sendMessage({
        type: 'LOG',
        level,
        platform: adapter ? adapter.id : '',
        message,
        detail: detail || location.href
      }, () => void chrome.runtime.lastError);
    } catch (_) { /* ignore */ }
  }

  /* ---------------- 浮层 UI：可拖拽 / 可关闭 / 可最小化 ---------------- */
  let overlayEl = null;
  let statusEl = null;
  let autoMinTimer = null;
  const POS_KEY = 'mpOverlayPos';

  function saveOverlayPos() {
    if (!overlayEl) return;
    try {
      const r = overlayEl.getBoundingClientRect();
      sessionStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
    } catch (_) { /* ignore */ }
  }

  function restoreOverlayPos() {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        overlayEl.style.right = 'auto';
        overlayEl.style.top = Math.max(4, pos.top) + 'px';
        overlayEl.style.left = Math.max(4, pos.left) + 'px';
      }
    } catch (_) { /* ignore */ }
  }

  /** 让浮层头部可拖拽（避开按钮），拖动范围限制在视口内 */
  function makeDraggable(el, handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      sx = e.clientX; sy = e.clientY;
      el.style.right = 'auto';
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = el.getBoundingClientRect();
      const nx = Math.min(Math.max(4, ox + e.clientX - sx), window.innerWidth - r.width - 4);
      const ny = Math.min(Math.max(4, oy + e.clientY - sy), window.innerHeight - 36);
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });
    const stop = () => {
      if (dragging) { dragging = false; saveOverlayPos(); }
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function showOverlay(platformName) {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'multipost-overlay';
    overlayEl.innerHTML = `
      <div class="mp-ov-header">
        <span class="mp-ov-logo">↗</span>
        <span class="mp-ov-title">多平台转发助手 · ${U.escapeHtml(platformName)}</span>
        <button class="mp-ov-min" title="最小化">—</button>
        <button class="mp-ov-close" title="关闭浮层（不影响后台填充）">×</button>
      </div>
      <div class="mp-ov-body">
        <div class="mp-ov-status">正在连接任务…</div>
        <div class="mp-ov-tip">浮层可拖拽；填充完成后请人工检查，再点平台自带的「发布」</div>
      </div>
    `;
    document.documentElement.appendChild(overlayEl);
    statusEl = overlayEl.querySelector('.mp-ov-status');
    restoreOverlayPos();
    makeDraggable(overlayEl, overlayEl.querySelector('.mp-ov-header'));

    overlayEl.querySelector('.mp-ov-close').addEventListener('click', () => {
      clearTimeout(autoMinTimer);
      overlayEl.remove();
      overlayEl = null;
      statusEl = null;
    });
    overlayEl.querySelector('.mp-ov-min').addEventListener('click', toggleMin);
  }

  function toggleMin() {
    if (!overlayEl) return;
    const min = overlayEl.classList.toggle('mp-ov-min');
    overlayEl.querySelector('.mp-ov-min').textContent = min ? '▾' : '—';
    saveOverlayPos();
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('mp-ov-error', !!isError);
    statusEl.classList.toggle('mp-ov-ok', !isError && /完成/.test(text));
    if (overlayEl) overlayEl.classList.remove('mp-ov-min');
  }

  /* ---------------- 主流程 ---------------- */
  let adapter = null;
  let pingTimer = null;

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'PING' }, () => void chrome.runtime.lastError);
      } catch (_) { stopPing(); }
    }, 20000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  async function main() {
    adapter = pickAdapter();
    if (!adapter) return;

    let task = null;
    try {
      task = await chrome.runtime.sendMessage({
        type: 'GET_FILL_TASK',
        hostname: location.hostname,
        url: location.href
      });
    } catch (_) { /* 扩展上下文失效等情况 */ }
    if (!task || !task.article || !task.platformId) return;

    mpLog('info', '开始填充（' + adapter.name + '）');
    showOverlay(adapter.name);
    setStatus('正在等待编辑器加载…');
    startPing();

    // 给编辑器 SPA 一点初始化时间
    await U.sleep(1200);

    // 规整源文本：折叠连续空行、去行尾空格（提高所有平台排版紧凑度）
    const markdown = U.normalizeMd(task.article.markdown);

    // 计算富文本 HTML：若任务带了主题，则按主题内联样式（公众号/知乎/头条生效）
    let html = U.mdToHtml(markdown);
    // 无 <br> 的块级版本：知乎 DraftJS 会把 <br> 渲染成空段落
    let htmlNoBr = U.mdToHtmlNoBreaks(markdown);
    const themeId = task.article.themeId;
    if (themeId && self.MULTIPOST_APPLY_THEME) {
      const theme = THEMES.find((t) => t.id === themeId);
      if (theme) {
        html = self.MULTIPOST_APPLY_THEME(html, theme);
        htmlNoBr = self.MULTIPOST_APPLY_THEME(htmlNoBr, theme);
        mpLog('info', '已套用主题样式：' + theme.name);
      }
    }

    let result = { ok: false, message: '未知错误' };
    try {
      result = await adapter.fill({
        title: task.article.title,
        markdown,
        html,
        htmlNoBr,
        themeId: task.article.themeId,
        // 统一「封面 + 标签」：适配器里由 withCoverAndTags 消费（尽力而为，不影响正文）
        cover: task.article.cover || null,
        coverFromArticle: !!task.article.coverFromArticle,
        tags: Array.isArray(task.article.tags) ? task.article.tags : []
      });
    } catch (err) {
      result = { ok: false, message: '填充异常：' + (err && err.message ? err.message : String(err)) };
    }

    stopPing();

    if (result.silent) {
      // 适配器正在做页面跳转（如公众号取 token 后跳编辑页）：
      // 本次不回报结果，background 继续等待；跳转后新页面的内容脚本会重新领取任务。
      setStatus(result.message || '正在跳转…');
      return;
    }

    if (!result.ok && !task.article.noCopyFallback) {
      // 复制兜底：按平台类型复制适用格式，并明确提示粘贴位置——
      // 此前统一复制「标题+正文」纯文本，用户粘到标题框导致全文进了标题（公众号教训）
      const platform = (self.MULTIPOST_PLATFORMS || []).find((p) => p.id === task.platformId);
      const useMd = platform ? (platform.mode === 'copy' || platform.copyFormat === 'md') : true;
      let copied = false;
      let tip;
      if (useMd) {
        copied = await U.copyToClipboard(task.article.title + '\n\n' + markdown);
        tip = '已复制「标题 + Markdown」：标题粘到标题框，其余粘到正文编辑区';
      } else {
        // 富文本平台：复制仅正文的主题 HTML（text/html 通道，粘进正文保留排版）。
        // plain 通道只放正文 markdown——若用户误粘到标题框，也不会把标题重复带进去
        copied = await U.copyRichToClipboard(html, markdown);
        tip = '已复制正文（富文本）：标题通常已自动填充；请点击正文编辑区（标题框下方的空白区）再 Ctrl+V，不要粘到标题框';
      }
      if (copied) {
        result.message = (result.message || '填充失败') + '；' + tip;
      }
    }

    if (result.ok) {
      setStatus('填充完成 ✓ 请检查内容后，手动点击该平台的「发布」按钮');
      mpLog('info', '填充完成：' + (result.message || ''));
      // 成功后 6 秒自动最小化成小胶囊，不挡编辑器按钮
      autoMinTimer = setTimeout(() => {
        if (overlayEl && !overlayEl.classList.contains('mp-ov-min')) toggleMin();
      }, 6000);
    } else {
      setStatus('填充失败：' + result.message, true);
      mpLog('error', '填充失败：' + result.message);
    }

    try {
      chrome.runtime.sendMessage({
        type: 'FILL_RESULT',
        platformId: task.platformId,
        jobId: task.jobId,
        ok: result.ok,
        message: result.message || ''
      }, () => void chrome.runtime.lastError);
    } catch (_) { /* ignore */ }
  }

  main();
})();
