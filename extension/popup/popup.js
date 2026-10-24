/**
 * Popup 逻辑：文章编辑、平台勾选、发起同步、进度与历史展示。
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const PLATFORMS = self.MULTIPOST_PLATFORMS || [];

const state = {
  job: null,
  selected: new Set(),
  coverDataUrl: null,
  coverName: ''
};

/* ---------------- 持久化草稿与勾选 ---------------- */
const draftSave = debounce(async () => {
  await chrome.storage.local.set({
    draft: {
      title: $('#title').value,
      markdown: $('#markdown').value,
      tags: $('#tags-input') ? $('#tags-input').value : '',
      coverDataUrl: state.coverDataUrl,
      coverName: state.coverName,
      coverFromArticle: !!( $('#cover-from-article') && $('#cover-from-article').checked )
    },
    selected: [...state.selected]
  });
}, 400);

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- 平台勾选 ---------------- */
function renderPlatforms() {
  const grid = $('#platform-grid');
  grid.innerHTML = '';
  for (const p of PLATFORMS) {
    const item = document.createElement('label');
    item.className = 'platform-item' + (state.selected.has(p.id) ? ' checked' : '');
    item.innerHTML = `
      <input type="checkbox" ${state.selected.has(p.id) ? 'checked' : ''} />
      <span class="p-dot" style="background:${p.color}"></span>
      <span class="p-name">${p.name}</span>
      ${p.mode === 'copy' ? '<span class="p-flag p-copy" title="复制模式：内容自动复制到剪贴板并打开页面，需手动 Ctrl+V 粘贴">⧉</span>' : ''}
      ${p.experimental && p.mode !== 'copy' ? '<span class="p-flag" title="实验性适配器，平台改版可能失效">!</span>' : ''}
    `;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.selected.has(p.id)) state.selected.delete(p.id);
      else state.selected.add(p.id);
      renderPlatforms();
      draftSave();
    });
    grid.appendChild(item);
  }
}

/* ---------------- 进度渲染 ---------------- */
const STATUS_ICON = { pending: '·', filling: '⏳', done: '✓', error: '✗' };
const STATUS_CLS = { pending: 'wait', filling: 'run', done: 'ok', error: 'err' };

