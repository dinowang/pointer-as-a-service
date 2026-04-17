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
  const url = `${NEGOTIATE_ENDPOINT}?id=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Negotiate failed: ${res.status}`);
  return res.json();
}

async function createPubSubClient(token) {
  const { url } = await negotiate(token);
  // UMD bundle exposes AzureWebPubSubClient global
  const { WebPubSubClient: Client } = window.AzureWebPubSubClient || window;
  const client = new Client(url);
  return client;
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
