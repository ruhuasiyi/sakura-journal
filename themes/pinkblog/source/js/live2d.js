(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (matchMedia('(max-width: 768px)').matches) return;   // 移动端不加载看板娘
  // 看板娘资源全部本地自托管（themes/pinkblog/source/live2d/），
  // 不依赖任何 CDN——jsDelivr 的 fastly 节点在部分网络环境不可达。
  var live2d_path = '/live2d/';

  function loadExternalResource(url, type) {
    return new Promise(function (resolve, reject) {
      var tag;
      if (type === 'css') {
        tag = document.createElement('link');
        tag.rel = 'stylesheet';
        tag.href = url;
      } else {
        tag = document.createElement('script');
        tag.type = 'module';
        tag.src = url;
      }
      tag.onload = function () { resolve(url); };
      tag.onerror = function () { reject(url); };
      document.head.appendChild(tag);
    });
  }

  // 避免图片资源跨域问题（与上游 autoload.js 保持一致）
  var OriginalImage = window.Image;
  window.Image = function () {
    var img = new OriginalImage();
    img.crossOrigin = 'anonymous';
    return img;
  };
  window.Image.prototype = OriginalImage.prototype;

  Promise.all([
    loadExternalResource(live2d_path + 'waifu.css', 'css'),
    loadExternalResource(live2d_path + 'waifu-tips.js', 'js')
  ]).then(function () {
    window.initWidget({
      waifuPath: live2d_path + 'waifu-tips.json',
      cubism2Path: live2d_path + 'live2d.min.js',
      tools: ['hitokoto', 'asteroids', 'switch-model', 'switch-texture', 'photo', 'info', 'quit'],
      logLevel: 'warn',
      drag: false
    });
  }).catch(function () {
    console.warn('[pinkblog] 看板娘资源加载失败，已静默降级');
  });
})();
