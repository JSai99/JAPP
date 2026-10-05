/* JAPP 課堂轉盤：抽人（轉盤／拉霸）＋ 分組
 * 名單只存在這台電腦的瀏覽器（localStorage），不會上傳到任何地方。
 */
(() => {
'use strict';

/* ================= 小工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv');      // YYYY-MM-DD
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 公平亂數：用瀏覽器的密碼學亂數，並避開取餘數造成的偏差
function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 改用舊方法 */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/* ================= 資料 ================= */
const STORE_KEY = 'japp.classWheel.v1';
const SAMPLE = `姓名	性別	系級
王小明	男	企管一
林佳穎	女	企管一
陳冠宇	男	國貿二
張雅婷	女	國貿二
李承恩	男	企管一
黃詩涵	女	會計三
吳柏翰	男	會計三
劉宜蓁	女	企管一
蔡宗翰	男	國貿二
楊子晴	女	會計三
許家豪	男	企管一
鄭欣妤	女	國貿二
謝承翰	男	會計三
洪郁婷	女	企管一
郭品睿	男	國貿二
曾筱涵	女	會計三
邱彥廷	男	企管一
廖思妤	女	國貿二
賴冠廷	男	會計三
周雨萱	女	企管一
葉俊宏	男	國貿二
蘇芷若	女	會計三
江昱辰	男	企管一
何沛綺	女	國貿二`;

const DEFAULT_SETTINGS = {
  mode: 'pick', ritual: 'wheel', duration: 'normal',
  sound: true, volume: 0.7, sidebar: true,
  gmode: 'count', groupN: 5, groupM: 4, balance: 'none', leader: true, speed: 'normal',
};

function freshDb() {
  const id = uid();
  return {
    classes: [{ id, name: '範例班級（可刪除）', students: parseRoster(SAMPLE) }],
    currentId: id,
    settings: { ...DEFAULT_SETTINGS },
    state: {},
  };
}
function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.classes)) {
      d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      d.state = d.state || {};
      d.classes.forEach(repairClass);
      return d;
    }
  } catch (e) { /* 壞掉就重來 */ }
  return freshDb();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('⚠️ 瀏覽器無法儲存（可能是無痕模式），關掉視窗後名單會消失'); }
}
const S = () => db.settings;
const cur = () => db.classes.find(c => c.id === db.currentId) || db.classes[0] || null;

// 每班的狀態：抽過被移除的人（跨堂保留）、今天缺席的人、今天的抽人紀錄
function stateOf(cls) {
  if (!cls) return { removed: [], absent: [], hist: [] };
  let st = db.state[cls.id];
  if (!st) st = db.state[cls.id] = { removed: [], absentDate: '', absent: [], histDate: '', hist: [] };
  const d = today();
  if (st.absentDate !== d) { st.absentDate = d; st.absent = []; }
  if (st.histDate !== d) { st.histDate = d; st.hist = []; }
  return st;
}
const present = cls => cls ? cls.students.filter(s => !stateOf(cls).absent.includes(s.id)) : [];
const pickPool = cls => present(cls).filter(s => !stateOf(cls).removed.includes(s.id));

/* ================= 名單解析 ================= */
function normGender(s) {
  s = String(s || '').trim().toLowerCase();
  if (/^(男|男生|男性|m|male|boy)$/.test(s)) return '男';
  if (/^(女|女生|女性|f|female|girl)$/.test(s)) return '女';
  return '';
}
function splitLine(l) { return l.split(/\t|,|，|、|;|；/).map(x => x.trim()); }

const CJK = '㐀-鿿豈-﫿';
const ID_RE = /^[A-Za-z]{0,2}\d+[A-Za-z0-9]*$/;                 // 學號、座號
// 系級／班級長相：「資四A」「財精二B」「社延B」「企管一」「資管碩一」
const DEPT_RE = new RegExp(`^[${CJK}]{1,6}(?:[一二三四五六七八九十]|延|碩[一二三]?|博[一二三四]?)?[A-Za-z甲乙丙丁戊]$|^[${CJK}]{1,5}(?:[一二三四五六七八九]|延|碩[一二三]?|博[一二三四]?)$`);
const isDeptLike = v => DEPT_RE.test(v);

// 「辛　薇」這種為了對齊而補空白的姓名，把中文字之間的空白拿掉
function cleanName(v) {
  return String(v || '').trim().replace(new RegExp(`([${CJK}])[\\s\\u3000]+(?=[${CJK}])`, 'g'), '$1');
}

// 沒有 Tab／逗號的一行改用空白切；切太多段時，把相鄰的單一中文字併回去（「辛　薇」）
function splitBySpace(line, want) {
  const t = line.split(/[\s　]+/).filter(Boolean);
  const one = new RegExp(`^[${CJK}]$`);
  for (let i = t.length - 2; i >= 0 && t.length > want; i--) {
    if (one.test(t[i]) && one.test(t[i + 1])) t.splice(i, 2, t[i] + t[i + 1]);
  }
  return t;
}

