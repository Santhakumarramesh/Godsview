/**
 * DemoDataBanner — Warns users when API responses contain demo/fixture data.
 *
 * In production, this banner is a hard warning that real broker data is not
 * flowing. In dev/staging, it's an informational notice.
 *
 * Usage: Place <DemoDataBanner /> in the root layout so it appears globally.
 */
import { useEffect, useState } from "react";
import { __hasDemoDataWarning, onDemoDataDetected } from "../lib/api";

const IS_PROD = import.meta.env.PROD;

export default function DemoDataBanner() {
  const [visible, setVisible] = useState(__hasDemoDataWarning);

  useEffect(() => {
    return onDemoDataDetected((isDemoData) => {
      if (isDemoData) setVisible(true);
    });
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "8px 16px",
        background: IS_PROD ? "#dc2626" : "#f59e0b",
        color: IS_PROD ? "#fff" : "#000",
        textAlign: "center",
        fontSize: 14,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <span>{IS_PROD ? "⚠️" : "ℹ️"}</span>
      <span>
        {IS_PROD
          ? "PRODUCTION WARNING: Some endpoints are returning demo data. Broker credentials may not be configured."
          : "Demo Mode: Some endpoints are returning fixture data instead of live market data."}
      </span>
      <button
        onClick={() => setVisible(false)}
        style={{
          marginLeft: 12,
          background: "transparent",
          border: "1px solid currentColor",
          borderRadius: 4,
          color: "inherit",
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 12,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
