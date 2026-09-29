(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // 上游 autoload.js 硬编码 fastly.jsdelivr.net，该节点在部分网络环境不可达，
  // 因此这里自行完成加载流程，全部资源走 cdn.jsdelivr.net。
  var live2d_path = 'https://cdn.jsdelivr.net/npm/live2d-widgets@1.0.1/dist/';

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
      cubism5Path: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
      tools: ['hitokoto', 'asteroids', 'switch-model', 'switch-texture', 'photo', 'info', 'quit'],
      logLevel: 'warn',
      drag: false
    });
  }).catch(function () {
    console.warn('[pinkblog] 看板娘资源加载失败，已静默降级');
  });
})();