function parseRoster(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // 有標題列（姓名／性別／系級…）就照標題對應欄位
  const head = splitLine(lines[0]);
  const ni = head.findIndex(h => /姓名|名字|^name$|^名$/i.test(h));
  if (ni >= 0) {
    const gi = head.findIndex(h => /性別|gender|sex/i.test(h));
    const di = head.findIndex((h, i) => i !== ni && /系級|系所|系別|科系|年級|班級|系|dept|department|grade|class|major/i.test(h));
    return lines.slice(1).map(line => {
      const f = splitLine(line);
      return { id: uid(), name: cleanName(f[ni]), gender: gi >= 0 ? normGender(f[gi]) : '', dept: di >= 0 ? (f[di] || '') : '' };
    }).filter(s => s.name);
  }

  // 沒有標題列：先切欄，再「看內容」判斷哪一欄是姓名、性別、系級、學號
  let rows = lines.map(splitLine);
  const counts = {};
  rows.forEach(r => { if (r.length > 1) counts[r.length] = (counts[r.length] || 0) + 1; });
  let k = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 1;
  if (k === 1) {
    // 整份都沒有分隔符號：看看是不是用空白隔開的（例如「資四A 黃渝尹」）
    const sp = lines.map(l => splitBySpace(l, 2));
    const multi = sp.filter(t => t.length >= 2 && t.some(isDeptLike)).length;
    if (multi >= Math.max(1, sp.length * 0.6)) { rows = lines.map(l => splitBySpace(l, 2)); k = 2; }
  } else {
    rows = rows.map((r, i) => (r.length === 1 && /[\s　]/.test(r[0]) ? splitBySpace(lines[i], k) : r));
  }

  const cols = Math.max(...rows.map(r => r.length));
  const col = j => rows.map(r => (r[j] || '').trim());
  const ratio = (arr, fn) => { const v = arr.filter(Boolean); return v.length ? v.filter(fn).length / v.length : 0; };
  const info = [...Array(cols).keys()].map(j => {
    const v = col(j), filled = v.filter(Boolean);
    return {
      j,
      fill: filled.length / rows.length,
      id: ratio(v, x => ID_RE.test(x)),
      gender: ratio(v, x => !!normGender(x)),
      dept: ratio(v, isDeptLike),
      uniq: filled.length ? new Set(filled).size / filled.length : 0,
    };
  });
  const genderCol = info.filter(c => c.gender > 0.6).sort((a, b) => b.gender - a.gender)[0];
  const cand = info.filter(c => c !== genderCol && c.id < 0.6 && c.fill > 0);
  // 姓名欄：最不重複、最不像系級
  const nameCol = cand.slice().sort((a, b) => (b.uniq - b.dept + b.fill) - (a.uniq - a.dept + a.fill))[0];
  if (!nameCol) return [];
  // 系級欄：剩下的欄位中最像系級、重複最多的
  const deptCol = cand.filter(c => c !== nameCol).sort((a, b) => (b.dept + (1 - b.uniq)) - (a.dept + (1 - a.uniq)))[0];

  return rows.map(r => ({
    id: uid(),
    name: cleanName(r[nameCol.j]),
    gender: genderCol ? normGender(r[genderCol.j]) : '',
    dept: deptCol ? (r[deptCol.j] || '').trim() : '',
  })).filter(s => s.name);
}

// 修正舊版解析錯的名單：整班「姓名」都像系級、「系級」反而像姓名時，兩欄對調
function repairClass(cls) {
  const list = cls.students || [];
  let changed = false;
  const both = list.filter(s => s.name && s.dept);
  if (both.length >= 2) {
    const nameLike = both.filter(s => isDeptLike(s.name)).length / both.length;
    const deptLike = both.filter(s => isDeptLike(s.dept)).length / both.length;
    if (nameLike >= 0.6 && deptLike <= 0.2) {
      both.forEach(s => { [s.name, s.dept] = [s.dept, s.name]; });
      changed = true;
    }
  }
  list.forEach(s => {
    // 「資四A 黃渝尹」整串被當成姓名
    if (!s.dept) {
      const t = splitBySpace(s.name, 2);
      if (t.length === 2 && isDeptLike(t[0]) && !isDeptLike(t[1])) { s.dept = t[0]; s.name = t[1]; changed = true; }
    }
    const c = cleanName(s.name);
    if (c !== s.name) { s.name = c; changed = true; }
  });
  return changed;
}
function rosterToText(students) {
  if (!students.length) return '';
  return '姓名\t性別\t系級\n' + students.map(s => [s.name, s.gender, s.dept].join('\t').replace(/\t+$/, '')).join('\n');
}
// 重新儲存名單時，同名的人沿用舊 id，抽過／缺席的狀態才不會不見
function keepIds(oldList, newList) {
  const pool = {};
  oldList.forEach(s => (pool[s.name] = pool[s.name] || []).push(s.id));
  newList.forEach(s => { const q = pool[s.name]; if (q && q.length) s.id = q.shift(); });
  return newList;
}
function rosterStats(list) {
  if (!list.length) return '名單是空的';
  const m = list.filter(s => s.gender === '男').length;
  const f = list.filter(s => s.gender === '女').length;
  const depts = {};
  list.forEach(s => { if (s.dept) depts[s.dept] = (depts[s.dept] || 0) + 1; });
  let t = `共 ${list.length} 人`;
  if (m || f) t += `（男 ${m}、女 ${f}${list.length - m - f ? `、未填 ${list.length - m - f}` : ''}）`;
  const dk = Object.keys(depts);
  if (dk.length) t += `｜系級：${dk.map(k => `${k} ${depts[k]}`).join('、')}`;
  const names = list.map(s => s.name);
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dup.length) t += `｜⚠️ 重複姓名：${dup.join('、')}`;
  return t;
}

// 解析相關的常數都定義好之後才載入資料（避免 TDZ）
let db = loadDb();

/* ================= 全域狀態 ================= */
let busy = false;           // 動畫進行中
let lastWinner = null;
const DURATION = { short: 4, normal: 7, long: 11 };   // 秒
const COLORS = ['#ff5c8a', '#ff9a3c', '#ffcc4d', '#3ccf91', '#2ec4d6', '#4f8cff', '#8c6cff', '#d65cff'];
const GROUP_COLORS = ['#ff5c8a', '#ff9a3c', '#e0b030', '#2fb37c', '#22a9ba', '#4f8cff', '#8c6cff', '#c34fe6', '#e8603c', '#5a7bd6'];
const isDark = hex => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 165;
};

/* ================= 頂部列、側欄 ================= */
function renderClassSel() {
  const sel = $('#classSel');
  sel.innerHTML = db.classes.map(c => `<option value="${c.id}">${esc(c.name)}（${c.students.length}）</option>`).join('');
  sel.value = db.currentId;
}

function chipHtml(s, st, forPick) {
  const cls = ['chip'];
  if (s.gender === '男') cls.push('g-m');
  if (s.gender === '女') cls.push('g-f');
  if (st.absent.includes(s.id)) cls.push('absent');
  else if (forPick && st.removed.includes(s.id)) cls.push('removed');
  return `<button class="${cls.join(' ')}" data-id="${s.id}" title="${esc(s.dept || '')}">${esc(s.name)}</button>`;
}

