"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function ChecklistPanel({ items, onSave, onClose }) {
  const [draft, setDraft] = useState(items || []);
  const [editing, setEditing] = useState(false);
  const [newItemText, setNewItemText] = useState("");

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
    onSave(draft);
    onClose();
  };

  return (
    <div style={{
      position: "absolute", top: 40, left: 12, width: 280,
      background: "var(--panel)", border: "1px solid var(--border)",
      borderRadius: 6, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      display: "flex", flexDirection: "column", pointerEvents: "auto"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Trading Checklist</h3>
        <button className="ghost" onClick={onClose} style={{ padding: "4px" }}><X size={14} /></button>
      </div>

      <div style={{ padding: 12, flex: 1, overflowY: "auto", maxHeight: 300, display: "flex", flexDirection: "column", gap: 8 }}>
        {draft.length === 0 && (
          <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: "10px 0" }}>No rules yet. Click Edit to add some!</div>
        )}
        {draft.map((item) => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!editing && (
              <input 
                type="checkbox" 
                checked={item.checked} 
                onChange={() => toggleItem(item.id)}
                style={{ cursor: "pointer" }}
              />
            )}
            <span style={{ fontSize: 13, flex: 1, textDecoration: item.checked && !editing ? "line-through" : "none", opacity: item.checked && !editing ? 0.6 : 1 }}>
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
              style={{ flex: 1, padding: "4px 8px", fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
            />
            <button type="submit" style={{ padding: "4px 8px", fontSize: 12 }}>Add</button>
          </form>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
        <button className="ghost" onClick={() => setEditing(!editing)} style={{ fontSize: 12 }}>
          {editing ? "Done" : "Edit"}
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          {!editing && <button className="ghost" onClick={resetChecks} style={{ fontSize: 12 }}>Reset</button>}
          <button className="primary" onClick={handleSave} style={{ fontSize: 12 }}>Save</button>
        </div>
      </div>
    </div>
  );
}
