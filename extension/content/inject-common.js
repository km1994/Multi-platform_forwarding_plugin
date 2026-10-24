/**
 * 注入工具集：DOM 等待、受控组件赋值、剪贴板粘贴模拟、Markdown 转 HTML。
 * 以经典脚本加载，挂载到 window.__MULTIPOST_UTIL__。
 */
(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 轮询等待，直到 fn() 返回真值或超时 */
  async function waitFor(fn, { timeout = 20000, interval = 300 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let v = null;
      try { v = fn(); } catch (_) { /* ignore */ }
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  /** 顶层文档 + 同源 iframe 文档列表（选择器搜索与深度发现共用）。
   * 公众号等平台的编辑器可能挂在同源 iframe 里，顶层文档找不到。 */
  function collectEditableDocs() {
    const docs = [document];
    try {
      for (const f of document.querySelectorAll('iframe')) {
        try {
          // 跨源 iframe 访问 contentDocument 会抛异常，逐个保护
          if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument);
        } catch (_) { /* cross-origin */ }
      }
    } catch (_) { /* ignore */ }
    return docs;
  }

  /**
   * 等待任意一个选择器出现（并行轮询，避免逐个串行等待太慢）。
   * 同时搜索顶层文档与同源 iframe 文档。
   * 返回 { el, selector } 或 null。
   */
  async function firstExisting(selectors, { timeout = 20000, interval = 300, root = null, skip = null } = {}) {
    const list = selectors.filter(Boolean);
    const found = await waitFor(() => {
      const docs = [root || document, ...(root ? [] : collectEditableDocs().slice(1))];
      for (const sel of list) {
        for (const doc of docs) {
          try {
            const el = doc.querySelector(sel);
            // skip 谓词不通过（如"标题字段防误粘护栏"）的候选不采纳，继续等待正确目标
            if (el && !(skip && skip(el))) return { el, selector: sel };
          } catch (_) { /* ignore */ }
        }
      }
      return null;
    }, { timeout, interval });
    return found;
  }

  /**
   * 标题字段判定：placeholder/aria-label/id/class 带"标题/title"的可编辑元素。
   * 正文填充绝不能落到标题框（公众号曾把整篇正文粘进标题输入框）——
   * 编辑器未挂载时，宽泛的兜底选择器可能先匹配到标题元素，一律跳过并继续等待。
   */
  function looksLikeTitleField(el) {
    try {
      // data-placeholder 必查：公众号标题是 ProseMirror div（data-placeholder=
      // "请在这里输入标题"），不查它标题字段会漏判，正文被粘进标题框
      const ph = (el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label'))) || '';
      const id = el.id || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return /标题|\btitle\b/i.test(ph + ' ' + id + ' ' + cls);
    } catch (_) { return false; }
  }

  /**
   * 深度收集文档里的可编辑元素（含开放 shadowRoot 内部的——编辑器可能挂在
   * shadow DOM 里，普通 querySelector 看不到）。
   * 额外收集 [data-placeholder] 元素：部分编辑器"点击后才挂载 contenteditable"，
   * 占位元素先出现，真实点击后才可编辑。
   */
  function deepEditableCandidates(doc) {
    const out = [];
    const seen = new Set();
    const push = (el) => {
      if (el && el.nodeType === 1 && !seen.has(el)) { seen.add(el); out.push(el); }
    };
    const walk = (root) => {
      try {
        root.querySelectorAll('[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[data-placeholder]').forEach(push);
        for (const host of root.querySelectorAll('*')) {
          try { if (host.shadowRoot) walk(host.shadowRoot); } catch (_) { /* ignore */ }
        }
      } catch (_) { /* ignore */ }
    };
    walk(doc);
    return out;
  }

  /** 富文本候选打分：面积大者优先，placeholder/类名含正文特征加分；不合格返回 -1 */
  function scoreRichCandidate(el) {
    try {
      if (/^(textarea|input|a|button|select)$/i.test(el.tagName)) return -1;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 60 || r.width * r.height < 6000) return -1;
      if (!isVisible(el)) return -1;
      const ph = ((el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label'))) || '') +
                 ' ' + (typeof el.className === 'string' ? el.className : '');
      let score = r.width * r.height;
      if (/正文|开始写|输入内容|写正文/.test(ph)) score += 5e6;
      if (/editor|editable|rich/i.test(ph)) score += 2e6;
      return score;
    } catch (_) { return -1; }
  }

  /** 单个元素的紧凑描述（诊断用） */
  function describeEl(el) {
    try {
      const tag = el.tagName.toLowerCase();
      const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 40);
      const ph = (el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label'))) || '';
      return tag + '.' + cls + (ph ? '[' + ph.slice(0, 12) + ']' : '');
    } catch (_) { return 'element'; }
  }

  /** 失败诊断：枚举页面实际存在的可编辑元素/输入框/iframe src，远程定位编辑器结构 */
  function describeEditableState() {
    try {
      const desc = [];
      const iframes = [];
      try {
        for (const f of document.querySelectorAll('iframe')) {
          iframes.push((f.src || f.getAttribute('src') || '(空src)').slice(0, 70));
        }
      } catch (_) { /* ignore */ }
      let i = 0;
      for (const doc of collectEditableDocs()) {
        try {
          for (const el of doc.querySelectorAll('[contenteditable],textarea,[data-placeholder]')) {
            if (desc.length >= 12) break;
            const tag = el.tagName.toLowerCase();
            const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 40);
            const ph = (el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label'))) || '';
            const r = el.getBoundingClientRect();
            desc.push((i === 0 ? '' : 'IF.') + tag + '.' + cls + (ph ? '[' + ph.slice(0, 12) + ']' : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          }
        } catch (_) { /* ignore */ }
        i++;
      }
      const js = document.querySelector('#js_editor');
      if (js) {
        try { desc.push('#js_editor(子元素' + js.querySelectorAll('*').length + '个)'); } catch (_) { /* ignore */ }
      }
      const out = desc.join(' | ');
      return (iframes.length ? 'iframe:[' + iframes.slice(0, 4).join(' ; ') + '] ' : '') + (out || '无可编辑元素');
    } catch (_) { return '诊断失败'; }
  }

  /** 以原生 setter 赋值并触发 input/change，兼容 React 受控组件 */
  function setNativeValue(el, value) {
    el.focus();
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** HTML 转纯文本（用于 text/plain 通道） */
  function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.innerText || div.textContent || '').trim();
  }

  /**
   * 向元素派发合成 paste 事件（DraftJS / ProseMirror / Slate / CodeMirror6 均可识别）。
   * 不需要剪贴板读取权限，因为事件携带 DataTransfer。
   */
  function firePaste(el, { html = null, text = null } = {}) {
    el.focus();
    const dt = new DataTransfer();
    if (html != null) dt.setData('text/html', html);
    if (text != null) dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    });
    el.dispatchEvent(ev);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 规整 Markdown 源文本：
   * CRLF -> LF、去掉行尾空格、把 3 个以上连续换行折叠成 1 个空行（2 个换行）。
   * 从 PDF/网页复制的内容常带大量连续空行，导致所有平台排版松散。
   */
  function normalizeMd(md) {
    return String(md || '')
      .replace(/\r\n?/g, '\n')
      .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 极简 Markdown 兜底转换（lib/marked 加载失败时使用）
   */
  function miniMdToHtml(md) {
    const lines = String(md).split(/\r?\n/);
    const out = [];
    let inCode = false, codeBuf = [], inList = false, listTag = 'ul';
    const closeList = () => { if (inList) { out.push(`</${listTag}>`); inList = false; } };
    const inline = (s) => escapeHtml(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line)) {
        if (inCode) { out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; inCode = false; }
        else { closeList(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.、]\s+(.*)$/);
      if (ul || ol) {
        const tag = ol ? 'ol' : 'ul';
        if (!inList || listTag !== tag) { closeList(); out.push(`<${tag}>`); inList = true; listTag = tag; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
        continue;
      }
      if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
      if (!line.trim()) { closeList(); continue; }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    return out.join('\n');
  }

  /** 空的块级元素（含只含 <br> / &nbsp; 的段落）：知乎 DraftJS 等会把它渲染成空行 */
  function stripEmptyBlocks(html) {
    return String(html || '')
      .replace(/<(p|li|h[1-6]|blockquote)[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<span>\s*<\/span>)*<\/\1>/gi, '');
  }

  /** 收紧松散列表：把 <li><p>x</p></li> 折叠成 <li>x</li>。
   *  marked 遇到列表项之间的空行会输出"松散列表"（li 内包 p），
   *  知乎 DraftJS 对 li 包 p 会生成多余的空段落（表现为列表区间多出好多空行）。
   *  循环替换直到稳定，由内向外处理嵌套列表。 */
  function tightenListItems(html) {
    let prev;
    let out = String(html || '');
    do {
      prev = out;
      out = out.replace(/<li>(\s*)<p>((?:(?!<\/p>|<[uo]l)[\s\S])*)<\/p>(\s*)<\/li>/gi, '<li>$2</li>');
    } while (out !== prev);
    return out;
  }

  /** 压缩块级标签之间的空白。
   * marked 输出的 HTML 在标签间带有换行/空格文本节点，DraftJS（知乎）、
   * ProseMirror（公众号）会把它们解析成空段落，表现为嵌套列表之间出现大量空行。
   */
  function compactHtml(html) {
    return tightenListItems(stripEmptyBlocks(String(html || '')
      .replace(/>\s*\n\s*</g, '><')   // 去掉标签之间的换行
      .replace(/(<(?:li|ul|ol|p|h[1-6]|blockquote|pre)[^>]*>)\s+/g, '$1')
      .replace(/\s+(<\/(?:li|ul|ol|p|h[1-6]|blockquote|pre)>)/g, '$1')));
  }

  /**
   * 把嵌套列表转成 DraftJS/知乎自己的序列化格式：
   *   <li>标题<ul><li>子项</li></ul></li>  →  <li>标题</li><ul><li>子项</li></ul>
   * 即子列表提升为 <li> 的兄弟节点（层级仍由 ul 嵌套表达）。
   * 背景：知乎 DraftJS 解析「ul 包在 li 里」的标准 HTML 时，会在嵌套层级
   * 收束处插入空段落，表现为列表分组之间多出好多空行；而它自己序列化输出的
   * 兄弟结构解析后没有空行。DOM 解析实现，可正确处理任意嵌套深度。
   */
  function hoistNestedLists(html) {
    try {
      const doc = new DOMParser().parseFromString('<div id="mp-root">' + html + '</div>', 'text/html');
      const root = doc.getElementById('mp-root');
      if (!root) return html;
      const processList = (list) => {
        for (const li of Array.from(list.children)) {
          if (!/^li$/i.test(li.tagName)) continue;
          // 先递归处理子级（子列表可能还嵌套更深层）
          for (const sub of Array.from(li.children)) {
            if (/^(ul|ol)$/i.test(sub.tagName)) processList(sub);
          }
          // 再把 li 的直接子列表移到 li 之后（兄弟位置），保持原有顺序
          let anchor = li;
          for (const sub of Array.from(li.children)) {
            if (/^(ul|ol)$/i.test(sub.tagName)) {
              anchor.parentNode.insertBefore(sub, anchor.nextSibling);
              anchor = sub;
            }
          }
          // 子列表移走后，li 若只剩一个 <p> 包装则解开（避免 DraftJS 生成空块）
          if (li.children.length === 1 && /^p$/i.test(li.children[0].tagName)) {
            li.innerHTML = li.children[0].innerHTML;
          }
        }
      };
      for (const list of Array.from(root.querySelectorAll('ul,ol'))) {
        if (list.parentElement && list.parentElement.closest && list.parentElement.closest('li')) continue; // 只从最外层进入
        processList(list);
      }
      return root.innerHTML;
    } catch (_) {
      return html;
    }
  }

  /** Markdown -> HTML：优先 marked；输出统一压缩空白 */
  function mdToHtml(markdown) {
    let html;
    try {
      if (self.marked && typeof self.marked.parse === 'function') {
        html = self.marked.parse(markdown, { breaks: true, gfm: true });
      }
    } catch (_) { /* fallthrough */ }
    if (!html) html = miniMdToHtml(markdown);
    return compactHtml(html);
  }

  /**
   * Markdown -> HTML（块级版本，无 <br>）：
   * 把段内单换行也提升为独立段落再解析（代码块内除外）。
   * 用于知乎 DraftJS：它会把 <br> 转成空段落，造成"多出好多空行"；
   * 改为每行独立 <p> 后排版紧凑且行行分明。
   */
  function mdToHtmlNoBreaks(markdown) {
    const lines = normalizeMd(markdown).split('\n');
    const out = [];
    let inFence = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      out.push(line);
      if (!inFence && line !== '') out.push(''); // 非代码区的每行后面补空行 → 独立段落
    }
    const md = out.join('\n');
    let html;
    try {
      if (self.marked && typeof self.marked.parse === 'function') {
        html = self.marked.parse(md, { breaks: false, gfm: true });
      }
    } catch (_) { /* fallthrough */ }
    if (!html) html = miniMdToHtml(md);
    return compactHtml(html);
  }

  /** CodeMirror 5 实例赋值 */
  function tryCodeMirror5(md) {
    const el = document.querySelector('.CodeMirror');
    if (el && el.CodeMirror && typeof el.CodeMirror.setValue === 'function') {
      el.CodeMirror.setValue(md);
      el.CodeMirror.refresh && el.CodeMirror.refresh();
      return true;
    }
    return false;
  }

  /**
   * CodeMirror 6（掘金 bytemd / CSDN 新版编辑器底层）：
   * 直接通过 DOM 元素上的 cmView 拿到 EditorView，用 dispatch 写入文档状态。
   * 这是唯一可靠的方式 —— 往 .cm-content 写 textContent 会被 CM6 下一次渲染回滚，
   * 造成"看起来填充成功、实际内容为空"的假阳性。
   */
  function findCodeMirror6Views() {
    const views = [];
    document.querySelectorAll('.cm-editor').forEach((el) => {
      try {
        const view = el.cmView && el.cmView.view;
        if (view && view.state && typeof view.dispatch === 'function') views.push(view);
      } catch (_) { /* ignore */ }
    });
    return views;
  }

  function tryCodeMirror6(md, { verify = true } = {}) {
    for (const view of findCodeMirror6Views()) {
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
        try { view.focus(); } catch (_) { /* ignore */ }
        if (!verify || view.state.doc.toString().length > 0) return view;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  /** 元素是否可见（公众号新版页面里存在隐藏的 UEditor 残留 iframe，必须排除） */
  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return !!(el.offsetParent || el.getClientRects().length);
    } catch (_) { return true; }
  }

  /** 受控编辑器判定：ProseMirror / DraftJS / CodeMirror 会把外部 DOM 直写回滚，
   *  只能通过 paste 事件或主世界输入通道写内容。 */
  function isControlledEditor(el) {
    try {
      return !!(el.closest('.ProseMirror, .public-DraftEditor-content, .cm-editor') ||
                el.querySelector('.ProseMirror, .public-DraftEditor-content'));
    } catch (_) { return false; }
  }

  /** 估算 HTML 里的块级元素数量（用于拍扁检测的期望值） */
  function countBlocks(html) {
    const m = String(html || '').match(/<(p|h[1-6]|li|blockquote|section|pre|div)[\s>]/gi);
    return m ? m.length : 0;
  }

  /**
   * 拍扁检测：粘贴"成功"（有文本）但块结构丢失 = 编辑器把 text/html 降级成了
   * 一整段纯文本（公众号编辑器对合成 paste 事件的实际行为）。
   * 表现：整篇文章挤在一个段落里，无换行无样式。
   */
  function isFlattened(el, html) {
    try {
      const expected = countBlocks(html);
      if (expected < 3) return false; // 内容本来就少，无从判断
      const actual = el.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,section,pre,div').length;
      return actual < 2;
    } catch (_) { return false; }
  }

  /**
   * 真实剪贴板粘贴：把带主题样式的 HTML 写入系统剪贴板（text/html 通道），
   * 再对编辑器执行 document.execCommand('paste')——与用户 Ctrl+V 走完全相同的
   * 浏览器原生管线，编辑器（公众号 ProseMirror 等）按真实外部粘贴处理，
   * 不会被降级成纯文本。需要 clipboardRead 权限（mdnice 等工具同款路径）。
   * 返回 true 表示命令已执行（内容是否落库仍需调用方回读校验）。
   */
  async function realClipboardPaste(el, html, text) {
    try {
      const copied = await copyRichToClipboard(html, text != null ? text : '');
      if (!copied) return false;
      el.focus();
      await sleep(300);
      // 编辑器可能在同源 iframe 内：execCommand 必须作用于它所属的文档，
      // 顶层 document.execCommand 粘不进 iframe
      return (el.ownerDocument || document).execCommand('paste');
    } catch (_) {
      return false;
    }
  }

  /** 填充成功后的延迟回读：受控编辑器可能把外写内容回滚，立即回读是假阳性
   *  （公众号「内容看似写入、随后正文为空」的教训）。等 2 秒再确认。 */
  async function verifyRichStable(el, okMsg) {
    await sleep(2000);
    if ((el.textContent || '').trim().length > 0) return { ok: true, message: okMsg };
    return { ok: false, message: '内容写入后被编辑器回滚为空（受控编辑器），请用剪贴板内容手动粘贴' };
  }

  /**
   * 清理 DraftJS（知乎）粘贴产物里的空块。
   * 背景：知乎 DraftJS 解析粘贴的 HTML 时，会在列表结束/嵌套层级收束处自动插入
   * 空段落块，表现为列表与后文之间多出空行。处理方式与用户手动删空行完全一致：
   * 光标定位到空块内 → document.execCommand('delete')（走 beforeinput 管线，
   * DraftJS 会正常合并块）。从最后一个空块向前删，避免位置失效。
   * 返回删除的空块数量（失败静默返回 0，不影响填充结果）。
   */
  async function cleanupDraftEmptyBlocks(el) {
    try {
      // 目标元素可能位于同源 iframe 内：selection/execCommand 必须用它所属文档的
      const doc = el.ownerDocument || document;
      const view = doc.defaultView || window;
      let removed = 0;
      // 每轮只删"最后一个空块"然后重新查询：DraftJS 删除后异步重渲染会让
      // 之前批量快照里的节点全部失效（addRange(): The given range isn't in
      // document 的根源），逐个重查永远拿新鲜节点
      for (let pass = 0; pass < 30; pass++) {
        let target = null;
        try {
          const blocks = Array.from(el.querySelectorAll(
            '.public-DraftStyleDefault-block, div[data-offset-key]'
          )).filter((b) => (b.textContent || '').trim() === '' && doc.contains(b));
          target = blocks.length ? blocks[blocks.length - 1] : null;
        } catch (_) { /* ignore */ }
        if (!target) break;
        let did = false;
        try {
          const range = doc.createRange();
          range.selectNodeContents(target);
          const sel = view.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          did = doc.execCommand('delete');
        } catch (_) { /* ignore */ }
        if (!did) break;
        removed++;
        await sleep(150);
      }
      return removed;
    } catch (_) {
      return 0;
    }
  }

  /**
   * 把 Markdown 里的 LaTeX 公式转成公式图片（知乎/公众号编辑器都不解析
   * LaTeX 文本，$$...$$ / $...$ 保持原文只能看到源码）。
   * - 块级公式 $$...$$（可多行）→ 居中展示图；行内 $...$ → 行内图
   * - 仅当内容像 LaTeX（含 \ 命令 / ^ / _）才转换，避免误伤普通 $ 金额文本
   * - 代码块（``` 与 ` ）内不做任何替换
   * 用 codecogs 的 PNG 渲染服务：知乎会转存外链图，实测 SVG 会被拒收
   * （"上传失败"），PNG 可正常转存；\dpi{150} 保证清晰度。
   */
  function latexMdToImg(md) {
    // 空格必须编码为 %20：codecogs 把查询串里的 + 当字面加号渲染
    //（0.4.10 之前空格转 + 曾导致公式里冒出大量 + 号）
    const enc = (s) => encodeURIComponent(s.trim());
    const img = (tex, display) => {
      tex = tex.replace(/\\mathm\b/g, '\\mathrm'); // 常见笔误修正
      const style = display
        ? 'display:block;margin:10px auto;max-width:100%;'
        : 'vertical-align:middle;max-width:100%;';
      const src = 'https://latex.codecogs.com/png.image?' + enc('\\dpi{150} ' + tex);
      return '<img src="' + src + '" alt="' + tex.replace(/"/g, '&quot;') + '" style="' + style + '">';
    };
    const isLatex = (t) => /[\\^_]|\b(?:frac|sum|in|int|mathbb|mathrm|text|times|sqrt|ln|log)\b/.test(t);
    const D = '\u0001D';
    let out = String(md || '');
    out = out.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => m.replace(/\$/g, D)); // 保护代码块
    out = out
      .replace(/^[ \t]*\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$[ \t]*$/gm, (m, tex) =>
        isLatex(tex) ? '\n' + img(tex, true) + '\n' : m)
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => isLatex(tex) ? img(tex, true) : m)
      .replace(/(^|[^\\$])\$(?!\s)((?:[^$\n\\]|\\.)+?)\$(?!\w)/g, (m, pre, tex) =>
        isLatex(tex) ? pre + img(tex, false) : m);
    return out.replace(new RegExp(D, 'g'), '$');
  }

  /**
   * 富文本编辑器填充：ProseMirror / DraftJS / Slate / UEditor 等多级兜底。
   * options:
   *  - directHtml: 粘贴失败后允许直接 innerHTML 覆写（仅对非受控编辑器生效）
   *  - cleanupEmptyBlocks: 粘贴成功后删除编辑器生成的空块
   *    （知乎 DraftJS 在列表结束处插入空段落，表现为列表与后文之间多出空行）
   * 返回 { ok, message }。
   */
  /**
   * 深度兜底发现富文本编辑器：已知选择器全部落空时（公众号 0.4.5/0.4.6 连续
   * "未找到富文本编辑器容器"），在顶层文档、同源 iframe、开放 shadowRoot 中
   * 枚举所有可编辑元素，过滤标题字段后按面积/特征打分，逐个尝试粘贴管线；
   * 对"点击后才挂载 contenteditable"的懒激活编辑器先真实点击再重查。
   * 返回 { ok, el, hint } 或 null。
   */
  async function deepFindRichEditor({ html, text, timeout, directHtml = false }) {
    const deadline = Date.now() + timeout;
    const tried = new WeakSet();
    while (Date.now() < deadline) {
      const cands = [];
      for (const doc of collectEditableDocs()) {
        for (const el of deepEditableCandidates(doc)) {
          if (looksLikeTitleField(el) || tried.has(el)) continue;
          const s = scoreRichCandidate(el);
          if (s > 0) cands.push({ el, s });
        }
      }
      cands.sort((a, b) => b.s - a.s);
      for (const { el } of cands.slice(0, 3)) {
        try {
          tried.add(el);
          if (!el.isContentEditable) {
            // 懒激活：真实点击触发编辑器挂载 contenteditable，再复查
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.click();
            await sleep(1200);
            if (!el.isContentEditable) continue;
          }
          el.focus();
          await sleep(400);
          // 合成 paste 两次 → 拍扁检测 → 真实剪贴板粘贴 →（非受控）innerHTML
          let pasted = false;
          for (let i = 0; i < 2 && !pasted; i++) {
            firePaste(el, { html, text });
            await sleep(700);
            pasted = (el.textContent || '').trim().length > 0;
          }
          if (pasted && !isFlattened(el, html)) {
            return { ok: true, el, hint: describeEl(el) };
          }
          if (await realClipboardPaste(el, html, text)) {
            await sleep(800);
            if ((el.textContent || '').trim().length > 0 && !isFlattened(el, html)) {
              return { ok: true, el, hint: '原生剪贴板/' + describeEl(el) };
            }
          }
          if (directHtml && !isControlledEditor(el)) {
            el.innerHTML = html;
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            await sleep(500);
            if ((el.textContent || '').trim().length > 0 && !isFlattened(el, html)) {
              return { ok: true, el, hint: 'innerHTML/' + describeEl(el) };
            }
          }
        } catch (_) { /* 下一个候选 */ }
      }
      await sleep(2000);
    }
    return null;
  }

  async function fillRichText({ html, text, selectors, timeout = 25000, directHtml = false, cleanupEmptyBlocks = false }) {
    // 1) UEditor iframe（旧版编辑器）：必须可见，避免把内容写进隐藏残留 iframe
    for (const iframe of document.querySelectorAll('iframe[id^="ueditor"], iframe.Editor')) {
      try {
        if (isVisible(iframe) && iframe.contentDocument && iframe.contentDocument.body &&
            iframe.contentDocument.body.isContentEditable !== false) {
          const body = iframe.contentDocument.body;
          body.innerHTML = html;
          return { ok: true, message: '已通过 UEditor iframe 填充' };
        }
      } catch (_) { /* 跨域 iframe 忽略 */ }
    }
    const startedAt = Date.now();
    const fillDone = async (el, okMsg) => {
      if (cleanupEmptyBlocks) await cleanupDraftEmptyBlocks(el);
      return verifyRichStable(el, okMsg);
    };
    // 2) contenteditable 富文本容器（跳过标题字段：正文绝不能粘进标题框）
    const found = await firstExisting(selectors, { timeout: Math.round(timeout * 0.6), skip: looksLikeTitleField });
    if (found) {
      const el = found.el;
      // 焦点校验：编辑器挂载后常把焦点抢回，焦点不在目标编辑器上时执行写入，
      // 内容会进到当前焦点元素（公众号曾把正文写进标题输入框）。聚焦失败不写入。
      // 编辑器可能在同源 iframe 内：activeElement 取自它所属文档，顶层
      // document.activeElement 此时只会是 <iframe> 元素本身
      const focusOk = async () => {
        el.focus();
        await sleep(400);
        try {
          const doc = el.ownerDocument || document;
          return doc.activeElement === el || (el.contains && el.contains(doc.activeElement));
        } catch (_) { return true; }
      };
      const pasteAndCheck = async () => {
        firePaste(el, { html, text });
        await sleep(600);
        return (el.textContent || '').trim().length > 0;
      };
      // 合成 paste 最多尝试两次（编辑器事件处理器可能晚于元素挂载）
      let pasted = false;
      for (let i = 0; i < 2 && !pasted; i++) {
        if (!(await focusOk())) break;
        pasted = await pasteAndCheck();
      }
      // 粘贴"成功"但被拍扁（编辑器把 text/html 降级成单段纯文本，公众号实测行为）
      // 不能算成功，继续走真实剪贴板粘贴
      if (pasted && !isFlattened(el, html)) {
        return fillDone(el, '已填充富文本编辑器（' + found.selector + '）');
      }
      // 3) 真实剪贴板粘贴（clipboardRead）：与用户 Ctrl+V 完全同管线，
      //    编辑器按真实外部粘贴处理，不会被降级成纯文本（mdnice 同款路径）
      if (await realClipboardPaste(el, html, text)) {
        await sleep(800);
        if ((el.textContent || '').trim().length > 0 && !isFlattened(el, html)) {
          return fillDone(el, '已通过原生剪贴板粘贴填充');
        }
      }
      const controlled = isControlledEditor(el);
      // 4) innerHTML 直写：仅对非受控编辑器安全（受控编辑器会回滚 DOM，造成假阳性）
      if (directHtml && !controlled) {
        try {
          el.innerHTML = html;
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(400);
          if ((el.textContent || '').trim().length > 0 && !isFlattened(el, html)) {
            return verifyRichStable(el, '已通过 innerHTML 直写填充');
          }
        } catch (_) { /* ignore */ }
      }
      // 5) 主世界富文本填充兜底：在页面主世界按 selectors 定位正文容器执行
      //    paste / insertHTML，与页面编辑器处理器同世界执行，识别率高于隔离世界
      const mw = await fillViaMainWorldRich({ selectors, html, text });
      if (mw && mw.ok) {
        await sleep(600);
        if ((el.textContent || '').trim().length > 0 && !isFlattened(el, html)) {
          return { ok: true, message: '已通过主世界' + (mw.how === 'insertHTML' ? 'insertHTML' : '粘贴') + '填充' };
        }
      }
    }
    // 6) 深度兜底：已知选择器全部落空时启用（占用剩余超时时间）
    const deepLeft = timeout - (Date.now() - startedAt);
    const deep = await deepFindRichEditor({ html, text, timeout: Math.max(5000, deepLeft), directHtml });
    if (deep && deep.ok) {
      return fillDone(deep.el, '已通过深度发现填充编辑器（' + deep.hint + '）');
    }
    // 7) 失败：附带页面可编辑元素诊断，便于远程精准定位编辑器结构
    return { ok: false, message: '未找到富文本编辑器容器。页面可编辑元素：' + describeEditableState() };
  }

  /**
   * 请求 background 在「页面主世界」执行富文本填充（paste / insertHTML），
   * selectors 用于在主世界定位正文编辑器容器。返回 { ok, how }。
   */
  function fillViaMainWorldRich({ selectors, html, text }) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r || { ok: false }); } };
      try {
        chrome.runtime.sendMessage({ type: 'MAIN_WORLD_FILL_RICH', selectors, html, text }, (res) => {
          void chrome.runtime.lastError;
          done(res);
        });
        setTimeout(() => done({ ok: false }), 8000);
      } catch (_) {
        done({ ok: false });
      }
    });
  }

  /**
   * 请求 background 在「页面主世界」执行 CodeMirror 5/6 实例直写。
   * 关键背景：CM6 的 EditorView（el.cmView）和 CM5 的实例（el.CodeMirror）
   * 都是页面 JS 挂在 DOM 对象上的属性，内容脚本隔离世界不可见——
   * 掘金 bytemd / CSDN 新编辑器必须在主世界 dispatch 才能真正写入。
   * 返回 { ok, cm6, cm5 }。
   */
  function fillViaMainWorld(markdown) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r || { ok: false }); } };
      try {
        chrome.runtime.sendMessage({ type: 'MAIN_WORLD_FILL', markdown }, (res) => {
          void chrome.runtime.lastError;
          done(res);
        });
        setTimeout(() => done({ ok: false }), 5000);
      } catch (_) {
        done({ ok: false });
      }
    });
  }

  /**
   * Markdown 编辑器填充：主世界 CM6/CM5 实例直写 → contenteditable 粘贴 → textarea 赋值，
   * 多级兜底。关键原则：每种填充方式都必须"回读校验"，回读不到就报失败，
   * 杜绝掘金之前"浮层显示成功、内容实际为空"的假阳性。
   * 返回 { ok, message }。
   */
  async function fillMarkdown({ markdown, selectors, timeout = 25000 }) {
    const list = (selectors || []).filter(Boolean);
    const start = Date.now();
    let found = null;
    let mainWorldNote = '';

    // 轮询等待：主世界 CM 实例 / 选择器命中的 DOM
    while (Date.now() - start < timeout) {
      // 1) 首选：主世界 CodeMirror 6/5 实例直写（最可靠，不会被渲染回滚）
      const mw = await fillViaMainWorld(markdown);
      if (mw && mw.ok) {
        const kind = mw.cm6 > 0 ? 'CodeMirror 6' : (mw.cm5 > 0 ? 'CodeMirror 5' : '主世界粘贴');
        return { ok: true, message: '已通过' + kind + '填充' };
      }
      if (mw && mw.note) mainWorldNote = mw.note;
      // 2) 选择器兜底
      for (const sel of list) {
        try {
          const el = document.querySelector(sel);
          if (el) { found = { el, selector: sel }; break; }
        } catch (_) { /* ignore */ }
      }
      if (found) break;
      await sleep(400);
    }
    if (!found) {
      return { ok: false, message: '未找到 Markdown 编辑器' + (mainWorldNote ? '（' + mainWorldNote + '）' : '') };
    }

    const el = found.el;
    // 普通输入框：原生 setter 赋值 + 回读校验
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeValue(el, markdown);
      await sleep(300);
      if ((el.value || '').length > 0) return { ok: true, message: '已填充 Markdown 文本框（' + found.selector + '）' };
      return { ok: false, message: 'Markdown 文本框赋值后未生效（' + found.selector + '）' };
    }
    // contenteditable（CodeMirror 6 / ProseMirror 类）：先再试主世界直写（此刻 cmView 可能已可用）
    if (el.isContentEditable) {
      const mw = await fillViaMainWorld(markdown);
      if (mw && mw.ok) {
        const kind = mw.cm6 > 0 ? 'CodeMirror 6' : (mw.cm5 > 0 ? 'CodeMirror 5' : '主世界粘贴');
        return { ok: true, message: '已通过' + kind + '填充' };
      }
      el.focus();
      try { document.execCommand('selectAll', false, null); } catch (_) { /* ignore */ }
      firePaste(el, { text: markdown });
      await sleep(600);
      if ((el.textContent || '').trim().length > 0) {
        return { ok: true, message: '已通过粘贴填充（' + found.selector + '）' };
      }
      // 注意：绝不回退到 el.textContent = markdown —— CM6 会回滚 DOM 造成假成功
      return { ok: false, message: '编辑器容器找到了但粘贴未生效（' + found.selector + '）' };
    }
    return { ok: false, message: '未找到 Markdown 编辑器' };
  }

  /** 复制文本到剪贴板：优先异步 API，失败回退 execCommand（content script 场景） */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* 无焦点或权限时回退 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * 复制富文本（text/html + text/plain 双通道）到剪贴板。
   * 关键：writeText 只写纯文本通道，把 HTML 源码粘进富文本编辑器会变成一堆标签文本；
   * 富文本平台（公众号等）的剪贴板兜底必须用本函数，粘贴才能保留排版。
   */
  async function copyRichToClipboard(html, plainText) {
    try {
      if (navigator.clipboard && self.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText != null ? plainText : html], { type: 'text/plain' })
        })]);
        return true;
      }
    } catch (_) { /* 无焦点等，走 execCommand 兜底 */ }
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

  /** 标题填充。finder：可选的自定义查找函数（选择器全部失效时的兜底，简书等使用） */
  async function fillTitle({ title, selectors, timeout = 20000, finder = null }) {
    let found = await firstExisting(selectors, { timeout: finder ? Math.min(timeout, 10000) : timeout });
    if (!found && finder) {
      const el = await waitFor(() => { try { return finder() || null; } catch (_) { return null; } }, { timeout: Math.max(timeout, 12000), interval: 400 });
      if (el) found = { el, selector: '自定义查找' };
    }
    if (!found) return { ok: false, message: '未找到标题输入框' };
    const el = found.el;
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      firePaste(el, { text: title });
      if ((el.textContent || '').trim()) return { ok: true, message: '' };
      setNativeValue(el, title);
      return { ok: (el.textContent || '').trim().length > 0, message: '' };
    }
    setNativeValue(el, title);
    await sleep(200);
    return { ok: (el.value || el.textContent || '').trim().length > 0, message: '' };
  }

  /* ============ 图片直传（平台自有图床）通用工具：本节为纯新增，不改动任何既有函数 ============ */

  /** 提取 Markdown 里所有外链图片 URL */
  function extractMdImages(md) {
    const re = /(!\[[^\]]*\]\()(https?:\/\/[^)\s]+)(\))/g;
    const out = [];
    let m;
    while ((m = re.exec(md || '')) !== null) out.push(m[2]);
    return out;
  }

  /** 按 url→新url 映射替换 Markdown 里的图片地址 */
  function replaceMdImages(md, map) {
    return String(md || '').replace(/(!\[[^\]]*\]\()(https?:\/\/[^)\s]+)(\))/g, (all, pre, url, post) =>
      (map && map[url]) ? pre + map[url] + post : all);
  }

  /** 按 url→新url 映射替换 HTML 里 <img> 的 src（富文本兜底路径与 Markdown 用同一份重传映射） */
  function replaceHtmlImgUrls(html, map) {
    return String(html || '').replace(/(<img[^>]*?\ssrc=)(["'])(https?:\/\/[^"']+)\2/gi, (all, pre, q, url) =>
      (map && map[url]) ? pre + q + map[url] + q : all);
  }

  /** 页面侧下载图片为 dataURL（依赖目标图站返回 CORS 头；被拒时由调用方走后台兜底） */
  async function fetchImageAsDataUrl(url) {
    const resp = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const type = (resp.headers.get('content-type') || '').toLowerCase();
    if (!/^image\//.test(type)) throw new Error('非图片类型：' + type);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 10 * 1024 * 1024) throw new Error('图片超过 10MB');
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    return 'data:' + type + ';base64,' + btoa(bin);
  }

  /**
   * 把 Markdown 里的外链图逐张重传到目标平台（uploadOne(dataUrl, fileName) -> {url}）。
   * 逐张独立容错：单张失败仅保留该张原链接并记日志，绝不让整篇填充失败。
   * 平台自有图 / 公式图（codecogs）/ dataURL 自动跳过。
   */
  async function rehostMdImages(md, uploadOne, log, mapOut) {
    const skipRe = /mmbiz\.qpic\.cn|zhimg\.com|hdslb\.com|csdnimg\.cn|codecogs|i\.loli\.net|sinaimg|gtimg\.cn|bdimg|data:image/i;
    const urls = extractMdImages(md).filter((u) => !skipRe.test(u));
    if (!urls.length) return md;
    const uniq = Array.from(new Set(urls));
    const map = {};
    for (const url of uniq) {
      try {
        let dataUrl = null;
        try { dataUrl = await fetchImageAsDataUrl(url); } catch (_) { /* CORS 拒绝时走后台兜底 */ }
        if (!dataUrl) {
          const r = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_IMAGE', url: url });
          if (r && r.ok) dataUrl = r.dataUrl;
        }
        if (!dataUrl) throw new Error('图片下载失败（目标站无跨域许可且后台未授权）');
        const up = await uploadOne(dataUrl, ((url.split('/').pop() || 'image.png').split('?')[0]) || 'image.png');
        if (!up || !up.url) throw new Error('平台未返回图片地址');
        map[url] = up.url;
        if (mapOut) mapOut[url] = up.url;
        if (log) log('info', '图片重传成功：' + url + ' → ' + up.url);
      } catch (e) {
        if (log) log('warn', '图片重传失败（保留原链接）：' + url + ' — ' + ((e && e.message) || e));
      }
    }
    return Object.keys(map).length ? replaceMdImages(md, map) : md;
  }

  self.__MULTIPOST_UTIL__ = {
    sleep, waitFor, firstExisting, setNativeValue, htmlToText, firePaste,
    escapeHtml, normalizeMd, miniMdToHtml, mdToHtml, mdToHtmlNoBreaks, compactHtml,
    stripEmptyBlocks, isVisible, tryCodeMirror5, isControlledEditor, verifyRichStable,
    findCodeMirror6Views, tryCodeMirror6, fillRichText, fillMarkdown, fillTitle,
    fillViaMainWorld, fillViaMainWorldRich, copyToClipboard, copyRichToClipboard,
    hoistNestedLists, latexMdToImg,
    extractMdImages, replaceMdImages, replaceHtmlImgUrls, fetchImageAsDataUrl, rehostMdImages,
    // MathJax 公式渲染（mdnice 同款：内联 SVG），common/formulas.js 提供
    latexMdToRich: (md) => (self.MULTIPOST_FORMULAS
      ? self.MULTIPOST_FORMULAS.latexMdToRich(md)
      : Promise.resolve(latexMdToImg(md)))
  };
})();
