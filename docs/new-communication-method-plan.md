# 新通訊方法評估計畫

## 背景

本專案目前使用 **ASP.NET Core SignalR** 搭配 **Azure SignalR Service** 作為即時通訊基礎架構，實現 PowerPoint Office Add-in（Host）與手機瀏覽器（Controller）之間的雙向指令傳遞。

**評估方向**：希望採用 Serverless 架構，或不仰賴任何第三方服務的自建方案。同時以現有 Azure SignalR 作為基準進行比較，若現有方案在成本與複雜度上仍為最優，則無需遷移。

通訊需求特性：
- 雙向即時通訊（Controller 發送指令 → Host 接收執行）
- 群組隔離（以 Token 分組，一對一或一對多）
- 訊息量極輕（僅傳遞 `First`、`Prev`、`Next`、`UpdateStatus` 等短指令）
- 兩端皆運行於瀏覽器環境（Office Add-in 使用 WebView、Controller 使用行動瀏覽器）

## 通訊方式評估

| 通訊方式 | 協定 | 第三方依賴 | 群組機制 | 開發複雜度 | 月成本估算 | 建議程度 |
|---|---|---|---|---|---|---|
| Azure SignalR（現行） | SignalR over WebSocket | Azure SignalR Service | ✅ 內建 | ⭐ 最低 | 免費層 $0 / 標準層 ~$50 | ⭐⭐⭐⭐⭐ |
| Azure Web PubSub | WebSocket (原生) | Azure Web PubSub | ✅ 內建 | ⭐⭐ 低 | 免費層 $0 / 標準層 ~$50 | ⭐⭐⭐⭐⭐ |
| WebSocket（自建） | WebSocket (RFC 6455) | 無 | ⚠️ 需自行實作 | ⭐⭐⭐ 中等 | 僅主機費用 | ⭐⭐⭐⭐ |
| WebRTC DataChannel | SCTP over DTLS | 無（需簡易 Signaling） | ⚠️ 需 Signaling | ⭐⭐⭐⭐ 較高 | 僅 STUN/TURN 費用 | ⭐⭐⭐ |
| SSE + HTTP POST | HTTP/1.1, HTTP/2 | 無 | ⚠️ 需自行實作 | ⭐⭐⭐ 中等 | 僅主機費用 | ⭐⭐⭐ |
| MQTT（自建 Broker） | MQTT 5.0 over WebSocket | 需自建 Broker | ✅ Topic-based | ⭐⭐⭐ 中等 | 僅主機費用 | ⭐⭐ |
| BroadcastChannel API | 瀏覽器內建 | 無 | ✅ Channel-based | ⭐ 最低 | $0 | ⭐ |

### 0. Azure SignalR Service（現行方案 — 基準）

目前專案使用的方案，以此作為所有替代方案的比較基準。

- **協定**：SignalR 協定（底層自動協商 WebSocket → SSE → Long Polling）
- **成本**：
  - 免費層：每日 20,000 則訊息、20 同時連線、1 單位 — **本專案簡報遙控場景完全足夠**
  - 標準層：每單位 ~$50/月，100 萬則訊息/天、1,000 同時連線
- **優勢**：
  - 群組管理、自動重連、連線協商等全部內建，開發量最少
  - 與 ASP.NET Core 深度整合，現有程式碼已可運作
  - 免費層額度對簡報遙控場景（低頻短指令）綽綽有餘
  - 無需維運 WebSocket 基礎設施，Azure 全託管
- **限制**：
  - 綁定 Azure 平台
  - 免費層有連線數與訊息數上限（但本場景極不易觸及）
  - SignalR 協定比原生 WebSocket 略重（含協商握手、Hub 協定封裝）
  - .NET SDK 版本需與 Azure SignalR Service 版本相容
- **建議程度**：⭐⭐⭐⭐⭐ — 對本專案而言，現行方案在成本（免費層即可）、開發複雜度（已實作完成）、穩定性（Azure 託管）三方面皆為最優；除非有明確的去 Azure 需求，否則無遷移必要

### 0.5 Azure Web PubSub

Azure 推出的原生 WebSocket 託管服務，定位為更輕量、協定無關的即時通訊方案。與 Azure SignalR Service 同為 Azure 即時通訊產品線，但更底層。

- **協定**：原生 WebSocket (RFC 6455)，支援 JSON 與 Protobuf 子協定
- **成本**：
  - 免費層：每日 20,000 則訊息、20 同時連線、1 單位 — **與 Azure SignalR 免費層相同**
  - 標準層：每單位 ~$50/月，與 Azure SignalR 定價接近