/** 复制富文本（text/html + text/plain 双通道）：纯 writeText 会把 HTML 源码当文本粘进富文本编辑器 */
async function copyRich(html, plainText) {
  try {
    if (navigator.clipboard && self.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText != null ? plainText : html], { type: 'text/plain' })
      })]);
      return true;
    }
  } catch (_) { /* fallthrough */ }
  try {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.position = 'fixed';
    div.style.opacity = '0';
    div.innerHTML = html;
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    div.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * 失败平台的「⧉ 复制」：按该平台适用的格式复制内容，用户到该平台编辑器手动粘贴。
 * - Markdown 类编辑器（copyFormat: 'md'）与复制模式平台 → 复制「标题 + Markdown 源文本」；
 * - 富文本类编辑器 → 复制（任务所选主题内联样式的）HTML 正文（text/html 通道）。
 */
async function copyForPlatform(p, job) {
  const platform = PLATFORMS.find((x) => x.id === p.id);
  const useMd = platform ? (platform.mode === 'copy' || platform.copyFormat === 'md') : true;
  let payload;
  if (useMd) {
    payload = (job.title || '') + '\n\n' + (job.markdown || '');
  } else {
    const md = job.markdown || '';
    let html = self.marked
      ? self.marked.parse(md, { breaks: true, gfm: true })
      : '<p>' + escapeHtml(md).replace(/\n/g, '<br>') + '</p>';
    if (job.themeId && self.MULTIPOST_APPLY_THEME) {
      const theme = (self.MULTIPOST_THEMES || []).find((t) => t.id === job.themeId);
      if (theme) html = self.MULTIPOST_APPLY_THEME(html, theme);
    }
    payload = html;
  }
  try {
    if (useMd) await navigator.clipboard.writeText(payload);
    else await copyRich(payload, job.markdown || '');
    flash('已复制' + (useMd ? ' Markdown（标题+正文）' : '富文本正文') + '（' + p.name + '）' +
      (useMd ? '：标题粘到标题框，其余粘到正文' : '：请点击正文编辑区（标题框下方）再 Ctrl+V，不要粘到标题框'));
  } catch (err) {
    flash('复制失败：' + (err && err.message ? err.message : err));
  }
}

function renderJob(job) {
  const card = $('#progress-card');
  const list = $('#progress-list');
  if (!job) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  list.innerHTML = '';
  for (const p of job.platforms) {
    const li = document.createElement('li');
    li.className = 'progress-item';
    const showCopy = p.status === 'error';
    li.innerHTML = `
      <span class="st ${STATUS_CLS[p.status] || 'wait'}">${STATUS_ICON[p.status] || '·'}</span>
      <span>${p.name}</span>
      <span class="msg">${escapeHtml(p.message || '')}</span>
      ${showCopy ? '<button class="mini-btn copy-one" title="复制该平台适用的格式（Markdown 类复制 MD，富文本类复制主题 HTML），到该平台手动粘贴">⧉</button>' : ''}
    `;
    if (showCopy) {
      li.querySelector('.copy-one').addEventListener('click', (e) => {
        e.stopPropagation();
        copyForPlatform(p, job);
      });
    }
    list.appendChild(li);
  }
  $('#publish').disabled = job.status === 'running';
  $('#publish').textContent = job.status === 'running' ? '同步中…' : '🚀 一键同步到勾选平台';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- 历史 ---------------- */
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const list = $('#history-list');
  list.innerHTML = '';
  if (!history.length) {
    list.innerHTML = '<li class="history-empty">暂无记录</li>';
    return;
  }
  for (const h of history) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const okCount = h.platforms.filter((p) => p.status === 'done').length;
    li.innerHTML = `
      <div class="h-title">${escapeHtml(h.title || '(无标题)')}</div>
      <div class="h-meta">${new Date(h.finishedAt).toLocaleString('zh-CN')} · ${okCount}/${h.platforms.length} 平台成功</div>
    `;
    li.title = '点击回填标题与正文';
    li.addEventListener('click', async () => {
      $('#title').value = h.title || '';
      $('#markdown').value = h.markdown || '';
      draftSave();
    });
    list.appendChild(li);
  }
}

/* ---------------- 发起同步 ---------------- */
async function startPublish() {
  const title = $('#title').value.trim();
  const markdown = $('#markdown').value.trim();
  if (!title) { flash('请先填写标题'); return; }
  if (!markdown) { flash('请先填写正文'); return; }
  if (!state.selected.size) { flash('请至少勾选一个平台'); return; }

  // 复制模式平台（小红书/微博/X 等）：先把「标题 + 正文」写入剪贴板，
  // 打开页面后由用户手动粘贴（参考 CSDN 同步助手 / MultiPost 的复制桥接思路）
  const hasCopy = [...state.selected].some((id) => {
    const p = PLATFORMS.find((x) => x.id === id);
    return p && p.mode === 'copy';
  });
  let copyTip = '';
  if (hasCopy) {
    try {
      await navigator.clipboard.writeText(title + '\n\n' + markdown);
      copyTip = '（剪贴板已就绪：复制模式平台打开后请手动粘贴）';
    } catch (err) {
      copyTip = '';
      flash('剪贴板复制失败：' + (err && err.message ? err.message : err));
      return;
    }
  }

  $('#publish').disabled = true;
  $('#publish').textContent = '同步中…';
  // 标签规范化：去 #、去空，最多 5 个（全角逗号/顿号/空白均可分隔）
  const tags = ($('#tags-input').value || '')
    .split(/[,，、\s]+/).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean).slice(0, 5);
  await chrome.runtime.sendMessage({
    type: 'START_JOB',
    title,
    markdown,
    themeId: $('#apply-theme').checked ? $('#theme-select').value : null,
    // 统一「封面 + 标签」：cover 为本地选择的封面 dataURL；
    // coverFromArticle=true 且未选封面时，由适配器取正文第一张图
    cover: state.coverDataUrl,
    coverFromArticle: $('#cover-from-article').checked && !state.coverDataUrl,
    tags,
    platformIds: [...state.selected]
  });
  if (copyTip) flash('已复制内容，' + copyTip);
}

