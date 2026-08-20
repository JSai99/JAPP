/* ============================================================
 * JAPP PDF 工作室
 * 純前端 PDF 工具：閱讀、文字/螢光筆/修正帶註記、
 * 頁面新增/刪除/旋轉/排序、多檔合併。
 * 顯示引擎：pdf.js（Mozilla）  編輯引擎：pdf-lib
 * 所有處理都在瀏覽器內完成，檔案不會離開你的電腦。
 * ============================================================ */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const FONT_STACKS = {
  sans: `-apple-system, "Segoe UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`,
  serif: `"Times New Roman", "PMingLiU", "新細明體", "Noto Serif TC", serif`,
  kai: `"DFKai-SB", "標楷體", "BiauKai", "Kaiti TC", "Noto Serif TC", serif`,
};
function fontStackOf(a) { return FONT_STACKS[a.font] || FONT_STACKS.sans; }
const LINE_HEIGHT = 1.3;
const TEXT_PAD = 2;          // 文字註記內距（scale 1 px）
const MAX_UNDO = 50;

/* ---------- 全域狀態 ---------- */
const state = {
  sources: {},      // srcId -> { name, bytes:Uint8Array, pdfjs, pjPages:Map, libdoc }
  pages: [],        // { uid, kind:'src'|'blank', srcId, srcIdx, rot, w, h, annots:[] }
                    //   w/h 只有 blank 頁使用（PDF pt）；rot 為使用者加轉的角度
  cur: 0,
  zoom: 1.25,
  tool: 'select',
  selectedAnnot: null,   // { pageUid, annotId }
  undoStack: [],
  dirty: false,
  docName: '文件',
};
let uidSeq = 1;
let srcSeq = 1;
let renderToken = 0;
let currentRenderTask = null;
const thumbCache = new Map();   // `${uid}:${rot}` -> canvas

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  thumbList: $('thumbList'), viewer: $('viewer'), emptyState: $('emptyState'),
  pageWrap: $('pageWrap'), pageStack: $('pageStack'), canvas: $('pageCanvas'),
  annotLayer: $('annotLayer'), rubber: $('rubberBand'),
  pageLabel: $('pageLabel'), zoomLabel: $('zoomLabel'),
  fontSize: $('fontSize'), fontColor: $('fontColor'), fontFamily: $('fontFamily'),
  fileOpen: $('fileOpen'), fileImport: $('fileImport'), dropCard: $('dropCard'),
};

/* ============================================================
 * 檔案載入
 * ============================================================ */
async function loadSource(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js 會把傳入的 buffer 轉移到 worker，因此給它一份複本，原始 bytes 留給 pdf-lib
  const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const srcId = 's' + (srcSeq++);
  state.sources[srcId] = { name: file.name, bytes, pdfjs, pjPages: new Map(), libdoc: null };
  const pages = [];
  for (let i = 0; i < pdfjs.numPages; i++) {
    pages.push({ uid: 'p' + (uidSeq++), kind: 'src', srcId, srcIdx: i, rot: 0, w: 0, h: 0, annots: [] });
  }
  return pages;
}

async function openFile(file) {
  try {
    const pages = await loadSource(file);
    // 重設整份文件
    for (const id of Object.keys(state.sources)) {
      if (!pages.length || id !== pages[0].srcId) {
        state.sources[id].pdfjs?.destroy?.();
        delete state.sources[id];
      }
    }
    state.pages = pages;
    state.cur = 0;
    state.undoStack = [];
    state.dirty = false;
    state.selectedAnnot = null;
    state.docName = file.name.replace(/\.pdf$/i, '');
    thumbCache.clear();
    refreshAll();
  } catch (err) {
    alert('無法開啟這個 PDF：' + (err && err.message ? err.message : err) +
      '\n（若檔案有密碼保護，請先解除密碼）');
  }
}

async function importFile(file) {
  try {
    pushUndo();
    const pages = await loadSource(file);
    state.pages.push(...pages);
    state.dirty = true;
    refreshAll();
    setStatusFlash(`已合併「${file.name}」（${pages.length} 頁，加在文件最後）`);
  } catch (err) {
    state.undoStack.pop();
    alert('無法匯入這個 PDF：' + (err && err.message ? err.message : err));
  }
}

async function getPjPage(pg) {
  const src = state.sources[pg.srcId];
  if (!src.pjPages.has(pg.srcIdx)) {
    src.pjPages.set(pg.srcIdx, await src.pdfjs.getPage(pg.srcIdx + 1));
  }
  return src.pjPages.get(pg.srcIdx);
}

/* 目前顯示的總旋轉角（含 PDF 內建 /Rotate；blank 頁恆為 0） */
async function totalRotation(pg) {
  if (pg.kind === 'blank') return 0;
  const pjPage = await getPjPage(pg);
  return ((pjPage.rotate || 0) + pg.rot) % 360;
}