function renderSide() {
  const cls = cur();
  const st = stateOf(cls);
  const list = cls ? cls.students : [];
  $('#pickChips').innerHTML = list.map(s => chipHtml(s, st, true)).join('');
  $('#groupChips').innerHTML = list.map(s => chipHtml(s, st, false)).join('');
  const pool = pickPool(cls).length, pres = present(cls).length;
  $('#poolCount').textContent = list.length ? `（可抽 ${pool}／出席 ${pres}／全班 ${list.length}）` : '';
  $('#groupCount').textContent = list.length ? `（${pres} 人）` : '';
  $('#btnRestore').style.visibility = st.removed.length ? 'visible' : 'hidden';
  renderHistory();
  renderGroupPreview();
}

function renderHistory() {
  const st = stateOf(cur());
  $('#history').innerHTML = st.hist.slice().reverse().map(h =>
    `<li><span class="t">${h.t}</span><span>${esc(h.name)}</span><span class="tag">${h.removed ? '已移除' : '保留'}</span></li>`
  ).join('') || '<li><span class="t"></span><span style="color:var(--text-dim)">還沒有人被抽到</span></li>';
}

function onChipClick(e) {
  const b = e.target.closest('.chip');
  if (!b || busy) return;
  const cls = cur(), st = stateOf(cls), id = b.dataset.id;
  const inPick = !!b.closest('#pickChips');
  if (inPick && st.removed.includes(id) && !st.absent.includes(id)) {
    st.removed = st.removed.filter(x => x !== id);
  } else if (st.absent.includes(id)) {
    st.absent = st.absent.filter(x => x !== id);
  } else {
    st.absent.push(id);
  }
  save(); refresh();
}

function refresh() {
  renderSide();
  renderStage();
}

/* ================= 舞台切換 ================= */
function renderStage() {
  const s = S(), cls = cur();
  document.body.classList.toggle('mode-pick', s.mode === 'pick');
  document.body.classList.toggle('mode-group', s.mode === 'group');
  $$('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
  const hint = $('#emptyHint');
  const views = { wheel: $('#wheelStage'), slot: $('#slotStage'), group: $('#groupStage') };
  Object.values(views).forEach(v => v.classList.add('hidden'));
  hint.classList.add('hidden');

  if (!cls || !cls.students.length) {
    hint.innerHTML = '這個班級還沒有名單<br>按上方「📋 名單管理」貼上學生名字';
    hint.classList.remove('hidden');
    $('#btnSpin').disabled = $('#btnGroup').disabled = true;
    return;
  }
  if (s.mode === 'pick') {
    const pool = pickPool(cls);
    $('#btnSpin').disabled = !pool.length;
    if (!pool.length) {
      hint.innerHTML = present(cls).length
        ? '🎉 這一輪大家都抽過了！<br>按右邊「↺ 全部放回」再來一輪'
        : '今天全班都標成缺席了？<br>在右邊點名字可以取消缺席';
      hint.classList.remove('hidden');
      return;
    }
    if (s.ritual === 'wheel') {
      views.wheel.classList.remove('hidden');
      W.items = pool;
      wheelResize();
    } else {
      views.slot.classList.remove('hidden');
      slotResize();
      if (!busy) slotIdle(pool);
    }
  } else {
    views.group.classList.remove('hidden');
    $('#btnGroup').disabled = present(cls).length < 2;
  }
}

/* ================= 轉盤 ================= */
const W = { items: [], rot: 0, size: 400, lastIdx: -1, flash: -1, bulbs: 0, lastTick: 0 };
const wheelCanvas = $('#wheel');
const wctx = wheelCanvas.getContext('2d');
const FONT = getComputedStyle(document.body).fontFamily;

function wheelResize() {
  const st = $('#wheelStage');
  if (!st.clientWidth) return;
  const s = Math.max(220, Math.min(st.clientWidth - 40, st.clientHeight - 50));
  W.size = s;
  const dpr = window.devicePixelRatio || 1;
  wheelCanvas.width = wheelCanvas.height = Math.round(s * dpr);
  wheelCanvas.style.width = wheelCanvas.style.height = s + 'px';
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hub = $('#hub');
  const hs = Math.round(s * 0.17);
  hub.style.width = hub.style.height = hs + 'px';
  hub.style.fontSize = Math.round(hs * 0.3) + 'px';
  const p = $('#pointer');
  p.style.width = Math.round(s * 0.075) + 'px';
  p.style.height = Math.round(s * 0.1) + 'px';
  p.style.marginLeft = -Math.round(s * 0.0375) + 'px';
  p.style.top = -Math.round(s * 0.025) + 'px';
  drawWheel();
}

function sliceColor(i, n) {
  let c = i % COLORS.length;
  // 最後一片別跟第一片同色
  if (n > 1 && i === n - 1 && c === 0) c = 3;
  return COLORS[c];
}

function drawWheel() {
  const s = W.size, c = s / 2, ctx = wctx;
  const R = c - 3, rim = Math.max(12, s * 0.04), r = R - rim;
  const items = W.items, n = items.length;
  ctx.clearRect(0, 0, s, s);

  // 外框 + 燈泡
  const g = ctx.createRadialGradient(c, c, r, c, c, R);
  g.addColorStop(0, '#6b4a00'); g.addColorStop(0.5, '#ffd76a'); g.addColorStop(1, '#8a6200');
  ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
  const nb = 24;
  for (let k = 0; k < nb; k++) {
    const a = k / nb * TAU;
    const lit = (k + W.bulbs) % 2 === 0;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * (r + rim / 2), c + Math.sin(a) * (r + rim / 2), rim * 0.24, 0, TAU);
    ctx.fillStyle = lit ? '#fffbe0' : '#a07a20';
    ctx.shadowColor = lit ? '#ffe680' : 'transparent';
    ctx.shadowBlur = lit ? rim * 0.6 : 0;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  if (!n) return;
  const sl = TAU / n;
  let fs = Math.min(r * 0.13, r * 0.58 * sl * 0.78);
  fs = Math.max(fs, 10);
  for (let i = 0; i < n; i++) {
    const a0 = W.rot - Math.PI / 2 + i * sl;
    const col = sliceColor(i, n);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a0 + sl);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    if (i === W.flash) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill(); }
    if (n > 1) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.stroke(); }

    // 名字：沿半徑方向，靠外緣對齊
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a0 + sl / 2);
    const maxW = r * 0.66;
    let f = fs;
    ctx.font = `800 ${f}px ${FONT}`;
    const w = ctx.measureText(items[i].name).width;
    if (w > maxW) { f = Math.max(9, f * maxW / w); ctx.font = `800 ${f}px ${FONT}`; }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const dark = isDark(col) && i !== W.flash;
    ctx.fillStyle = dark ? '#fff' : '#1d1d2b';
    if (dark) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3; }
    ctx.fillText(items[i].name, r - r * 0.06, 0);
    ctx.restore();
  }
  // 中心陰影，讓中心按鈕浮起來
  const sh = ctx.createRadialGradient(c, c, r * 0.1, c, c, r * 0.3);
  sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(c, c, r * 0.3, 0, TAU); ctx.fillStyle = sh; ctx.fill();
}

