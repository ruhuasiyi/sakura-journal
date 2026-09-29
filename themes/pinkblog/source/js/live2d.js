(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/stevenjoezhang/live2d-widget@master/dist/autoload.js';
  s.async = true;
  s.onerror = function () { /* 模型加载失败时静默降级，不影响页面 */ };
  document.body.appendChild(s);
})();