let flashTimer = null;
let flashBase = null; // flash 前的按钮文案，避免"上传中…"被误存为恢复文案
function flash(text) {
  const btn = $('#publish');
  if (flashBase === null) flashBase = btn.textContent;
  btn.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    btn.textContent = flashBase;
    flashBase = null;
  }, 2200);
}

/* ---------------- 工具按钮 ---------------- */
function bindActions() {
  $('#title').addEventListener('input', draftSave);
  $('#markdown').addEventListener('input', draftSave);

  // ---- 封面与标签 ----
  $('#cover-pick').addEventListener('click', () => $('#cover-input').click());
  $('#cover-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.coverDataUrl = String(reader.result || '');
      state.coverName = file.name;
      $('#cover-name').textContent = '已选：' + file.name;
      $('#cover-clear').hidden = false;
      draftSave();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  $('#cover-clear').addEventListener('click', () => {
    state.coverDataUrl = null;
    state.coverName = '';
    $('#cover-name').textContent = '未选择封面';
    $('#cover-clear').hidden = true;
    draftSave();
  });
  $('#cover-from-article').addEventListener('change', draftSave);
  $('#tags-input').addEventListener('input', draftSave);

  $('#publish').addEventListener('click', startPublish);

  $('#import-md').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $('#markdown').value = String(reader.result || '');
      if (!$('#title').value.trim()) $('#title').value = file.name.replace(/\.(md|markdown|txt)$/i, '');
      draftSave();
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  $('#copy-md').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#markdown').value);
    flash('已复制 Markdown');
  });
  $('#copy-html').addEventListener('click', async () => {
    let html;
    const theme = getSelectedTheme();
    const mdF = await renderFormulas($('#markdown').value);
    const raw = self.marked
      ? self.marked.parse(mdF, { breaks: true, gfm: true })
      : mdF;
    if (theme && $('#apply-theme').checked && self.MULTIPOST_APPLY_THEME) {
      html = self.MULTIPOST_APPLY_THEME(raw, theme);
    } else {
      html = raw;
    }
    await navigator.clipboard.writeText(html);
    flash($('#apply-theme').checked ? '已复制主题样式 HTML' : '已复制 HTML');
  });

  // 主题预览「⧉ 复制正文」：mdnice 式工作流——复制排版后的富文本（公式已渲染
  // 成内联 SVG、主题样式已内联），到任意平台正文区直接 Ctrl+V
  $('#copy-rich').addEventListener('click', async () => {
    const md = $('#markdown').value.trim();
    if (!md) return flash('正文为空，先写点内容');
    const mdF = await renderFormulas(md);
    let html = self.marked
      ? self.marked.parse(mdF, { breaks: true, gfm: true })
      : '<p>' + escapeHtml(mdF).replace(/\n/g, '<br>') + '</p>';
    const theme = getSelectedTheme();
    if (theme && self.MULTIPOST_APPLY_THEME) html = self.MULTIPOST_APPLY_THEME(html, theme);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([md], { type: 'text/plain' })
      })]);
      flash('已复制排版正文（含公式），到目标平台正文区 Ctrl+V');
    } catch (_) {
      await navigator.clipboard.writeText(html);
      flash('已复制排版正文（当前环境仅支持纯文本通道）');
    }
  });

  bindPreview();
  bindImageUpload();
  bindBedSettings();
  bindLogExport();

  $('#clear-history').addEventListener('click', async () => {
    await chrome.storage.local.set({ history: [] });
    renderHistory();
  });
}

/* ---------------- 主题预览（参考 mdnice：写完切主题，所见即所得） ---------------- */

/** Markdown 公式渲染（MathJax 内联 SVG；无公式/加载失败原样返回） */
async function renderFormulas(md) {
  try {
    if (self.MULTIPOST_FORMULAS) return await self.MULTIPOST_FORMULAS.latexMdToRich(md);
  } catch (_) { /* 公式失败不影响正文 */ }
  return md;
}

