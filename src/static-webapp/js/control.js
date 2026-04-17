/**
 * Controller page (control.js) — Mobile remote control.
 * Swipe/tap navigation, slide preview, speaker notes, Web PubSub messaging.
 */
(function () {
  "use strict";

  const token = Shared.getTokenFromUrl();
  if (!token) {
    document.body.innerHTML =
      '<div style="padding:2rem;text-align:center;">No session token. Scan QR code from PowerPoint.</div>';
    return;
  }

  document.getElementById("token").value = token;
  Shared.initTheme();
  Shared.initWakeLock();

  let client = null;
  let allSlides = [];
  let currentSlideIndex = -1;

  // ---------- Web PubSub Connection ----------

  async function connectPubSub() {
    Shared.setStatus("connecting", "Connecting...");
    try {
      client = await Shared.createPubSubClient(token);

      client.on("connected", () => {
        Shared.setStatus("connected", "Connected");
        client.joinGroup(token);
        // Notify host that presenter (controller) has joined
        client.sendToGroup(
          token,
          { type: "PresenterJoined" },
          "json",
          { noEcho: true }
        );
      });

      client.on("disconnected", () => {
        Shared.setStatus("connecting", "Reconnecting...");
        setTimeout(connectPubSub, 2000);
      });

      client.on("group-message", (e) => {
        if (e.message.group !== token) return;
        handleMessage(e.message.data);
      });

      await client.start();
    } catch (err) {
      console.error("PubSub connection error:", err);
      Shared.setStatus("", "Error");
      setTimeout(connectPubSub, 3000);
    }
  }

  // ---------- Message Handling ----------

  function handleMessage(data) {
    switch (data.type) {
      case "UpdateStatus":
        document.getElementById("docName").textContent =
          data.docName || "(no name)";
        document.title = `${data.docName || "Controller"} - Pointer as a Service`;
        break;

      case "SlideChanged":
        currentSlideIndex = data.slideIndex ?? -1;
        updateCurrentSlide(data.image, data.notes);
        updateNextSlidePreview();
        highlightActiveSlide();
        break;

      case "AllSlides":
        allSlides = data.slides || [];
        renderSlidesGrid();
        // Update current slide if we have index
        if (currentSlideIndex >= 0 && allSlides[currentSlideIndex]) {
          updateCurrentSlide(
            allSlides[currentSlideIndex].thumbnail,
            allSlides[currentSlideIndex].notes
          );
          updateNextSlidePreview();
        }
        break;
    }
  }

  // ---------- Slide Display ----------

  function updateCurrentSlide(imageBase64, notes) {
    const container = document.getElementById("currentSlide");
    if (imageBase64) {
      // Detect format: JPEG thumbnails from AllSlides, PNG from SlideChanged
      var mime = imageBase64.startsWith("/9j/") ? "image/jpeg" : "image/png";
      container.innerHTML = '<img src="data:' + mime + ';base64,' + imageBase64 + '" alt="Current slide" />';
    }

    const notesText = document.getElementById("notesText");
    notesText.textContent = notes || "(no notes)";
  }

  function updateNextSlidePreview() {
    const section = document.getElementById("nextSlideSection");
    const thumb = document.getElementById("nextSlideThumb");
    const nextIndex = currentSlideIndex + 1;

    if (nextIndex < allSlides.length && allSlides[nextIndex]?.thumbnail) {
      var nextMime = allSlides[nextIndex].thumbnail.startsWith("/9j/") ? "image/jpeg" : "image/png";
      thumb.innerHTML = '<img src="data:' + nextMime + ';base64,' + allSlides[nextIndex].thumbnail + '" alt="Next slide" />';
      section.style.display = "flex";
    } else {
      section.style.display = "none";
    }
  }

  // ---------- Send Commands ----------

  function sendCommand(type, extra) {
    if (!client) return;
    client.sendToGroup(token, { type, ...extra }, "json");
  }

  // ---------- Navigation Buttons ----------

  document.getElementById("btnFirst").addEventListener("click", () => sendCommand("First"));
  document.getElementById("btnPrev").addEventListener("click", () => sendCommand("Prev"));
  document.getElementById("btnNext").addEventListener("click", () => sendCommand("Next"));

  // ---------- Swipe Navigation (nipplejs) ----------

  const slideArea = document.getElementById("slideArea");
  const manager = nipplejs.create({
    zone: slideArea,
    mode: "dynamic",
    position: { left: "50%", top: "50%" },
    color: "rgba(0, 120, 212, 0.3)",
    size: 80,
  });

  let swipeDir = null;

  manager.on("move", (evt, nipple) => {
    if (nipple.direction) {
      swipeDir = nipple.direction.angle;
    }
  });

  manager.on("end", () => {
    if (swipeDir === "left") {
      sendCommand("Next");
    } else if (swipeDir === "right") {
      sendCommand("Prev");
    }
    swipeDir = null;
  });

  // ---------- Speaker Notes Toggle ----------

  document.getElementById("notesToggle").addEventListener("click", () => {
    document.getElementById("notesSection").classList.toggle("expanded");
  });

  // ---------- Slides Preview (Bottom Sheet) ----------

  const slidesOverlay = document.getElementById("slidesOverlay");
  const slidesSheet = document.getElementById("slidesSheet");

  function openSlidesSheet() {
    slidesOverlay.classList.add("visible");
    slidesSheet.classList.add("visible");
  }

  function closeSlidesSheet() {
    slidesOverlay.classList.remove("visible");
    slidesSheet.classList.remove("visible");
  }

  document.getElementById("btnSlides").addEventListener("click", openSlidesSheet);
  document.getElementById("btnCloseSlides").addEventListener("click", closeSlidesSheet);
  slidesOverlay.addEventListener("click", closeSlidesSheet);

  function renderSlidesGrid() {
    const grid = document.getElementById("slidesGrid");
    grid.innerHTML = "";

    allSlides.forEach((slide, i) => {
      const item = document.createElement("div");
      item.className = "slides-grid-item";
      if (i === currentSlideIndex) item.classList.add("active");
      item.dataset.index = i;

      const img = slide.thumbnail
        ? '<img src="data:' + (slide.thumbnail.startsWith("/9j/") ? "image/jpeg" : "image/png") + ';base64,' + slide.thumbnail + '" alt="Slide ' + (i + 1) + '" />'
        : '<div style="width:100%;aspect-ratio:16/9;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:var(--text-muted);">Slide ' + (i + 1) + '</div>';

      item.innerHTML = `${img}<div class="slide-number">${i + 1}</div>`;

      item.addEventListener("click", () => {
        sendCommand("GoToSlide", { slideId: slide.id, slideIndex: i });
        closeSlidesSheet();
      });

      grid.appendChild(item);
    });
  }

  function highlightActiveSlide() {
    document.querySelectorAll(".slides-grid-item").forEach((item, i) => {
      item.classList.toggle("active", i === currentSlideIndex);
    });
  }

  // ---------- Start ----------

  connectPubSub();
})();
