# JAPP 工具箱 🧰

自己動手做的小工具集——純瀏覽器端、免安裝、免訂閱，**檔案完全不離開你的電腦**。

🌐 **線上直接用（免下載）**：<https://jsai99.github.io/JAPP/>
（由 GitHub Actions 自動部署，`main` 分支每次更新後約 1–2 分鐘生效）

## 工具清單

| 工具 | 說明 | 入口 |
|---|---|---|
| 📄 [PDF 工作室](pdf-studio/) | PDF 閱讀、註記（文字/螢光筆/修正帶）、取代原文、關鍵字搜尋、頁面增刪旋轉排序、多檔合併、另存新檔 | [`pdf-studio/index.html`](pdf-studio/index.html) |

## 使用方式

1. 下載整個專案（`Code` → `Download ZIP`，解壓縮）
2. 雙擊根目錄的 `index.html` 打開工具入口頁（建議用 Chrome 或 Edge）
3. 點選想用的工具

> 也可以直接雙擊各工具資料夾內的 `index.html`。若日後開啟 GitHub Pages，每個工具都會有自己的網址，免下載直接用。

## 專案結構（monorepo）

```
JAPP/
├── index.html        # 工具入口頁
├── shared/vendor/    # 共用開源函式庫（pdf.js、pdf-lib）
├── pdf-studio/       # 📄 PDF 工作室（含自己的 README）
└── （未來的小工具，一個資料夾一個工具）
```

約定：

- **一個工具 = 一個頂層資料夾**，英文短名（kebab-case），內含自己的 `index.html` 與 `README.md`
- 共用資源（函式庫、字型等）放 `shared/`
- 純靜態網頁、零建置流程；某個工具長大後可「畢業」搬到獨立 repo
