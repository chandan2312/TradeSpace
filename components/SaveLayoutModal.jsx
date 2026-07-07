"use client";

import { useState } from "react";

export default function SaveLayoutModal({ onCancel, onSave }) {
  const [name, setName] = useState("");
  const [includeSync, setIncludeSync] = useState(true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSave({ name: name.trim(), includeSync });
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex",
      alignItems: "center", justifyContent: "center"
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "var(--panel)", padding: 24, borderRadius: 8, width: 340,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)", border: "1px solid var(--border)"
      }}>
        <h3 style={{ margin: "0 0 16px 0" }}>Save Layout</h3>
        
        <label style={{ display: "block", marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
          Layout Name
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Crypto Grid"
            style={{
              width: "100%", padding: "8px 12px", marginTop: 6,
              background: "var(--bg)", border: "1px solid var(--border)",
              color: "#fff", borderRadius: 4, outline: "none", boxSizing: "border-box"
            }}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 24, cursor: "pointer" }}>
          <input 
            type="checkbox" 
            checked={includeSync} 
            onChange={(e) => setIncludeSync(e.target.checked)} 
          />
          Save current Sync Settings
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}