/* scale=1 的顯示尺寸 */
async function displaySize(pg) {
  if (pg.kind === 'blank') return { w: pg.w, h: pg.h };
  const pjPage = await getPjPage(pg);
  const vp = pjPage.getViewport({ scale: 1, rotation: await totalRotation(pg) });
  return { w: vp.width, h: vp.height };
}

/* ============================================================
 * 復原
 * ============================================================ */
function pushUndo() {
  state.undoStack.push(JSON.stringify(state.pages));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  updateToolbar();
}

function undo() {
  if (!state.undoStack.length) return;
  state.pages = JSON.parse(state.undoStack.pop());
  if (state.cur >= state.pages.length) state.cur = Math.max(0, state.pages.length - 1);
  state.selectedAnnot = null;
  state.dirty = true;
  refreshAll();
}

/* ============================================================
 * 縮圖側欄
 * ============================================================ */
async function renderThumbs() {
  els.thumbList.innerHTML = '';
  for (let i = 0; i < state.pages.length; i++) {
    const pg = state.pages[i];
    const item = document.createElement('div');
    item.className = 'thumb' + (i === state.cur ? ' current' : '');
    item.dataset.index = i;
    item.draggable = true;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = '勾選後可一次刪除／旋轉多頁';
    cb.dataset.uid = pg.uid;
    cb.addEventListener('click', (e) => e.stopPropagation());

    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.appendChild(cb);

    const key = pg.uid + ':' + pg.rot;
    let tc = thumbCache.get(key);
    if (!tc) {
      tc = await renderThumbCanvas(pg);
      thumbCache.set(key, tc);
    }
    frame.appendChild(tc.cloneNode ? await cloneCanvas(tc) : tc);

    const pno = document.createElement('div');
    pno.className = 'pno';
    pno.textContent = (i + 1) + (pg.kind === 'blank' ? '（空白）' : '');

    item.appendChild(frame);
    item.appendChild(pno);
    item.addEventListener('click', () => { gotoPage(i); });
    attachThumbDnD(item);
    els.thumbList.appendChild(item);
  }
}

async function cloneCanvas(c) {
  const n = document.createElement('canvas');
  n.width = c.width; n.height = c.height;
  n.style.width = c.style.width; n.style.height = c.style.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}

async function renderThumbCanvas(pg) {
  const THUMB_W = 108;
  const size = await displaySize(pg);
  const scale = THUMB_W / size.w;
  const canvas = document.createElement('canvas');
  const cssH = Math.max(1, Math.round(size.h * scale));
  canvas.width = THUMB_W * 2;              // 2x 讓縮圖清晰
  canvas.height = cssH * 2;
  canvas.style.width = THUMB_W + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (pg.kind === 'src') {
    const pjPage = await getPjPage(pg);
    const vp = pjPage.getViewport({ scale: scale * 2, rotation: await totalRotation(pg) });
    await pjPage.render({ canvasContext: ctx, viewport: vp }).promise;
  }
  return canvas;
}

/* 縮圖拖曳排序 */
let dragIndex = -1;
function attachThumbDnD(item) {
  item.addEventListener('dragstart', (e) => {
    dragIndex = +item.dataset.index;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIndex)); // Firefox 需要
  });
  item.addEventListener('dragend', () => {
    dragIndex = -1;
    els.thumbList.querySelectorAll('.thumb').forEach(t =>
      t.classList.remove('dragging', 'dragover-before', 'dragover-after'));
  });
  item.addEventListener('dragover', (e) => {
    if (dragIndex < 0) return;
    e.preventDefault();
    const before = e.offsetY < item.offsetHeight / 2;
    item.classList.toggle('dragover-before', before);
    item.classList.toggle('dragover-after', !before);
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('dragover-before', 'dragover-after');
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragIndex < 0) return;
    const targetIdx = +item.dataset.index;
    const before = e.offsetY < item.offsetHeight / 2;
    let insertAt = before ? targetIdx : targetIdx + 1;
    if (insertAt === dragIndex || insertAt === dragIndex + 1) return;
    pushUndo();
    const curUid = state.pages[state.cur].uid;
    const [moved] = state.pages.splice(dragIndex, 1);
    if (insertAt > dragIndex) insertAt--;
    state.pages.splice(insertAt, 0, moved);
    state.cur = state.pages.findIndex(p => p.uid === curUid);
    state.dirty = true;
    refreshAll();
  });
}

function checkedPageUids() {
  return [...els.thumbList.querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => cb.dataset.uid);
}

/* ============================================================
 * 主頁面顯示
 * ============================================================ */
function gotoPage(i) {
  if (i < 0 || i >= state.pages.length) return;
  state.cur = i;
  state.selectedAnnot = null;
  renderMain();
  els.thumbList.querySelectorAll('.thumb').forEach((t, idx) =>
    t.classList.toggle('current', idx === i));
  updateToolbar();
}

