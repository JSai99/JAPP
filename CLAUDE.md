# JAPP 工具箱 — 給 Claude 的專案說明

Jessica 的個人小工具集。使用者稱呼 Claude 為「JARVIS」，以繁體中文溝通。

## 架構（monorepo）

- 一個工具 = 一個頂層資料夾，英文 kebab-case（例：`pdf-studio/`），內含自己的 `index.html`、`README.md`
- 新工具要在根目錄 `index.html` 入口頁加一張卡片，並更新根 `README.md` 的工具清單
- 共用函式庫放 `shared/vendor/`，工具用相對路徑引用（`../shared/vendor/...`）
- 純靜態網頁、零建置流程、零後端；使用者的檔案只在瀏覽器內處理，不上傳任何地方——這是核心承諾，不要破壞
- 需要第三方函式庫時下載到 `shared/vendor/`（沙箱網路擋 CDN，可用 `npm pack` 從 npm registry 取得），不要在網頁中引用 CDN

## 部署

- `main` 有更新時，`.github/workflows/deploy-pages.yml` 自動部署到 GitHub Pages：https://jsai99.github.io/JAPP/
- 所有路徑必須是相對路徑（網站在 `/JAPP/` 子路徑下）
- 沙箱環境的代理會擋 `*.github.io`，無法直接連到上線網站驗證；改看 Actions 部署日誌，或請使用者開網址確認

## Git 慣例

- **commit 信箱一律用匿名信箱** `274424221+JSai99@users.noreply.github.com`（repo 為公開，絕不可寫入使用者的真實信箱）
- 在功能分支開發，推上後開 draft PR，由使用者合併
- 開發前從最新的 `origin/main` 起分支

## 開發習慣

- 先上網研究前人做法、查證事實並附來源，再動手（使用者重視這點）
- 改完用 Playwright 實測（Chromium 在 `/opt/pw-browsers/chromium`），截圖目視確認，不只看程式碼
- 本機測試：在 repo 根目錄 `python3 -m http.server`，開 `http://127.0.0.1:<port>/<tool>/index.html`