function flickPointer() {
  $('#pointer').animate(
    [{ transform: 'rotate(22deg)' }, { transform: 'rotate(0deg)' }],
    { duration: 130, easing: 'ease-out' }
  );
}

function spinWheel() {
  const items = W.items, n = items.length;
  if (!n || busy) return;
  busy = true;
  setBusyUi(true);
  Sound.unlock();
  const sl = TAU / n;
  const win = randInt(n);
  const off = (Math.random() - 0.5) * 0.7;       // 停在那一格的哪個位置（純視覺）
  const D = DURATION[S().duration] * 1000;
  const turns = Math.round(DURATION[S().duration] * 1.1) + 3;
  const start = W.rot;
  const dist = mod(-(win + 0.5 + off) * sl - start, TAU) + turns * TAU;
  const t0 = performance.now();
  let lastBulb = t0;
  W.lastIdx = Math.floor(mod(-start, TAU) / sl);

  function frame(now) {
    const p = Math.min(1, (now - t0) / D);
    const e = 1 - Math.pow(1 - p, 4);
    W.rot = start + dist * e;
    const idx = Math.floor(mod(-W.rot, TAU) / sl);
    if (idx !== W.lastIdx) {
      W.lastIdx = idx;
      if (now - W.lastTick > 32) {
        W.lastTick = now;
        Sound.tick(Math.pow(1 - p, 2));
        flickPointer();
      }
    }
    if (now - lastBulb > 110 + p * 200) { W.bulbs++; lastBulb = now; }
    drawWheel();
    if (p < 1) requestAnimationFrame(frame);
    else finishWheel(win);
  }
  requestAnimationFrame(frame);
}

async function finishWheel(win) {
  for (let k = 0; k < 6; k++) {
    W.flash = k % 2 === 0 ? win : -1;
    drawWheel();
    await sleep(110);
  }
  W.flash = -1; drawWheel();
  showResult(W.items[win]);
}

/* ================= 拉霸 ================= */
const strip = $('#slotStrip');
let rowH = 110;

function slotResize() {
  const st = $('#slotStage');
  if (!st.clientWidth) return;
  rowH = Math.round(Math.max(56, Math.min(150, st.clientHeight * 0.19, st.clientWidth * 0.13)));
  $('#slotMachine').style.setProperty('--rowH', rowH + 'px');
  const lights = '<i></i>'.repeat(Math.max(8, Math.round($('#slotMachine').clientWidth / 34)));
  $$('.slot-lights').forEach(el => (el.innerHTML = lights));
}

const rowHtml = s => `<div class="slot-row"><span>${esc(s.name)}</span>${s.dept ? `<span class="dept">${esc(s.dept)}</span>` : ''}</div>`;

function slotIdle(pool) {
  const mid = lastWinner && pool.find(s => s.id === lastWinner.id) ? lastWinner : pool[0];
  const others = pool.filter(s => s !== mid);
  const pickO = () => others.length ? others[randInt(others.length)] : mid;
  strip.innerHTML = [pickO(), mid, pickO()].map(rowHtml).join('');
  strip.style.transform = 'translateY(0)';
  $('#slotWindow').classList.remove('win');
}

function spinSlot() {
  const pool = pickPool(cur()), n = pool.length;
  if (!n || busy) return;
  busy = true;
  setBusyUi(true);
  Sound.unlock();
  Sound.lever();
  const lever = $('#lever');
  lever.classList.add('pulled');
  setTimeout(() => lever.classList.remove('pulled'), 450);

  const win = pool[randInt(n)];
  const D = DURATION[S().duration];
  const total = Math.round(D * 7) + 14;
  // 開頭沿用目前畫面上的三列，銜接才自然
  const seq = $$('.slot-row', strip).slice(0, 3).map(el => el.outerHTML);
  let prev = null;
  for (let k = 3; k < total; k++) {
    let s = pool[randInt(n)];
    if (n > 1) while (s === prev) s = pool[randInt(n)];
    if (k === total - 2) s = win;
    if (n > 1 && k === total - 1) while (s === win) s = pool[randInt(n)];
    if (n > 1 && k === total - 3 && s === win) s = pool.find(x => x !== win);
    seq.push(rowHtml(s));
    prev = s;
  }
  strip.innerHTML = seq.join('');
  $('#slotWindow').classList.remove('win');
  const machine = $('#slotMachine');
  machine.classList.add('running');

  const target = (total - 3) * rowH;
  const over = rowH * 0.28;
  const t0 = performance.now() + 250;   // 拉桿拉下去之後才開始轉
  const D1 = D * 1000;
  let lastRow = 0;
  function frame(now) {
    let y;
    if (now < t0) { requestAnimationFrame(frame); return; }
    const t = now - t0;
    if (t < D1) {
      const p = t / D1;
      y = (target + over) * (1 - Math.pow(1 - p, 4));
    } else {
      // 稍微超過再彈回來，像真的拉霸
      const p = Math.min(1, (t - D1) / 260);
      y = target + over * (1 - (1 - Math.pow(1 - p, 2)));
    }
    strip.style.transform = `translateY(${-y}px)`;
    const row = Math.floor((y + rowH / 2) / rowH);
    if (row !== lastRow) { lastRow = row; Sound.reel(); }
    if (t < D1 + 260) requestAnimationFrame(frame);
    else {
      machine.classList.remove('running');
      $('#slotWindow').classList.add('win');
      setTimeout(() => showResult(win), 700);
    }
  }
  requestAnimationFrame(frame);
}

