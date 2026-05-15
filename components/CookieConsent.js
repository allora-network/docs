import React, { useEffect, useState } from "react";

const STORAGE_KEY = "allora-cookie-consent";

function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch (e) {
      setVisible(true);
    }
  }, []);

  const respond = (choice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch (e) {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        left: "20px",
        right: "20px",
        bottom: "20px",
        maxWidth: "520px",
        margin: "0 auto",
        padding: "16px 20px",
        background: "#1f1f1f",
        color: "#fff",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        zIndex: 1001,
        fontSize: "14px",
        lineHeight: 1.4,
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ flex: "1 1 240px" }}>
        We use cookies to improve your experience. You can accept or decline
        non-essential cookies.
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => respond("declined")}
          style={{
            padding: "8px 14px",
            fontSize: "14px",
            cursor: "pointer",
            background: "transparent",
            color: "#fff",
            border: "1px solid #888",
            borderRadius: "4px",
          }}
        >
          Decline
        </button>
        <button
          onClick={() => respond("accepted")}
          style={{
            padding: "8px 14px",
            fontSize: "14px",
            cursor: "pointer",
            background: "#22c55e",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            fontWeight: 600,
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

export default CookieConsent;
