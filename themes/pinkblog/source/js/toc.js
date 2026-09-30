function pbInitPage() {
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

  // 封面图加载完成后，用真实宽高比替换 2:3 占位
  document.querySelectorAll('.post-card-cover .cover-img').forEach(function (img) {
    function natural() {
      if (img.naturalWidth) {
        img.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
        img.style.objectFit = 'contain';
      }
    }
    if (img.complete) natural();
    else img.addEventListener('load', natural);
  });

  // 封面卡：文字列高度钳制到封面实际高度（文字适应封面）
  var mq = matchMedia('(min-width: 769px)');
  document.querySelectorAll('.post-card.has-cover').forEach(function (card) {
    var cover = card.querySelector('.post-card-cover');
    var body = card.querySelector('.post-card-body');
    if (!cover || !body) return;
    var img = cover.querySelector('.cover-img');
    function fit() {
      if (mq.matches) body.style.maxHeight = cover.offsetHeight + 'px';
      else body.style.maxHeight = '';
    }
    fit();
    if (img && !img.complete) img.addEventListener('load', fit);
  });
  mq.addEventListener('change', function () {
    document.querySelectorAll('.post-card.has-cover .post-card-body')
      .forEach(function (b) { b.style.maxHeight = ''; });
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
}
window.pbInitPage = pbInitPage;
pbInitPage();
