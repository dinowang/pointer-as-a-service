# 靜態 HTML 遷移可行性評估

## 背景

現行架構使用 ASP.NET Core MVC 提供 Razor Views，搭配 Azure SignalR Service 進行即時通訊。評估是否可以用 **Static HTML + JavaScript** 取代 ASP.NET Core MVC，並部署至 **GitHub Pages**。

## 現行伺服器端功能盤點

| 功能 | 現行實作 | 可否移至前端 |
|---|---|---|
| Token 生成（URL-safe Base64 GUID） | `IdService.cs`（伺服器端） | ✅ JavaScript `crypto.randomUUID()` 即可 |
| 路由 `/{id?}` → 自動生成 Token 並 Redirect | `HomeController.Index` | ✅ 前端 JS 判斷 URL 參數，無 ID 則自動生成 |
| 路由 `/control/{id}` → 渲染遙控器頁面 | `HomeController.Control` | ✅ 靜態 HTML + JS 從 URL 讀取 ID |
| `/refresh` API → 生成新 Token 並回傳 JSON | `HomeController.Refresh` | ✅ 前端 JS 直接生成，不需 API |
| Theme Cookie 讀取 → 伺服器端 Razor 渲染 | `_Layout.cshtml` | ✅ 前端 JS 讀取 Cookie/localStorage |
| SignalR Hub（群組管理、指令轉發） | `RemoteHub.cs` | ⚠️ 需要後端 — 見下方分析 |

**結論**：除 SignalR Hub 外，所有伺服器端邏輯都可移至前端 JavaScript。

## SignalR 的處理方案

SignalR Hub 是唯一無法純前端實現的部分，以下為三個可行方案：

### 方案 A：Azure SignalR Service（Serverless 模式）+ Azure Functions

GitHub Pages 託管靜態前端，Azure Functions 提供 SignalR negotiate 端點與訊息路由。

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ GitHub Pages │────▶│ Azure Functions   │────▶│ Azure SignalR Service│
│ (靜態 HTML)  │     │ (negotiate + Hub) │     │ (Serverless 模式)    │
└─────────────┘     └──────────────────┘     └─────────────────────┘
```

**Azure Functions 需實作**：
- `negotiate` — 回傳 SignalR 連線資訊（access token + URL）
- `JoinGroup` / `LeaveGroup` — 群組管理（透過 SignalR Service REST API）
- `SendCommand` — 接收 Controller 指令，轉發至群組

**優點**：
- 前端完全靜態，可部署於 GitHub Pages
- Azure Functions 消費方案有免費額度（每月 100 萬次呼叫）
- Azure SignalR Service 免費層（每日 20,000 訊息）已足夠

**限制**：
- 前端需引入 SignalR JavaScript SDK（~50KB）
- 仍需 Azure Functions 作為後端（非純靜態）
- 需設定 CORS 允許 GitHub Pages 網域
- Azure Functions 消費方案有冷啟動延遲（~1-3 秒）

### 方案 A2：Azure Web PubSub（Client Protocol）+ Azure Static Web Apps ⭐ 推薦

利用 Azure Web PubSub 的 **Client Protocol（`json.webpubsub.azure.v1`）**，客戶端可直接加入群組、發送群組訊息，**伺服器完全不參與訊息路由**。後端僅需一個 `negotiate` 端點產生 access token。

搭配 **Azure Static Web Apps**，前端與 API 合併為同一個 Git Repository，`git push` 一次即同時部署靜態檔案與 API。開發體驗上幾乎等同「沒有獨立的 Azure Functions」。

```
┌──────────────────────────────────────┐
│     Azure Static Web Apps            │
│  ┌────────────┐  ┌────────────────┐  │     ┌───────────────────┐
│  │ 靜態 HTML   │  │ /api/negotiate │──┼────▶│ Azure Web PubSub  │
│  │ (前端)      │  │ (內建 Function)│  │     │ (Client Protocol) │
│  └────────────┘  └────────────────┘  │     └───────────────────┘
└──────────────────────────────────────┘           ▲
                                                   │ 直接 WebSocket
                                            ┌──────┴──────┐
                                            │ Host / Ctrl  │
                                            │ (瀏覽器客戶端)│
                                            └─────────────┘
```

**關鍵：Client Protocol 讓客戶端自主操作群組**

```javascript
// 前端 — 取得 negotiate URL 後直接連線
const res = await fetch('/api/negotiate');
const { url } = await res.json();

