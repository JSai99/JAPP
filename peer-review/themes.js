// 學生頁背景主題：每個活動可選一種。畫在一張固定在最底層的 canvas 上。
// 使用者若在系統設定「減少動態效果」，只畫靜止的一格。
(() => {
  const THEMES = {
    plain:  { label: '素雅', dark: null },
    candle: { label: '燭光', dark: true,  bg: ['#1b1411', '#2a1e16'] },
    starry: { label: '星空', dark: true,  bg: ['#23246a', '#0b1030'] },
    ember:  { label: '螢火', dark: true,  bg: ['#1f1214', '#160c0e'] },
    bubble: { label: '泡泡', dark: false, bg: ['#ffffff', '#fbfcff'] },
    pastel: { label: '粉彩', dark: false, bg: ['#fdf3f5', '#f4effb'] },
    dawn:   { label: '晨曦', dark: false, bg: ['#ffe4d2', '#ece2fb'] },
    mint:   { label: '薄荷', dark: false, bg: ['#def4ea', '#f6fcf9'] },
    paper:  { label: '紙張', dark: false, bg: ['#fbf8f1', '#f7f2e7'] },
  };
  // 手機螢幕小，裝飾要跟著縮：以短邊 700px 為基準，最小縮到 0.45 倍
  const scaleOf = (w, h) => Math.min(1, Math.max(.45, Math.min(w, h) / 700));
  // 裝飾盡量放在左右兩側，中間留給題目卡片
  // 平板、筆電上題目欄寬 620px 置中，兩側空白夠寬時就把裝飾放在空白處
  const sideX = (w) => {
    const free = (w - 660) / 2, left = Math.random() < .5;
    if (free > 140) return left ? rnd(-.1, 1) * free : w - rnd(-.1, 1) * free;
    return (left ? rnd(-.08, .26) : rnd(.74, 1.08)) * w;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 每個主題：init(w, h) 建立粒子；frame(ctx, w, h, t, dt) 畫一格
  const SCENES = {
    candle: () => {
      let flames = [], sparks = [];
      return {
        init(w, h) {
          const n = Math.max(3, Math.round(w * h / 160000)), k = scaleOf(w, h);
          flames = Array.from({ length: n }, () => ({ x: sideX(w), y: rnd(.1, .9) * h, r: rnd(90, 150) * k, ph: rnd(0, 9), sp: rnd(.6, 1.2) }));
          sparks = Array.from({ length: n * 3 }, () => ({ x: rnd(0, w), y: rnd(0, h), v: rnd(6, 16), r: rnd(1.2, 2.6), dx: rnd(-4, 4) }));
        },
        frame(ctx, w, h, t, dt) {
          for (const f of flames) {
            const fl = 1 + .08 * Math.sin(t * 3 * f.sp + f.ph) + .05 * Math.sin(t * 7.3 + f.ph * 2);
            const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * fl);
            g.addColorStop(0, 'rgba(255,190,110,.16)'); g.addColorStop(.45, 'rgba(200,130,60,.07)'); g.addColorStop(1, 'rgba(120,70,30,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * fl, 0, 7); ctx.fill();
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
          const k = Math.max(.7, scaleOf(w, h));
          stars = Array.from({ length: Math.round(w * h / 22000) + 8 }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(3, 8) * k, c: pick(COLORS), ph: rnd(0, 9), sp: rnd(.6, 1.6) }));
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
            const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 2.2);
            g.addColorStop(0, `rgba(${d.c},${a * .3})`); g.addColorStop(1, `rgba(${d.c},0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 2.2, 0, 7); ctx.fill();
            ctx.fillStyle = `rgba(${d.c},${a})`; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
          }
        },
      };
    },
    bubble: () => circles(['255,226,180', '190,240,215', '200,218,255', '255,205,218'], .26, false),
    pastel: () => circles(['246,176,196', '206,186,240', '252,200,180', '238,184,222'], .24, false),
    dawn: () => still((ctx, w, h) => {
      const k = scaleOf(w, h), r = 260 * k;
      const g = ctx.createRadialGradient(w * .92, h * .06, 0, w * .92, h * .06, r * 1.6);
      g.addColorStop(0, 'rgba(255,214,150,.9)'); g.addColorStop(.35, 'rgba(255,186,150,.45)'); g.addColorStop(1, 'rgba(255,186,150,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const v = ctx.createRadialGradient(w * .05, h * .95, 0, w * .05, h * .95, r * 1.4);
      v.addColorStop(0, 'rgba(196,170,240,.55)'); v.addColorStop(1, 'rgba(196,170,240,0)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    }),
    mint: () => still((ctx, w, h) => {
      const k = scaleOf(w, h);
      for (const [x, y, r, c] of [[.0, .04, 230, '150,220,190'], [1, .5, 180, '160,215,225'], [.1, 1, 210, '185,230,170']]) {
        const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * k * 1.5);
        g.addColorStop(0, `rgba(${c},.55)`); g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    }),
    paper: () => still((ctx, w, h) => {
      ctx.fillStyle = 'rgba(140,115,80,.2)';
      for (let y = 12; y < h; y += 22) for (let x = 12; x < w; x += 22) { ctx.beginPath(); ctx.arc(x, y, 1.1, 0, 7); ctx.fill(); }
    }),
  };
  // 靜態主題：只畫一次，不跑動畫
  function still(paint) { return { still: true, init() {}, frame: (ctx, w, h) => paint(ctx, w, h) }; }
  function circles(colors, alpha, outline) {
    let cs = [];
    return {
      init(w, h) {
        const k = scaleOf(w, h);
        cs = Array.from({ length: Math.min(22, Math.round(w * h / 50000) + 4) }, () => ({ x: sideX(w), y: rnd(0, h), r: rnd(30, 80) * k, c: pick(colors), vy: -rnd(4, 10), ph: rnd(0, 9) }));
      },
      frame(ctx, w, h, t, dt) {
        for (const c of cs) {
          c.y += c.vy * dt; const x = c.x + Math.sin(t * .3 + c.ph) * 12;
          if (c.y < -c.r - 5) { c.y = h + c.r; c.x = sideX(w); }
          ctx.fillStyle = `rgba(${c.c},${alpha})`; ctx.beginPath(); ctx.arc(x, c.y, c.r, 0, 7); ctx.fill();
          if (outline) { ctx.strokeStyle = `rgba(${c.c},.6)`; ctx.lineWidth = 1.5; ctx.stroke(); }
        }
      },
    };
  }

  // 在 canvas 上播放主題，回傳停止函式。canvas 的大小跟著它在畫面上的大小走。
  function playTheme(name, canvas) {
    const th = THEMES[name] || THEMES.plain;
    const ctx = canvas.getContext('2d');
    let raf = 0, last = 0, w = 0, h = 0, t = 0, scene = SCENES[name] ? SCENES[name]() : null;
    const still = scene?.still || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    // 手機滑動時網址列伸縮會改變高度；寬度沒變、高度只差一點點就不重畫，避免閃爍
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth === w && Math.abs(canvas.clientHeight - h) < 160) return;
      size(); if (still || !scene) draw(0);
    });
    ro.observe(canvas);
    if (still || !scene) { t = 3; draw(0); } else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); ctx.clearRect(0, 0, w, h); };
  }

  window.PEER_THEMES = THEMES;
  window.playTheme = playTheme;
})();
