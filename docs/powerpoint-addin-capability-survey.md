# PowerPoint Add-in 功能可行性調查

## 目標

評估新版 Pointer as a Service 希望加入的功能在技術上的可行性，涵蓋 PWA 實作、防止系統 Suspend、講稿顯示、Slide 截圖與任意頁面切換。

## 功能可行性總覽

| 功能 | 可行性 | 關鍵技術 | 最低需求 |
|---|---|---|---|
| PWA 實現 Controller | ✅ 可行 | Service Worker + Web App Manifest | 現代瀏覽器 |
| 防止手機 Suspend | ✅ 可行 | Wake Lock API | Chromium 系、Safari 16.4+ |
| 顯示 PPT 講稿 | ✅ 可行 | `slide.notesPage.notesTextFrame.text` | PowerPointApi 1.3+ |
| 顯示目前 Slide 截圖 | ⚠️ 有條件可行 | `Slide.getImageAsBase64()` | PowerPointApi 1.4+ |
| 任意頁面切換（含截圖預覽） | ✅ 可行 | `goToByIdAsync` + `getImageAsBase64()` | PowerPointApi 1.4+（截圖）；1.1（純列表） |

---

## 詳細分析

### 1. 使用 PWA 實現 Controller

**可行性**：✅ 完全可行

Controller 端（手機遙控器）可以改為 PWA，提供類 App 體驗。

**實作要點**：
- 新增 `manifest.json`（Web App Manifest），設定 `display: "standalone"` 實現全螢幕無網址列
- 註冊 Service Worker 快取靜態資源，支援離線載入 UI（WebSocket 連線仍需網路）
- 加入 `<meta name="apple-mobile-web-app-capable" content="yes">` 支援 iOS Add to Home Screen

**限制**：
- iOS Safari 的 PWA 支援較 Android 弱，Push Notification 需 iOS 16.4+
- Service Worker 無法快取 WebSocket 連線，離線時僅能顯示 UI 但無法操控

### 2. 防止手機 OS Suspend

**可行性**：✅ 可行（主流平台支援）

使用 **Screen Wake Lock API** 可防止螢幕在簡報過程中自動關閉。

**實作要點**：
```javascript
let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      console.log('Wake Lock released');
    });
  } catch (err) {
    console.error(`${err.name}: ${err.message}`);
  }
}

// 切回前景時重新申請
document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});
```

**平台支援**：

| 平台 | 支援狀態 |
|---|---|
| Chrome (Android) | ✅ 支援 |
| Edge (Android) | ✅ 支援 |
| Samsung Internet | ✅ 支援 |
| Safari (iOS 16.4+) | ✅ 支援 |
| Firefox (Android) | ❌ 不支援 |

**限制**：
- 頁面進入背景（切換 App）時 Wake Lock 會自動釋放，需在 `visibilitychange` 事件中重新申請
- Firefox Android 不支援，需在 UI 提示使用者手動關閉自動鎖屏
- PWA 以 standalone 模式運行時行為與瀏覽器一致

### 3. 在 PWA 顯示 PPT 講稿

**可行性**：✅ 可行

PowerPoint JavaScript API 自 **PowerPointApi 1.3** 起支援讀取投影片備忘稿。

**實作要點**：

Host 端（Office Add-in）讀取講稿後透過 SignalR/WebSocket 傳送至 Controller 端。

```javascript
// Host 端 - Office Add-in 內執行
await PowerPoint.run(async (context) => {
  const slides = context.presentation.slides;
  slides.load("items");
  await context.sync();

  for (const slide of slides.items) {
    slide.notesPage.notesTextFrame.load("text");
  }
  await context.sync();

  // 將講稿透過 WebSocket 傳送至 Controller
  const notes = slides.items.map((slide, i) => ({
    index: i,
    text: slide.notesPage.notesTextFrame.text
  }));

  connection.invoke("SyncNotes", token, JSON.stringify(notes));
});
```

**限制**：
- 需要 PowerPointApi 1.3+，較舊的 Office 2016 永久授權版不支援
- `notesPage` 僅提供純文字，不包含備忘稿中的格式、圖片或超連結
- 講稿內容需從 Host 端讀取後中繼至 Controller 端，無法由 Controller 直接存取

### 4. 顯示目前 Slide 截圖

**可行性**：⚠️ 有條件可行

**PowerPointApi 1.4+** 提供 `Slide.getImageAsBase64()` 方法，可取得投影片的 Base64 編碼圖片。

**實作要點**：

```javascript
// Host 端 - 取得當前投影片截圖
await PowerPoint.run(async (context) => {
  const selectedSlides = context.presentation.getSelectedSlides();
  selectedSlides.load("items");
  await context.sync();

  if (selectedSlides.items.length > 0) {
    const slide = selectedSlides.items[0];
    const image = slide.getImageAsBase64();
    await context.sync();

    // 將 Base64 圖片透過 WebSocket 傳送
    connection.invoke("SyncSlideImage", token, image.value);
  }
});
```