/* ================= 抽中結果 ================= */
function showResult(s) {
  lastWinner = s;
  const st = stateOf(cur());
  const now = new Date();
  st.hist.push({ t: now.toTimeString().slice(0, 5), id: s.id, name: s.name, removed: false });
  save();
  $('#resultName').textContent = s.name;
  $('#resultMeta').textContent = [s.dept, s.gender].filter(Boolean).join('・');
  $('#resultOverlay').classList.remove('hidden');
  Sound.fanfare();
  Confetti.burst();
  renderHistory();
}

function closeResult(remove) {
  const ov = $('#resultOverlay');
  if (ov.classList.contains('hidden')) return;
  ov.classList.add('hidden');
  const cls = cur(), st = stateOf(cls);
  if (remove && lastWinner) {
    if (!st.removed.includes(lastWinner.id)) st.removed.push(lastWinner.id);
    const h = st.hist[st.hist.length - 1];
    if (h && h.id === lastWinner.id) h.removed = true;
    if (!pickPool(cls).length) setTimeout(() => Sound.soft(), 200);
  }
  save();
  busy = false;
  setBusyUi(false);
  refresh();
}

function setBusyUi(on) {
  $('#btnSpin').disabled = on;
  $('#hub').disabled = on;
  $('#btnGroup').disabled = on;
  $('#classSel').disabled = on;
}

/* ================= 彩帶 ================= */
const Confetti = (() => {
  const cv = $('#confetti'), cx = cv.getContext('2d');
  let parts = [], raf = 0;
  const colors = ['#ff5c8a', '#ffcc4d', '#3ccf91', '#4f8cff', '#8c6cff', '#ff9a3c', '#ffffff'];
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(n = 200) {
    fit();
    const w = innerWidth, h = innerHeight;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      parts.push({
        x: left ? -10 : w + 10, y: h * (0.55 + Math.random() * 0.3),
        vx: (left ? 1 : -1) * (5 + Math.random() * 11) * (w / 1400 + 0.5),
        vy: -(9 + Math.random() * 14) * (h / 900 + 0.4),
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.4,
        w: 7 + Math.random() * 7, h: 4 + Math.random() * 6,
        c: colors[i % colors.length], wob: Math.random() * TAU,
      });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.y < innerHeight + 40);
    for (const p of parts) {
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.34;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.wob += 0.12;
      cx.save();
      cx.translate(p.x, p.y); cx.rotate(p.rot);
      cx.scale(1, Math.cos(p.wob));
      cx.fillStyle = p.c;
      cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
    }
    raf = parts.length ? requestAnimationFrame(loop) : 0;
    if (!raf) cx.clearRect(0, 0, innerWidth, innerHeight);
  }
  return { burst };
})();

/* ================= 分組 ================= */
let lastGroups = null;
let groupToken = 0;

function groupPlan(n) {
  const s = S();
  if (n < 2) return null;
  let g = s.gmode === 'count' ? Math.max(2, Math.min(n, s.groupN | 0 || 2)) : Math.ceil(n / Math.max(1, s.groupM | 0 || 1));
  g = Math.max(1, Math.min(n, g));
  return { g, min: Math.floor(n / g), max: Math.ceil(n / g) };
}

function renderGroupPreview() {
  const cls = cur(), people = present(cls), n = people.length;
  const plan = groupPlan(n);
  $('#groupPreview').textContent = !plan ? '出席人數不足，無法分組'
    : `→ ${n} 人分成 ${plan.g} 組，每組 ${plan.min === plan.max ? plan.min : `${plan.min}～${plan.max}`} 人`;
  const hasG = people.some(p => p.gender), hasD = people.some(p => p.dept);
  const b = S().balance;
  let note = '';
  if ((b === 'gender' || b === 'both') && !hasG) note = '⚠️ 名單沒有性別資料，會當作「不限」處理。';
  else if ((b === 'dept' || b === 'both') && !hasD) note = '⚠️ 名單沒有系級資料，會當作「不限」處理。';
  else if (b !== 'none') note = '同性別／同系級的人會盡量平均散到各組（各組人數最多差 1）。';
  $('#balanceNote').textContent = note;
}

// 分層發牌：先依條件分層、層內洗牌，再依序輪流發到各組，
// 每一層連續的 g 個人一定落在不同組，所以每組的各類人數最多差 1。
function makeGroups(people, g, balance) {
  const strata = (list, key) => {
    const m = new Map();
    shuffle(list).forEach(p => {
      const k = key(p) || '（未填）';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    });
    return shuffle([...m.values()]);
  };
  let order;
  if (balance === 'gender') order = strata(people, p => p.gender).flat();
  else if (balance === 'dept') order = strata(people, p => p.dept).flat();
  else if (balance === 'both') order = strata(people, p => p.gender).flatMap(part => strata(part, p => p.dept).flat());
  else order = shuffle(people);

  const perm = shuffle([...Array(g).keys()]);   // 哪幾組會多一人也隨機
  const groups = Array.from({ length: g }, () => ({ members: [], leader: null }));
  order.forEach((p, k) => groups[perm[k % g]].members.push(p));
  if (balance === 'both') refineBoth(groups.map(gr => gr.members));
  groups.forEach(gr => {
    gr.members = shuffle(gr.members);
    gr.leader = gr.members[randInt(gr.members.length)];
  });
  return groups;
}