const client = new WebPubSubClient(url);
await client.start();

// 客戶端直接加入群組 — 不經伺服器
await client.joinGroup(token);

// 客戶端直接發送群組訊息 — 不經伺服器
await client.sendToGroup(token, { type: 'N ext' }, 'json');

// 接收群組訊息
client.on('group-message', (e) => {
  const cmd = e.message.data;
  // 處理 First / Prev / Next 等指令
});
```

**Azure Functions 僅需 1 個函式**：

```javascript
// /api/negotiate — 產生帶有群組權限的 client access URL
const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const client = new WebPubSubServiceClient(
  process.env.WEB_PUBSUB_CONNECTION_STRING, 'pointer'
);

module.exports = async function (context, req) {
  const token = req.query.id || crypto.randomUUID();
  const clientUrl = await client.getClientAccessUrl({
    roles: [
      `webpubsub.joinLeaveGroup.${token}`,
      `webpubsub.sendToGroup.${token}`
    ]
  });
  context.res = { body: { url: clientUrl, token } };
};
```

**與方案 A（原 Azure Functions 3-4 個函式）的差異**：

| 項目 | 方案 A（舊） | 方案 A2（新） |
|---|---|---|
| Azure Functions 數量 | 3-4 個（negotiate + 訊息路由 + 事件處理） | **1 個**（僅 negotiate） |
| 訊息路由 | 伺服器轉發 | **客戶端直接群組通訊** |
| 群組管理 | 伺服器 REST API | **客戶端 Client Protocol** |
| 部署方式 | 前端 + Functions 分開部署 | **Azure Static Web Apps 一次部署** |
| 獨立 Function App | 需要 | **不需要**（內建於 Static Web Apps） |

**優點**：
- **近乎無後端**：僅 1 個 negotiate 函式，且內嵌於 Azure Static Web Apps，無獨立 Function App
- `git push` 一次部署前端 + API，與 GitHub Pages 體驗相當
- 客戶端直接透過 Web PubSub 通訊，伺服器不在訊息路徑上
- 免費層：Static Web Apps 免費 + Web PubSub 免費層 = **$0**
- 前端可使用官方 `@azure/web-pubsub-client` SDK（~15KB gzipped），內建自動重連

**限制**：
- 從 GitHub Pages 改為 Azure Static Web Apps（同為靜態託管，但換了平台）
- Client Protocol 需使用 `json.webpubsub.azure.v1` 子協定
- 綁定 Azure 平台

**成本估算**：

| 資源 | 方案 | 預估月成本 |
|---|---|---|
| Azure Static Web Apps | 免費方案（含內建 API） | $0 |
| Azure Web PubSub | 免費層 | $0 |
| **合計** | | **$0** |

> **為何不能完全消除伺服器端？**
> Access token 必須由持有 connection string 的可信端點產生。但透過 Azure Static Web Apps 的內建 API，這個端點與靜態前端合為一體，開發與部署體驗上等同純靜態。

### 方案 B：自建 WebSocket 中繼服務（Minimal API）

以極簡的 .NET Minimal API 或 Node.js 提供 WebSocket 中繼，前端靜態檔案可部署於 GitHub Pages 或與 API 同主機。

**優點**：
- 零 Azure 依賴
- 完全自主掌控

**限制**：
- 需維運一台伺服器（VPS、Container 等）
- 需自行實作群組管理與重連
- GitHub Pages 前端需跨域連接至 WebSocket 伺服器

### 方案 C：WebRTC DataChannel（P2P）

前端透過 WebRTC 建立點對點連線，僅需極簡的 Signaling Server 交換 SDP。

**優點**：
- 連線建立後完全 P2P，無伺服器中繼
- Signaling 可用 GitHub Gist 或其他靜態方式模擬（實驗性）

**限制**：
- Office Add-in WebView 的 WebRTC 支援不穩定
- 仍需 Signaling Server（無法完全 GitHub Pages only）
- NAT 穿越問題

## GitHub Pages 部署可行性

### ✅ 可行的部分

- 靜態 HTML/CSS/JavaScript 檔案託管
- 自訂網域（CNAME）
- HTTPS 自動支援
- SPA 路由（透過 `404.html` hack 或 hash-based routing）

### ⚠️ 需注意的限制

| 限制 | 影響 | 解決方式 |
|---|---|---|
| 無伺服器端程式碼 | 無法直接執行 SignalR Hub | 搭配 Azure Functions（方案 A / A2） |
| 無 URL Rewrite | `/control/{id}` 路由無法直接使用 | 改用 hash routing：`/#/control/{id}` 或 `control.html?id={id}` |
| 單一 Repository 限制 | 每個帳號僅一個 `username.github.io` | 使用 Project Pages（`repo/gh-pages` 分支） |
| 頻寬限制 | 100GB/月 | 簡報遙控場景完全足夠 |

