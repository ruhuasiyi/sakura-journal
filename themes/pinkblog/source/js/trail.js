(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // 鼠标拖尾：花瓣从光标处自然飘落（重力 + 摇曳 + 旋转），落到屏幕底部淡出。
  // 花瓣图本地自托管 /images/sakura-petal.png，源自经典 sakura.js 特效。
  const cv = document.createElement('canvas');
  cv.id = 'trail-canvas';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W, H;
  function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
  resize();
  addEventListener('resize', resize);

  const img = new Image();
  img.src = '/images/sakura-petal.png';

  let parts = [];
  let last = null;
  let acc = 0;
  const SPAWN_DIST = 90;   // 每移动约 90px 落一片
  const MAX_PARTS = 30;    // 同屏上限
  let running = false;     // 无粒子时停掉 rAF，鼠标动时唤醒

  addEventListener('mousemove', function (e) {
    if (!running) { running = true; requestAnimationFrame(loop); }
    if (last === null) last = [e.clientX, e.clientY];
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    acc += Math.sqrt(dx*dx + dy*dy);
    if (acc > SPAWN_DIST) {
      acc = 0;
      parts.push({
        x: e.clientX + (Math.random()-.5)*16,
        y: e.clientY + (Math.random()-.5)*10,
        s: .25 + Math.random()*.3,
        r: Math.random()*6.28, vr: (Math.random()-.5)*.08,
        sway: 1 + Math.random()*1.6,
        phase: Math.random()*6.28,
        vy: .3 + Math.random()*.5, g: .012 + Math.random()*.008,
        life: 1
      });
      if (parts.length > MAX_PARTS) parts.shift();
    }
    last = [e.clientX, e.clientY];
  });

  function loop() {
    ctx.clearRect(0, 0, W, H);
    if (!parts.length) { running = false; return; }   // 空场即停
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.phase += .02;
      p.vy = Math.min(p.vy + p.g, 2.2);
      p.y += p.vy;
      p.x += Math.sin(p.phase) * p.sway;
      p.r += p.vr;
      if (p.y > H - 60) p.life -= .04;
      if (p.y <= H) {
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0) * .9;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.drawImage(img, -16*p.s, -16*p.s, 32*p.s, 32*p.s);
        ctx.restore();
      }
    }
    parts = parts.filter(function(p){ return p.life > 0 && p.y <= H + 40; });
    if (running) requestAnimationFrame(loop);
  }
})();
