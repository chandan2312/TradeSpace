"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function ChecklistPanel({ symbol, items, notes, onSave, onClose }) {
  const [draft, setDraft] = useState(items || []);
  const [draftNotes, setDraftNotes] = useState(notes || "");
  const [editing, setEditing] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [activeTab, setActiveTab] = useState("checklist"); // "checklist" | "notes"

  const toggleItem = (id) => {
    setDraft(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  const addItem = (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    setDraft(prev => [...prev, { id: Date.now().toString(), text: newItemText.trim(), checked: false }]);
    setNewItemText("");
  };

  const removeItem = (id) => {
    setDraft(prev => prev.filter(item => item.id !== id));
  };

  const resetChecks = () => {
    setDraft(prev => prev.map(item => ({ ...item, checked: false })));
  };

  const handleSave = () => {
    onSave({ checklist: draft, notes: draftNotes });
    onClose();
  };

  return (
    <div style={{
      position: "absolute", top: 40, left: 12, width: 300,
      background: "var(--panel)", border: "1px solid var(--border)",
      borderRadius: 6, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      display: "flex", flexDirection: "column", pointerEvents: "auto"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", borderRadius: "6px 6px 0 0" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{symbol}</h3>
        <div style={{ display: "flex", gap: 12, fontSize: 13, fontWeight: 600 }}>
          <div onClick={() => setActiveTab("checklist")} style={{ cursor: "pointer", color: activeTab === "checklist" ? "var(--fg)" : "var(--muted)", textDecoration: activeTab === "checklist" ? "underline" : "none", textUnderlineOffset: 4 }}>Checklist</div>
          <div onClick={() => setActiveTab("notes")} style={{ cursor: "pointer", color: activeTab === "notes" ? "var(--fg)" : "var(--muted)", textDecoration: activeTab === "notes" ? "underline" : "none", textUnderlineOffset: 4 }}>Notes</div>
        </div>
        <button className="ghost" onClick={onClose} style={{ padding: "4px" }}><X size={14} /></button>
      </div>

      <div style={{ padding: 12, flex: 1, overflowY: "auto", minHeight: 150, maxHeight: 350, display: "flex", flexDirection: "column", gap: 8 }}>
        {activeTab === "checklist" ? (
          <>
            {draft.length === 0 && (
              <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: "20px 0" }}>No rules yet. Click Edit to add some!</div>
            )}
            {draft.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                {!editing && (
                  <input 
                    type="checkbox" 
                    checked={item.checked} 
                    onChange={() => toggleItem(item.id)}
                    style={{ cursor: "pointer", marginTop: 2 }}
                  />
                )}
                <span style={{ fontSize: 13, flex: 1, textDecoration: item.checked && !editing ? "line-through" : "none", opacity: item.checked && !editing ? 0.4 : 1, lineHeight: 1.4, wordBreak: "break-word" }}>
                  {item.text}
                </span>
                {editing && (
                  <button className="ghost danger" onClick={() => removeItem(item.id)} style={{ padding: "4px" }}><X size={14} /></button>
                )}
              </div>
            ))}

            {editing && (
              <form onSubmit={addItem} style={{ display: "flex", gap: 4, marginTop: 8 }}>
                <input 
                  type="text" 
                  value={newItemText} 
                  onChange={e => setNewItemText(e.target.value)} 
                  placeholder="Add new rule..."
                  style={{ flex: 1, padding: "6px 8px", fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                />
                <button type="submit" className="primary" style={{ padding: "6px 12px", fontSize: 12 }}>Add</button>
              </form>
            )}
          </>
        ) : (
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            placeholder={`Enter your trading notes for ${symbol} here...`}
            style={{
              width: "100%", height: 200, resize: "vertical",
              background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)",
              borderRadius: 4, padding: "8px", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
              outline: "none"
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
        {activeTab === "checklist" ? (
          <button className="ghost" onClick={() => setEditing(!editing)} style={{ fontSize: 12, fontWeight: 600 }}>
            {editing ? "Done" : "Edit"}
          </button>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {activeTab === "checklist" && !editing && <button className="ghost" onClick={resetChecks} style={{ fontSize: 12, fontWeight: 600 }}>Reset</button>}
          <button className="primary" onClick={handleSave} style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px" }}>Save</button>
        </div>
      </div>
    </div>
  );
}
