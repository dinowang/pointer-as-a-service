/**
 * Host page (index.js) — Office Add-in Task Pane.
 * Displays QR code, manages Web PubSub connection, relays PowerPoint commands.
 * Speaker notes are extracted from OOXML via getFileAsync + JSZip (no JS API for notes).
 */
(function () {
  "use strict";

  let token = Shared.getTokenFromUrl();
  let client = null;
  let officeReady = false;
  let slideIds = [];

  // ---------- Image Compression ----------

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
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.replace(/^data:image\/jpeg;base64,/, ""));
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/png;base64," + base64Png;
    });
  }

  // ---------- OOXML Notes Extraction ----------
  // Office JS API has NO notesSlide property. We extract notes by downloading
  // the PPTX (ZIP) via getFileAsync and parsing the OOXML notesSlides XML.

  function getFileAsUint8Array() {
    return new Promise(function (resolve, reject) {
      console.log("getFileAsUint8Array: calling getFileAsync(Compressed)...");
      Office.context.document.getFileAsync(
        Office.FileType.Compressed,
        { sliceSize: 4194304 },
        function (result) {
          console.log("getFileAsUint8Array: callback status:", result.status);
          if (result.status !== Office.AsyncResultStatus.Succeeded) {
            reject(new Error("getFileAsync: " + (result.error ? result.error.message : "unknown")));
            return;
          }
          var file = result.value;
          var sliceCount = file.sliceCount;
          console.log("getFileAsUint8Array: file size:", file.size, "bytes, slices:", sliceCount);
          var slices = new Array(sliceCount);
          var received = 0;

          for (var i = 0; i < sliceCount; i++) {
            (function (idx) {
              file.getSliceAsync(idx, function (sliceResult) {
                if (sliceResult.status === Office.AsyncResultStatus.Succeeded) {
                  slices[idx] = sliceResult.value.data;
                  console.log("getFileAsUint8Array: slice", idx, "received,", sliceResult.value.data.length, "bytes");
                } else {
                  console.warn("getFileAsUint8Array: slice", idx, "failed");
                }
                received++;
                if (received === sliceCount) {
                  file.closeAsync();
                  var totalLen = 0;
                  for (var s = 0; s < slices.length; s++) {
                    totalLen += (slices[s] ? slices[s].length : 0);
                  }
                  var combined = new Uint8Array(totalLen);
                  var offset = 0;
                  for (var s = 0; s < slices.length; s++) {
                    if (!slices[s]) continue;
                    for (var b = 0; b < slices[s].length; b++) {
                      combined[offset++] = slices[s][b];
                    }
                  }
                  console.log("getFileAsUint8Array: complete, total:", totalLen, "bytes");
                  resolve(combined);
                }
              });
            })(i);
          }
        }
      );
    });
  }

  function decodeXmlEntities(str) {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  // Extract notes text from a notesSlide XML string.
  // Only reads the body placeholder shape (type="body"), skipping slide image and slide number.
  function extractNotesText(xml) {
    // Split into shapes by <p:sp> boundaries
    var shapes = xml.split(/<p:sp\b/);
    for (var i = 0; i < shapes.length; i++) {
      if (shapes[i].indexOf('type="body"') === -1) continue;

      // Found the body placeholder — extract paragraphs
      var paragraphs = shapes[i].split(/<\/a:p>/);
      var result = [];
      for (var p = 0; p < paragraphs.length; p++) {
        var texts = [];
        var re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
        var m;
        while ((m = re.exec(paragraphs[p])) !== null) {
          texts.push(decodeXmlEntities(m[1]));
        }
        if (texts.length > 0) {
          result.push(texts.join(""));
        }
      }
      return result.join("\n").trim();
    }
    return "";
  }

  // Parse the PPTX ZIP and extract notes for each slide in presentation order.
  // Returns: string[] where index matches slide order.
  async function extractNotesFromPptx(zipData) {
    var zip = await JSZip.loadAsync(zipData);

    // 1. Read presentation.xml to get slide order
    var presFile = zip.file("ppt/presentation.xml");
    if (!presFile) throw new Error("No presentation.xml in PPTX");
    var presXml = await presFile.async("string");

    // Extract ordered slide rIds from <p:sldId ... r:id="rIdN"/>
    var slideRIds = [];
    var sldIdRe = /<p:sldId[^>]+r:id="([^"]+)"/g;
    var sldMatch;
    while ((sldMatch = sldIdRe.exec(presXml)) !== null) {
      slideRIds.push(sldMatch[1]);
    }
    console.log("extractNotes: found", slideRIds.length, "slides in presentation.xml");

    // 2. Read presentation.xml.rels to map rId → slide file path
    var presRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
    if (!presRelsFile) throw new Error("No presentation.xml.rels");
    var presRelsXml = await presRelsFile.async("string");

    var rIdToTarget = {};
    var relRe = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
    var relMatch;
    while ((relMatch = relRe.exec(presRelsXml)) !== null) {
      rIdToTarget[relMatch[1]] = relMatch[2];
    }

    // 3. For each slide (in presentation order), find its notes
    var notesByIndex = [];
    for (var k = 0; k < slideRIds.length; k++) {
      var slideTarget = rIdToTarget[slideRIds[k]]; // e.g. "slides/slide3.xml"
      if (!slideTarget) {
        notesByIndex.push("");
        continue;
      }

      var slideFileName = slideTarget.split("/").pop(); // "slide3.xml"
      var slideRelsPath = "ppt/slides/_rels/" + slideFileName + ".rels";
      var slideRelsFile = zip.file(slideRelsPath);
      if (!slideRelsFile) {
        notesByIndex.push("");
        continue;
      }

      var slideRelsXml = await slideRelsFile.async("string");

      // Find notesSlide relationship
      var notesTarget = null;
      var noteRelRe = /<Relationship[^>]+Type="[^"]*notesSlide"[^>]+Target="([^"]+)"/g;
      var noteRelMatch = noteRelRe.exec(slideRelsXml);
      if (!noteRelMatch) {
        // Try alternate attribute order (Target before Type)
        var altRe = /<Relationship[^>]+Target="([^"]+)"[^>]+Type="[^"]*notesSlide"/g;
        noteRelMatch = altRe.exec(slideRelsXml);
      }
      if (!noteRelMatch) {
        notesByIndex.push("");
        continue;
      }
      notesTarget = noteRelMatch[1]; // e.g. "../notesSlides/notesSlide3.xml"

      // Resolve path: "../notesSlides/..." → "ppt/notesSlides/..."
      var notesPath = "ppt/" + notesTarget.replace(/^\.\.\//, "");
      var notesFile = zip.file(notesPath);
      if (!notesFile) {
        notesByIndex.push("");
        continue;
      }

      var notesXml = await notesFile.async("string");
      var notesText = extractNotesText(notesXml);
      notesByIndex.push(notesText);

      if (notesText) {
        console.log("extractNotes: slide", k + 1, "=>", notesText.length, "chars");
      }
    }

    return notesByIndex;
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
      try { await client.leaveGroup(token); } catch (_) {}
    }
    token = Shared.generateToken();
    document.getElementById("token").value = token;
    renderQrCode();
    if (client) await connectPubSub();
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
        handleCommand(e.message.data);
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
          Office.Index.First, Office.GoToType.Index,
          function () { setTimeout(syncCurrentSlide, 500); }
        );
        break;
      case "Prev":
        Office.context.document.goToByIdAsync(
          Office.Index.Previous, Office.GoToType.Index,
          function () { setTimeout(syncCurrentSlide, 500); }
        );
        break;
      case "Next":
        Office.context.document.goToByIdAsync(
          Office.Index.Next, Office.GoToType.Index,
          function () { setTimeout(syncCurrentSlide, 500); }
        );
        break;
      case "GoToSlide":
        if (typeof data.slideIndex === "number") {
          Office.context.document.goToByIdAsync(
            data.slideIndex + 1, Office.GoToType.Index,
            function () { setTimeout(syncCurrentSlide, 500); }
          );
        }
        break;
      case "PresenterJoined":
        syncStatus();
        syncAllSlides().catch(function (err) {
          console.error("syncAllSlides unhandled:", err);
        });
        break;
    }
  }

  // ---------- Office.js Integration ----------

  function syncStatus() {
    if (!Office.context || !Office.context.document) return;
    var docUrl = Office.context.document.url;
    var docName = docUrl ? docUrl.split(/[/\\]/).pop() : "(no name)";
    if (client) {
      client.sendToGroup(token, { type: "UpdateStatus", docName }, "json", { noEcho: true });
    }
  }

  function syncCurrentSlide() {
    if (!officeReady) return;

    Office.context.document.getSelectedDataAsync(
      Office.CoercionType.SlideRange,
      function (dataResult) {
        if (dataResult.status !== Office.AsyncResultStatus.Succeeded) {
          console.warn("syncCurrentSlide failed:", dataResult.error && dataResult.error.message);
          return;
        }

        var slideRange = dataResult.value;
        if (!slideRange || !slideRange.slides || slideRange.slides.length === 0) return;

        var slideIndex = slideRange.slides[0].index - 1;
        var slideId = slideRange.slides[0].id;

        console.log("syncCurrentSlide:", { slideIndex: slideIndex, slideId: slideId });

        if (client && slideIndex >= 0) {
          client.sendToGroup(
            token,
            { type: "SlideChanged", slideIndex: slideIndex, slideId: String(slideId) },
            "json",
            { noEcho: true }
          );
        }
      }
    );
  }

  async function syncAllSlides() {
    if (!officeReady) return;
    console.log("syncAllSlides: starting...");

    try {
      // Step 1: Extract notes from OOXML (getFileAsync + JSZip)
      var notesByIndex = [];
      if (typeof JSZip === "undefined") {
        console.warn("syncAllSlides: JSZip not loaded, skipping notes");
      } else if (Office.context.requirements && !Office.context.requirements.isSetSupported("File", "1.1")) {
        console.warn("syncAllSlides: File API not supported on this platform, skipping notes");
      } else {
        try {
          console.log("syncAllSlides: downloading PPTX for notes extraction...");
          // Allow up to 120s — file can be large and PowerPoint Online may be slow
          var fileData = await Promise.race([
            getFileAsUint8Array(),
            new Promise(function (_, reject) {
              setTimeout(function () { reject(new Error("getFileAsync timeout (120s)")); }, 120000);
            })
          ]);
          console.log("syncAllSlides: PPTX downloaded,", fileData.length, "bytes, parsing notes...");
          notesByIndex = await extractNotesFromPptx(fileData);
          var notesCount = notesByIndex.filter(function (n) { return n.length > 0; }).length;
          console.log("syncAllSlides: extracted notes for", notesCount, "/", notesByIndex.length, "slides");
        } catch (notesErr) {
          console.warn("syncAllSlides: notes extraction failed:", notesErr.message);
        }
      }

      // Step 2: Get thumbnails via PowerPoint Rich API
      await PowerPoint.run(async (context) => {
        var slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();

        console.log("syncAllSlides: loaded", slides.items.length, "slides for thumbnails");
        slideIds = slides.items.map(function (s) { return s.id; });

        var slideList = [];
        for (var i = 0; i < slides.items.length; i++) {
          var slide = slides.items[i];

          var thumbnail = null;
          try {
            var image = slide.getImageAsBase64();
            await context.sync();
            if (image.value) {
              thumbnail = await compressImage(image.value, 320, 0.5);
            }
          } catch (e) {
            console.warn("syncAllSlides: slide", i + 1, "thumbnail failed");
          }

          slideList.push({
            id: slide.id,
            index: i,
            thumbnail: thumbnail,
            notes: notesByIndex[i] || "",
          });

          console.log(
            "syncAllSlides: slide", i + 1,
            "=> thumbnail:", !!thumbnail,
            "notes:", (notesByIndex[i] || "").length, "chars"
          );
        }

        // Step 3: Send in chunks to avoid WebSocket message size limits
        console.log("syncAllSlides: sending", slideList.length, "slides in chunks...");
        if (client) {
          var chunkSize = 5;
          for (var c = 0; c < slideList.length; c += chunkSize) {
            var chunk = slideList.slice(c, c + chunkSize);
            client.sendToGroup(
              token,
              {
                type: "AllSlides",
                slides: chunk,
                offset: c,
                total: slideList.length,
              },
              "json",
              { noEcho: true }
            );
          }
        }
      });
    } catch (err) {
      console.error("syncAllSlides error:", err);
    }
  }

  // ---------- Office Ready ----------

  if (typeof Office !== "undefined" && Office.onReady) {
    Office.onReady(function () {
      officeReady = true;

      try {
        var savedTheme = Office.context.document.settings.get("theme");
        if (savedTheme) Shared.applyTheme(savedTheme);
      } catch (_) {}

      try {
        Office.context.document.addHandlerAsync(
          Office.EventType.DocumentSelectionChanged,
          function () { syncCurrentSlide(); }
        );
      } catch (_) {}

      connectPubSub();
    });
  } else {
    connectPubSub();
  }
})();