async function renderMain() {
  const token = ++renderToken;
  if (currentRenderTask) { try { currentRenderTask.cancel(); } catch (e) {} currentRenderTask = null; }

  if (!state.pages.length) {
    els.emptyState.hidden = false;
    els.pageWrap.hidden = true;
    updateToolbar();
    return;
  }
  els.emptyState.hidden = true;
  els.pageWrap.hidden = false;

  const pg = state.pages[state.cur];
  const size = await displaySize(pg);
  if (token !== renderToken) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.round(size.w * state.zoom);
  const cssH = Math.round(size.h * state.zoom);
  els.canvas.width = Math.round(cssW * dpr);
  els.canvas.height = Math.round(cssH * dpr);
  els.canvas.style.width = cssW + 'px';
  els.canvas.style.height = cssH + 'px';
  els.pageStack.style.width = cssW + 'px';
  els.pageStack.style.height = cssH + 'px';

  const ctx = els.canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  if (pg.kind === 'src') {
    const pjPage = await getPjPage(pg);
    if (token !== renderToken) return;
    const vp = pjPage.getViewport({ scale: state.zoom * dpr, rotation: await totalRotation(pg) });
    const task = pjPage.render({ canvasContext: ctx, viewport: vp });
    currentRenderTask = task;
    try { await task.promise; } catch (e) { /* 被取消 */ }
    if (currentRenderTask === task) currentRenderTask = null;
  }
  if (token !== renderToken) return;
  renderAnnotLayer();
  updateToolbar();
}

/* ============================================================
 * 註記層
 * ============================================================ */
function renderAnnotLayer() {
  const layer = els.annotLayer;
  layer.innerHTML = '';
  layer.className = '';
  if (state.tool === 'text') layer.classList.add('tool-text');
  else if (state.tool === 'highlight' || state.tool === 'whiteout' || state.tool === 'replace') layer.classList.add('tool-draw');
  else layer.classList.add('tool-select');

  const pg = state.pages[state.cur];
  if (!pg) return;
  for (const a of pg.annots) layer.appendChild(buildAnnotEl(pg, a));
}

function buildAnnotEl(pg, a) {
  const z = state.zoom;
  const el = document.createElement('div');
  el.dataset.annotId = a.id;
  if (a.type === 'rect') {
    el.className = 'annot rect-' + a.mode;
    el.style.left = (a.x * z) + 'px';
    el.style.top = (a.y * z) + 'px';
    el.style.width = (a.w * z) + 'px';
    el.style.height = (a.h * z) + 'px';
  } else { // text
    el.className = 'annot text';
    el.style.left = (a.x * z) + 'px';
    el.style.top = (a.y * z) + 'px';
    el.style.width = (a.w * z) + 'px';
    el.style.minHeight = (a.h * z) + 'px';
    el.style.fontSize = (a.size * z) + 'px';
    el.style.padding = (TEXT_PAD * z) + 'px';
    el.style.color = a.color;
    el.style.fontFamily = fontStackOf(a);
    el.textContent = a.text;
  }
  if (isSelected(pg, a)) {
    el.classList.add('selected');
    const del = document.createElement('button');
    del.className = 'del-btn';
    del.textContent = '✕';
    del.title = '刪除這個註記';
    del.addEventListener('mousedown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAnnot(pg, a.id);
    });
    el.appendChild(del);
    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.title = '拖曳調整大小';
    el.appendChild(handle);
  }
  return el;
}

function isSelected(pg, a) {
  return state.selectedAnnot &&
    state.selectedAnnot.pageUid === pg.uid && state.selectedAnnot.annotId === a.id;
}

function removeAnnot(pg, annotId) {
  pushUndo();
  pg.annots = pg.annots.filter(x => x.id !== annotId);
  state.selectedAnnot = null;
  state.dirty = true;
  renderAnnotLayer();
}

function layerPos(e) {
  const r = els.annotLayer.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
}

/* --- 文字註記編輯 --- */
function startTextEdit(pg, a) {
  renderAnnotLayer();
  const el = els.annotLayer.querySelector(`[data-annot-id="${a.id}"]`);
  if (!el) return;
  // 編輯期間移除刪除鈕與縮放把手，避免它們的字元被讀進文字內容
  el.querySelectorAll('.del-btn, .handle').forEach(n => n.remove());
  el.contentEditable = 'true';
  el.focus();
  // 游標移到最後
  const sel = window.getSelection();
  sel.selectAllChildren(el);
  sel.collapseToEnd();

  const commit = () => {
    el.contentEditable = 'false';
    const text = el.innerText.replace(/\n$/, '');
    if (!text.trim()) {
      pg.annots = pg.annots.filter(x => x.id !== a.id);
      state.selectedAnnot = null;
    } else {
      a.text = text;
      a.h = Math.max(a.size * LINE_HEIGHT + TEXT_PAD * 2, el.scrollHeight / state.zoom);
      state.dirty = true;
    }
    renderAnnotLayer();
  };
  el.addEventListener('blur', commit, { once: true });
  el.addEventListener('input', () => {
    a.h = Math.max(a.size * LINE_HEIGHT + TEXT_PAD * 2, el.scrollHeight / state.zoom);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') el.blur();
    e.stopPropagation();
  });
}

