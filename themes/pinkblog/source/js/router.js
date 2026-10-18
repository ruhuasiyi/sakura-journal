// 轻量 SPA 路由：内存页面缓存 + fetch 预取 + View Transition。
//
// 关键时序：线上每次换页都有一次完整 HTML 往返（Cloudflare 的目录索引 HTML 没有
// ETag/Last-Modified，max-age=0 下无法复用 <link rel=prefetch> 的结果）。旧实现
// 在点击瞬间就 startViewTransition，把整段网络等待塞进过渡的冻结窗口，表现为“卡一下”。
// 现在：有缓存 → 立即过渡；没有缓存 → 先取页并显示顶部进度条，取到后才启动过渡，
// 等待期间旧页面保持可交互。
//
// 依赖：window.pbVtName / window.pbInitPage（toc.js）、window.PB_BOOT（layout.ejs 内联）。
(function () {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  var CACHE_MAX = 16;
  var CACHE_TTL = 10 * 60 * 1000;
  var MAX_CONCURRENCY = 2;
  var FETCH_TIMEOUT = 8000;

  var NON_HTML = /\.(xml|json|txt|pdf|zip|rar|7z|jpe?g|png|webp|avif|gif|svg|ico|css|js|mjs|map|mp4|webm|mp3|wav|woff2?|ttf|otf)$/i;

  var cache = new Map();      // urlKey -> { url, title, html, ts }
  var inflight = new Map();   // urlKey -> Promise<entry>
  var queue = [];             // 待取的页面（点击任务排在队首）
  var active = 0;

  // 滚动位置记忆：键统一用 urlKey，避免 /about 与 /about/ 对不上
  var scrollMap = {};
  try {
    scrollMap = JSON.parse(sessionStorage.getItem('pb-scroll') || '{}');
  } catch (e) {}

  function urlKey(u) {
    try {
      return new URL(u, location.href).href.split('#')[0];
    } catch (e) {
      return String(u).split('#')[0];
    }
  }

  function saveScrollMap() {
    try { sessionStorage.setItem('pb-scroll', JSON.stringify(scrollMap)); } catch (e) {}
  }

  function saveScroll(key) {
    if (!key) return;
    scrollMap[key] = window.scrollY;
    saveScrollMap();
  }

  function cacheGet(key) {
    var e = cache.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL) { cache.delete(key); return null; }
    // 刷新 Map 插入顺序当 LRU 用
    cache.delete(key);
    cache.set(key, e);
    return e;
  }

  function cachePut(key, entry) {
    if (!key) return;
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }
  }

  function setBusy(on) {
    if (on) document.documentElement.dataset.pbBusy = '1';
    else delete document.documentElement.dataset.pbBusy;
  }

  function fetchPage(url) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT);
    return fetch(url, {
      signal: ctl.signal,
      credentials: 'same-origin',
      headers: { Accept: 'text/html' }
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var type = res.headers.get('content-type') || '';
      if (type.indexOf('text/html') < 0) throw new Error('not html');
      return res.text().then(function (html) {
        return { html: html, finalUrl: res.url || url };
      });
    }).then(function (r) {
      var doc = new DOMParser().parseFromString(r.html, 'text/html');
      var main = doc.querySelector('main.container');
      if (!main) throw new Error('no main');
      return {
        url: urlKey(r.finalUrl),
        title: doc.title,
        html: main.outerHTML,
        ts: Date.now()
      };
    });
  }

  function pump() {
    while (active < MAX_CONCURRENCY && queue.length) {
      (function (job) {
        active++;
        fetchPage(job.url).then(function (entry) {
          // 同时按"请求地址"和"重定向后的地址"缓存（/about → /about/）
          cachePut(job.key, entry);
          cachePut(entry.url, entry);
          job.resolve(entry);
        }, function (err) {
          job.reject(err);
        }).then(function () {
          active--;
          pump();
        });
      })(queue.shift());
    }
  }

  function load(url, priority) {
    var key = urlKey(url);
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    if (inflight.has(key)) return inflight.get(key);

    var p = new Promise(function (resolve, reject) {
      var job = { key: key, url: key, resolve: resolve, reject: reject };
      if (priority) queue.unshift(job);
      else queue.push(job);
      pump();
    });
    inflight.set(key, p);
    p.then(function () { inflight.delete(key); }, function () { inflight.delete(key); });
    return p;
  }

  var navToken = 0;
  var currentVT = null;
  var curUrl = urlKey(location.href);

  function applyEntry(entry, push, opts) {
    setBusy(false);
    var oldMain = document.querySelector('main.container');
    var tpl = document.createElement('template');
    tpl.innerHTML = entry.html;
    var newMain = tpl.content.firstElementChild;
    if (!oldMain || !newMain) { location.replace(entry.url); return; }

    document.title = entry.title || document.title;
    oldMain.replaceWith(newMain);

    // 只在成功换页、DOM 已替换后 pushState：Umami 的 history 钩子据此每次前进只记一次。
    // 跨页锚点要把 hash 留在地址栏，后退时才能靠 Location.hash 找回来。
    if (push) history.pushState({ pb: 1 }, '', entry.url + (opts && opts.hash ? '#' + opts.hash : ''));
    curUrl = urlKey(entry.url);

    try {
      window.pbInitPage && window.pbInitPage();
    } catch (e) {
      console.warn('[pinkblog] pbInitPage 失败', e);
    }

    window.scrollTo(0, push || (opts && opts.hash) ? 0 : (scrollMap[curUrl] || 0));
    if (opts && opts.hash) {
      var el = document.getElementById(opts.hash);
      if (el) el.scrollIntoView();
    }

    // 新页面空闲时继续预取它的卡片（首页 → 文章 → 后退时缓存已有，这里主要覆盖分类/归档页）
    if (window.requestIdleCallback) requestIdleCallback(prefetchIdle, { timeout: 2000 });
  }

  function transition(entry, push, opts) {
    opts = opts || {};
    var card = opts.card || null;
    if (card && opts.cardPath && window.pbVtName) {
      card.style.viewTransitionName = window.pbVtName(opts.cardPath);
    }
    var cleared = false;
    function clearName() {
      if (cleared || !card) return;
      cleared = true;
      card.style.viewTransitionName = '';
    }

    // 连续快速点击：跳过上一个过渡的动画（它的 DOM 已换好，不能回滚）
    if (currentVT) {
      try { currentVT.skipTransition(); } catch (e) {}
    }

    if (!document.startViewTransition || document.visibilityState === 'hidden') {
      applyEntry(entry, push, opts);
      clearName();
      return;
    }

    try {
      var vt = document.startViewTransition(function () {
        applyEntry(entry, push, opts);
      });
      currentVT = vt;
      vt.finished.then(function () {
        clearName();
        if (currentVT === vt) currentVT = null;
      }, function () {
        clearName();
        if (currentVT === vt) currentVT = null;
      });
    } catch (e) {
      // VT 被拒绝时不能丢导航
      applyEntry(entry, push, opts);
      clearName();
    }
  }

  function navigate(url, push, opts) {
    opts = opts || {};
    var target = urlKey(url);
    if (target === curUrl) {
      setBusy(false);   // 同页操作可能打断了仍在进行的冷路径取页
      // 同页：只有 hash 变化时滚到锚点，不重放 DOM
      if (opts.hash) {
        var same = document.getElementById(opts.hash);
        if (same) same.scrollIntoView();
      }
      return;
    }

    saveScroll(curUrl);
    var token = ++navToken;

    var hit = cacheGet(target);
    if (hit) {
      transition(hit, push, opts);
      return;
    }

    // 冷路径：等待期间不启动 VT，旧页面保持可交互
    setBusy(true);
    load(target, true).then(function (entry) {
      if (token !== navToken) return;
      transition(entry, push, opts);
    }, function () {
      if (token !== navToken) return;
      setBusy(false);
      // 整页兜底：让跨文档 View Transitions 也尽量从卡片展开
      if (opts.card && opts.cardPath && window.pbVtName) {
        opts.card.style.viewTransitionName = window.pbVtName(opts.cardPath);
      }
      location.replace(target);
    });
  }

  // ---- 预取：真正 fetch 并写入内存缓存（link rel=prefetch 在这套缓存头下无法复用）----

  function canPrefetch() {
    var c = navigator.connection;
    return !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
  }

  function shouldNavigate(u) {
    try {
      var a = new URL(u, location.href);
      return a.origin === location.origin && !NON_HTML.test(a.pathname);
    } catch (e) {
      return false;
    }
  }

  function prefetch(a) {
    if (!a || !canPrefetch()) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    if (!shouldNavigate(a.href)) return;
    var key = urlKey(a.href);
    // 用 cacheGet 而不是 cache.has：过期条目应当重新预取
    if (cacheGet(key) || inflight.has(key)) return;
    load(key, false).catch(function () {});
  }

  function linkOf(node) {
    return node && node.closest ? node.closest('a[href]') : null;
  }

  // 桌面悬停 80ms 后预取（保持原行为，但改为真 fetch）
  var hoverMq = matchMedia('(hover: hover)');
  document.addEventListener('pointerover', function (e) {
    if (!hoverMq.matches) return;
    var a = linkOf(e.target);
    if (!a) return;
    var hrefAtEvent = a.href;
    setTimeout(function () {
      if (a.matches(':hover') && a.href === hrefAtEvent) prefetch(a);
    }, 80);
  }, { passive: true });

  // 触屏没有 hover：按下即预取（navigate 会复用同一个 inflight，不会重复请求）
  document.addEventListener('pointerdown', function (e) {
    prefetch(linkOf(e.target));
  }, { passive: true });
  document.addEventListener('touchstart', function (e) {
    prefetch(linkOf(e.target));
  }, { passive: true });

  // 键盘 Tab 到链接时预取
  document.addEventListener('focusin', function (e) {
    prefetch(linkOf(e.target));
  }, { passive: true });

  // 空闲时预取首屏前几张卡片
  function prefetchIdle() {
    if (!canPrefetch()) return;
    // 只取文章链接：标题链接、封面链接、整卡覆盖层；排除标签链接
    var links = document.querySelectorAll(
      '.post-list .post-card .post-card-title a[href], .post-list .post-card .card-overlay[href], .post-list .post-card .post-card-cover[href], .archive-list a[href]'
    );
    var count = 0;
    for (var i = 0; i < links.length && count < 4; i++) {
      var a = links[i];
      if (!shouldNavigate(a.href) || a.hash) continue;
      if (cacheGet(urlKey(a.href)) || inflight.has(urlKey(a.href))) continue;
      prefetch(a);
      count++;
    }
  }
  if (window.requestIdleCallback) {
    requestIdleCallback(prefetchIdle, { timeout: 2000 });
  } else {
    setTimeout(prefetchIdle, 1500);
  }

  // ---- 点击拦截 ----
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = linkOf(e.target);
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.origin !== location.origin) return;
    if (!shouldNavigate(a.href)) return;
    // 纯锚点（同页 #）走默认行为
    if (a.pathname === location.pathname && a.hash) return;

    e.preventDefault();
    // 只有点击的确实是这张卡的"文章链接"才挂过渡名。标签链接也在 .post-card 内部，
    // 若一并 morph 会去找一个目标页并不存在的命名组，出现无意义的淡出伪影。
    var card = a.closest('.post-card');
    var titleLink = card && card.querySelector('.post-card-title a');
    var isCardNav = titleLink && titleLink.pathname === a.pathname;
    navigate(a.href, true, {
      card: isCardNav ? card : null,
      cardPath: isCardNav ? decodeURIComponent(a.pathname).slice(1) : null,
      hash: a.hash ? a.hash.slice(1) : null
    });
  });

  window.addEventListener('popstate', function () {
    // 历史条目可能带 hash（跨页锚点），后退时同样要落回该小节
    navigate(location.href, false, { hash: location.hash ? location.hash.slice(1) : null });
  });

  window.addEventListener('pagehide', function () {
    saveScroll(curUrl);
  });

  // ---- 启动：把服务端原始 DOM 种入缓存，保证"首页 → 文章 → 后退"直接命中 ----
  (function seedBoot() {
    var b = window.PB_BOOT;
    if (!b || !b.main) return;
    var entry = { url: curUrl, title: b.title || document.title, html: b.main, ts: Date.now() };
    cachePut(entry.url, entry);
  })();
})();
