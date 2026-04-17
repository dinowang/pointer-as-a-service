/**
 * Host page (index.js) — Office Add-in Task Pane.
 * Displays QR code, manages Web PubSub connection, relays PowerPoint commands.
 */
(function () {
  "use strict";

  let token = Shared.getTokenFromUrl();
  let client = null;
  let officeReady = false;

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
        if (officeReady) syncStatus();
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
        const selectedSlides = context.presentation.getSelectedSlides();
        selectedSlides.load("items/id");
        await context.sync();

        if (selectedSlides.items.length === 0) {
          console.warn("syncCurrentSlide: no slides selected");
          return;
        }

        const slide = selectedSlides.items[0];
        const slideIndex = await getSlideIndex(context, slide.id);

        // Get current slide image (PowerPointApi 1.4+)
        let imageBase64 = null;
        try {
          const image = slide.getImageAsBase64();
          await context.sync();
          imageBase64 = image.value;
        } catch (e) {
          console.warn("getImageAsBase64 not available:", e.message);
        }

        // Get current slide notes (PowerPointApi 1.5+)
        let notesText = "";
        try {
          const notesSlide = slide.notesSlide;
          notesSlide.load("shapes");
          await context.sync();
          // Notes text body is typically in shape at index 1
          for (let i = 0; i < notesSlide.shapes.items.length; i++) {
            const shape = notesSlide.shapes.items[i];
            shape.textFrame.load("textRange/text");
          }
          await context.sync();
          for (let i = 0; i < notesSlide.shapes.items.length; i++) {
            const shape = notesSlide.shapes.items[i];
            try {
              const text = shape.textFrame.textRange.text;
              if (text && text.trim()) {
                notesText = text;
                break;
              }
            } catch (_) { /* shape has no text frame */ }
          }
        } catch (e) {
          console.warn("Notes not available:", e.message);
        }

        console.log("syncCurrentSlide:", { slideIndex, hasImage: !!imageBase64, notesLength: notesText.length });

        if (client) {
          client.sendToGroup(
            token,
            {
              type: "SlideChanged",
              slideId: slide.id,
              slideIndex,
              image: imageBase64,
              notes: notesText,
            },
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

        const slideList = [];
        for (let i = 0; i < slides.items.length; i++) {
          const slide = slides.items[i];
          let thumbnail = null;
          try {
            const image = slide.getImageAsBase64();
            await context.sync();
            thumbnail = image.value;
          } catch (e) {
            // PowerPointApi 1.4 not available
          }

          let notes = "";
          try {
            const notesSlide = slide.notesSlide;
            notesSlide.load("shapes");
            await context.sync();
            for (let j = 0; j < notesSlide.shapes.items.length; j++) {
              notesSlide.shapes.items[j].textFrame.load("textRange/text");
            }
            await context.sync();
            for (let j = 0; j < notesSlide.shapes.items.length; j++) {
              try {
                const text = notesSlide.shapes.items[j].textFrame.textRange.text;
                if (text && text.trim()) { notes = text; break; }
              } catch (_) { /* no text frame */ }
            }
          } catch (e) {
            // Notes API not available
          }

          slideList.push({
            id: slide.id,
            index: i,
            thumbnail,
            notes,
          });
        }

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