/* --- 滑鼠互動：建立/選取/搬移/縮放註記 --- */
let drag = null; // {mode:'draw'|'move'|'resize', ...}

els.annotLayer.addEventListener('mousedown', (e) => {
  const pg = state.pages[state.cur];
  if (!pg) return;
  const pos = layerPos(e);

  if (state.tool === 'text') {
    pushUndo();
    const size = +els.fontSize.value;
    const a = {
      id: 'a' + (uidSeq++), type: 'text',
      x: pos.x, y: pos.y, w: 220, h: size * LINE_HEIGHT + TEXT_PAD * 2,
      size, color: els.fontColor.value, font: els.fontFamily.value, text: '',
    };
    pg.annots.push(a);
    state.selectedAnnot = { pageUid: pg.uid, annotId: a.id };
    setTool('select');
    startTextEdit(pg, a);
    e.preventDefault();
    return;
  }

  if (state.tool === 'highlight' || state.tool === 'whiteout' || state.tool === 'replace') {
    drag = { mode: 'draw', start: pos, tool: state.tool };
    e.preventDefault();
    return;
  }

  // select 工具
  const annotEl = e.target.closest('.annot');
  if (annotEl) {
    const a = pg.annots.find(x => x.id === annotEl.dataset.annotId);
    if (!a) return;
    state.selectedAnnot = { pageUid: pg.uid, annotId: a.id };
    if (a.type === 'text') {
      els.fontSize.value = a.size;
      els.fontColor.value = a.color;
      els.fontFamily.value = a.font || 'sans';
    }
    if (e.target.classList.contains('handle')) {
      drag = { mode: 'resize', a, start: pos, ow: a.w, oh: a.h, os: a.size, moved: false };
    } else {
      drag = { mode: 'move', a, start: pos, ox: a.x, oy: a.y, moved: false };
    }
    renderAnnotLayer();
    e.preventDefault();
  } else {
    state.selectedAnnot = null;
    renderAnnotLayer();
  }
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const pg = state.pages[state.cur];
  if (!pg) return;
  const pos = layerPos(e);

  if (drag.mode === 'draw') {
    const x = Math.min(drag.start.x, pos.x), y = Math.min(drag.start.y, pos.y);
    const w = Math.abs(pos.x - drag.start.x), h = Math.abs(pos.y - drag.start.y);
    Object.assign(els.rubber.style, {
      left: x * state.zoom + 'px', top: y * state.zoom + 'px',
      width: w * state.zoom + 'px', height: h * state.zoom + 'px',
    });
    els.rubber.hidden = false;
    drag.rect = { x, y, w, h };
  } else if (drag.mode === 'move') {
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    drag.a.x = drag.ox + (pos.x - drag.start.x);
    drag.a.y = drag.oy + (pos.y - drag.start.y);
    positionAnnotEl(drag.a);
  } else if (drag.mode === 'resize') {
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    if (drag.a.type === 'text') {
      // 拖曳右下角＝等比例縮放文字
      const factor = Math.max(0.1, (drag.ow + (pos.x - drag.start.x)) / drag.ow);
      drag.a.w = Math.max(24, drag.ow * factor);
      drag.a.size = Math.min(200, Math.max(6, Math.round(drag.os * factor)));
      els.fontSize.value = drag.a.size;
    } else {
      drag.a.w = Math.max(12, drag.ow + (pos.x - drag.start.x));
      drag.a.h = Math.max(8, drag.oh + (pos.y - drag.start.y));
    }
    positionAnnotEl(drag.a);
  }
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const pg = state.pages[state.cur];
  if (drag.mode === 'draw' && pg) {
    els.rubber.hidden = true;
    if (drag.rect && drag.rect.w > 4 && drag.rect.h > 4) {
      if (drag.tool === 'replace') {
        handleReplace(pg, drag.rect);
      } else {
        pushUndo();
        pg.annots.push({
          id: 'a' + (uidSeq++), type: 'rect',
          mode: drag.tool, ...drag.rect,
        });
        state.dirty = true;
        renderAnnotLayer();
      }
    }
  } else if (drag.moved) {
    state.dirty = true;
    if (drag.mode === 'resize' && drag.a.type === 'text') {
      // 寬度改變後重新計算高度
      renderAnnotLayer();
      const el = els.annotLayer.querySelector(`[data-annot-id="${drag.a.id}"]`);
      if (el) drag.a.h = Math.max(drag.a.size * LINE_HEIGHT + TEXT_PAD * 2, el.scrollHeight / state.zoom);
    }
    renderAnnotLayer();
  }
  drag = null;
});

