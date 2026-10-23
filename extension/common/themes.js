/**
 * 主题系统（参考 mdnice / wemd 的排版主题思路）：
 * 每个主题 = { id, name, desc, base, rules[] }。
 * - rules: [{ sel, css }]，css 为纯内联样式串（不含伪类），既可拼成预览 CSS，
 *   也可直接内联到富文本平台的 HTML 元素上（公众号/知乎/头条）。
 * - rules 顺序有意义：后面的规则覆盖前面（如 'pre code' 在 'code' 之后重置）。
 * 三端共用：popup（预览）、content（富文本平台套样式）。
 */
(function () {
  'use strict';

  const THEMES = [
    {
      id: 'default',
      name: '简洁默认',
      desc: '干净耐看的通用排版',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8;color:#333;word-break:break-word;',
      rules: [
        { sel: 'h1', css: 'font-size:22px;font-weight:700;color:#1a1a1a;margin:28px 0 16px;text-align:center;' },
        { sel: 'h2', css: 'font-size:19px;font-weight:700;color:#1a1a1a;margin:26px 0 14px;padding-left:10px;border-left:4px solid #4f46e5;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#333;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#333;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#4f46e5;text-decoration:none;border-bottom:1px solid rgba(79,70,229,.35);' },
        { sel: 'strong', css: 'font-weight:700;color:#1a1a1a;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:10px 14px;border-left:4px solid #4f46e5;background:#f5f6ff;color:#555;border-radius:0 6px 6px 0;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#f0f0f5;color:#c7254e;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#282c34;color:#abb2bf;padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px solid #e5e7eb;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #e5e7eb;background:#f9fafb;padding:8px 10px;font-weight:600;text-align:left;' },
        { sel: 'td', css: 'border:1px solid #e5e7eb;padding:8px 10px;' }
      ]
    },
    {
      id: 'wechat',
      name: '公众号经典',
      desc: '微信排版风，适合公众号/知乎',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.85;color:#3f3f3f;word-break:break-word;letter-spacing:.5px;',
      rules: [
        { sel: 'h1', css: 'font-size:21px;font-weight:700;color:#1f1f1f;margin:28px 0 16px;text-align:center;' },
        { sel: 'h2', css: 'font-size:18px;font-weight:700;color:#1f1f1f;margin:26px 0 14px;padding-bottom:6px;border-bottom:2px solid #ff8f42;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#ff8f42;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#3f3f3f;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#ff8f42;text-decoration:none;' },
        { sel: 'strong', css: 'font-weight:700;color:#ff8f42;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:12px 14px;background:#fff8f3;border-left:4px solid #ff8f42;color:#8a5a3b;border-radius:4px;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#fff4ec;color:#d4622a;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#2d2d2d;color:#f8f8f2;padding:14px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px dashed #ffb98a;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #ffd9bd;background:#fff8f3;padding:8px 10px;font-weight:600;text-align:left;color:#d4622a;' },
        { sel: 'td', css: 'border:1px solid #ffd9bd;padding:8px 10px;' }
      ]
    },
    {
      id: 'juejin',
      name: '掘金蓝',
      desc: '技术社区风格，代码友好',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.75;color:#252933;word-break:break-word;',
      rules: [
        { sel: 'h1', css: 'font-size:22px;font-weight:700;color:#1d2129;margin:28px 0 16px;' },
        { sel: 'h2', css: 'font-size:19px;font-weight:700;color:#1d2129;margin:26px 0 14px;padding-left:10px;border-left:4px solid #1e80ff;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#1d2129;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#515767;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#1e80ff;text-decoration:none;' },
        { sel: 'strong', css: 'font-weight:700;color:#1e80ff;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:10px 14px;border-left:4px solid #1e80ff;background:#eaf2fc;color:#515767;border-radius:0 6px 6px 0;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#fff5f5;color:#ff502c;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#1e1e1e;color:#d4d4d4;padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px solid #e5e6eb;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #e5e6eb;background:#f7f8fa;padding:8px 10px;font-weight:600;text-align:left;' },
        { sel: 'td', css: 'border:1px solid #e5e6eb;padding:8px 10px;' }
      ]
    },
    {
      id: 'geek',
      name: '极客暗黑',
      desc: '深色卡片风，预览与代码站气质',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8;color:#d4d4d8;background:#18181b;padding:16px;border-radius:8px;word-break:break-word;',
      rules: [
        { sel: 'h1', css: 'font-size:22px;font-weight:700;color:#fafafa;margin:28px 0 16px;text-align:center;' },
        { sel: 'h2', css: 'font-size:19px;font-weight:700;color:#fafafa;margin:26px 0 14px;padding-bottom:6px;border-bottom:1px solid #3f3f46;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#a5b4fc;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#c7d2fe;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#818cf8;text-decoration:none;' },
        { sel: 'strong', css: 'font-weight:700;color:#fafafa;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:10px 14px;border-left:4px solid #6366f1;background:#27272a;color:#a1a1aa;border-radius:0 6px 6px 0;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#27272a;color:#c4b5fd;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#0f0f10;color:#a5f3fc;padding:14px;border:1px solid #3f3f46;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px solid #3f3f46;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #3f3f46;background:#27272a;padding:8px 10px;font-weight:600;text-align:left;color:#e4e4e7;' },
        { sel: 'td', css: 'border:1px solid #3f3f46;padding:8px 10px;' }
      ]
    },
    {
      id: 'green',
      name: '清新抹茶',
      desc: '柔和绿色系，阅读轻松',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.85;color:#3a4a3f;word-break:break-word;',
      rules: [
        { sel: 'h1', css: 'font-size:21px;font-weight:700;color:#2f5d3a;margin:28px 0 16px;text-align:center;' },
        { sel: 'h2', css: 'font-size:18px;font-weight:700;color:#2f5d3a;margin:26px 0 14px;padding-left:10px;border-left:4px solid #3cafb6;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#3cafb6;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#3a4a3f;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#2f8f6b;text-decoration:none;' },
        { sel: 'strong', css: 'font-weight:700;color:#2f5d3a;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:10px 14px;border-left:4px solid #3cafb6;background:#eff8f4;color:#4a6a56;border-radius:0 6px 6px 0;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#e8f5ee;color:#1f7a5c;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#22332b;color:#c9ead9;padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px solid #cfe8dc;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #cfe8dc;background:#eff8f4;padding:8px 10px;font-weight:600;text-align:left;' },
        { sel: 'td', css: 'border:1px solid #cfe8dc;padding:8px 10px;' }
      ]
    },
    {
      id: 'rose',
      name: '樱花粉',
      desc: '生活/种草类内容适合',
      base: 'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.85;color:#4a3f42;word-break:break-word;',
      rules: [
        { sel: 'h1', css: 'font-size:21px;font-weight:700;color:#c2545f;margin:28px 0 16px;text-align:center;' },
        { sel: 'h2', css: 'font-size:18px;font-weight:700;color:#c2545f;margin:26px 0 14px;padding-bottom:6px;border-bottom:2px solid #f4a7b9;' },
        { sel: 'h3', css: 'font-size:16px;font-weight:600;color:#d46a75;margin:20px 0 10px;' },
        { sel: 'h4', css: 'font-size:15px;font-weight:600;color:#4a3f42;margin:16px 0 8px;' },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: 'color:#d46a75;text-decoration:none;' },
        { sel: 'strong', css: 'font-weight:700;color:#c2545f;' },
        { sel: 'blockquote', css: 'margin:16px 0;padding:10px 14px;border-left:4px solid #f4a7b9;background:#fdf1f4;color:#8a5f68;border-radius:0 6px 6px 0;' },
        { sel: 'code', css: 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#fbe8ee;color:#b34a57;padding:2px 6px;border-radius:4px;' },
        { sel: 'pre', css: 'background:#3d2f33;color:#f5d8de;padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;' },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: 'border:none;border-top:1px dashed #f4a7b9;margin:24px 0;' },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: 'border:1px solid #f4ccd8;background:#fdf1f4;padding:8px 10px;font-weight:600;text-align:left;color:#b34a57;' },
        { sel: 'td', css: 'border:1px solid #f4ccd8;padding:8px 10px;' }
      ]
    }
  ];

  /**
   * 新主题工厂：省去逐条手写 rules 的重复劳动。
   * accent 为主色，各元素按统一套路派生，保证与手写主题结构一致。
   */
  function buildTheme(cfg) {
    const F = 'font-family:Consolas,Menlo,monospace;font-size:13px;';
    return {
      id: cfg.id,
      name: cfg.name,
      desc: cfg.desc,
      base: cfg.base ||
        'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8;color:#333;word-break:break-word;',
      rules: cfg.rules || [
        { sel: 'h1', css: `font-size:22px;font-weight:700;color:${cfg.ink};margin:28px 0 16px;text-align:center;` },
        { sel: 'h2', css: `font-size:19px;font-weight:700;color:${cfg.ink};margin:26px 0 14px;padding-left:10px;border-left:4px solid ${cfg.accent};` },
        { sel: 'h3', css: `font-size:16px;font-weight:600;color:${cfg.accent};margin:20px 0 10px;` },
        { sel: 'h4', css: `font-size:15px;font-weight:600;color:${cfg.ink};margin:16px 0 8px;` },
        { sel: 'p', css: 'margin:0 0 14px;text-align:justify;' },
        { sel: 'a', css: `color:${cfg.accent};text-decoration:none;` },
        { sel: 'strong', css: `font-weight:700;color:${cfg.ink};` },
        { sel: 'blockquote', css: `margin:16px 0;padding:10px 14px;border-left:4px solid ${cfg.accent};background:${cfg.softBg};color:${cfg.bqText};border-radius:0 6px 6px 0;` },
        { sel: 'code', css: `${F}background:${cfg.codeBg};color:${cfg.codeColor};padding:2px 6px;border-radius:4px;` },
        { sel: 'pre', css: `background:${cfg.preBg};color:${cfg.preColor};padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;` },
        { sel: 'pre code', css: 'background:transparent;color:inherit;padding:0;border-radius:0;font-size:inherit;' },
        { sel: 'ul,ol', css: 'margin:0 0 14px;padding-left:24px;' },
        { sel: 'li', css: 'margin:4px 0;' },
        { sel: 'img', css: 'max-width:100%;border-radius:6px;margin:10px 0;display:block;' },
        { sel: 'hr', css: `border:none;border-top:1px ${cfg.hrStyle || 'solid'} ${cfg.hrColor};margin:24px 0;` },
        { sel: 'table', css: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;' },
        { sel: 'th', css: `border:1px solid ${cfg.lineColor};background:${cfg.softBg};padding:8px 10px;font-weight:600;text-align:left;color:${cfg.accent};` },
        { sel: 'td', css: `border:1px solid ${cfg.lineColor};padding:8px 10px;` }
      ]
    };
  }

  THEMES.push(
    buildTheme({
      id: 'business-blue',
      name: '商务蓝',
      desc: '稳重深蓝，适合汇报/评测',
      ink: '#1f3a5f',
      accent: '#2563eb',
      softBg: '#eff4fb',
      bqText: '#3b5a7e',
      codeBg: '#eef2f8',
      codeColor: '#b45309',
      preBg: '#0f2540',
      preColor: '#93c5fd',
      lineColor: '#c9d8ec',
      hrColor: '#c9d8ec'
    }),
    buildTheme({
      id: 'violet',
      name: '浪漫紫',
      desc: '紫罗兰色系，优雅柔和',
      ink: '#3b2a5d',
      accent: '#7c3aed',
      softBg: '#f3effc',
      bqText: '#5b4a80',
      codeBg: '#f1ebfb',
      codeColor: '#9333ea',
      preBg: '#241a3e',
      preColor: '#c4b5fd',
      lineColor: '#ddd2f0',
      hrColor: '#ddd2f0'
    }),
    buildTheme({
      id: 'tech-cyan',
      name: '科技青',
      desc: '高对比青色，技术文首选',
      ink: '#0f3b3f',
      accent: '#0891b2',
      softBg: '#e8f7f9',
      bqText: '#155e6b',
      codeBg: '#e6f6f8',
      codeColor: '#0e7490',
      preBg: '#082f36',
      preColor: '#67e8f9',
      lineColor: '#bfe5ea',
      hrColor: '#bfe5ea'
    }),
    buildTheme({
      id: 'energetic-orange',
      name: '活力橙',
      desc: '暖橙撞色，教程/干货风',
      ink: '#4a2c12',
      accent: '#ea580c',
      softBg: '#fdf1e7',
      bqText: '#9a4b1c',
      codeBg: '#fdeee2',
      codeColor: '#c2410c',
      preBg: '#3b1e0a',
      preColor: '#fdba74',
      lineColor: '#f5d3b8',
      hrColor: '#f5d3b8',
      hrStyle: 'dashed'
    }),
    buildTheme({
      id: 'china-red',
      name: '中国红',
      desc: '正红点缀，节日/公告适用',
      ink: '#4a1a1a',
      accent: '#c0392b',
      softBg: '#faeceb',
      bqText: '#8a3535',
      codeBg: '#f9ebea',
      codeColor: '#a93226',
      preBg: '#2c1210',
      preColor: '#f5b7b1',
      lineColor: '#eecac7',
      hrColor: '#eecac7'
    }),
    buildTheme({
      id: 'minimal-mono',
      name: '极简黑白',
      desc: '无彩色干扰，纯排版主义',
      ink: '#111111',
      accent: '#111111',
      softBg: '#f6f6f6',
      bqText: '#444444',
      codeBg: '#f0f0f0',
      codeColor: '#c7254e',
      preBg: '#111111',
      preColor: '#f5f5f5',
      lineColor: '#dddddd',
      hrColor: '#dddddd'
    })
  );

  self.MULTIPOST_THEMES = THEMES;

  /**
   * 把主题样式内联到 HTML 上（用于公众号/知乎/头条等富文本平台，
   * 让主题排版跨平台保留——mdnice 的核心做法）。
   * 依赖 DOMParser，内容脚本可用。
   */
  self.MULTIPOST_APPLY_THEME = function applyTheme(html, theme) {
    if (!theme || !Array.isArray(theme.rules)) return html;
    try {
      const doc = new DOMParser().parseFromString('<div id="mp-root">' + html + '</div>', 'text/html');
      const root = doc.getElementById('mp-root');
      if (!root) return html;
      root.setAttribute('style', theme.base || '');
      for (const r of theme.rules) {
        let els;
        try { els = root.querySelectorAll(r.sel); } catch (_) { continue; }
        els.forEach((el) => { el.setAttribute('style', r.css); });
      }
      return root.innerHTML;
    } catch (_) {
      return html;
    }
  };

  /** 由主题生成预览用 CSS（限定在 scope 内，如 '#preview-body'） */
  self.MULTIPOST_THEME_CSS = function themeCss(theme, scope) {
    if (!theme) return '';
    const s = scope || '.mp-theme-scope';
    const lines = [s + '{' + (theme.base || '') + '}'];
    for (const r of theme.rules) {
      const parts = r.sel.split(',').map((x) => x.trim()).filter(Boolean);
      for (const p of parts) lines.push(s + ' ' + p + '{' + r.css + '}');
    }
    return lines.join('\n');
  };
})();
