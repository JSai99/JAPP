# JAPP 工具箱 🧰

自己動手做的小工具集——純瀏覽器端、免安裝、免訂閱，**檔案完全不離開你的電腦**。

🌐 **線上直接用（免下載）**：<https://jsai99.github.io/JAPP/>
（由 GitHub Actions 自動部署，`main` 分支每次更新後約 1–2 分鐘生效）

## 工具清單

| 工具 | 說明 | 入口 |
|---|---|---|
| 📝 [同儕互評](peer-review/) | 組間／組內互評：學生手機掃碼評分，老師自訂面向、看進度、算成績、匯出 Excel。**唯一有後端的工具**（資料存在老師自己的 Supabase） | [`peer-review/admin.html`](peer-review/admin.html)（老師）・[`peer-review/index.html`](peer-review/index.html)（學生） |
| 🎡 [課堂轉盤](class-wheel/) | 隨機抽人（轉盤／拉霸）、依性別或系級平均分組、抽組長；多班名單、音效彩帶，適合投影 | [`class-wheel/index.html`](class-wheel/index.html) |

### 已封存

| 工具 | 說明 |
|---|---|
| 📄 [PDF 工作室](pdf-studio/) | 已有更完整的開源替代品 [PDFCraft](https://github.com/PDFCraftTool/pdfcraft)（同樣在瀏覽器內處理、不上傳），因此不再維護，入口頁已移除。程式碼保留在資料夾內，網址仍可開啟。 |

## 使用方式

1. 下載整個專案（`Code` → `Download ZIP`，解壓縮）
2. 雙擊根目錄的 `index.html` 打開工具入口頁（建議用 Chrome 或 Edge）
3. 點選想用的工具

> 也可以直接雙擊各工具資料夾內的 `index.html`。若日後開啟 GitHub Pages，每個工具都會有自己的網址，免下載直接用。

## 專案結構（monorepo）

```
JAPP/
├── index.html        # 工具入口頁
├── shared/vendor/    # 共用開源函式庫（pdf.js、pdf-lib、supabase-js、qrcode-generator）
├── pdf-studio/       # 📄 PDF 工作室（已封存）
├── peer-review/      # 📝 同儕互評（含自己的 README）
├── class-wheel/      # 🎡 課堂轉盤（含自己的 README）
└── （未來的小工具，一個資料夾一個工具）
```

約定：

- **一個工具 = 一個頂層資料夾**，英文短名（kebab-case），內含自己的 `index.html` 與 `README.md`
- 共用資源（函式庫、字型等）放 `shared/`
- 純靜態網頁、零建置流程；某個工具長大後可「畢業」搬到獨立 repo

## 授權

本專案以 [MIT License](LICENSE) 釋出——歡迎自由使用、修改、散布。

內含的開源函式庫沿用其原始授權：[pdf.js](https://mozilla.github.io/pdf.js/)（Apache-2.0）、[pdf-lib](https://pdf-lib.js.org/)（MIT）、[supabase-js](https://github.com/supabase/supabase-js)（MIT）、[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT）。