- **優勢**：
  - 原生 WebSocket 協定，比 SignalR 協定更輕量（無 Hub 協定封裝）
  - 內建群組管理 API（`joinGroup` / `leaveGroup`），可直接對應現有 Token-based 分組
  - 支援 Serverless 模式，可搭配 Azure Functions 實現無伺服器架構
  - 客戶端無需 SignalR SDK，任何 WebSocket 客戶端皆可連接
  - 適合搭配靜態前端部署（GitHub Pages / Azure Static Web Apps）
- **限制**：
  - 綁定 Azure 平台（與現行方案相同）
  - 免費層有連線數與訊息數上限（但本場景不易觸及）
  - 不像 SignalR 有自動協定降級（WebSocket → SSE → Long Polling），僅支援 WebSocket
  - 需重寫通訊層程式碼（從 SignalR Hub 模式改為 WebSocket 訊息模式）
  - 群組管理透過 REST API 或 Server SDK，不如 SignalR Hub 的 `Groups.AddToGroupAsync()` 直覺
- **建議程度**：⭐⭐⭐⭐⭐ — 若專案計畫遷移至靜態前端（GitHub Pages），Azure Web PubSub 是比 Azure SignalR 更適合的選擇：原生 WebSocket 無需 SignalR SDK、Serverless 模式天然適合靜態部署、免費層額度相同。**適合作為架構重構時的首選通訊層**
- 參考：[Azure Web PubSub 文件](https://learn.microsoft.com/azure/azure-web-pubsub/)

#### Azure SignalR vs Azure Web PubSub 直接比較

| 比較項目 | Azure SignalR Service | Azure Web PubSub |
|---|---|---|
| 協定 | SignalR（封裝 WebSocket） | 原生 WebSocket |
| 客戶端 SDK | 需 SignalR JS SDK（~50KB） | 任何 WebSocket 客戶端 |
| 群組管理 | Hub 內建，程式碼最簡 | REST API / Server SDK |
| 自動重連 | ✅ SDK 內建 | 需自行實作或使用官方 Client SDK |
| 協定降級 | WebSocket → SSE → Long Polling | 僅 WebSocket |
| Serverless 模式 | ✅ 支援（搭配 Azure Functions） | ✅ 支援（搭配 Azure Functions） |
| 靜態前端適配 | ⚠️ 可行但需 SignalR SDK | ✅ 原生 WebSocket 天然適合 |
| 免費層 | 20 連線 / 20K 訊息/日 | 20 連線 / 20K 訊息/日 |
| 現有程式碼相容 | ✅ 無需修改 | ❌ 需重寫通訊層 |

### 1. WebSocket（自建）

使用 ASP.NET Core 原生 WebSocket 中介軟體，自行實作群組管理與訊息路由，完全不依賴第三方服務。

- **協定**：WebSocket (RFC 6455)
- **限制**：
  - 需自行實作群組管理、斷線重連、心跳偵測
  - 水平擴展需搭配 Redis Backplane 或 Sticky Session
  - 無內建的連線管理 Dashboard
- **建議程度**：⭐⭐⭐⭐ — 零外部依賴，完全自主掌控；本專案的通訊模式簡單（僅數個指令），自建群組管理的實作量可控；升級至 .NET 8+ 後可搭配 Minimal API 進一步簡化；但相較現行 Azure SignalR 免費層，需額外開發群組管理與重連機制，成本效益需考量
- 參考：[ASP.NET Core WebSocket](https://learn.microsoft.com/aspnet/core/fundamentals/websockets)

### 2. WebRTC DataChannel

點對點直連，建立連線後資料完全不經伺服器中繼，實現真正的 Serverless 通訊。

- **協定**：SCTP over DTLS，需 ICE/STUN/TURN 進行 NAT 穿越
- **限制**：
  - 初始連線仍需 Signaling Server 交換 SDP（可用輕量 HTTP 端點實現）
  - Office Add-in WebView 對 WebRTC 支援不穩定，需實測驗證
  - NAT 穿越失敗時需 TURN Server 中繼（可使用免費公開 STUN，但 TURN 通常需自建或付費）
  - 一對多場景需建立多條 PeerConnection
- **建議程度**：⭐⭐⭐ — 連線建立後完全 P2P 無伺服器負擔；但 Office Add-in WebView 相容性為主要風險，建議先進行可行性 PoC 再決定
- 參考：[WebRTC API](https://developer.mozilla.org/docs/Web/API/WebRTC_API)

### 3. SSE + HTTP POST

Server-Sent Events 處理伺服器推送，搭配 HTTP POST 處理客戶端上行，純 HTTP 協定組合實現雙向通訊。

- **協定**：HTTP/1.1 或 HTTP/2（SSE 為單向串流）
- **限制**：
  - SSE 為單向（Server → Client），上行需額外 POST 請求
  - HTTP/1.1 下每個 Domain 有 6 條連線上限，SSE 佔用一條長連線
  - 需自行實作群組路由與訊息分發
  - 相較 WebSocket 有較高的 HTTP Header 開銷
- **建議程度**：⭐⭐⭐ — 實作簡單、防火牆/Proxy 友善度最高（純 HTTP）；適合作為 WebSocket 不可用時的 Fallback 方案；但雙向拼接的開發體驗不如 WebSocket 直覺
- 參考：[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)

### 4. BroadcastChannel API

瀏覽器內建的同源跨分頁通訊 API，無需任何伺服器。

- **協定**：瀏覽器內建 API，無網路協定
- **限制**：
  - 僅限同一裝置、同一瀏覽器、同一 Origin 的分頁間通訊
  - 無法跨裝置（手機 → 電腦），不符合本專案核心場景
  - Office Add-in WebView 不一定與桌面瀏覽器共享 BroadcastChannel
- **建議程度**：⭐ — 無法滿足跨裝置通訊的核心需求，僅列入作為技術參考
- 參考：[BroadcastChannel API](https://developer.mozilla.org/docs/Web/API/BroadcastChannel)

### 5. MQTT（自建 Broker）

自行部署 MQTT Broker（如 Mosquitto），透過 WebSocket 橋接瀏覽器端。

- **協定**：MQTT 5.0 over WebSocket
- **限制**：
  - 需額外部署與維運 MQTT Broker
  - 瀏覽器端需引入 MQTT.js 客戶端函式庫（~90KB gzipped）
  - QoS、Retained Message 等機制對此場景過度設計
  - Broker 本身成為額外的基礎設施元件
- **建議程度**：⭐⭐ — Topic-based 路由天然適合分組；但自建 Broker 增加維運複雜度，對本專案規模而言不如直接自建 WebSocket 精簡
- 參考：[Mosquitto](https://mosquitto.org/)、[MQTT.js](https://github.com/mqttjs/MQTT.js)

## 總結建議

### 方案比較矩陣

| 比較項目 | Azure SignalR（現行） | Azure Web PubSub | WebSocket（自建） | WebRTC | SSE + POST |
|---|---|---|---|---|---|
| 開發工作量 | ✅ 已完成 | 需重寫通訊層 | 需重寫通訊層 | 需重寫 + Signaling | 需重寫通訊層 |
| 月成本 | $0（免費層） | $0（免費層） | 僅主機 | 僅主機 + STUN | 僅主機 |
| 外部依賴 | Azure | Azure | 無 | 無 | 無 |
| 群組管理 | ✅ 內建 | ✅ 內建 | 需自建 | 需自建 | 需自建 |
| 自動重連 | ✅ 內建 | ⚠️ 需 Client SDK | 需自建 | 需自建 | 需自建 |
| 水平擴展 | ✅ 自動 | ✅ 自動 | 需 Redis/Sticky | P2P 天然擴展 | 需 Redis/Sticky |
| 靜態前端適配 | ⚠️ 需 SignalR SDK | ✅ 原生 WebSocket | ✅ 原生 WebSocket | ✅ 原生 API | ✅ 原生 API |

### 結論

**維持現狀 vs 架構重構，取決於是否遷移至靜態前端**：

**情境 1：維持 ASP.NET Core MVC 架構**
- **Azure SignalR Service（現行）** 仍為最佳方案，無遷移必要
- 成本 $0、開發量 0、穩定可靠

**情境 2：遷移至靜態前端（GitHub Pages）**
- **Azure Web PubSub** 為首選 — 原生 WebSocket 無需 SignalR SDK，Serverless 模式天然適合靜態部署，免費層額度相同
- 搭配 Azure Functions 作為 negotiate + 訊息路由端點
- 預估月成本仍為 $0

**情境 3：完全脫離 Azure**
- **自建 WebSocket** 為首選替代方案，開發量可控且零外部依賴
- **WebRTC DataChannel** 適合長期探索，但需先驗證 Office Add-in WebView 相容性
