(function () {
  // 代码块语言标签：从 figure.highlight 的类名取语言。
  // figure 自身是横向滚动容器，标签必须挂在外层 wrapper 上才能钉在可视区域右上角。
  document.querySelectorAll('figure.highlight').forEach(function (fig) {
    var lang = fig.className.split(/\s+/).filter(function (c) {
      return c !== 'highlight' && c !== 'plain';
    })[0];
    var wrap = document.createElement('div');
    wrap.className = 'highlight-wrap';
    fig.parentNode.insertBefore(wrap, fig);
    wrap.appendChild(fig);
    if (!lang) return;
    var label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = lang;
    wrap.appendChild(label);
  });

  var toc = document.getElementById('toc');
  var content = document.querySelector('.post-content');
  if (!toc || !content) return;
  var heads = content.querySelectorAll('h2, h3');
  var card = toc.closest('.toc-card');
  if (!heads.length) { if (card) card.style.display = 'none'; return; }
  var html = '<ul>';
  var open = false;
  heads.forEach(function (h, i) {
    if (!h.id) h.id = 'h-' + i;
    if (h.tagName === 'H3' && !open) { html += '<ul>'; open = true; }
    if (h.tagName === 'H2' && open) { html += '</ul>'; open = false; }
    html += '<li><a href="#' + h.id + '">' + h.textContent + '</a></li>';
  });
  if (open) html += '</ul>';
  html += '</ul>';
  toc.innerHTML = html;
})();