**限制**：
- 需要 **PowerPointApi 1.4+**，支援範圍比 1.3 窄：
  - ✅ PowerPoint on Windows（Microsoft 365 訂閱版）
  - ✅ PowerPoint on Web
  - ⚠️ PowerPoint on Mac（需較新版本）
  - ❌ Office 2019/2021 永久授權版可能不支援
- 圖片為 Base64 字串，傳輸體積較大（一張 1920x1080 約 200-500KB）
- 每次換頁需重新擷取並傳送，頻繁換頁可能有延遲
- 建議：傳輸前壓縮或降低解析度；可搭配節流（throttle）減少頻寬消耗

**替代方案**（若 1.4 不可用）：
- 伺服器端使用 Microsoft Graph API 存取 OneDrive 中的簡報檔並轉換為圖片
- 使用第三方函式庫（如 Aspose.Slides）在伺服器端解析 .pptx 匯出圖片

### 5. 在 PWA 中 Slides Preview（含截圖）切換任意頁面

**可行性**：✅ 可行（截圖預覽依賴功能 4，需 PowerPointApi 1.4+）

此功能結合投影片列表列舉、截圖取得與 `goToByIdAsync`，在 Controller 端呈現帶有縮圖的投影片總覽，讓講者可以直接跳轉到任意頁面。

**實作要點**：

```javascript
// Host 端 - 簡報開始時一次性同步所有投影片 ID 與縮圖
await PowerPoint.run(async (context) => {
  const slides = context.presentation.slides;
  slides.load("items/id");
  await context.sync();

  const slideList = [];
  for (const slide of slides.items) {
    const image = slide.getImageAsBase64(); // 需 PowerPointApi 1.4+
    await context.sync();
    slideList.push({
      id: slide.id,
      thumbnail: image.value  // Base64 編碼縮圖
    });
  }

  // 傳送投影片清單（含縮圖）至 Controller
  connection.invoke("SyncSlideList", token, JSON.stringify(slideList));
});

// Host 端 - 接收 Controller 指令跳轉至指定投影片
connection.on("GoToSlide", (slideId) => {
  Office.context.document.goToByIdAsync(
    slideId,
    Office.GoToType.Index,
    (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        console.log("Navigated to slide");
      }
    }
  );
});
```

**Controller 端 UI 流程**：
1. 簡報開始時收到完整投影片清單（含縮圖），渲染為可捲動的縮圖網格
2. 當前播放的投影片以高亮框標示
3. 使用者點擊任一縮圖
4. 發送 `GoToSlide` 指令（帶 Slide ID）至 Host 端
5. Host 端呼叫 `goToByIdAsync` 跳轉，並回報新的當前頁碼

**縮圖傳輸最佳化**：
- 初始同步時使用低解析度縮圖（如 480x270），降低總傳輸量
- 全部投影片的縮圖可壓縮後一次傳送，避免逐張請求
- 若投影片數量多（>50 頁），可分批載入（先傳前 10 張，其餘背景載入）
- 快取已接收的縮圖，簡報過程中不需重複傳輸

**限制**：
- `goToByIdAsync` 需要 Slide ID（非 index），需先列舉所有投影片建立 ID 對照表
- 跳轉在簡報模式下可能有動畫延遲
- **截圖預覽需要 PowerPointApi 1.4+**；若不支援，可降級為僅顯示投影片編號的文字列表
- 投影片數量多時，初始同步時間較長（每張截圖約 200-500KB）

---

## 架構影響

新功能引入後，Host → Controller 的資料流將大幅增加：

| 資料類型 | 方向 | 頻率 | 大小 |
|---|---|---|---|
| 換頁指令 | Controller → Host | 使用者觸發 | < 100B |
| 講稿文字 | Host → Controller | 簡報開始時 + 換頁時 | 1-10KB |
| Slide 截圖 | Host → Controller | 每次換頁 | 200-500KB |
| 投影片清單 | Host → Controller | 簡報開始時 | 1-5KB |

**建議**：
- Slide 截圖傳輸量最大，建議降低解析度（如 960x540）並使用 JPEG 壓縮
- 講稿與投影片清單可在簡報開始時一次性同步，後續僅傳送差異
- 通訊層若從 SignalR 改為自建 WebSocket（參考通訊方法評估），需自行處理大型訊息的分片傳輸

## 最低相容性需求

| 元件 | 最低需求 |
|---|---|
| Office Add-in (Host) | PowerPointApi 1.4+（Microsoft 365 訂閱版） |
| Controller 瀏覽器 | 支援 PWA + Wake Lock API（Chrome 84+、Safari 16.4+） |
| 網路 | WebSocket 連線（Slide 截圖需足夠頻寬） |

若需向下相容 PowerPointApi 1.3（無截圖），可將 Slide 截圖功能設為選用，其餘功能（講稿、換頁、任意跳轉）皆可正常運作。
