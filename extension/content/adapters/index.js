/**
 * 平台适配器注册表。
 * 每个适配器实现：{ id, name, hosts, experimental?, match(url)?, async fill(ctx) -> {ok, message} }
 * ctx = { title, markdown, html, htmlNoBr, util }
 *
 * 维护说明：各平台前端改版会导致选择器失效，fill 内部均为"多级选择器兜底"，
 * 失效时优先在对应选择器数组里补充新选择器即可。
 * 另：fill 失败后 main.js 会自动把内容复制到剪贴板（copyFallback），
 * 用户可手动粘贴，保证平台改版时仍可用。
 */
(function () {
  'use strict';
  const U = self.__MULTIPOST_UTIL__;

  /* ---------------- 知乎专栏 ---------------- */
  const zhihu = {
    id: 'zhihu',
    name: '知乎专栏',
    hosts: ['zhuanlan.zhihu.com'],
    async fill(ctx) {
      // 登录态检查：未登录会被重定向到登录页
      if (/signin|signup/.test(location.pathname)) {
        return { ok: false, message: '知乎未登录，请先在浏览器登录后再同步' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          '.WriteIndex-titleInput textarea',
          '.TitleInput textarea',
          '#Editable-title textarea'
        ]
      });
      // 知乎编辑器是 DraftJS：会把 <br> 解析成空段落（表现为多出好多空行）。
      // 用无 <br> 的块级 HTML（每行独立 <p>），排版紧凑。
      // ① LaTeX 公式 → MathJax 内联 SVG（mdnice 同款；MathJax 不可用自动回退
      //    codecogs PNG 图——知乎会拒收 SVG 外链图转存，但内联 SVG 不走转存）
      // ② 嵌套列表转 DraftJS 兄弟结构（子 ul 提到 li 外），否则嵌套收束处被插入空行
      // ③ cleanupEmptyBlocks：粘贴后再清一遍 DraftJS 自动插入的空块（列表→标题边界）
      const mdWithMath = await U.latexMdToRich(ctx.markdown);
      let htmlZ = U.mdToHtmlNoBreaks(mdWithMath);
      const theme = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
      if (theme && self.MULTIPOST_APPLY_THEME) htmlZ = self.MULTIPOST_APPLY_THEME(htmlZ, theme);
      const rich = await U.fillRichText({
        html: U.hoistNestedLists(htmlZ),
        text: ctx.markdown,
        selectors: [
          '.public-DraftEditor-content[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          '.Editable .EditableView [contenteditable="true"]',
          '#editable-content [contenteditable="true"]'
        ],
        cleanupEmptyBlocks: true
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 掘金 ---------------- */
  const juejin = {
    id: 'juejin',
    name: '掘金',
    hosts: ['juejin.cn'],
    async fill(ctx) {
      // 未登录会被重定向到登录页（manifest 已放宽到整站注入，便于识别）
      if (/\/login|\/signin/.test(location.pathname)) {
        return { ok: false, message: '掘金未登录，请先在浏览器登录 juejin.cn 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.title-input textarea',
          '.header .title-input input'
        ]
      });
      // 掘金编辑器为 bytemd（底层 CodeMirror 6）：
      // fillMarkdown 会优先走「主世界 CM6 实例直写」，这里选择器只作兜底。
      // 注意 .bytemd textarea 是 bytemd 的隐藏同步框，直接赋值不会生效，仅作最后兜底。
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        timeout: 30000,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea.markdown-editor-input',
          '.markdown-body textarea',
          '.bytemd textarea',
          'textarea[placeholder*="Markdown"]'
        ]
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- CSDN ---------------- */
  const csdn = {
    id: 'csdn',
    name: 'CSDN',
    hosts: ['editor.csdn.net'],
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input.text-editor-title',
          'input[placeholder*="标题"]',
          '.article-bar input.title',
          '#txtTitle'
        ]
      });
      // CSDN 新版 Markdown 编辑器底层为 CodeMirror 6，优先走 CM6 实例写入
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        timeout: 40000,
        selectors: [
          'textarea#editor',
          'pre#editor',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          '.cm-content[contenteditable="true"]',
          '.editor__inner textarea',
          'textarea[placeholder*="markdown" i]'
        ]
      });
      if (body.ok) {
        return { ok: title.ok, message: title.ok ? '' : title.message };
      }
      // Markdown 模式失败 → 可能用户默认是「富文本」编辑器，兜底走富文本填充
      const rich = await U.fillRichText({
        html: ctx.html,
        text: ctx.markdown,
        timeout: 8000,
        selectors: [
          '[contenteditable="true"].editor__inner',
          'div[contenteditable="true"][class*="editor"]',
          'div[contenteditable="true"][class*="content"]'
        ]
      });
      const bodyOk = body.ok || rich.ok;
      const bodyMsg = [body.ok ? '' : body.message, rich.ok ? '' : rich.message].filter(Boolean).join('；');
      return {
        ok: title.ok && bodyOk,
        message: [title.ok ? '' : title.message, bodyOk ? '' : bodyMsg].filter(Boolean).join('；')
      };
    }
  };

  /* ---------------- 微信公众号 ---------------- */
  const weixin = {
    id: 'weixin',
    name: '微信公众号',
    hosts: ['mp.weixin.qq.com'],
    async fill(ctx) {
      // 未登录会落在扫码登录页
      if (document.querySelector('.login__type__container__scan, .qrcode_area, #scan_qrcode') ||
          /\/cgi-bin\/loginpage/.test(location.href)) {
        return { ok: false, message: '公众号未登录，请先扫码登录 mp.weixin.qq.com 后重试' };
      }

      // 公众号编辑页必须携带 token 参数；插件打开的无 token 链接会被重定向回首页，
      // 表现为"标题输入框/富文本编辑器都找不到"。这里从页面提取 token（先查 URL，
      // 再查 HTML，带重试等待），然后自动跳转到带 token 的编辑页。返回 silent：
      // 本次不回报结果，跳转后新页面的 content 脚本会重新领取任务并继续填充。
      if (!/[?&]action=edit/.test(location.search)) {
        const token = await U.waitFor(findWxToken, { timeout: 12000, interval: 600 });
        if (token) {
          const url = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=' + token;
          location.href = url;
          return { ok: false, silent: true, message: '已获取公众号 token，正在跳转编辑页…' };
        }
        return { ok: false, message: '未进入公众号编辑页，且页面未找到 token；请先在浏览器登录 mp.weixin.qq.com（能看到左侧菜单的首页），再重新同步' };
      }

      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea#title',
          'textarea[placeholder*="请在这里输入标题"]',
          '#title',
          'input[name="title"]',
          '.title-input textarea',
          'textarea[placeholder*="标题"]'
        ],
        timeout: 25000
      });
      // 标题填完立即失焦：防止后续正文填充时焦点残留把内容写进标题框
      try { document.activeElement && document.activeElement.blur(); } catch (_) { /* ignore */ }
      // 公式渲染：公众号不解析 LaTeX（$$...$$ 只显示源码）。转 MathJax 内联
      // SVG（mdnice 同款，随粘贴内容自带路径，无需图片转存）；MathJax 不可用
      // 自动回退 codecogs PNG 图。再按原流程生成主题 HTML（与 ctx.html 同管线）
      let htmlW = ctx.html;
      if (/\$[\s\S]/.test(ctx.markdown) && U.latexMdToRich && U.mdToHtml) {
        try {
          const mdW = await U.latexMdToRich(ctx.markdown);
          if (mdW !== ctx.markdown) {
            htmlW = U.mdToHtml(mdW);
            const theme = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
            if (theme && self.MULTIPOST_APPLY_THEME) htmlW = self.MULTIPOST_APPLY_THEME(htmlW, theme);
          }
        } catch (_) { htmlW = ctx.html; /* 公式转换失败退回原文 */ }
      }
      // 正文：新版编辑器 = 顶层文档里的 ProseMirror（#ueditor_0 是 mock-iframe，
      // 只是 CSS 类不是真 iframe，实测 DOM 来自页面存档）。选择器全部限定在
      // 正文编辑器上——绝不放宽到任意 contenteditable：标题也是 .ProseMirror
      //（data-placeholder="请在这里输入标题"），0.4.4 曾把整篇正文粘进标题框；
      // looksLikeTitleField 护栏现已覆盖 data-placeholder，此处再按正文容器限定
      const rich = await U.fillRichText({
        html: htmlW,
        text: ctx.markdown,
        timeout: 45000,
        directHtml: true,
        selectors: [
          // 真实结构（页面存档确认）：#ueditor_0.mock-iframe > .mock-iframe-body > .rich_media_content > .ProseMirror
          '.rich_media_content .ProseMirror[contenteditable="true"]',
          '#ueditor_0 .ProseMirror[contenteditable="true"]',
          '.mock-iframe-body .ProseMirror[contenteditable="true"]',
          '.editor-v-root .ProseMirror[contenteditable="true"]',
          '.rich_media_content[contenteditable="true"]',
          '.edui-body-container[contenteditable="true"]',
          'div[contenteditable][data-placeholder*="正文"]',
          'div[contenteditable="true"][aria-label*="正文"]',
          // 旧版 UEditor 式 iframe：可编辑的 iframe body（firstExisting 会进 iframe 查找）
          'body[contenteditable="true"]'
        ]
      });
      // 标题污染恢复：历史版本曾把正文粘进标题框，若标题内容远超标题长度则还原
      //（标题真实结构：.title-editor__input > .ProseMirror[data-placeholder=请在这里输入标题]）
      try {
        const t = document.querySelector('textarea#title, #title[contenteditable], .title-editor__input .ProseMirror, div[contenteditable="true"][class*="title" i]');
        const cur = t ? (t.value !== undefined ? t.value : t.textContent) : '';
        if (t && cur && cur.length > ctx.title.length + 5) {
          if (t.value !== undefined) t.value = ctx.title;
          else t.textContent = ctx.title;
          t.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (_) { /* ignore */ }
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /** 从公众号页面提取 token（content script 与页面 JS 隔离，只能从 URL/DOM 正则提取） */
  function findWxToken() {
    try {
      // 首页重定向后 token 通常直接出现在地址栏
      let m = location.href.match(/[?&]token=(\d+)/);
      if (m) return m[1];
      m = document.documentElement.innerHTML.match(/[?&]token=(\d+)/);
      if (m) return m[1];
    } catch (_) { /* ignore */ }
    return null;
  }

  /* ---------------- 今日头条（头条号） ---------------- */
  const toutiao = {
    id: 'toutiao',
    name: '今日头条',
    hosts: ['mp.toutiao.com'],
    async fill(ctx) {
      if (/login/.test(location.href)) {
        return { ok: false, message: '头条号未登录，请先登录 mp.toutiao.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.article-title textarea',
          '.title-input textarea'
        ]
      });
      const rich = await U.fillRichText({
        html: ctx.html,
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.ProseMirror[contenteditable="true"]',
          '.editor-content[contenteditable="true"]',
          '[class*="editor"] [contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 简书（实验性） ---------------- */
  const jianshu = {
    id: 'jianshu',
    name: '简书',
    hosts: ['www.jianshu.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录 / 未进入创作中心：跳到 writer 入口（返回 silent，跳转后重新领任务）
      if (!/\/writer/.test(location.pathname)) {
        if (/\/(sign_up|signin)/.test(location.pathname)) {
          return { ok: false, message: '简书未登录，请先登录 www.jianshu.com 后重试' };
        }
        location.href = 'https://www.jianshu.com/writer';
        return { ok: false, silent: true, message: '正在进入简书创作中心…' };
      }

      // 简书必须写到「新建笔记」里：直接打开 writer 会命中上次的旧草稿（默认标题是
      // 日期，如 2026-10-23）。之前点击「新建文章」后只 sleep(1500)，SPA 路由还没切完
      // 就开始找标题，导致标题填充失败或写进旧草稿；现在改为等待路由 hash 真正切到
      // /notes/:id 再继续。
      const onNotePage = () => /\/notes\/\d+/.test(location.hash);
      // 已在笔记页但标题是纯日期 → 命中的是旧草稿，同样需要点「新建文章」换到新笔记
      const looksLikeOldDraft = () => {
        const el = jianshuTitleFinder();
        if (!el) return false;
        const v = String(el.value != null ? el.value : el.textContent || '').trim();
        return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v);
      };
      if (!onNotePage() || looksLikeOldDraft()) {
        const newBtn = await U.waitFor(() =>
          [...document.querySelectorAll('a, button, [role="button"], li, span')]
            .find((e) => /新建文章|写文章/.test((e.textContent || '').trim()) && U.isVisible(e))
        , { timeout: 8000 });
        if (newBtn) {
          newBtn.click();
          await U.waitFor(onNotePage, { timeout: 10000, interval: 400 });
          await U.sleep(1200); // 新笔记编辑器挂载
        }
      }

      // 标题：简书 writer 的选择器随版本变化（_24i7q 等哈希类不可靠），
      // 用特征查找：编辑器区域内、靠页面顶部、宽度足够的单行输入框
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input.note-title',
          'input._24i7q',
          'header input[type="text"]'
        ],
        timeout: 8000,
        finder: jianshuTitleFinder
      });
      // 先按 Markdown 编辑器填；失败再按富文本编辑器兜底
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea#arthur-editor',
          'textarea.note-edit',
          'textarea[placeholder*="正文"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.htmlNoBr || ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            'div[contenteditable="true"][class*="editor"]',
            'div[contenteditable="true"][class*="content"]',
            '.arthur-editor div[contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /**
   * 简书标题自定义查找：
   * 1) 语义特征优先：placeholder/class 带标题特征的可编辑元素
   *    （简书改版后标题可能是 contenteditable，而非 input/textarea）；
   * 2) 几何特征兜底：可见单行输入框，位于编辑区（右侧 2/3、页面顶部 50%），
   *    宽度 > 200px 且高度 < 100px（排除侧栏搜索框与正文编辑器）。
   */
  function jianshuTitleFinder() {
    const semantic = document.querySelectorAll([
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input.note-title',
      'input[class*="title" i]',
      'textarea[class*="title" i]',
      'div[contenteditable="true"][class*="title" i]',
      '[class*="Title"] input'
    ].join(','));
    for (const el of semantic) {
      try {
        if (!U.isVisible(el)) continue;
        const ph = el.getAttribute('placeholder') || '';
        if (ph.includes('标题')) return el;
        const r = el.getBoundingClientRect();
        if (r.width >= 200 && r.left >= window.innerWidth * 0.3 && r.top <= window.innerHeight * 0.5) return el;
      } catch (_) { /* ignore */ }
    }
    const els = document.querySelectorAll('input[type="text"], input:not([type]), textarea, div[contenteditable="true"]');
    for (const el of els) {
      try {
        if (!U.isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height > 100) continue;
        if (r.left < window.innerWidth * 0.3) continue; // 排除左侧栏
        if (r.top > window.innerHeight * 0.5) continue; // 标题在编辑区顶部（放宽到 50%）
        // contenteditable 候选若位于正文编辑器容器内则跳过，避免误选正文
        if (el.tagName === 'DIV' && el.isContentEditable &&
            el.closest('[class*="editor" i], .arthur-editor')) continue;
        return el;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  /* ---------------- 博客园（实验性） ---------------- */
  const cnblogs = {
    id: 'cnblogs',
    name: '博客园',
    hosts: ['i.cnblogs.com'],
    experimental: true,
    async fill(ctx) {
      // 登录态 / 开通状态检查：博客园要求账号先开通博客功能才能进入后台
      const pageText = (document.body && document.body.innerText) || '';
      if (/登录|signin/i.test(location.pathname) || /请登录|用户登录/.test(pageText.slice(0, 500))) {
        return { ok: false, message: '博客园未登录，请先登录 i.cnblogs.com 后重试' };
      }
      if (/未开通博客/.test(pageText)) {
        return {
          ok: false,
          message: '博客园账号未开通博客功能（与登录与否无关）：请到 i.cnblogs.com 按提示「申请开通博客」，人工审核通过后（通常 1-3 天）再同步'
        };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#post-title',
          'input[name="Title"]',
          'input[id*="Title"]',
          'input[placeholder*="标题"]'
        ]
      });
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea#md-editor',
          'textarea#Editor_Edit_EditorBody',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[name*="EditorBody"]',
          'textarea[id*="editor" i]'
        ]
      }).then(async (res) => {
        if (res.ok) return res;
        // TinyMCE（富文本模式）兜底
        const iframe = document.querySelector('iframe#iframe_Edit_EditorBody, iframe[id*="EditorBody"], iframe.mce-edit-area');
        if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
          iframe.contentDocument.body.innerHTML = ctx.html;
          return { ok: true, message: '已通过 TinyMCE iframe 填充' };
        }
        return res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- B站专栏（实验性，新版 york 编辑器） ---------------- */
  const bilibili = {
    id: 'bilibili',
    name: 'B站专栏',
    hosts: ['member.bilibili.com'],
    experimental: true,
    async fill(ctx) {
      if (/passport\.bilibili\.com|\/login/.test(location.href)) {
        return { ok: false, message: 'B站未登录，请先登录 bilibili.com 后重试' };
      }
      // 旧版 read/editor/#/web 已下线：页面提示"旧版编辑器已停止使用"时自动跳新版 york 编辑器
      if (/\/read\/editor/.test(location.pathname)) {
        const pageText = (document.body && document.body.innerText) || '';
        if (/旧版编辑器已停止使用|旧版编辑器已下线/.test(pageText)) {
          location.href = 'https://member.bilibili.com/york/read-editor';
          return { ok: false, silent: true, message: '正在跳转 B站新版专栏编辑器…' };
        }
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'textarea[placeholder*="30字"]',
          'input[placeholder*="标题"]',
          '.b-read-editor__title textarea',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 20000
      });
      // york 编辑器为自研块编辑器（contenteditable），合成 paste 识别；Quill 兜底
      const rich = await U.fillRichText({
        html: ctx.htmlNoBr || ctx.html,
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.ql-editor[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          '.b-read-editor .ql-editor[contenteditable="true"]',
          'div[contenteditable="true"][class*="editor" i]',
          'div[contenteditable="true"][data-placeholder]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 百家号（实验性） ---------------- */
  const baijiahao = {
    id: 'baijiahao',
    name: '百家号',
    hosts: ['baijiahao.baidu.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|passport\.baidu\.com/.test(location.href)) {
        return { ok: false, message: '百家号未登录，请先登录 baijiahao.baidu.com 后重试' };
      }
      // 标题选择器随改版易失效：选择器超时后用特征查找兜底
      // （编辑区顶部、宽度足够的可见单行输入框/标题 contenteditable）
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          '.title-input input',
          '#title',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 20000,
        finder: baijiahaoTitleFinder
      });
      // 百家号图文编辑器为自研富文本（contenteditable），合成 paste 多数可识别
      const rich = await U.fillRichText({
        html: ctx.htmlNoBr || ctx.html,
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.editor-container [contenteditable="true"]',
          '[class*="editor"] [contenteditable="true"]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /** 百家号标题特征查找：编辑区顶部 50%、宽度 > 200px、高度 < 100px 的可编辑元素 */
  function baijiahaoTitleFinder() {
    const els = document.querySelectorAll(
      'input[type="text"], input:not([type]), textarea, div[contenteditable="true"]'
    );
    for (const el of els) {
      try {
        if (!U.isVisible(el)) continue;
        const ph = el.getAttribute('placeholder') || '';
        if (ph && /标题/.test(ph)) return el;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height > 100) continue;
        if (r.top > window.innerHeight * 0.5) continue; // 标题位于编辑区顶部
        // 排除正文编辑器容器内的 contenteditable
        if (el.tagName === 'DIV' && el.isContentEditable &&
            el.closest('[class*="editor" i]')) continue;
        return el;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  /* ---------------- 51CTO博客（实验性） ---------------- */
  const cto51 = {
    id: 'cto51',
    name: '51CTO博客',
    hosts: ['blog.51cto.com'],
    experimental: true,
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#title',
          'input[placeholder*="标题"]',
          'input[name="title"]'
        ],
        timeout: 20000
      });
      // 51CTO 悟空编辑器：Markdown 模式为 textarea（placeholder=请输入正文），富文本模式为 contenteditable
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea[placeholder*="正文"]',
          'textarea[name*="content"]',
          '.cm-content[contenteditable="true"]',
          'textarea'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            '[class*="editor"] [contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 开源中国（实验性） ---------------- */
  const oschina = {
    id: 'oschina',
    name: '开源中国',
    hosts: ['my.oschina.net'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '开源中国未登录，请先登录 my.oschina.net 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#title',
          'input[placeholder*="标题"]',
          'input[name="title"]'
        ],
        timeout: 20000
      });
      // Markdown 模式：#mdeditor textarea（CodeMirror）；富文本模式：UEditor iframe
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea#mdeditor',
          '#mdeditor',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[name="content"]'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          selectors: [
            'iframe[id^="ueditor"]',
            '[contenteditable="true"].edui-body-container',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 腾讯云开发者社区（实验性） ---------------- */
  const tencentcloud = {
    id: 'tencentcloud',
    name: '腾讯云社区',
    hosts: ['cloud.tencent.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '腾讯云社区未登录，请先登录 cloud.tencent.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder="请输入标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]'
        ],
        timeout: 25000
      });
      // write-new 编辑器可能为 CodeMirror（主世界 CM6 直写优先），
      // 也可能改版为富文本 contenteditable —— 两种都兜住
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[placeholder*="正文"], textarea[placeholder*="markdown" i]'
        ],
        timeout: 25000
      }).then(async (res) => {
        if (res.ok) return res;
        // 富文本编辑器兜底（改版后的 write-new 为自研富文本）
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 10000,
          directHtml: true,
          selectors: [
            'div[contenteditable="true"][class*="editor" i]',
            '.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"][data-placeholder]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 阿里云开发者社区（实验性） ---------------- */
  const aliyun = {
    id: 'aliyun',
    name: '阿里云社区',
    hosts: ['developer.aliyun.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页（标题/编辑器都找不到的常见原因）
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '阿里云社区未登录，请先登录 developer.aliyun.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input.article-title',
          '#title'
        ],
        timeout: 25000
      });
      // 阿里云博文默认 Markdown 编辑器（含 CodeMirror 变体），富文本（语雀）兜底
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[placeholder*="正文"], textarea[placeholder*="markdown" i]',
          'textarea'
        ],
        timeout: 25000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            '[class*="editor"] [contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 本地演示页 ---------------- */
  const demo = {
    id: 'demo',
    name: '本地演示页',
    hosts: ['localhost', '127.0.0.1'],
    match(url) {
      return /(^|\.)localhost$/.test(location.hostname) && location.port === '8788';
    },
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: ['#demo-title'],
        timeout: 10000
      });
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: ['#demo-content'],
        timeout: 10000
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  self.__MULTIPOST_ADAPTERS__ = [
    zhihu, juejin, csdn, weixin, toutiao, jianshu, cnblogs,
    bilibili, baijiahao, cto51, oschina, tencentcloud, aliyun, demo
  ];
})();
