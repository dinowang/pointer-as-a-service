/**
 * Shared module — theme management, token generation, Web PubSub connection.
 * Used by both index.js (Host) and control.js (Controller).
 */

// ---------- Configuration ----------

const FUNCTIONS_BASE_URL = window.__FUNCTIONS_BASE_URL || "";
const NEGOTIATE_ENDPOINT = `${FUNCTIONS_BASE_URL}/api/negotiate`;

// ---------- Theme ----------

const ThemeMode = Object.freeze({
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
});

function getStoredTheme() {
  return localStorage.getItem("theme") || ThemeMode.SYSTEM;
}

function applyTheme(mode) {
  localStorage.setItem("theme", mode);

  let effective;
  if (mode === ThemeMode.SYSTEM) {
    effective = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? ThemeMode.DARK
      : ThemeMode.LIGHT;
  } else {
    effective = mode;
  }

  document.documentElement.setAttribute("data-theme", effective);
  updateThemeButtons(mode);
}

function updateThemeButtons(activeMode) {
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === activeMode);
  });
}

function initTheme() {
  const stored = getStoredTheme();
  applyTheme(stored);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getStoredTheme() === ThemeMode.SYSTEM) {
        applyTheme(ThemeMode.SYSTEM);
      }
    });

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
    });
  });
}

// ---------- Token ----------

function generateToken() {
  return crypto.randomUUID();
}

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || null;
}

// ---------- Web PubSub ----------

async function negotiate(token) {
  var url = NEGOTIATE_ENDPOINT + "?id=" + encodeURIComponent(token);
  var res = await fetch(url);
  if (!res.ok) throw new Error("Negotiate failed: " + res.status);
  return res.json();
}

// Lightweight Web PubSub client using native WebSocket
// with json.webpubsub.azure.v1 subprotocol
function PubSubClient(wsUrl) {
  var self = this;
  var ws = null;
  var handlers = {};
  var ackId = 1;

  self.on = function (event, fn) {
    handlers[event] = handlers[event] || [];
    handlers[event].push(fn);
  };

  function emit(event, data) {
    (handlers[event] || []).forEach(function (fn) { fn(data); });
  }

  self.start = function () {
    return new Promise(function (resolve, reject) {
      ws = new WebSocket(wsUrl, "json.webpubsub.azure.v1");

      ws.onopen = function () {
        // connected event comes from server message, not onopen
      };

      ws.onmessage = function (evt) {
        var msg;
        try { msg = JSON.parse(evt.data); } catch (_) { return; }

        if (msg.event === "connected") {
          emit("connected", msg);
          resolve();
        } else if (msg.event === "disconnected") {
          emit("disconnected", msg);
        } else if (msg.type === "message" && msg.from === "group") {
          emit("group-message", {
            message: {
              group: msg.group,
              data: msg.data
            }
          });
        }
      };

      ws.onclose = function () {
        emit("disconnected", {});
      };

      ws.onerror = function (err) {
        reject(err);
      };
    });
  };

  self.joinGroup = function (group) {
    ws.send(JSON.stringify({
      type: "joinGroup",
      group: group,
      ackId: ackId++
    }));
  };

  self.sendToGroup = function (group, data, dataType, options) {
    var msg = {
      type: "sendToGroup",
      group: group,
      data: data,
      dataType: dataType || "json",
      ackId: ackId++
    };
    if (options && options.noEcho) {
      msg.noEcho = true;
    }
    ws.send(JSON.stringify(msg));
  };

  self.stop = function () {
    if (ws) ws.close();
  };
}

async function createPubSubClient(token) {
  var result = await negotiate(token);
  return new PubSubClient(result.url);
}

// ---------- Status indicator ----------

function setStatus(state, text) {
  const dot = document.querySelector(".status-dot");
  const label = document.querySelector(".status-text");
  if (dot) {
    dot.className = "status-dot";
    if (state) dot.classList.add(state);
  }
  if (label) label.textContent = text || state || "";
}

// ---------- Wake Lock ----------

let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (err) {
    console.warn("Wake Lock failed:", err.message);
  }
}

function initWakeLock() {
  requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !wakeLock) {
      requestWakeLock();
    }
  });
}

// ---------- Exports (global) ----------

window.Shared = {
  ThemeMode,
  initTheme,
  applyTheme,
  generateToken,
  getTokenFromUrl,
  negotiate,
  createPubSubClient,
  setStatus,
  requestWakeLock,
  initWakeLock,
};