els.annotLayer.addEventListener('dblclick', (e) => {
  if (state.tool !== 'select') return;
  const pg = state.pages[state.cur];
  const annotEl = e.target.closest('.annot.text');
  if (!pg || !annotEl) return;
  const a = pg.annots.find(x => x.id === annotEl.dataset.annotId);
  if (!a) return;
  pushUndo();
  state.selectedAnnot = { pageUid: pg.uid, annotId: a.id };
  startTextEdit(pg, a);
});

function positionAnnotEl(a) {
  const el = els.annotLayer.querySelector(`[data-annot-id="${a.id}"]`);
  if (!el) return;
  const z = state.zoom;
  el.style.left = a.x * z + 'px';
  el.style.top = a.y * z + 'px';
  el.style.width = a.w * z + 'px';
  if (a.type === 'rect') {
    el.style.height = a.h * z + 'px';
  } else {
    el.style.minHeight = a.h * z + 'px';
    el.style.fontSize = a.size * z + 'px';
  }
}

/* ============================================================
 * 頁面操作
 * ============================================================ */
function targetPages() {
  const uids = checkedPageUids();
  if (uids.length) return uids;
  return state.pages.length ? [state.pages[state.cur].uid] : [];
}

async function addBlankPage() {
  if (!state.pages.length) return;
  pushUndo();
  const cur = state.pages[state.cur];
  let w = 595, h = 842; // A4 直式（pt）
  if (cur) {
    const size = await displaySize(cur);
    w = size.w; h = size.h;
  }
  const pg = { uid: 'p' + (uidSeq++), kind: 'blank', srcId: null, srcIdx: -1, rot: 0, w, h, annots: [] };
  state.pages.splice(state.cur + 1, 0, pg);
  state.dirty = true;
  state.cur++;
  refreshAll();
}

function deletePages() {
  const uids = new Set(targetPages());
  if (!uids.size) return;
  if (uids.size >= state.pages.length) {
    if (!confirm('這樣會刪掉所有頁面，整份文件會清空。確定嗎？')) return;
  } else if (uids.size > 1) {
    if (!confirm(`確定要刪除 ${uids.size} 頁嗎？`)) return;
  }
  pushUndo();
  const curUid = state.pages[state.cur] ? state.pages[state.cur].uid : null;
  state.pages = state.pages.filter(p => !uids.has(p.uid));
  let idx = state.pages.findIndex(p => p.uid === curUid);
  if (idx < 0) idx = Math.min(state.cur, state.pages.length - 1);
  state.cur = Math.max(0, idx);
  state.dirty = true;
  refreshAll();
}

async function rotatePages() {
  const uids = new Set(targetPages());
  if (!uids.size) return;
  pushUndo();
  for (const pg of state.pages) {
    if (!uids.has(pg.uid)) continue;
    const before = await displaySize(pg);
    if (pg.kind === 'blank') {
      [pg.w, pg.h] = [pg.h, pg.w];
    } else {
      pg.rot = (pg.rot + 90) % 360;
    }
    // 順時針轉 90°：把註記座標跟著轉，讓它們留在頁面上原本的位置
    for (const a of pg.annots) {
      const { x, y, w, h } = a;
      if (a.type === 'rect') {
        a.x = before.h - y - h;
        a.y = x;
        a.w = h;
        a.h = w;
      } else {
        // 文字註記：只移動錨點，框保持橫向可讀；並收斂在新頁面範圍內
        a.x = Math.max(0, Math.min(before.h - y - h, before.h - a.w));
        a.y = Math.max(0, Math.min(x, before.w - a.h));
      }
    }
  }
  state.dirty = true;
  refreshAll();
}

/* ============================================================
 * ✏️ 取代文字：框選原文 → 自動蓋白 → 帶入原文/字級/字體/顏色直接改
 * ============================================================ */

/* 讀出頁面所有文字片段（scale1 顯示座標），並猜測字體分類 */
async function getTextItems(pg) {
  const src = state.sources[pg.srcId];
  if (!src.textCache) src.textCache = new Map();
  const key = pg.srcIdx + ':' + pg.rot;
  if (src.textCache.has(key)) return src.textCache.get(key);

  const pjPage = await getPjPage(pg);
  const vp = pjPage.getViewport({ scale: 1, rotation: await totalRotation(pg) });
  const tc = await pjPage.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const m = it.transform; // PDF 使用者空間
    const fh = Math.hypot(m[2], m[3]) || 10;
    // 以基線推出文字方塊（上緣約 0.85 個字高、下緣約 0.22）
    const p1 = vp.convertToViewportPoint(m[4], m[5] - fh * 0.22);
    const p2 = vp.convertToViewportPoint(m[4] + it.width, m[5] + fh * 0.85);
    const rect = {
      x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
      w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]),
    };
    let font = 'sans';
    const style = tc.styles && tc.styles[it.fontName];
    if (style && style.fontFamily === 'serif') font = 'serif';
    try {
      // 渲染後可從 commonObjs 取得內嵌字型的真實名稱，做更準的判斷
      const fobj = pjPage.commonObjs.get(it.fontName);
      const nm = (fobj && fobj.name) || '';
      if (/kai|biaukai|dfkai|楷/i.test(nm)) font = 'kai';
      else if (/ming|sung|song|serif|times|georgia|roman|garamond|明|宋/i.test(nm)) font = 'serif';
    } catch (e) { /* 字型物件尚未載入就用啟發式結果 */ }
    items.push({ str: it.str, rect, size: fh, font });
  }
  src.textCache.set(key, items);
  return items;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* 把命中的文字片段串回多行文字 */
