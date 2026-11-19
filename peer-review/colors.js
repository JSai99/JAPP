// 組別色塊：依組別順序配色，學生頁與老師後台共用，確保同一組在各畫面顏色一致
window.GROUP_COLORS = ['#4f9f8c', '#cf5a50', '#5b9a68', '#dfa23f', '#5068d4', '#8a5bc2', '#cf5f8e', '#3a95bf', '#a5774b', '#5f7d8c'];
window.groupColor = (pos) => GROUP_COLORS[((pos || 0) % GROUP_COLORS.length + GROUP_COLORS.length) % GROUP_COLORS.length];
window.groupChip = (name, pos, extra = '') =>
  `<span class="gchip ${extra}" style="background:${groupColor(pos)}">${String(name ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</span>`;
