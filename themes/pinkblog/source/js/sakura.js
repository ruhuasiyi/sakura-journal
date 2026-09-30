(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var canvas = document.createElement('canvas');
  canvas.id = 'sakura-canvas';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var W, H, petals = [];
  var DPR = Math.min(devicePixelRatio || 1, 1.5);  // 高分屏按 1.5 封顶，省 4 倍像素填充

  function resize() {
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function isDark() { return document.documentElement.dataset.theme === 'dark'; }
  function petalCount() { return innerWidth < 768 ? 12 : 26; }

  function Petal() { this.reset(true); }
  Petal.prototype.reset = function (init) {
    this.x = Math.random() * W;
    this.y = init ? Math.random() * H : -20;
    this.size = 6 + Math.random() * 8;
    this.speedY = .6 + Math.random() * 1.2;
    this.rot = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - .5) * .04;
    this.flip = Math.random() * Math.PI * 2;
    this.flipSpeed = .02 + Math.random() * .04;
  };

  function tick() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = isDark() ? '#FF9CC3' : '#F4A7B9';
    ctx.globalAlpha = isDark() ? .3 : .5;
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.speedY;
      p.x += Math.sin(p.y / 40) * .6;
      p.rot += p.rotSpeed;
      p.flip += p.flipSpeed;
      if (p.y > H + 20) p.reset(false);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(Math.sin(p.flip), 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(p.size, -p.size, p.size * 1.6, p.size * .6, 0, p.size);
      ctx.bezierCurveTo(-p.size * 1.6, p.size * .6, -p.size, -p.size, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    if (!paused) requestAnimationFrame(tick);
  }

  var paused = false;
  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
    if (!paused) requestAnimationFrame(tick);
  });

  resize();
  addEventListener('resize', resize);
  for (var i = 0; i < petalCount(); i++) petals.push(new Petal());
  tick();
})();