function joinMatchedText(ms) {
  let out = '', lastY = null, lastH = 12;
  for (const m of ms) {
    if (lastY !== null && Math.abs(m.rect.y - lastY) > lastH * 0.5) {
      out += '\n';
    } else if (out && /[A-Za-z0-9)]$/.test(out) && /^[A-Za-z0-9(]/.test(m.str)) {
      out += ' ';
    }
    out += m.str;
    lastY = m.rect.y; lastH = m.rect.h;
  }
  return out;
}

/* 從目前渲染好的畫布取樣文字顏色（優先取深色像素的平均） */
function sampleTextColor(rect) {
  try {
    const k = (window.devicePixelRatio || 1) * state.zoom;
    const x = Math.max(0, Math.round(rect.x * k));
    const y = Math.max(0, Math.round(rect.y * k));
    const w = Math.min(els.canvas.width - x, Math.round(rect.w * k));
    const h = Math.min(els.canvas.height - y, Math.round(rect.h * k));
    if (w < 1 || h < 1) return null;
    const data = els.canvas.getContext('2d').getImageData(x, y, w, h).data;
    const acc = { dark: [0, 0, 0, 0], any: [0, 0, 0, 0] };
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
      const colorful = Math.max(R, G, B) - Math.min(R, G, B) > 40;
      if (lum < 140 || (colorful && lum < 200)) {
        acc.dark[0] += R; acc.dark[1] += G; acc.dark[2] += B; acc.dark[3]++;
      } else if (lum < 235) {
        acc.any[0] += R; acc.any[1] += G; acc.any[2] += B; acc.any[3]++;
      }
    }
    const use = acc.dark[3] > 8 ? acc.dark : (acc.any[3] > 8 ? acc.any : null);
    if (!use) return null;
    const hex = (v) => Math.round(v / use[3]).toString(16).padStart(2, '0');
    return '#' + hex(use[0]) + hex(use[1]) + hex(use[2]);
  } catch (e) { return null; }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function handleReplace(pg, rect) {
  pushUndo();
  let matches = [];
  if (pg.kind === 'src') {
    try { matches = (await getTextItems(pg)).filter(it => rectsOverlap(it.rect, rect)); }
    catch (e) { matches = []; }
  }

  let cover = { ...rect };
  let size = clampFontSize(+els.fontSize.value);
  let color = '#000000';
  let font = els.fontFamily.value;
  let text = '';
  if (matches.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const m of matches) {
      x1 = Math.min(x1, m.rect.x); y1 = Math.min(y1, m.rect.y);
      x2 = Math.max(x2, m.rect.x + m.rect.w); y2 = Math.max(y2, m.rect.y + m.rect.h);
    }
    cover = { x: x1 - 1.5, y: y1 - 1.5, w: x2 - x1 + 3, h: y2 - y1 + 3 };
    size = clampFontSize(median(matches.map(m => m.size)));
    font = matches[0].font;
    text = joinMatchedText(matches);
    color = sampleTextColor({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }) || '#000000';
  }

  pg.annots.push({ id: 'a' + (uidSeq++), type: 'rect', mode: 'whiteout', ...cover });
  // 替換的字常比原文長：框寬給到原文的 1.6 倍 + 60，但不超出頁面右緣
  const pageW = (await displaySize(pg)).w;
  const a = {
    id: 'a' + (uidSeq++), type: 'text',
    x: cover.x, y: cover.y - TEXT_PAD,
    w: Math.max(120, Math.min(pageW - cover.x - 6, cover.w * 1.6 + 60)),
    h: Math.max(size * LINE_HEIGHT + TEXT_PAD * 2, cover.h),
    size, color, font, text,
  };
  pg.annots.push(a);
  state.dirty = true;
  state.selectedAnnot = { pageUid: pg.uid, annotId: a.id };
  els.fontSize.value = size;
  els.fontColor.value = color;
  els.fontFamily.value = font;
  setTool('select');
  startTextEdit(pg, a);
}

/* ============================================================
 * 匯出（pdf-lib）
 * ============================================================ */