// 性別＋系級：發牌已保證性別平均，再隨機交換「同性別」的兩人，
// 只要能讓各組系級更平均（各組各系人數平方和變小）就換。性別與組人數完全不變。
function refineBoth(lists) {
  const g = lists.length;
  if (g < 2) return;
  const dk = p => p.dept || '（未填）';
  const cnt = lists.map(l => {
    const m = {};
    l.forEach(p => { m[dk(p)] = (m[dk(p)] || 0) + 1; });
    return m;
  });
  const c = (i, k) => cnt[i][k] || 0;
  for (let it = 0; it < 6000; it++) {
    const g1 = randInt(g);
    let g2 = randInt(g - 1); if (g2 >= g1) g2++;
    const L1 = lists[g1], L2 = lists[g2];
    if (!L1.length || !L2.length) continue;
    const i = randInt(L1.length), a = L1[i];
    const same = L2.map((p, j) => j).filter(j => L2[j].gender === a.gender);
    if (!same.length) continue;
    const j = same[randInt(same.length)], b = L2[j];
    const ka = dk(a), kb = dk(b);
    if (ka === kb) continue;
    const delta = 2 * (c(g1, kb) - c(g1, ka) + c(g2, ka) - c(g2, kb)) + 4;
    if (delta < 0 || (delta === 0 && randInt(3) === 0)) {
      L1[i] = b; L2[j] = a;
      cnt[g1][ka]--; cnt[g1][kb] = c(g1, kb) + 1;
      cnt[g2][kb]--; cnt[g2][ka] = c(g2, ka) + 1;
    }
  }
}

function groupCardsHtml(groups, leaderOn) {
  return groups.map((gr, i) => {
    const col = GROUP_COLORS[i % GROUP_COLORS.length];
    const m = gr.members.filter(p => p.gender === '男').length;
    const f = gr.members.filter(p => p.gender === '女').length;
    const gtxt = m || f ? `・男${m} 女${f}` : '';
    return `<div class="gcard" style="animation-delay:${i * 50}ms">
      <div class="gcard-head" style="background:${col}"><span>第 ${i + 1} 組</span><small>${gr.members.length} 人${gtxt}</small></div>
      <ul>${gr.members.map(p => `<li class="pending" data-id="${p.id}"><span class="crown">👑</span><span>${esc(p.name)}</span><span class="dept">${esc(p.dept || '')}</span></li>`).join('')}</ul>
    </div>`;
  }).join('');
}

async function runGrouping() {
  const cls = cur(), people = present(cls);
  const plan = groupPlan(people.length);
  if (!plan || busy) return;
  busy = true;
  setBusyUi(true);
  Sound.unlock();
  const token = ++groupToken;
  const s = S();
  let bal = s.balance;
  if ((bal === 'gender' || bal === 'both') && !people.some(p => p.gender)) bal = bal === 'both' ? 'dept' : 'none';
  if ((bal === 'dept' || bal === 'both') && !people.some(p => p.dept)) bal = bal === 'both' ? 'gender' : 'none';
  const groups = makeGroups(people, plan.g, bal);
  lastGroups = { cls: cls.name, groups, leader: s.leader, date: new Date() };
  $('#btnCopyGroups').disabled = $('#btnCsvGroups').disabled = true;

  const grid = $('#groupGrid');
  $('#groupEmpty').classList.add('hidden');
  grid.innerHTML = groupCardsHtml(groups, s.leader);
  fitGroupGrid();
  const alive = () => token === groupToken;

  const speed = { slow: [950, 650], normal: [480, 380], fast: [190, 170], instant: [0, 0] }[s.speed] || [480, 380];
  if (speed[0] === 0) {
    $$('li.pending', grid).forEach(li => li.classList.remove('pending'));
  } else {
    const deck = $('#groupDeck'), deckName = $('#deckName');
    deck.classList.add('show');
    // 洗牌：小鼓滾奏 + 名字快速閃過
    Sound.drumroll(1.3);
    const tEnd = performance.now() + 1300;
    while (performance.now() < tEnd && alive()) {
      const p = people[randInt(people.length)];
      deckName.textContent = p.name;
      deckName.style.color = '#fff';
      await sleep(70);
    }
    // 一輪一輪發：每輪每組各一人，組的順序隨機
    const rounds = Math.max(...groups.map(g => g.members.length));
    for (let r = 0; r < rounds && alive(); r++) {
      for (const gi of shuffle([...groups.keys()])) {
        if (!alive()) break;
        const p = groups[gi].members[r];
        if (!p) continue;
        const col = GROUP_COLORS[gi % GROUP_COLORS.length];
        deckName.textContent = p.name;
        deckName.style.color = col;
        const li = $(`li[data-id="${p.id}"]`, grid);
        fly(p.name, col, deckName, li, speed[1], gi);
        await sleep(speed[0]);
      }
    }
    await sleep(speed[1] + 50);
    deck.classList.remove('show');
    deckName.textContent = '';
  }
  if (!alive()) return;
  $$('li.pending', grid).forEach(li => li.classList.remove('pending'));

  if (s.leader) {
    await sleep(350);
    for (let i = 0; i < groups.length && alive(); i++) {
      const li = $(`li[data-id="${groups[i].leader.id}"]`, grid);
      li.classList.add('leader');
      Sound.crown(i);
      await sleep(speed[0] === 0 ? 120 : 380);
    }
  }
  if (!alive()) return;
  Sound.fanfare();
  Confetti.burst(160);
  $('#btnCopyGroups').disabled = $('#btnCsvGroups').disabled = false;
  busy = false;
  setBusyUi(false);
  renderStage();
}

// 讓各列組數平均：6 組排 3×2，而不是 5＋1
function fitGroupGrid() {
  const grid = $('#groupGrid');
  const n = grid.children.length;
  if (!n) return;
  const maxCols = Math.max(1, Math.floor((grid.clientWidth + 14) / 234));
  const rows = Math.ceil(n / maxCols);
  grid.style.gridTemplateColumns = `repeat(${Math.ceil(n / rows)}, minmax(0, 1fr))`;
}

