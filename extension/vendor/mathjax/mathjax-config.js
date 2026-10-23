// MathJax 预配置（必须在 tex-svg.js 之前加载；MV3 扩展页禁止内联脚本，故独立成文件）
// 与 common/formulas.js 的 ensureConfig 保持一致
if (!window.MathJax) {
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$']],
      displayMath: [['$$', '$$']],
      processEscapes: false,
      tags: 'ams'
    },
    svg: { fontCache: 'none' },
    options: { renderActions: { addMenu: [0, '', ''] } },
    startup: { typeset: false }
  };
}