function getSelectedTheme() {
  const themes = self.MULTIPOST_THEMES || [];
  const sel = $('#theme-select');
  if (!sel) return null;
  return themes.find((t) => t.id === sel.value) || null;
}

function renderPreviewStyle() {
  const themes = self.MULTIPOST_THEMES || [];
  const theme = themes.find((t) => t.id === $('#theme-select').value);
  $('#preview-style').textContent = theme ? self.MULTIPOST_THEME_CSS(theme, '#preview-body') : '';
}

function renderPreviewBody() {
  const body = $('#preview-body');
  const md = $('#markdown').value.trim();
  if (!md) {
    body.innerHTML = '<div class="preview-empty">正文为空，先写点内容再看预览</div>';
    return;
  }
  // 先渲染公式（MathJax 内联 SVG，mdnice 同款）再交给 marked，预览即最终效果
  renderFormulas(md).then((mdF) => {
    if ($('#markdown').value.trim() !== md) return; // 编辑已更新，丢弃过期渲染
    body.innerHTML = self.marked
      ? self.marked.parse(mdF, { breaks: true, gfm: true })
      : '<p>' + escapeHtml(mdF).replace(/\n/g, '<br>') + '</p>';
  });
}

function bindPreview() {
  const themes = self.MULTIPOST_THEMES || [];
  const sel = $('#theme-select');
  for (const t of themes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name; // 只显示主题名，防止 option 过长把右侧"同步套用"挤出可视区
    opt.title = t.desc;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    renderPreviewStyle();
    renderPreviewBody();
    await chrome.storage.local.set({ themeId: sel.value });
  });

  $('#preview-toggle').addEventListener('click', () => {
    const panel = $('#preview-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      renderPreviewStyle();
      renderPreviewBody();
    }
  });

  // 套用状态与主题选择持久化
  chrome.storage.local.get(['themeId', 'applyTheme']).then(({ themeId, applyTheme }) => {
    if (themeId) sel.value = themeId;
    $('#apply-theme').checked = !!applyTheme;
    renderPreviewStyle();
  });
  $('#apply-theme').addEventListener('change', async () => {
    await chrome.storage.local.set({ applyTheme: $('#apply-theme').checked });
  });

  // 编辑正文时若预览打开则实时刷新
  $('#markdown').addEventListener('input', () => {
    if (!$('#preview-panel').classList.contains('hidden')) renderPreviewBody();
  });
}

/* ---------------- 图床上传 ---------------- */
/** 图片上传状态行：过程可见、失败有原因，不再只靠按钮文案闪一下 */
function imgStatus(text, cls) {
  const el = $('#img-status');
  if (!text) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.classList.toggle('ok', cls === 'ok');
  el.classList.toggle('err', cls === 'err');
  const lines = Array.isArray(text) ? text : [text];
  el.innerHTML = lines.map((l) => '<div>' + escapeHtml(l) + '</div>').join('');
}

/** 在光标处插入文本并触发草稿保存 */
function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

async function uploadImageFile(file, { quiet = false } = {}) {
  if (!file || !/^image\//.test(file.type)) { imgStatus('只支持图片文件（png/jpg/gif/webp…）', 'err'); return false; }
  if (file.size > 10 * 1024 * 1024) { imgStatus('「' + file.name + '」超过 10MB，请压缩后再上传', 'err'); return false; }
  const alt = (file.name || 'image').replace(/\.[a-z0-9]+$/i, '');
  imgStatus('⏳ 正在上传「' + file.name + '」（' + Math.round(file.size / 1024) + 'KB）到图床…');
  if (!quiet) flash('图片上传中…');
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'UPLOAD_IMAGE', dataUrl, fileName: file.name });
  } catch (err) {
    imgStatus('上传失败：' + (err && err.message ? err.message : err), 'err');
    return false;
  }
  if (res && res.ok) {
    insertAtCursor($('#markdown'), '![' + alt + '](' + res.url + ')');
    draftSave();
    imgStatus(['✓ 已上传并插入外链：' + res.url].concat(res.note ? ['ℹ ' + res.note] : []), 'ok');
    return true;
  }
  const reason = (res && res.error) || '未知错误';
  imgStatus([
    '✗ 上传失败：' + reason,
    '排查建议：插件已自动尝试所有可用图床仍失败，多为当前网络无法访问境外图床（catbox/freeimage）；可注册 ImgBB / SM.MS 填入密钥，或配置自定义图床接口。提示：CSDN 等平台会「转存」外链图，需选国内可达图床。'
  ], 'err');
  return false;
}

