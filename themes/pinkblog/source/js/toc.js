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

  // ---- 萌计数器刷新（Umami 自动追踪 SPA 换页，无需手动补）----
  var moeImg = document.querySelector('.moe-counter img');
  if (moeImg) {
    var sep = moeImg.src.indexOf('?') > -1 ? '&' : '?';
    moeImg.src = moeImg.src.split('?')[0] + sep + 't=' + Date.now();
  }

  // ---- Waline 评论组件（文章页/留言板）----
  var walineEl = document.getElementById('waline-comment');
  if (walineEl && window.PB_WALINE && window.PB_WALINE.serverURL) {
    if (window._walineInstance && window._walineInstance.destroy) window._walineInstance.destroy();
    import(window.PB_WALINE.module).then(function (W) {
      window._walineInstance = W.init({
        el: '#waline-comment',
        serverURL: window.PB_WALINE.serverURL,
        lang: window.PB_WALINE.lang || 'zh-CN',
        dark: 'html[data-theme="dark"]',
        pageview: false,
        emoji: window.PB_WALINE.emoji
      });
      // 编辑框占位符携带必填/隐私说明（昵称/邮箱输入框默认折叠，用户看不到）
      function patchWaline() {
        var editor = walineEl.querySelector('.wl-editor');
        if (editor && editor.dataset.pbPatched !== '1' &&
            editor.placeholder.indexOf('欢迎评论') > -1) {
          editor.placeholder =
            '欢迎评论 ～ 昵称与邮箱为必填（邮箱仅用于头像，不会公开），网址选填';
          editor.dataset.pbPatched = '1';
        }
        walineEl.querySelectorAll('input.wl-input').forEach(function (inp) {
          var ph = inp.placeholder || '';
          if (ph.indexOf('昵称') > -1) inp.placeholder = '昵称（必填）';
          else if (ph.indexOf('邮箱') > -1) inp.placeholder = '邮箱（必填 · 仅用于头像，不会公开）';
          else if (ph.indexOf('网址') > -1 || ph.indexOf('网站') > -1) inp.placeholder = '网址（选填）';
        });
      }
      patchWaline();
      setTimeout(patchWaline, 500);   // Vue 渲染可能异步，补一次
      walineEl.addEventListener('focusin', patchWaline);   // 输入框展开时再补一次
    }).catch(function (err) { console.warn('[pinkblog] Waline 加载失败', err); });
  }

  // ---- 侧栏最近评论（实时拉取，失败静默隐藏）----
  var rcEl = document.getElementById('recent-comments');
  if (rcEl && window.PB_WALINE && window.PB_WALINE.serverURL) {
    fetch(window.PB_WALINE.serverURL + '/api/comment?type=recent&pageSize=3&lang=zh-CN')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var list = (res && res.errno === 0 && res.data) || [];
        if (!list.length) {
          rcEl.innerHTML = '<p class="rc-empty">还没有评论，去 <a href="/board/">留言板</a> 抢个沙发？</p>';
          return;
        }
        rcEl.innerHTML = list.map(function (c) {
          var esc = function (t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
          var nick = esc(c.nick || '匿名');
          var text = esc(String(c.comment || '').replace(/<[^>]*>/g, '').slice(0, 42));
          var link = c.url || '/';
          var diff = (Date.now() - new Date(c.insertedAt).getTime()) / 1000;
          var ago = isNaN(diff) ? '' :
                    diff < 3600 ? Math.max(1, Math.floor(diff / 60)) + ' 分钟前' :
                    diff < 86400 ? Math.floor(diff / 3600) + ' 小时前' :
                    Math.floor(diff / 86400) + ' 天前';
          return '<a class="rc-item" href="' + link + '"><b>' + nick + '</b><span>' + text + '</span><i>' + ago + '</i></a>';
        }).join('');
      })
      .catch(function () {
        rcEl.innerHTML = '<p class="rc-empty">评论服务暂时不可用</p>';
      });
  }

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