### 連線設定值保護

> **SignalR / Web PubSub 設定值可不可以保留在部署於 GitHub Pages 的靜態檔案內？**

**不可以直接放入前端程式碼**。無論是 Azure SignalR Service 或 Azure Web PubSub，connection string 都包含 access key，暴露在前端會導致安全風險。

**正確做法**：
- Connection string 存放於 **Azure Functions 的環境變數**（Application Settings）
- 前端僅呼叫 Azure Functions 的 `negotiate` 端點取得臨時 access token
- 臨時 token 有時效性，過期後需重新 negotiate

**Azure Web PubSub 範例（方案 A2 — 推薦）**：
```javascript
// 前端 — 呼叫 negotiate 取得 WebSocket 連線 URL
const res = await fetch('https://your-functions.azurewebsites.net/api/negotiate');
const { url } = await res.json();

// 原生 WebSocket — 無需額外 SDK
const ws = new WebSocket(url);
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  // 處理 First / Prev / Next 等指令
};
```

**Azure SignalR 範例（方案 A）**：
```javascript
// 前端 — 需引入 SignalR SDK
const res = await fetch('https://your-functions.azurewebsites.net/api/negotiate');
const { url, accessToken } = await res.json();

const connection = new signalR.HubConnectionBuilder()
  .withUrl(url, { accessTokenFactory: () => accessToken })
  .withAutomaticReconnect()
  .build();
```

## 遷移計畫

### Phase 1：建立靜態前端

1. 將 Razor Views 轉換為靜態 HTML
   - `Index.cshtml` → `index.html`（Host 端 / Office Add-in 面板）
   - `Control.cshtml` → `control.html`（Controller 端 / 手機遙控器）
   - `_Layout.cshtml` → 共用 HTML 模板（直接內嵌或使用 JS 組裝）
2. Token 生成改用 JavaScript：
   ```javascript
   function generateToken() {
     return crypto.randomUUID().replace(/-/g, '');
   }
   ```
3. 路由改用 URL 參數：
   - Host：`index.html` → 自動生成 Token，顯示 `control.html?id={token}` 的 QR Code
   - Controller：`control.html?id={token}` → 從 URL 讀取 Token
4. Theme 切換改用 `localStorage`

### Phase 2：建立 Azure Static Web Apps 專案

1. 建立 Azure Static Web Apps 專案，目錄結構：
   ```
   /
   ├── index.html          # Host 端（Office Add-in）
   ├── control.html        # Controller 端（手機）
   ├── css/
   ├── js/
   └── api/
       └── negotiate/
           └── index.js    # 僅此一個 Function
   ```
2. 實作 `api/negotiate` 函式 — Web PubSub Client Protocol 連線協商
3. 將 Web PubSub connection string 存入 Azure Static Web Apps Application Settings

### Phase 3：部署與驗證

1. 連接 GitHub Repository 至 Azure Static Web Apps（自動產生 GitHub Actions workflow）
2. `git push` 即同時部署前端 + API
3. 更新 Office Add-in manifest 中的 URL 指向 GitHub Pages
4. 端對端測試：Office Add-in ↔ Azure Functions ↔ Web PubSub ↔ 手機 Controller

## 建議

**推薦方案 A2（Azure Web PubSub Client Protocol + Azure Static Web Apps）**：

- **近乎無後端**：僅 1 個 negotiate 函式，內嵌於 Static Web Apps，無獨立 Function App
- 客戶端透過 Client Protocol 直接操作群組，伺服器不在訊息路徑上
- `git push` 一次部署前端 + API，開發體驗等同純靜態站
- 預估月成本 $0（全部在免費額度內）
- 前端使用官方 `@azure/web-pubsub-client` SDK，內建自動重連

若偏好 GitHub Pages 部署（而非 Azure Static Web Apps），可搭配獨立 Azure Functions 消費方案（仍僅需 1 個 negotiate 函式），成本同樣 $0。

完全消除伺服器端在技術上不可行（access token 需由持有 connection string 的可信端點產生），但透過 Azure Static Web Apps 的內建 API，這個端點已與前端融為一體。
