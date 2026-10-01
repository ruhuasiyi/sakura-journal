// 文章页过渡名哈希（唯一客户端实现）：卡片点击时与 post.ejs 服务端静态名配对，
// 保证 View Transitions 卡片→文章页 morph 生效。请勿在其他地方另写一份。
window.pbVtName = function (path) {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  return 'post-' + h.toString(36);
};

function pbInitPage() {
  // 代码块语言标签：从 figure.highlight 的类名取语言。
  // figure 自身是横向滚动容器，标签必须挂在外层 wrapper 上才能钉在可视区域右上角。
  document.querySelectorAll('figure.highlight').forEach(function (fig) {
    const lang = fig.className.split(/\s+/).filter(function (c) {
      return c !== 'highlight' && c !== 'plain';
    })[0];
    const wrap = document.createElement('div');
    wrap.className = 'highlight-wrap';
    fig.parentNode.insertBefore(wrap, fig);
    wrap.appendChild(fig);
    if (!lang) return;
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = lang;
    wrap.appendChild(label);
  });

  // ---- 萌计数器刷新（Umami 自动追踪 SPA 换页，无需手动补）----

  // ---- Waline 评论组件（文章页/留言板）----
  const walineEl = document.getElementById('waline-comment');
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
        const editor = walineEl.querySelector('.wl-editor');
        if (editor && editor.dataset.pbPatched !== '1' &&
            editor.placeholder.indexOf('欢迎评论') > -1) {
          editor.placeholder =
            '欢迎评论 ～ 昵称与邮箱为必填（邮箱仅用于头像，不会公开），网址选填';
          editor.dataset.pbPatched = '1';
        }
        walineEl.querySelectorAll('input.wl-input').forEach(function (inp) {
          const ph = inp.placeholder || '';
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
  const rcEl = document.getElementById('recent-comments');
  if (rcEl && window.PB_WALINE && window.PB_WALINE.serverURL) {
    fetch(window.PB_WALINE.serverURL + '/api/comment?type=recent&count=3&lang=zh-CN')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        const list = (res && res.errno === 0 && res.data) || [];
        if (!list.length) {
          rcEl.innerHTML = '<p class="rc-empty">还没有评论，去 <a href="/board/">留言板</a> 抢个沙发？</p>';
          return;
        }
        rcEl.innerHTML = list.map(function (c) {
          const esc = function (t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/>/g, '&gt;'); };
          const nick = esc(c.nick || '匿名');
          const text = esc(String(c.comment || '').replace(/<[^>]*>/g, '').slice(0, 42));
          // 仅放行 http(s) 或站内相对路径，其余一律落到站内（防 javascript:/data: 及属性注入）
          const raw = c.url || '/';
          const link = (/^https?:\/\//i.test(raw) || raw.charAt(0) === '/') ? raw : '/';
          const diff = (Date.now() - new Date(c.insertedAt).getTime()) / 1000;
          const ago = isNaN(diff) ? '' :
                      diff < 3600 ? Math.max(1, Math.floor(diff / 60)) + ' 分钟前' :
                      diff < 86400 ? Math.floor(diff / 3600) + ' 小时前' :
                      Math.floor(diff / 86400) + ' 天前';
          return '<a class="rc-item" href="' + esc(link) + '"><b>' + nick + '</b><span>' + text + '</span><i>' + ago + '</i></a>';
        }).join('');
      })
      .catch(function () {
        rcEl.innerHTML = '<p class="rc-empty">评论服务暂时不可用</p>';
      });
  }

  // 清掉可能卡住的横向滚动偏移（移动端浏览器在瞬时溢出后会把 scrollLeft 留在原地）
  document.documentElement.scrollLeft = 0;
  document.body.scrollLeft = 0;

  // ---- 无封面文章：从封面池确定性抽选（随机观感、互不重复、同文恒定）----
  if (window.PB_COVERS && window.PB_COVERS.length) {
    const pool = window.PB_COVERS;
    const used = {};
    document.querySelectorAll('.post-card:not(.has-cover)').forEach(function (card) {
      const link = card.querySelector('.post-card-title a');
      const path = link ? link.getAttribute('href') : String(Math.random());
      let h = 0;
      for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
      let idx = h % pool.length;
      if (used[idx]) {
        for (let k = 1; k < pool.length; k++) {
          const c = (idx + k) % pool.length;
          if (!used[c]) { idx = c; break; }
        }
      }
      used[idx] = true;
      card.classList.add('has-cover');
      const a = document.createElement('a');
      a.className = 'post-card-cover';
      a.href = path; a.tabIndex = -1; a.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.className = 'cover-img';
      img.src = pool[idx]; img.alt = ''; img.loading = 'lazy';
      a.appendChild(img);
      const body = card.querySelector('.post-card-body');
      card.insertBefore(a, body);
    });
  }

  // 封面卡：文字列高度钳制到封面实际高度（文字适应封面）
  const mq = matchMedia('(min-width: 769px)');
  document.querySelectorAll('.post-card.has-cover').forEach(function (card) {
    const cover = card.querySelector('.post-card-cover');
    const body = card.querySelector('.post-card-body');
    if (!cover || !body) return;
    const img = cover.querySelector('.cover-img');
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

  const toc = document.getElementById('toc');
  const content = document.querySelector('.post-content');
  if (!toc || !content) return;
  const heads = content.querySelectorAll('h2, h3');
  const card = toc.closest('.toc-card');
  if (!heads.length) { if (card) card.style.display = 'none'; return; }
  let html = '<ul>';
  let open = false;
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
