/**
 * GodsView TradingView Bridge — content script
 *
 * Runs on tradingview.com chart pages. Extracts:
 *   - symbol (from URL or page header)
 *   - timeframe (from active interval button)
 *   - last price (from price label DOM)
 *
 * Adds a small floating panel ("GodsView Capture") to the chart that:
 *   1. Shows current detected symbol/timeframe/price
 *   2. Lets the user pick direction (long/short) and signal type
 *   3. Captures the snapshot and POSTs to background → /api/tv-webhook
 *   4. Renders the most recent decision (grade, action, confidence, thesis)
 *   5. Shows rejection reasons if the decision was reject
 *
 * The DOM selectors on TradingView change frequently; this script tries
 * several fallbacks and degrades gracefully — the panel still works as a
 * manual capture tool even when auto-detection misses a field.
 */

(function () {
  if (window.__godsviewBridgeMounted) return;
  window.__godsviewBridgeMounted = true;

  const PANEL_ID = "godsview-capture-panel";

  /* ── Selectors (best-effort, fallback chain) ──────────────────────────── */
  function detectSymbol() {
    // Try URL first: /chart/<id>/?symbol=NASDAQ:AAPL
    try {
      const u = new URL(window.location.href);
      const sym = u.searchParams.get("symbol");
      if (sym) return sym.split(":").pop();
    } catch (_) {
      /* ignore */
    }
    // Try header element
    const sel = document.querySelector('[data-name="legend-source-title"]')
      ?? document.querySelector('button[id^="header-toolbar-symbol-search"]')
      ?? document.querySelector('div[class*="symbolNameText"]');
    if (sel?.textContent) return sel.textContent.trim();
    // Try title
    const m = document.title.match(/^([A-Z0-9.\-]+)/);
    return m ? m[1] : "";
  }

  function detectTimeframe() {
    // Active interval button has aria-pressed=true
    const active = document.querySelector('button[aria-pressed="true"][data-tooltip*="Interval"]')
      ?? document.querySelector('div[id^="header-toolbar-intervals"] button[aria-pressed="true"]');
    const txt = active?.textContent?.trim();
    if (txt) {
      const norm = txt.toLowerCase().replace(/\s+/g, "");
      // Normalize common forms: 1m,5m,15m,1h,4h,1D
      if (/^\d+m$/.test(norm)) return norm;
      if (/^\d+h$/.test(norm)) return norm;
      if (/^1d$/.test(norm)) return "1d";
    }
    return "1h";
  }

  function detectPrice() {
    const candidates = [
      'div[class*="lastPrice"] span',
      'div[class*="price-"] span',
      '[data-name="legend-series-item"] span[class*="value"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      const num = parseFloat((el?.textContent ?? "").replace(/[^\d.\-]/g, ""));
      if (Number.isFinite(num) && num > 0) return num;
    }
    return null;
  }

  /* ── Panel UI ─────────────────────────────────────────────────────────── */
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "width:300px",
      "background:#0c0d10",
      "color:#e6e6e6",
      "border:1px solid #2a2c33",
      "border-radius:10px",
      "padding:12px",
      "z-index:2147483647",
      "font-family:'SF Mono',Menlo,monospace",
      "font-size:12px",
      "box-shadow:0 8px 30px rgba(0,0,0,0.45)",
    ].join(";");

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#9cff93;letter-spacing:.05em;">GODSVIEW CAPTURE</strong>
        <span id="gv-status" title="server status" style="font-size:10px;color:#888;">·</span>
      </div>
      <div id="gv-context" style="margin-bottom:8px;line-height:1.55;">
        <div>symbol: <span id="gv-sym" style="color:#67e8f9;">—</span></div>
        <div>tf:     <span id="gv-tf"  style="color:#67e8f9;">—</span></div>
        <div>price:  <span id="gv-px"  style="color:#67e8f9;">—</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <select id="gv-dir" style="flex:1;background:#1a1b1f;color:#e6e6e6;border:1px solid #2a2c33;border-radius:4px;padding:4px;">
          <option value="long">long</option>
          <option value="short">short</option>
          <option value="neutral">neutral</option>
        </select>
        <select id="gv-sig" style="flex:1.6;background:#1a1b1f;color:#e6e6e6;border:1px solid #2a2c33;border-radius:4px;padding:4px;">
          <option value="custom">custom</option>
          <option value="breakout">breakout</option>
          <option value="breakdown">breakdown</option>
          <option value="reversal_long">reversal_long</option>
          <option value="reversal_short">reversal_short</option>
          <option value="pullback_long">pullback_long</option>
          <option value="pullback_short">pullback_short</option>
          <option value="order_block_entry">order_block_entry</option>
          <option value="fvg_fill">fvg_fill</option>
          <option value="sweep_reclaim">sweep_reclaim</option>
          <option value="vwap_reclaim">vwap_reclaim</option>
          <option value="opening_range_breakout">opening_range_breakout</option>
        </select>
      </div>
      <button id="gv-send" style="width:100%;background:#9cff93;color:#0c0d10;border:0;border-radius:6px;padding:8px;font-weight:700;cursor:pointer;">
        Capture &amp; send to GodsView
      </button>
      <div id="gv-result" style="margin-top:10px;font-size:11px;line-height:1.55;color:#aaa;">
        ready
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? "—");
  }

  function refreshContext() {
    setText("gv-sym", detectSymbol());
    setText("gv-tf", detectTimeframe());
    const px = detectPrice();
    setText("gv-px", px ? px.toFixed(4) : "—");
  }

  function refreshStatus() {
    chrome.runtime.sendMessage({ type: "GV_PING" }, (resp) => {
      const dot = document.getElementById("gv-status");
      if (!dot) return;
      const ok = resp?.ok && resp?.status === "up";
      dot.textContent = ok ? `● ${resp.latencyMs ?? 0}ms` : "● offline";
      dot.style.color = ok ? "#9cff93" : "#ff7162";
    });
  }

  function renderResult(resp) {
    const el = document.getElementById("gv-result");
    if (!el) return;
    if (!resp?.ok) {
      el.innerHTML = `<span style="color:#ff7162;">err: ${resp?.error ?? "unknown"}</span>`;
      return;
    }
    const d = resp.decision ?? {};
    const color = d.action === "execute" ? "#9cff93" : d.action === "watch" ? "#fbbf24" : "#ff7162";
    el.innerHTML = `
      <div><span style="color:${color};font-weight:700;">${(d.action ?? "?").toUpperCase()}</span>
        ${d.direction ?? ""} · grade <strong>${d.grade ?? "?"}</strong>
        · score ${d.overallScore ?? "?"} · conf ${(d.confidence != null ? (d.confidence * 100).toFixed(0) + "%" : "?")}</div>
      <div style="color:#888;margin-top:4px;">${(d.thesis ?? "").substring(0, 200)}</div>
      ${(d.rejectionReasons ?? []).length
        ? `<ul style="margin:4px 0 0 16px;color:#ff9a8a;padding:0;">${d.rejectionReasons.map((r) => `<li>${r}</li>`).join("")}</ul>`
        : ""}
    `;
  }

  function send() {
    const symbol = document.getElementById("gv-sym")?.textContent?.trim();
    const tf = document.getElementById("gv-tf")?.textContent?.trim();
    const pxText = document.getElementById("gv-px")?.textContent?.trim();
    const direction = document.getElementById("gv-dir")?.value ?? "long";
    const signal = document.getElementById("gv-sig")?.value ?? "custom";
    const price = parseFloat(pxText);

    if (!symbol || !Number.isFinite(price)) {
      renderResult({ ok: false, error: "missing symbol or price — refresh and retry" });
      return;
    }

    const payload = {
      symbol,
      signal,
      direction,
      timeframe: ["1m", "5m", "15m", "1h", "4h", "1d"].includes(tf) ? tf : "1h",
      price,
      timestamp: Date.now(),
      strategy_name: "chrome_extension_capture",
      message: `captured from ${window.location.href}`,
      meta: { source_url: window.location.href },
    };

    document.getElementById("gv-result").textContent = "sending...";
    chrome.runtime.sendMessage({ type: "GV_SIGNAL", payload }, (resp) => {
      renderResult(resp);
    });
  }

  /* ── Bootstrap ────────────────────────────────────────────────────────── */
  const panel = ensurePanel();
  panel.querySelector("#gv-send").addEventListener("click", send);
  refreshContext();
  refreshStatus();
  // Light polling so the panel reflects the current chart state.
  setInterval(refreshContext, 2000);
  setInterval(refreshStatus, 30000);
})();
