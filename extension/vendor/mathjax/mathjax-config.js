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
    // 禁用 assistive MathML：mjx-container 默认附带的 <mjx-assistive-mml>
    // 会被公众号编辑器按文本拍平，公式变成 "+ 号" 乱码（0.4.9 实测事故）
    options: { renderActions: { addMenu: [0, '', ''], assistiveMml: [] } },
    startup: { typeset: false }
  };
}
