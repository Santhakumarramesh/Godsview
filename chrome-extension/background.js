/**
 * GodsView TradingView Bridge — background service worker (MV3)
 *
 * Responsibilities:
 *   - Owns connection state to the GodsView MCP webhook
 *   - Receives chart context from content scripts
 *   - POSTs normalized TradingView signals to /api/tv-webhook
 *   - Pings /api/health every 60s and tracks server status
 *   - Stores last signal + last decision in chrome.storage.local
 *
 * Public messages (chrome.runtime.sendMessage):
 *   { type: 'GV_SIGNAL', payload: <TradingView signal> }
 *     → returns { ok, decision?, error? }
 *   { type: 'GV_PING' }
 *     → returns { ok, status, latencyMs?, server?, error? }
 *   { type: 'GV_GET_STATE' }
 *     → returns { server, status, lastSignal, lastDecision, lastError }
 */

const STATE_KEY = "godsview_state_v1";
const SETTINGS_KEY = "godsview_settings_v1";

const DEFAULT_SETTINGS = {
  serverUrl: "http://127.0.0.1:5001",
  passphrase: "",
  autoSubmit: false,
  pingIntervalMin: 1,
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

async function saveSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...next };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] ?? {
    server: DEFAULT_SETTINGS.serverUrl,
    status: "unknown",
    lastSignal: null,
    lastDecision: null,
    lastError: null,
    lastPingAt: null,
  };
}

async function patchState(patch) {
  const current = await loadState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function ping() {
  const settings = await loadSettings();
  const url = `${settings.serverUrl.replace(/\/$/, "")}/api/health`;
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      await patchState({
        status: "down",
        server: settings.serverUrl,
        lastError: `HTTP ${res.status}`,
        lastPingAt: new Date().toISOString(),
      });
      return { ok: false, status: "down", latencyMs, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    await patchState({
      status: "up",
      server: settings.serverUrl,
      lastError: null,
      lastPingAt: new Date().toISOString(),
    });
    return { ok: true, status: "up", latencyMs, server: settings.serverUrl, payload: json };
  } catch (err) {
    await patchState({
      status: "down",
      server: settings.serverUrl,
      lastError: err?.message ?? "fetch failed",
      lastPingAt: new Date().toISOString(),
    });
    return { ok: false, status: "down", error: err?.message ?? "fetch failed" };
  }
}

async function submitSignal(signal) {
  const settings = await loadSettings();
  const url = `${settings.serverUrl.replace(/\/$/, "")}/api/tv-webhook`;
  const body = {
    symbol: signal.symbol,
    signal: signal.signal ?? "custom",
    direction: signal.direction ?? "neutral",
    timeframe: signal.timeframe ?? "1h",
    price: Number(signal.price),
    timestamp: Math.floor((signal.timestamp ?? Date.now()) / 1000),
    stop_loss: signal.stop_loss != null ? Number(signal.stop_loss) : undefined,
    take_profit: signal.take_profit != null ? Number(signal.take_profit) : undefined,
    strategy_name: signal.strategy_name ?? "chrome_extension_capture",
    message: signal.message ?? "",
    passphrase: settings.passphrase,
    meta: signal.meta ?? {},
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      const errMsg = json.error ?? `HTTP ${res.status}`;
      await patchState({ lastSignal: body, lastError: errMsg });
      return { ok: false, error: errMsg, server: settings.serverUrl, raw: json };
    }
    await patchState({
      lastSignal: body,
      lastDecision: {
        signalId: json.signalId,
        action: json.action,
        direction: json.direction,
        confidence: json.confidence,
        grade: json.grade,
        overallScore: json.overallScore,
        thesis: json.thesis,
        rejectionReasons: json.rejectionReasons ?? [],
        receivedAt: new Date().toISOString(),
      },
      lastError: null,
    });
    return { ok: true, decision: json, server: settings.serverUrl };
  } catch (err) {
    const msg = err?.message ?? "fetch failed";
    await patchState({ lastSignal: body, lastError: msg });
    return { ok: false, error: msg };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }
  switch (msg.type) {
    case "GV_PING":
      ping().then(sendResponse);
      return true;
    case "GV_SIGNAL":
      submitSignal(msg.payload ?? {}).then(sendResponse);
      return true;
    case "GV_GET_STATE":
      Promise.all([loadState(), loadSettings()]).then(([state, settings]) => {
        sendResponse({ ok: true, state, settings });
      });
      return true;
    case "GV_SAVE_SETTINGS":
      saveSettings(msg.payload ?? {}).then((s) => sendResponse({ ok: true, settings: s }));
      return true;
    default:
      sendResponse({ ok: false, error: `unknown_type:${msg.type}` });
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings(); // ensures defaults persist
  chrome.alarms.create("godsview_ping", { periodInMinutes: DEFAULT_SETTINGS.pingIntervalMin });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "godsview_ping") {
    ping().catch(() => {});
  }
});
