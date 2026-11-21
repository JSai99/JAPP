// 學生頁背景主題：每個活動可選一種。畫在一張固定在最底層的 canvas 上。
// 使用者若在系統設定「減少動態效果」，只畫靜止的一格。
(() => {
  const THEMES = {
    plain:  { label: '素雅（無動畫）', dark: null },
    candle: { label: '燭光', dark: true,  bg: ['#1b1411', '#2a1e16'] },
    starry: { label: '星空', dark: true,  bg: ['#23246a', '#0b1030'] },
    ember:  { label: '螢火', dark: true,  bg: ['#1f1214', '#160c0e'] },
    bubble: { label: '泡泡', dark: false, bg: ['#ffffff', '#fbfcff'] },
    pastel: { label: '粉彩', dark: false, bg: ['#fbf7f2', '#f8f2ea'] },
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 每個主題：init(w, h) 建立粒子；frame(ctx, w, h, t, dt) 畫一格
  const SCENES = {
    candle: () => {
      let flames = [], sparks = [];
      return {
        init(w, h) {
          const n = Math.max(3, Math.round(w * h / 160000));
          flames = Array.from({ length: n }, () => ({ x: rnd(.05, .95) * w, y: rnd(.1, .9) * h, r: rnd(90, 150), ph: rnd(0, 9), sp: rnd(.6, 1.2) }));
          sparks = Array.from({ length: n * 3 }, () => ({ x: rnd(0, w), y: rnd(0, h), v: rnd(6, 16), r: rnd(1.2, 2.6), dx: rnd(-4, 4) }));
        },
        frame(ctx, w, h, t, dt) {
          for (const f of flames) {
            const fl = 1 + .08 * Math.sin(t * 3 * f.sp + f.ph) + .05 * Math.sin(t * 7.3 + f.ph * 2);
            const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * fl);
            g.addColorStop(0, 'rgba(255,190,110,.32)'); g.addColorStop(.45, 'rgba(200,130,60,.12)'); g.addColorStop(1, 'rgba(120,70,30,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * fl, 0, 7); ctx.fill();
            ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 1.6 * fl);
            const c = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
            c.addColorStop(0, '#fffbe8'); c.addColorStop(.6, '#ffd27a'); c.addColorStop(1, 'rgba(255,170,60,0)');
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.restore();
          }
          for (const s of sparks) {
            s.y -= s.v * dt; s.x += s.dx * dt + Math.sin(t + s.r * 9) * .2;
            if (s.y < -5) { s.y = h + 5; s.x = rnd(0, w); }
            ctx.fillStyle = `rgba(240,120,50,${.55 + .35 * Math.sin(t * 2 + s.x)})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
          }
        },
      };
    },
    starry: () => {
      let stars = [], trail = [], shoot = null, next = 2;
      const COLORS = ['#e8d9ff', '#ffc4e6', '#fff1b8', '#b8f0ff', '#d9c4ff'];
      const sparkle = (ctx, x, y, r, col, a) => {
        const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
        gl.addColorStop(0, col); gl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * .22; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 3.5, 0, 7); ctx.fill(); ctx.fillStyle = col;
        ctx.globalAlpha = a; ctx.beginPath();
        ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
        ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill(); ctx.globalAlpha = 1;
      };
      return {
        init(w, h) {
          stars = Array.from({ length: Math.round(w * h / 22000) + 8 }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(3, 9), c: pick(COLORS), ph: rnd(0, 9), sp: rnd(.6, 1.6) }));
        },
        frame(ctx, w, h, t, dt) {
          for (const s of stars) sparkle(ctx, s.x, s.y, s.r * (.85 + .15 * Math.sin(t * s.sp + s.ph)), s.c, .55 + .4 * Math.sin(t * s.sp * 1.3 + s.ph));
          next -= dt;
          if (!shoot && next <= 0) shoot = { x: rnd(-.1, .4) * w, y: rnd(.3, .8) * h, vx: rnd(180, 260), vy: -rnd(60, 120), life: rnd(2.2, 3.2) };
          if (shoot) {
            shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt; shoot.life -= dt;
            for (let i = 0; i < 3; i++) trail.push({ x: shoot.x + rnd(-8, 8), y: shoot.y + rnd(-8, 8), r: rnd(1.5, 4), a: 1 });
            const g = ctx.createRadialGradient(shoot.x, shoot.y, 0, shoot.x, shoot.y, 40);
            g.addColorStop(0, 'rgba(255,245,200,.55)'); g.addColorStop(1, 'rgba(255,245,200,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(shoot.x, shoot.y, 40, 0, 7); ctx.fill();
            if (shoot.life <= 0 || shoot.x > w + 50 || shoot.y < -50) { shoot = null; next = rnd(5, 10); }
          }
          trail = trail.filter((p) => (p.a -= dt * .7) > 0);
          for (const p of trail) sparkle(ctx, p.x, p.y, p.r, '#ffe9a8', p.a);
        },
      };
    },
    ember: () => {
      let dots = [];
      const COLORS = ['255,150,90', '255,190,80', '240,110,70', '255,215,110'];
      return {
        init(w, h) {
          dots = Array.from({ length: Math.round(w * h / 30000) + 6 }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(2.5, 6), c: pick(COLORS), ph: rnd(0, 9), vx: rnd(-6, 6), vy: rnd(-8, -2) }));
        },
        frame(ctx, w, h, t, dt) {
          for (const d of dots) {
            d.x += (d.vx + Math.sin(t * .7 + d.ph) * 5) * dt; d.y += d.vy * dt;
            if (d.y < -10) { d.y = h + 10; d.x = rnd(0, w); }
            if (d.x < -10) d.x = w + 10; if (d.x > w + 10) d.x = -10;
            const a = .55 + .4 * Math.sin(t * 1.4 + d.ph);
            const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 4);
            g.addColorStop(0, `rgba(${d.c},${a * .45})`); g.addColorStop(1, `rgba(${d.c},0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 4, 0, 7); ctx.fill();
            ctx.fillStyle = `rgba(${d.c},${a})`; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
          }
        },
      };
    },
    bubble: () => circles(['255,236,200', '210,250,230', '215,230,255', '255,215,225'], .22, false),
    pastel: () => circles(['250,200,205', '200,240,220', '200,230,235', '245,200,225'], .38, true),
  };
  function circles(colors, alpha, outline) {
    let cs = [];
    return {
      init(w, h) {
        cs = Array.from({ length: Math.round(w * h / 60000) + 5 }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(35, 105), c: pick(colors), vy: -rnd(4, 10), ph: rnd(0, 9) }));
      },
      frame(ctx, w, h, t, dt) {
        for (const c of cs) {
          c.y += c.vy * dt; const x = c.x + Math.sin(t * .3 + c.ph) * 12;
          if (c.y < -c.r - 5) { c.y = h + c.r; c.x = rnd(0, w); }
          ctx.fillStyle = `rgba(${c.c},${alpha})`; ctx.beginPath(); ctx.arc(x, c.y, c.r, 0, 7); ctx.fill();
          if (outline) { ctx.strokeStyle = `rgba(${c.c},.9)`; ctx.lineWidth = 2; ctx.stroke(); }
        }
      },
    };
  }

  // 在 canvas 上播放主題，回傳停止函式。canvas 的大小跟著它在畫面上的大小走。
  function playTheme(name, canvas) {
    const th = THEMES[name] || THEMES.plain;
    const ctx = canvas.getContext('2d');
    let raf = 0, last = 0, w = 0, h = 0, t = 0, scene = SCENES[name] ? SCENES[name]() : null;
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene?.init(w, h);
    };
    const draw = (dt) => {
      if (th.bg) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
      else ctx.clearRect(0, 0, w, h);
      scene?.frame(ctx, w, h, t, dt);
    };
    const loop = (now) => {
      const dt = last ? Math.min((now - last) / 1000, .05) : 0; last = now; t += dt;
      draw(dt); raf = requestAnimationFrame(loop);
    };
    size();
    const ro = new ResizeObserver(() => { size(); if (still || !scene) draw(0); });
    ro.observe(canvas);
    if (still || !scene) { t = 3; draw(0); } else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); ctx.clearRect(0, 0, w, h); };
  }

  window.PEER_THEMES = THEMES;
  window.playTheme = playTheme;
})();
