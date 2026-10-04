/* JAPP 課堂轉盤：音效引擎
 * 全部用 Web Audio API 即時合成，不需要任何音檔（沒有版權問題、離線也能用）。
 * 瀏覽器規定要使用者先點過畫面才能發聲，所以 AudioContext 在第一次播放時才建立。
 */
const Sound = (() => {
  let ctx = null, master = null, reverbIn = null, noiseBuf = null;
  let enabled = true, volume = 0.7;

  // C 大調五聲音階（C D E G A），怎麼組合都和諧
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      // 輕微壓縮，避免多個聲音疊在一起爆音
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);

      // 簡易殘響：用指數衰減的雜訊當脈衝響應，讓鈴聲有空間感
      const len = Math.floor(ctx.sampleRate * 1.8);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.22;
      conv.connect(wet); wet.connect(master);
      reverbIn = conv;

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function ready() { return enabled && ensure(); }

  function out(node, reverb) {
    node.connect(master);
    if (reverb) node.connect(reverbIn);
  }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // 鐘聲：幾個非整數倍的正弦泛音 + 指數衰減
  function bell(freq, when = 0, dur = 1.2, peak = 0.22) {
    const c = ready(); if (!c) return;
    const t = c.currentTime + when;
    const partials = [[1, 1], [2.0, 0.42], [3.01, 0.2], [4.17, 0.1], [5.43, 0.05]];
    const g = c.createGain();
    env(g, t, peak, 0.004, dur);
    out(g, true);
    partials.forEach(([mul, amp], i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      const pg = c.createGain();
      pg.gain.value = amp;
      // 高泛音衰減得比較快，聲音才會「叮」而不是「嗡」
      if (i > 0) pg.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + i));
      o.connect(pg); pg.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  function noise(when, dur, { type = 'bandpass', freq = 2000, q = 1, peak = 0.3, attack = 0.002, reverb = false, sweepTo = null } = {}) {
    const c = ready(); if (!c) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    env(g, t, peak, attack, dur);
    src.connect(f); f.connect(g); out(g, reverb);
    src.start(t, Math.random() * 0.5); src.stop(t + attack + dur + 0.02);
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    get volume() { return volume; },
    set volume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
    unlock() { ensure(); },

    // 轉盤指針撥過一格：短促的木質「喀」
    tick(speed = 1) {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.035);
      const g = c.createGain();
      env(g, t, 0.28 * Math.min(1, 0.55 + speed * 0.45), 0.002, 0.045);
      o.connect(g); out(g, false);
      o.start(t); o.stop(t + 0.06);
      noise(0, 0.018, { type: 'highpass', freq: 3500, peak: 0.12 });
    },

    // 拉霸滾輪經過一列：比較圓潤的「嗒」
    reel() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(380, t + 0.04);
      const g = c.createGain();
      env(g, t, 0.22, 0.002, 0.05);
      o.connect(g); out(g, false);
      o.start(t); o.stop(t + 0.07);
    },

    // 拉霸拉桿
    lever() {
      noise(0, 0.25, { type: 'bandpass', freq: 600, q: 0.7, peak: 0.25, sweepTo: 200 });
      bell(196, 0.12, 0.25, 0.12);
    },

    // 小鼓滾奏（分組洗牌時用），回傳停止函式
    drumroll(seconds = 1.5) {
      const c = ready(); if (!c) return () => {};
      const step = 0.045;
      const n = Math.max(1, Math.floor(seconds / step));
      for (let i = 0; i < n; i++) {
        const p = i / n;
        noise(i * step, 0.05, { type: 'bandpass', freq: 1700 + Math.random() * 400, q: 0.8, peak: 0.05 + p * 0.16 });
      }
      return () => {};
    },

    // 分組時名字落入某一組：每組一個五聲音階的音
    pluck(index = 0) {
      const f = PENTA[((index % PENTA.length) + PENTA.length) % PENTA.length];
      bell(f, 0, 0.7, 0.16);
    },

    // 名字飛出去的「咻」
    whoosh(dur = 0.3) {
      noise(0, dur, { type: 'bandpass', freq: 500, q: 1.2, peak: 0.08, attack: dur * 0.4, sweepTo: 3200 });
    },

    // 組長揭曉：清亮的兩聲
    crown(i = 0) {
      bell(PENTA[5 + (i % 5)], 0, 0.9, 0.18);
      bell(PENTA[5 + (i % 5)] * 1.5, 0.08, 1.0, 0.12);
    },

    // 揭曉！琶音 + 和弦 + 銅管感的鋸齒波襯底 + 星星點點
    fanfare() {
      const c = ready(); if (!c) return;
      const arp = [523.25, 659.25, 783.99];
      arp.forEach((f, i) => bell(f, i * 0.085, 0.9, 0.2));
      [523.25, 659.25, 783.99, 1046.5].forEach(f => bell(f, 0.3, 2.2, 0.15));
      const t = c.currentTime + 0.28;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(800, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.15);
      lp.frequency.exponentialRampToValueAtTime(900, t + 1.4);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      lp.connect(g); out(g, true);
      [261.63, 329.63, 392.0, 523.25].forEach((f, i) => {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.detune.value = (i - 1.5) * 6;
        o.connect(lp); o.start(t); o.stop(t + 1.7);
      });
      for (let i = 0; i < 7; i++) {
        bell(PENTA[5 + Math.floor(Math.random() * 5)] * 2, 0.45 + i * 0.09 + Math.random() * 0.04, 0.5, 0.05);
      }
      noise(0.3, 0.6, { type: 'highpass', freq: 6000, peak: 0.05, attack: 0.01, reverb: true });
    },

    // 名單抽完了之類的提示
    soft() { bell(659.25, 0, 0.5, 0.1); bell(523.25, 0.12, 0.7, 0.1); },
  };
})();