function bindImageUpload() {
  const md = $('#markdown');
  const card = md.closest('.card'); // 拖拽接收范围扩大到整个编辑卡片
  // 粘贴图片 → 上传图床
  md.addEventListener('paste', (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const imgItem = items.find((it) => it.type && it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      uploadImageFile(imgItem.getAsFile());
    }
  });
  // 拖拽图片 → 上传图床（dragenter/dragover 都要 preventDefault，drop 才会触发）
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  for (const target of [card, md]) {
    if (!target) continue;
    target.addEventListener('dragenter', (e) => {
      if (hasFiles(e)) { e.preventDefault(); $('#drop-hint').classList.remove('hidden'); }
    });
    target.addEventListener('dragover', (e) => {
      if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    target.addEventListener('dragleave', (e) => {
      if (e.target === card || e.target === md) $('#drop-hint').classList.add('hidden');
    });
    target.addEventListener('drop', (e) => {
      $('#drop-hint').classList.add('hidden');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
        .filter((f) => f.type && f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        e.stopPropagation();
        (async () => {
          let okCount = 0;
          for (const f of files) { if (await uploadImageFile(f, { quiet: files.length > 1 })) okCount++; }
          if (files.length > 1) flash('图片上传完成 ' + okCount + '/' + files.length);
        })();
      }
    });
  }
  // 工具按钮选择文件（支持多选）
  $('#upload-img').addEventListener('click', () => $('#image-input').click());
  $('#image-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    (async () => {
      for (const f of files) await uploadImageFile(f, { quiet: files.length > 1 });
    })();
    e.target.value = '';
  });
}

/* ---------------- 图床设置 ---------------- */
const BED_FIELDS = ['catbox', 'freeimage', 'imgbb', 'smms', 'custom'];

function syncBedFields() {
  const provider = $('#bed-provider').value;
  for (const p of BED_FIELDS) {
    $('#bed-' + p).classList.toggle('hidden', p !== provider);
  }
}