/* 顯示座標（scale1、目前旋轉）矩形 -> PDF 使用者空間矩形 */
async function rectToPdf(pg, x, y, w, h) {
  if (pg.kind === 'blank') {
    return { x, y: pg.h - y - h, w, h };
  }
  const pjPage = await getPjPage(pg);
  const vp = pjPage.getViewport({ scale: 1, rotation: await totalRotation(pg) });
  const [x1, y1] = vp.convertToPdfPoint(x, y);
  const [x2, y2] = vp.convertToPdfPoint(x + w, y + h);
  return {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
  };
}

/* 文字排版：逐字換行（與 CSS word-break:break-all 對應） */
function layoutTextLines(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of text.split('\n')) {
    if (!raw) { lines.push(''); continue; }
    let line = '';
    for (const ch of raw) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

/* 把文字註記畫成透明 PNG（瀏覽器負責中文字型，PDF 不必內嵌字型） */
function textAnnotToCanvas(a, sf) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(a.w * sf));
  canvas.height = Math.max(1, Math.round(a.h * sf));
  const ctx = canvas.getContext('2d');
  ctx.font = `${a.size * sf}px ${fontStackOf(a)}`;
  ctx.fillStyle = a.color;
  ctx.textBaseline = 'top';
  const pad = TEXT_PAD * sf;
  const lines = layoutTextLines(ctx, a.text, canvas.width - pad * 2);
  const lh = a.size * LINE_HEIGHT * sf;
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lh));
  return canvas;
}

/* 把 canvas 內容逆時針旋轉 deg（90 的倍數），
 * 抵銷頁面的顯示旋轉，讓文字在旋轉頁上仍然正立 */
