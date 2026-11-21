// 互評工具連線設定。這把 publishable key 本來就是公開用的（等同網頁上的門牌），
// 真正的保護在資料庫的權限規則：學生只能透過檢查過的函式送出評分，看不到任何分數。
window.PEER_CONFIG = {
  supabaseUrl: 'https://pqedztnyztqixieehzew.supabase.co',
  supabaseKey: 'sb_publishable_tXVmTR-jby9msRQUJ2gfbw_nSuARd1a',
  // 給學生的網址（QR code、紙條用）。放在 Vercel，不顯示 GitHub 網址
  studentUrl: 'https://reviewclass-group.vercel.app/',
};