function bindBedSettings() {
  const panel = $('#bed-panel');
  $('#bed-toggle').addEventListener('click', async () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    $('#bed-toggle').textContent = opening ? '收起' : '展开';
    if (opening) {
      const { bedConfig = {} } = await chrome.storage.local.get('bedConfig');
      $('#bed-provider').value = bedConfig.provider || 'freeimage';
      $('#bed-freeimage-key').value = bedConfig.freeimageKey || '';
      $('#bed-imgbb-key').value = bedConfig.imgbbKey || '';
      $('#bed-smms-token').value = bedConfig.smmsToken || '';
      $('#bed-custom-url').value = bedConfig.customUrl || '';
      $('#bed-custom-header-name').value = bedConfig.customHeaderName || '';
      $('#bed-custom-header-value').value = bedConfig.customHeaderValue || '';
      $('#bed-custom-path').value = bedConfig.customJsonPath || '';
      syncBedFields();
    }
  });
  $('#bed-provider').addEventListener('change', syncBedFields);
  $('#bed-save').addEventListener('click', async () => {
    const cfg = {
      provider: $('#bed-provider').value,
      freeimageKey: $('#bed-freeimage-key').value.trim(),
      imgbbKey: $('#bed-imgbb-key').value.trim(),
      smmsToken: $('#bed-smms-token').value.trim(),
      customUrl: $('#bed-custom-url').value.trim(),
      customHeaderName: $('#bed-custom-header-name').value.trim(),
      customHeaderValue: $('#bed-custom-header-value').value.trim(),
      customJsonPath: $('#bed-custom-path').value.trim() || 'data.url'
    };
    if (cfg.provider === 'custom') {
      if (!cfg.customUrl) { flash('请填写自定义图床地址'); return; }
      // MV3 跨域 fetch 需要 host 权限，此处弹授权框（需要用户手势）
      try {
        const origin = new URL(cfg.customUrl).origin + '/*';
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) { flash('未授权该域名，自定义图床将无法上传'); }
      } catch (err) {
        flash('权限请求失败：' + (err && err.message ? err.message : err));
      }
    }
    await chrome.storage.local.set({ bedConfig: cfg });
    panel.classList.add('hidden');
    $('#bed-toggle').textContent = '展开';
    flash('✓ 图床设置已保存');
  });
  // 图床连通性测试：生成 1x1 测试图上传，直接给出可用性结论
  $('#bed-test').addEventListener('click', async () => {
    flash('图床测试中…');
    // 1x1 红色像素 PNG
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'UPLOAD_IMAGE', dataUrl, fileName: 'multipost-test.png' });
      if (res && res.ok) {
        imgStatus(['✓ 图床可用' + (res.note ? '（' + res.note + '）' : '') + '！测试图外链：', res.url], 'ok');
        flash('✓ 图床可用');
      } else {
        imgStatus([
          '✗ 图床不可用：' + ((res && res.error) || '未知错误'),
          '排查建议：已自动尝试所有可用图床仍失败，多为当前网络无法访问境外图床；可注册 ImgBB / SM.MS 填入密钥，或配置自定义图床接口。提示：CSDN 等平台会「转存」外链图，需选国内可达图床（推荐 ImgBB/SM.MS，catbox 常被拦截）。'
        ], 'err');
      }
    } catch (err) {
      imgStatus('图床测试失败：' + (err && err.message ? err.message : err), 'err');
    }
  });
}

/* ---------------- 诊断日志导出 ---------------- */
async function exportLogs() {
  const { mpLogs = [] } = await chrome.storage.local.get('mpLogs');
  if (!mpLogs.length) {
    flash('暂无日志记录');
    return;
  }
  const lines = mpLogs.map((e) => {
    const time = new Date(e.t).toLocaleString('zh-CN', { hour12: false });
    const detail = e.detail ? ' | ' + e.detail : '';
    return `[${time}] [${(e.level || 'info').toUpperCase()}]${e.platform ? '[' + e.platform + ']' : ''} ${e.message}${detail}`;
  });
  const header = '多平台转发助手 诊断日志\n导出时间：' + new Date().toLocaleString('zh-CN') +
    '\n共 ' + mpLogs.length + ' 条\n' + '='.repeat(48) + '\n';
  const blob = new Blob([header + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  a.href = url;
  a.download = 'multipost-logs-' + ts + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  flash('已导出 ' + mpLogs.length + ' 条日志');
}

function bindLogExport() {
  $('#export-log').addEventListener('click', exportLogs);
  $('#export-log2').addEventListener('click', exportLogs);
}

/* ---------------- 消息监听 ---------------- */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'JOB_UPDATED' && msg.job) {
    state.job = msg.job;
    renderJob(msg.job);
  }
});

/* ---------------- 初始化 ---------------- */
(async function init() {
  bindActions();

  const { draft = {}, selected = null } = await chrome.storage.local.get(['draft', 'selected']);
  $('#title').value = draft.title || '';
  $('#markdown').value = draft.markdown || '';
  // 恢复封面/标签草稿
  if (draft.tags) $('#tags-input').value = draft.tags;
  if (draft.coverDataUrl) {
    state.coverDataUrl = draft.coverDataUrl;
    state.coverName = draft.coverName || 'cover.png';
    $('#cover-name').textContent = '已选：' + state.coverName;
    $('#cover-clear').hidden = false;
  }
  if (draft.coverFromArticle) $('#cover-from-article').checked = true;
  if (Array.isArray(selected)) state.selected = new Set(selected);
  else state.selected = new Set(['juejin', 'csdn']); // 默认勾选两个稳定平台

  renderPlatforms();
  renderHistory();

  try {
    const { job } = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (job) renderJob(job);
  } catch (_) { /* ignore */ }
})();
