/**
 * GodsView Bridge — popup script
 * Reads/writes settings + state from background via runtime messages.
 */

const $ = (id) => document.getElementById(id);

function fmtAgo(iso) {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d) || d < 0) return iso;
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3_600_000)}h ago`;
}

function colorize(el, status) {
  el.classList.remove("ok", "warn", "err");
  if (status === "up") el.classList.add("ok");
  else if (status === "unknown") el.classList.add("warn");
  else el.classList.add("err");
}

function render(state, settings) {
  $("server").textContent = state?.server ?? settings?.serverUrl ?? "—";
  const statusEl = $("status");
  statusEl.textContent = state?.status ?? "unknown";
  colorize(statusEl, state?.status ?? "unknown");
  $("last-ping").textContent = fmtAgo(state?.lastPingAt);
  $("server-url").value = settings?.serverUrl ?? "";
  $("passphrase").value = settings?.passphrase ?? "";
  if (state?.lastSignal) {
    const s = state.lastSignal;
    $("last-signal").textContent =
      `last signal: ${s.symbol} ${s.direction} ${s.signal} @ ${s.price} (${s.timeframe})`;
  } else {
    $("last-signal").textContent = "last signal: —";
  }
  if (state?.lastDecision) {
    const d = state.lastDecision;
    const conf = d.confidence != null ? `${(d.confidence * 100).toFixed(0)}%` : "?";
    $("last-decision").innerHTML = `last decision: <strong>${(d.action ?? "?").toUpperCase()}</strong> `
      + `· grade ${d.grade ?? "?"} · score ${d.overallScore ?? "?"} · conf ${conf}`
      + (d.thesis ? `\n${d.thesis.substring(0, 240)}` : "");
  } else if (state?.lastError) {
    $("last-decision").innerHTML = `<span class="err">last error: ${state.lastError}</span>`;
  } else {
    $("last-decision").textContent = "last decision: —";
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "GV_GET_STATE" }, (resp) => {
    if (!resp?.ok) return;
    render(resp.state, resp.settings);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  refresh();
  $("save").addEventListener("click", () => {
    const payload = {
      serverUrl: $("server-url").value.trim(),
      passphrase: $("passphrase").value,
    };
    chrome.runtime.sendMessage({ type: "GV_SAVE_SETTINGS", payload }, () => refresh());
  });
  $("ping").addEventListener("click", () => {
    $("status").textContent = "pinging…";
    chrome.runtime.sendMessage({ type: "GV_PING" }, () => refresh());
  });
});