function fly(name, color, fromEl, toEl, dur, gi) {
  if (!toEl) return;
  toEl.scrollIntoView({ block: 'nearest' });
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'flyer';
  f.textContent = name;
  f.style.background = color;
  f.style.fontSize = getComputedStyle(fromEl).fontSize;
  document.body.appendChild(f);
  const fr = f.getBoundingClientRect();
  const sx = a.left + a.width / 2 - fr.width / 2, sy = a.top + a.height / 2 - fr.height / 2;
  const scale = Math.min(1, b.height / fr.height);
  const ex = b.left + 10 - fr.width * (1 - scale) / 2, ey = b.top + b.height / 2 - fr.height / 2;
  f.style.left = '0px'; f.style.top = '0px';
  Sound.whoosh(dur / 1000);
  const anim = f.animate([
    { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1 },
    { transform: `translate(${(sx + ex) / 2}px, ${Math.min(sy, ey) - 40}px) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.45 },
    { transform: `translate(${ex}px, ${ey}px) scale(${scale})`, opacity: 0.4 },
  ], { duration: dur, easing: 'cubic-bezier(.45,.05,.4,1)' });
  anim.onfinish = () => {
    f.remove();
    toEl.classList.remove('pending');
    toEl.classList.add('landed');
    Sound.pluck(gi);
  };
}

function groupsText() {
  const g = lastGroups;
  if (!g) return '';
  const d = g.date.toLocaleDateString('zh-TW');
  const lines = [`分組結果｜${g.cls}｜${d}`];
  g.groups.forEach((gr, i) => {
    const names = gr.members.map(p => p.name + (g.leader && p === gr.leader ? '（組長）' : ''));
    lines.push(`第 ${i + 1} 組（${gr.members.length} 人）：${names.join('、')}`);
  });
  return lines.join('\n');
}
function groupsCsv() {
  const g = lastGroups;
  const q = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const rows = [['組別', '姓名', '性別', '系級', '組長']];
  g.groups.forEach((gr, i) => gr.members.forEach(p =>
    rows.push([`第 ${i + 1} 組`, p.name, p.gender, p.dept, g.leader && p === gr.leader ? '是' : ''])));
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}

/* ================= 名單管理 ================= */
const dlg = $('#rosterDlg');
let editId = null, dirty = false;

function openRoster() {
  if (busy) return;
  editId = db.currentId || (db.classes[0] && db.classes[0].id);
  if (!editId) newClass();
  loadEditor();
  dlg.showModal();
}
function renderClassList() {
  $('#classList').innerHTML = db.classes.map(c =>
    `<button data-id="${c.id}" class="${c.id === editId ? 'active' : ''}">${esc(c.name)}<small>${c.students.length} 人</small></button>`
  ).join('');
}
function loadEditor() {
  const c = db.classes.find(x => x.id === editId);
  $('#className').value = c ? c.name : '';
  $('#rosterText').value = c ? rosterToText(c.students) : '';
  dirty = false;
  updateStats();
  renderClassList();
}
function updateStats() {
  $('#rosterStats').textContent = rosterStats(parseRoster($('#rosterText').value));
}
function commitEditor() {
  const c = db.classes.find(x => x.id === editId);
  if (!c) return;
  c.name = $('#className').value.trim() || '未命名班級';
  c.students = keepIds(c.students, parseRoster($('#rosterText').value));
  const ids = new Set(c.students.map(s => s.id));
  const st = stateOf(c);
  st.removed = st.removed.filter(id => ids.has(id));
  st.absent = st.absent.filter(id => ids.has(id));
  dirty = false;
  save();
}
function newClass() {
  const id = uid();
  db.classes.push({ id, name: `新班級 ${db.classes.length + 1}`, students: [] });
  editId = id;
  save();
}

/* ================= 匯入匯出 ================= */
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('big5').decode(buf); }   // Excel 中文版另存的 CSV 常是 Big5
}
async function importFile(file) {
  const text = (await readTextFile(file)).replace(/^﻿/, '');
  if (/\.json$/i.test(file.name)) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('⚠️ 這個 JSON 檔讀不懂'); return; }
    const list = Array.isArray(data.classes) ? data.classes : null;
    if (!list || !list.length) { toast('⚠️ 這不是課堂轉盤的備份檔'); return; }
    if (!confirm(`要匯入 ${list.length} 個班級嗎？\n（同名的班級會被備份檔裡的名單取代）`)) return;
    for (const c of list) {
      if (!c || !c.name || !Array.isArray(c.students)) continue;
      const students = c.students.filter(s => s && s.name).map(s => ({
        id: s.id || uid(), name: String(s.name), gender: normGender(s.gender), dept: String(s.dept || ''),
      }));
      const same = db.classes.find(x => x.name === c.name);
      if (same) same.students = keepIds(same.students, students);
      else db.classes.push({ id: uid(), name: String(c.name), students });
    }
    save();
    loadEditor();
    renderClassSel(); refresh();
    toast(`✅ 已匯入 ${list.length} 個班級`);
  } else {
    const list = parseRoster(text);
    if (!list.length) { toast('⚠️ 檔案裡沒有讀到名字'); return; }
    $('#rosterText').value = rosterToText(list);
    const nameEl = $('#className');
    if (!nameEl.value.trim() || /^新班級/.test(nameEl.value)) nameEl.value = file.name.replace(/\.[^.]+$/, '');
    dirty = true;
    updateStats();
    toast(`📥 讀到 ${list.length} 位，確認沒問題後按「💾 儲存」`);
  }
}
function exportBackup() {
  if (dirty) commitEditor();
  const data = {
    app: 'japp-class-wheel', version: 1, exported: new Date().toISOString(),
    classes: db.classes.map(c => ({ name: c.name, students: c.students.map(({ id, name, gender, dept }) => ({ id, name, gender, dept })) })),
  };
  download(`課堂轉盤名單備份-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('⬇ 已下載備份檔，帶到教室電腦用「⬆ 匯入檔案」就能還原');
}

/* ================= 設定、事件 ================= */
function setSeg(segId, key) {
  const seg = $(segId);
  $$('button', seg).forEach(b => b.classList.toggle('active', b.dataset.v === S()[key]));
  seg.onclick = e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    S()[key] = b.dataset.v;
    save();
    $$('button', seg).forEach(x => x.classList.toggle('active', x === b));
    if (key === 'ritual') renderStage();
  };
}

function applySound() {
  Sound.enabled = S().sound;
  Sound.volume = S().volume;
  $('#btnSound').textContent = S().sound ? '🔊' : '🔇';
  $('#volume').value = Math.round(S().volume * 100);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('這個瀏覽器不允許全螢幕，可以按 F11'));
}

function go() {
  if (busy) return;
  // 移開按鈕焦點，避免之後按空白鍵／Enter 又觸發同一顆按鈕
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (S().mode === 'pick') (S().ritual === 'wheel' ? spinWheel : spinSlot)();
  else runGrouping();
}

function bind() {
  $('#classSel').onchange = e => {
    db.currentId = e.target.value;
    lastWinner = null;
    save(); refresh();
    $('#groupGrid').innerHTML = '';
    $('#groupEmpty').classList.remove('hidden');
    $('#btnCopyGroups').disabled = $('#btnCsvGroups').disabled = true;
  };
  $$('.mode-tab').forEach(b => b.onclick = () => {
    if (busy) return;
    S().mode = b.dataset.mode; save(); renderStage();
  });
  $('#btnSound').onclick = () => { S().sound = !S().sound; save(); applySound(); if (S().sound) Sound.soft(); };
  $('#volume').oninput = e => { S().volume = e.target.value / 100; save(); applySound(); };
  $('#btnSidebar').onclick = () => {
    S().sidebar = !S().sidebar; save();
    document.body.classList.toggle('no-sidebar', !S().sidebar);
    requestAnimationFrame(renderStage);
  };
  $('#btnFull').onclick = toggleFullscreen;

  $('#btnSpin').onclick = go;
  $('#hub').onclick = go;
  wheelCanvas.onclick = go;
  $('#lever').onclick = go;
  $('#btnGroup').onclick = go;
  $('#pickChips').onclick = onChipClick;
  $('#groupChips').onclick = onChipClick;
  $('#btnRestore').onclick = () => {
    const st = stateOf(cur());
    st.removed = []; save(); refresh(); toast('↺ 全部放回轉盤了');
  };
  $('#btnClearHist').onclick = () => { stateOf(cur()).hist = []; save(); renderHistory(); };
  $('#btnRemoveWinner').onclick = () => closeResult(true);
  $('#btnKeepWinner').onclick = () => closeResult(false);

  setSeg('#ritualSeg', 'ritual');
  setSeg('#durSeg', 'duration');
  setSeg('#speedSeg', 'speed');
  $$('input[name=gmode]').forEach(r => {
    r.checked = r.value === S().gmode;
    r.onchange = () => { S().gmode = r.value; save(); renderGroupPreview(); };
  });
  $('#groupN').value = S().groupN;
  $('#groupM').value = S().groupM;
  $('#groupN').oninput = e => { S().groupN = +e.target.value; S().gmode = 'count'; $$('input[name=gmode]')[0].checked = true; save(); renderGroupPreview(); };
  $('#groupM').oninput = e => { S().groupM = +e.target.value; S().gmode = 'size'; $$('input[name=gmode]')[1].checked = true; save(); renderGroupPreview(); };
  $('#balanceSel').value = S().balance;
  $('#balanceSel').onchange = e => { S().balance = e.target.value; save(); renderGroupPreview(); };
  $('#leaderChk').checked = S().leader;
  $('#leaderChk').onchange = e => { S().leader = e.target.checked; save(); };
  $('#btnCopyGroups').onclick = async () => toast(await copyText(groupsText()) ? '📋 已複製，可以貼到 LINE 或 Moodle' : '⚠️ 複製失敗');
  $('#btnCsvGroups').onclick = () => download(`分組結果-${lastGroups.cls}-${today()}.csv`, groupsCsv(), 'text/csv');

  // 名單管理
  $('#btnRoster').onclick = openRoster;
  $('#classList').onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.id === editId) return;
    if (dirty) commitEditor();
    editId = b.dataset.id;
    loadEditor();
  };
  $('#btnNewClass').onclick = () => {
    if (dirty) commitEditor();
    newClass(); loadEditor();
    $('#className').select();
  };
  $('#className').oninput = () => { dirty = true; };
  $('#rosterText').oninput = () => { dirty = true; updateStats(); };
  $('#btnSaveClass').onclick = () => {
    commitEditor();
    db.currentId = editId;
    save();
    dlg.close();
    toast('💾 名單已儲存');
  };
  $('#btnDelClass').onclick = () => {
    const c = db.classes.find(x => x.id === editId);
    if (!c || !confirm(`確定刪除「${c.name}」？這個動作不能復原。`)) return;
    db.classes = db.classes.filter(x => x !== c);
    delete db.state[c.id];
    if (!db.classes.length) newClass();
    editId = db.classes[0].id;
    if (db.currentId === c.id) db.currentId = editId;
    save(); loadEditor();
  };
  dlg.addEventListener('cancel', e => {
    if (dirty && !confirm('名單有修改還沒儲存，確定要關閉？')) e.preventDefault();
  });
  $('[data-close]', dlg).onclick = () => {
    if (dirty && !confirm('名單有修改還沒儲存，確定要關閉？')) return;
    dlg.close();
  };
  dlg.addEventListener('close', () => {
    if (!db.classes.find(c => c.id === db.currentId)) db.currentId = db.classes[0].id;
    renderClassSel(); refresh();
  });
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importFile(f);
  };

  // 快捷鍵
  document.addEventListener('keydown', e => {
    if (dlg.open) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) && e.target.type !== 'range' && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
    const overlay = !$('#resultOverlay').classList.contains('hidden');
    const k = e.key.toLowerCase();
    if (overlay) {
      if (k === 'r') closeResult(true);
      else if (k === 'enter' || k === 'escape' || k === ' ') { e.preventDefault(); closeResult(false); }
      return;
    }
    if (k === ' ') { e.preventDefault(); go(); }
    else if (k === 'f') toggleFullscreen();
    else if (k === 'm') $('#btnSound').click();
  });

  document.addEventListener('keyup', e => {
    if (e.key === ' ' && !dlg.open && e.target.tagName === 'BUTTON') e.preventDefault();
  });

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { fitGroupGrid(); if (!busy) renderStage(); else if (S().ritual === 'wheel') wheelResize(); }, 120);
  });
  document.addEventListener('fullscreenchange', () => {
    $('#btnFull').textContent = document.fullscreenElement ? '⤢ 離開全螢幕' : '⛶ 全螢幕';
  });
}

/* ================= 啟動 ================= */
document.body.classList.toggle('no-sidebar', !S().sidebar);
applySound();
bind();
renderClassSel();
refresh();
save();
})();