function rotateCanvasCCW(canvas, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (deg === 0) return canvas;
  const out = document.createElement('canvas');
  if (deg === 180) { out.width = canvas.width; out.height = canvas.height; }
  else { out.width = canvas.height; out.height = canvas.width; }
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(-deg * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('PNG 轉換失敗'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

async function exportPdf() {
  const { PDFDocument, degrees, rgb, BlendMode } = PDFLib;
  const out = await PDFDocument.create();

  for (const pg of state.pages) {
    let libPage;
    if (pg.kind === 'blank') {
      libPage = out.addPage([pg.w, pg.h]);
    } else {
      const src = state.sources[pg.srcId];
      if (!src.libdoc) {
        src.libdoc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
      }
      const [cp] = await out.copyPages(src.libdoc, [pg.srcIdx]);
      libPage = out.addPage(cp);
      if (pg.rot) {
        const base = libPage.getRotation().angle || 0;
        libPage.setRotation(degrees((base + pg.rot) % 360));
      }
    }

    const rotDeg = await totalRotation(pg);
    for (const a of pg.annots) {
      const r = await rectToPdf(pg, a.x, a.y, a.w, a.h);
      if (a.type === 'rect') {
        const isHi = a.mode === 'highlight';
        libPage.drawRectangle({
          x: r.x, y: r.y, width: r.w, height: r.h,
          color: isHi ? rgb(1, 0.92, 0.23) : rgb(1, 1, 1),
          opacity: isHi ? (BlendMode ? 1 : 0.4) : 1,
          ...(isHi && BlendMode ? { blendMode: BlendMode.Multiply } : {}),
        });
      } else if (a.type === 'text' && a.text.trim()) {
        const sf = 3; // 高解析輸出
        let canvas = textAnnotToCanvas(a, sf);
        canvas = rotateCanvasCCW(canvas, rotDeg);
        const png = await out.embedPng(await canvasToPngBytes(canvas));
        libPage.drawImage(png, { x: r.x, y: r.y, width: r.w, height: r.h });
      }
    }
  }
  return out.save();
}

async function savePdf() {
  if (!state.pages.length) return;
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = '⏳ 產生中…';
  try {
    const bytes = await exportPdf();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.docName + '-編輯版.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    state.dirty = false;
  } catch (err) {
    alert('儲存失敗：' + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 儲存 PDF';
    updateToolbar();
  }
}

/* ============================================================
 * 工具列 / 快捷鍵 / 事件
 * ============================================================ */
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('#toolGroup .tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  renderAnnotLayer();
}

function setZoom(z) {
  state.zoom = Math.min(4, Math.max(0.4, z));
  els.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  renderMain();
}

async function fitWidth() {
  const pg = state.pages[state.cur];
  if (!pg) return;
  const size = await displaySize(pg);
  const avail = els.viewer.clientWidth - 64;
  setZoom(avail / size.w);
}

function updateToolbar() {
  const has = state.pages.length > 0;
  for (const id of ['btnImport', 'btnSave', 'btnAddBlank', 'btnRotate', 'btnDelete',
                    'btnZoomIn', 'btnZoomOut', 'btnFit', 'btnPrev', 'btnNext']) {
    $(id).disabled = !has;
  }
  $('btnUndo').disabled = !state.undoStack.length;
  if (has) {
    $('btnPrev').disabled = state.cur === 0;
    $('btnNext').disabled = state.cur >= state.pages.length - 1;
    els.pageLabel.textContent = (state.cur + 1) + ' / ' + state.pages.length;
  } else {
    els.pageLabel.textContent = '– / –';
  }
}

let flashTimer = null;
function setStatusFlash(msg) {
  clearTimeout(flashTimer);
  const el = $('sidebarHint');
  el.textContent = msg;
  flashTimer = setTimeout(() => { el.textContent = '縮圖可拖曳調整頁面順序'; }, 5000);
}

function refreshAll() {
  renderThumbs();
  renderMain();
  updateToolbar();
}

/* --- 事件繫結 --- */
$('btnOpen').addEventListener('click', () => {
  if (state.dirty && !confirm('目前文件有尚未儲存的編輯，開新檔案會遺失。要繼續嗎？')) return;
  els.fileOpen.click();
});
$('btnImport').addEventListener('click', () => els.fileImport.click());
$('btnSave').addEventListener('click', savePdf);
$('btnUndo').addEventListener('click', undo);
$('btnAddBlank').addEventListener('click', addBlankPage);
$('btnRotate').addEventListener('click', rotatePages);
$('btnDelete').addEventListener('click', deletePages);
$('btnZoomIn').addEventListener('click', () => setZoom(state.zoom + 0.25));
$('btnZoomOut').addEventListener('click', () => setZoom(state.zoom - 0.25));
$('btnFit').addEventListener('click', fitWidth);
$('btnPrev').addEventListener('click', () => gotoPage(state.cur - 1));
$('btnNext').addEventListener('click', () => gotoPage(state.cur + 1));
document.querySelectorAll('#toolGroup .tool').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

function clampFontSize(v) {
  return Math.min(200, Math.max(6, Math.round(v) || 16));
}

/* 套用字級到選取中的文字註記（沒有選取時只改預設值） */
function applyFontSize(size) {
  size = clampFontSize(size);
  els.fontSize.value = size;
  const sel = getSelectedTextAnnot();
  if (!sel) return;
  pushUndo();
  sel.a.size = size;
  state.dirty = true;
  renderAnnotLayer();
  // 字級變了，高度跟著重新計算
  const el = els.annotLayer.querySelector(`[data-annot-id="${sel.a.id}"]`);
  if (el) {
    sel.a.h = Math.max(size * LINE_HEIGHT + TEXT_PAD * 2, el.scrollHeight / state.zoom);
    renderAnnotLayer();
  }
}

els.fontSize.addEventListener('change', () => applyFontSize(+els.fontSize.value));
$('fontMinus').addEventListener('click', () => applyFontSize(+els.fontSize.value - 2));
$('fontPlus').addEventListener('click', () => applyFontSize(+els.fontSize.value + 2));
els.fontColor.addEventListener('change', () => {
  const sel = getSelectedTextAnnot();
  if (sel) {
    pushUndo();
    sel.a.color = els.fontColor.value;
    state.dirty = true;
    renderAnnotLayer();
  }
});
$('fontFamily').addEventListener('change', () => {
  const sel = getSelectedTextAnnot();
  if (sel) {
    pushUndo();
    sel.a.font = $('fontFamily').value;
    state.dirty = true;
    renderAnnotLayer();
  }
});
function getSelectedTextAnnot() {
  if (!state.selectedAnnot) return null;
  const pg = state.pages.find(p => p.uid === state.selectedAnnot.pageUid);
  if (!pg) return null;
  const a = pg.annots.find(x => x.id === state.selectedAnnot.annotId);
  return a && a.type === 'text' ? { pg, a } : null;
}

els.fileOpen.addEventListener('change', (e) => {
  if (e.target.files[0]) openFile(e.target.files[0]);
  e.target.value = '';
});
els.fileImport.addEventListener('change', (e) => {
  if (e.target.files[0]) importFile(e.target.files[0]);
  e.target.value = '';
});
els.dropCard.addEventListener('click', () => els.fileOpen.click());

/* 拖放整個視窗 */
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    els.dropCard.classList.add('dragging');
  }
});
window.addEventListener('dragleave', () => els.dropCard.classList.remove('dragging'));
window.addEventListener('drop', (e) => {
  els.dropCard.classList.remove('dragging');
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const file = [...e.dataTransfer.files].find(f => /\.pdf$/i.test(f.name));
  if (!file) return;
  if (state.pages.length) importFile(file);
  else openFile(file);
});

/* 快捷鍵 */
window.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); savePdf(); return; }
  if (e.key === 'ArrowLeft') gotoPage(state.cur - 1);
  else if (e.key === 'ArrowRight') gotoPage(state.cur + 1);
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedAnnot) {
      const pg = state.pages.find(p => p.uid === state.selectedAnnot.pageUid);
      if (pg) { e.preventDefault(); removeAnnot(pg, state.selectedAnnot.annotId); }
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

updateToolbar();
