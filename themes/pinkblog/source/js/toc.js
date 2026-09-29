(function () {
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
