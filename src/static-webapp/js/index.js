/**
 * Host page (index.js) — Office Add-in Task Pane.
 * Displays QR code, manages Web PubSub connection, relays PowerPoint commands.
 */
(function () {
  "use strict";

  let token = Shared.getTokenFromUrl();
  let client = null;
  let officeReady = false;

  // Compress base64 PNG to smaller JPEG for efficient WebSocket transfer
  function compressImage(base64Png, maxWidth, quality) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxWidth / img.width);
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        // Export as JPEG, strip data URI prefix to get raw base64
        var dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.replace(/^data:image\/jpeg;base64,/, ""));
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/png;base64," + base64Png;
    });
  }

  // ---------- Initialization ----------

  if (!token) {
    token = Shared.generateToken();
  }

  document.getElementById("token").value = token;
  Shared.initTheme();

  // ---------- QR Code ----------

  function renderQrCode() {
    const controlUrl = `${window.location.origin}/control.html?id=${token}`;
    document.getElementById("controlUrl").textContent = controlUrl;
    document.getElementById("openController").href = controlUrl;

    const container = document.getElementById("qrcode");
    container.innerHTML = "";

    const qr = qrcode(0, "M");
    qr.addData(controlUrl);
    qr.make();

    const size = 180;
    const canvas = document.createElement("canvas");
    const cellSize = Math.floor(size / qr.getModuleCount());
    canvas.width = cellSize * qr.getModuleCount();
    canvas.height = canvas.width;
    const ctx = canvas.getContext("2d");

    const fg = getComputedStyle(document.documentElement)
      .getPropertyValue("--qr-fg")
      .trim();
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--qr-bg")
      .trim();

    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        ctx.fillStyle = qr.isDark(row, col) ? fg : bg;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
    container.appendChild(canvas);
  }

  renderQrCode();

  // ---------- Refresh Token ----------

  document.getElementById("refreshToken").addEventListener("click", async () => {
    if (client) {
      try {
        await client.leaveGroup(token);
      } catch (e) {
        console.warn("Leave group error:", e);
      }
    }

    token = Shared.generateToken();
    document.getElementById("token").value = token;
    renderQrCode();

    if (client) {
      // Reconnect with new token (need new negotiate for permissions)
      await connectPubSub();
    }
  });

  // ---------- Web PubSub Connection ----------

  async function connectPubSub() {
    Shared.setStatus("connecting", "Connecting...");
    try {
      client = await Shared.createPubSubClient(token);

      client.on("connected", () => {
        Shared.setStatus("connected", "Connected");
        client.joinGroup(token);
        if (officeReady) {
          syncStatus();
          syncAllSlides();
        }
      });

      client.on("disconnected", () => {
        Shared.setStatus("connecting", "Reconnecting...");
        setTimeout(connectPubSub, 2000);
      });

      client.on("group-message", (e) => {
        if (e.message.group !== token) return;
        const data = e.message.data;
        handleCommand(data);
      });

      await client.start();
    } catch (err) {
      console.error("PubSub connection error:", err);
      Shared.setStatus("", "Error");
      setTimeout(connectPubSub, 3000);
    }
  }

  // ---------- PowerPoint Commands ----------

  function handleCommand(data) {
    if (!officeReady || !Office.context || !Office.context.document) return;

    switch (data.type) {
      case "First":
        Office.context.document.goToByIdAsync(
          Office.Index.First,
          Office.GoToType.Index,
          () => setTimeout(syncCurrentSlide, 500)
        );
        break;
      case "Prev":
        Office.context.document.goToByIdAsync(
          Office.Index.Previous,
          Office.GoToType.Index,
          () => setTimeout(syncCurrentSlide, 500)
        );
        break;
      case "Next":
        Office.context.document.goToByIdAsync(
          Office.Index.Next,
          Office.GoToType.Index,
          () => setTimeout(syncCurrentSlide, 500)
        );
        break;
      case "GoToSlide":
        if (data.slideId) {
          Office.context.document.goToByIdAsync(
            data.slideId,
            Office.GoToType.Index,
            () => setTimeout(syncCurrentSlide, 500)
          );
        }
        break;
      case "PresenterJoined":
        syncStatus();
        syncAllSlides();
        break;
    }
  }

  // ---------- Office.js Integration ----------

  function syncStatus() {
    if (!Office.context || !Office.context.document) return;
    const docUrl = Office.context.document.url;
    const docName = docUrl ? docUrl.split(/[/\\]/).pop() : "(no name)";

    if (client) {
      client.sendToGroup(
        token,
        { type: "UpdateStatus", docName },
        "json",
        { noEcho: true }
      );
    }
  }

  async function syncCurrentSlide() {
    if (!officeReady) return;

    try {
      await PowerPoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();

        // Use ActiveView to detect current slide index via selection
        var slideIndex = -1;
        var slideId = null;
        try {
          const selectedSlides = context.presentation.getSelectedSlides();
          selectedSlides.load("items");
          await context.sync();
          if (selectedSlides.items.length > 0) {
            selectedSlides.items[0].load("id");
            await context.sync();
            slideId = selectedSlides.items[0].id;
            slideIndex = slides.items.findIndex(function (s) { return s.id === slideId; });
          }
        } catch (e) {
          console.warn("getSelectedSlides not available:", e.message);
        }

        console.log("syncCurrentSlide:", { slideIndex, slideId: slideId });

        if (client && slideIndex >= 0) {
          client.sendToGroup(
            token,
            { type: "SlideChanged", slideId: slideId, slideIndex: slideIndex },
            "json",
            { noEcho: true }
          );
        }
      });
    } catch (err) {
      console.error("syncCurrentSlide error:", err);
    }
  }

  async function syncAllSlides() {
    if (!officeReady) return;

    try {
      await PowerPoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();

        // Try to load hidden property (may not be available in all API versions)
        var hiddenSupported = true;
        try {
          for (var h = 0; h < slides.items.length; h++) {
            slides.items[h].load("hidden");
          }
          await context.sync();
        } catch (_) {
          hiddenSupported = false;
        }

        const slideList = [];
        var visibleIndex = 0;
        for (let i = 0; i < slides.items.length; i++) {
          const slide = slides.items[i];

          // Skip hidden slides
          if (hiddenSupported && slide.hidden) continue;

          let thumbnail = null;
          try {
            const image = slide.getImageAsBase64();
            await context.sync();
            // Compress: 320px wide, JPEG quality 0.5
            thumbnail = await compressImage(image.value, 320, 0.5);
          } catch (e) {
            // PowerPointApi 1.4 not available
          }

          let notes = "";
          try {
            const notesSlide = slide.notesSlide;
            const shapes = notesSlide.shapes;
            shapes.load("items");
            await context.sync();
            for (let j = 0; j < shapes.items.length; j++) {
              shapes.items[j].textFrame.load("textRange/text");
            }
            await context.sync();
            for (let j = 0; j < shapes.items.length; j++) {
              try {
                const text = shapes.items[j].textFrame.textRange.text;
                if (text && text.trim()) { notes = text; break; }
              } catch (_) { /* no text frame */ }
            }
          } catch (e) {
            // Notes API not available
          }

          slideList.push({
            id: slide.id,
            index: visibleIndex,
            notes,
            thumbnail,
          });
          visibleIndex++;
        }

        console.log("syncAllSlides:", slideList.length, "visible slides");

        if (client) {
          client.sendToGroup(
            token,
            { type: "AllSlides", slides: slideList },
            "json",
            { noEcho: true }
          );
        }
      });
    } catch (err) {
      console.error("syncAllSlides error:", err);
    }
  }

  async function getSlideIndex(context, slideId) {
    const slides = context.presentation.slides;
    slides.load("items/id");
    await context.sync();
    return slides.items.findIndex((s) => s.id === slideId);
  }

  // ---------- Office Ready ----------

  if (typeof Office !== "undefined" && Office.onReady) {
    Office.onReady((info) => {
      officeReady = true;

      // Restore theme from Office settings
      try {
        const savedTheme = Office.context.document.settings.get("theme");
        if (savedTheme) Shared.applyTheme(savedTheme);
      } catch (e) {
        // Not in Office context
      }

      // Listen for slide selection changes
      try {
        Office.context.document.addHandlerAsync(
          Office.EventType.DocumentSelectionChanged,
          () => syncCurrentSlide()
        );
      } catch (e) {
        console.warn("Selection change handler not supported:", e.message);
      }

      connectPubSub();
    });
  } else {
    // Running outside Office (e.g., browser testing)
    connectPubSub();
  }
})();
