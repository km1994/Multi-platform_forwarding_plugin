/**
 * LaTeX 公式渲染（共享模块：content scripts 与 popup 均可加载）。
 *
 * 实现方式与 mdnice 一致：内置 MathJax 3，SVG 输出、fontCache:"none"——
 * 每个公式渲染成自带字形路径的独立内联 <svg>，直接进剪贴板/文章 HTML，
 * 粘贴到公众号、知乎后不依赖任何外链图片、Web 字体或图片转存。
 * MathJax 不可用时（加载失败/超时）回退为 codecogs PNG 公式图。
 *
 * 仅在检测到 $...$ / $$...$$ 时才加载 MathJax（content script 场景通过
 * background 懒注入到隔离世界，页面无感知）。
 */
(function () {
  'use strict';

  const MATHJAX_FILE = 'vendor/mathjax/tex-svg.js';

  /** 写入 MathJax 配置（必须在 tex-svg.js 执行前完成；已有配置则不覆盖） */
  function ensureConfig() {
    if (!self.MathJax) {
      self.MathJax = {
        tex: {
          inlineMath: [['$', '$']],
          displayMath: [['$$', '$$']],
          processEscapes: false,
          tags: 'ams'
        },
        svg: { fontCache: 'none' },
        // 不自动排版页面、不加右键菜单，只做按需 tex2svg
        options: { renderActions: { addMenu: [0, '', ''] } },
        startup: { typeset: false }
      };
    }
  }

  let loadPromise = null;

  /** 确保 MathJax 可用；返回 Promise<boolean> */
  function ensureMathJax() {
    if (self.MathJax && self.MathJax.tex2svg && self.MathJax.startup && self.MathJax.startup.promise) {
      return self.MathJax.startup.promise.then(() => true, () => false);
    }
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          if (!ok) loadPromise = null; // 失败允许下次重试
          resolve(!!ok);
        }
      };
      try {
        ensureConfig();
        // popup 等扩展页面：tex-svg.js 已通过 <script> 标签同步加载，无需注入
        const extPage = !/^https?:/.test(location.protocol);
        if (extPage && self.MathJax && self.MathJax.startup) {
          self.MathJax.startup.promise.then(() => done(true), () => done(false));
          return;
        }
        // content script：请 background 把 tex-svg.js 注入同一隔离世界
        chrome.runtime.sendMessage({ type: 'LOAD_MATHJAX' }, (resp) => {
          if (chrome.runtime.lastError) return done(false);
          if (!resp || !resp.ok) return done(false);
          // executeScript 返回时脚本已执行完；等 startup 初始化
          const wait = () => {
            if (self.MathJax && self.MathJax.startup && self.MathJax.startup.promise) {
              self.MathJax.startup.promise.then(() => done(true), () => done(false));
            } else if (Date.now() - started > 8000) {
              done(false);
            } else {
              setTimeout(wait, 80);
            }
          };
          const started = Date.now();
          wait();
        });
        // 兜底超时：MathJax 起不来就走 PNG 兜底，别卡住整次同步
        setTimeout(() => done(false), 12000);
      } catch (_) {
        done(false);
      }
    });
    return loadPromise;
  }

  /** 单条 LaTeX → 内联 SVG HTML（display=true 块级居中）。失败返回 null */
  function renderFormulaSvg(tex, display) {
    try {
      const mj = self.MathJax;
      if (!mj || !mj.tex2svg) return null;
      const node = mj.tex2svg(String(tex || '').trim(), { display: !!display });
      const svg = mj.startup.adaptor.outerHTML(node);
      if (display) return '<div style="text-align:center;margin:12px 0;">' + svg + '</div>';
      return svg;
    } catch (_) {
      return null;
    }
  }

  /** 单条 LaTeX → codecogs PNG 图（回退方案，与旧版 latexMdToImg 相同） */
  function renderFormulaPng(tex, display) {
    const enc = (s) => encodeURIComponent(String(s || '').trim()).replace(/%20/g, '+');
    const t = String(tex || '').trim();
    const style = display
      ? 'display:block;margin:10px auto;max-width:100%;'
      : 'vertical-align:middle;max-width:100%;';
    const src = 'https://latex.codecogs.com/png.image?' + enc('\\dpi{150} ' + t);
    return '<img src="' + src + '" alt="' + t.replace(/"/g, '&quot;') + '" style="' + style + '">';
  }

  /**
   * Markdown 里的 LaTeX 公式 → 可直接粘贴的内联 SVG（MathJax，mdnice 同款）。
   * - 块级 $$...$$（可跨行）→ 居中 SVG；行内 $...$ → 行内 SVG
   * - 代码块（``` 与 ` ）内不做替换；内容不含 LaTeX 特征（\ ^ _）不误伤金额文本
   * - MathJax 不可用时回退 PNG 公式图；无公式原样返回
   * 返回 Promise<string>
   */
  async function latexMdToRich(md) {
    const src = String(md || '');
    if (!/\$\$[\s\S]+?\$\$|[^$\n]\$[^$\n]+\$/.test(src)) return src;
    // 有公式：先按代码段切开保护，再逐段处理
    const parts = String(src).split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    const hasLatexFeature = (s) => /\\[a-zA-Z]|[^\s]\^|[^\s]_/.test(s);
    const out = [];
    for (const part of parts) {
      if (/^```/.test(part) || /^`[^`]*`$/.test(part)) { out.push(part); continue; }
      let seg = part;
      // 块级公式
      seg = seg.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
        if (!hasLatexFeature(tex)) return m;
        return '\n\n' + (renderFormulaSvg(tex, true) || renderFormulaPng(tex, true)) + '\n\n';
      });
      // 行内公式（$ 前后不贴 $，避免吃掉块级残留/金额文本：内容必须像 LaTeX）
      seg = seg.replace(/([^$\n])\$([^$\n]+?)\$(?!\$)/g, (m, pre, tex) => {
        if (!hasLatexFeature(tex)) return m;
        return pre + (renderFormulaSvg(tex, false) || renderFormulaPng(tex, false));
      });
      out.push(seg);
    }
    const joined = out.join('');
    if (!/<svg|<img/.test(joined)) return src; // 没有产出任何公式节点则原样返回
    return joined;
  }

  /** 便捷入口：确保 MathJax 就绪（预览面板渲染前调用可选） */
  async function ready() {
    return ensureMathJax();
  }

  self.MULTIPOST_FORMULAS = { latexMdToRich, renderFormulaSvg, renderFormulaPng, ensureMathJax, ready };
})();
