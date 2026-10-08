"use client";

import { useState, useEffect, useRef } from "react";
import {
  Settings, Copy, Trash2, Lock, Unlock, Eye, EyeOff,
  BringToFront, SendToBack, Bookmark, ChevronDown, Plus, RotateCcw
} from "lucide-react";
import ColorPicker from "./ColorPicker.jsx";
import { defaultStyleFor } from "lightweight-charts-drawing";

const TEMPLATES_KEY = "ts_tool_templates";

export default function MiniDrawingToolbar({ api }) {
  const { selected, setSettingsOpen, updateSelected, cloneSelected, deleteSelected, bringToFront, sendToBack, toggleLock, toggleHide, activeTool } = api;

  const [isMobile, setIsMobile] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toolKind = selected?.kind || selected?.type || "tool";

  // Load templates for current tool
  useEffect(() => {
    if (!toolKind) return;
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      setTemplates(all[toolKind] || []);
    } catch {
      setTemplates([]);
    }
  }, [toolKind, templateOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!templateOpen) return;
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setTemplateOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsideClick);
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [templateOpen]);

  if (!selected || activeTool) return null;

  const set = (patch) => updateSelected(patch);

  const handleApplyTemplate = (tmpl) => {
    if (!tmpl || !tmpl.style) return;
    updateSelected({ style: tmpl.style });
    try {
      const saved = JSON.parse(localStorage.getItem("ts_tool_last_style") || "{}");
      saved[toolKind] = { ...(saved[toolKind] || {}), ...tmpl.style };
      localStorage.setItem("ts_tool_last_style", JSON.stringify(saved));
    } catch {}
    setTemplateOpen(false);
  };

  const handleSaveTemplate = () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      const list = all[toolKind] || [];
      const updated = [...list.filter((t) => t.name !== name), { name, style: { ...(selected.style || {}) } }];
      all[toolKind] = updated;
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
      setTemplates(updated);
      setNewTemplateName("");
      setIsSaving(false);
      setTemplateOpen(false);
    } catch (e) {
      console.error("Failed to save template:", e);
    }
  };

  const handleDeleteTemplate = (e, name) => {
    e.stopPropagation();
    try {
      const all = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
      const list = all[toolKind] || [];
      const updated = list.filter((t) => t.name !== name);
      all[toolKind] = updated;
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
      setTemplates(updated);
    } catch {}
  };

  const handleResetDefaults = () => {
    try {
      const def = defaultStyleFor(toolKind);
      if (def) {
        updateSelected({ style: def });
        const saved = JSON.parse(localStorage.getItem("ts_tool_last_style") || "{}");
        saved[toolKind] = { ...(saved[toolKind] || {}), ...def };
        localStorage.setItem("ts_tool_last_style", JSON.stringify(saved));
      }
    } catch {}
    setTemplateOpen(false);
  };

  const Btn = ({ icon: Icon, onClick, danger, active, title }) => (
    <button
      type="button"
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={active ? "primary" : "ghost"}
      title={title}
      style={{
        padding: "6px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
        color: danger ? "var(--red)" : "inherit", cursor: "pointer", flexShrink: 0
      }}
    >
      <Icon size={14} />
    </button>
  );

  return (
    <div
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: isMobile ? 8 : 12, left: "50%", transform: "translateX(-50%)", zIndex: 40,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,.5)", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        whiteSpace: "nowrap", overflowX: "visible", maxWidth: isMobile ? "calc(100vw - 16px)" : "95vw",
      }}
    >
      {/* Drawing type badge */}
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: "var(--muted)", paddingRight: 4, borderRight: "1px solid var(--border)", flexShrink: 0 }}>
        {selected.kind || selected.type}
      </span>

      {/* Template Selector Dropdown */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          onTouchStart={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setTemplateOpen((v) => !v);
            setIsSaving(false);
            setNewTemplateName("");
          }}
          className={templateOpen ? "primary" : "ghost"}
          title="Select or save tool template"
          style={{
            padding: "4px 6px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          <Bookmark size={13} />
          <span className="hide-mobile">Template</span>
          {templates.length > 0 && (
            <span style={{
              fontSize: 9,
              background: "rgba(255,255,255,0.15)",
              padding: "0 4px",
              borderRadius: 8,
              fontWeight: 600,
            }}>
              {templates.length}
            </span>
          )}
          <ChevronDown size={11} style={{ transform: templateOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>

        {/* Floating Template Menu */}
        {templateOpen && (
          <div
            ref={dropdownRef}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              minWidth: 220,
              maxWidth: 290,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.65)",
              zIndex: 100,
              display: "flex",
              flexDirection: "column",
              padding: "6px 0",
            }}
          >
            <div style={{ padding: "4px 10px 6px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "capitalize" }}>
                {toolKind} Templates
              </span>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>
                {templates.length} saved
              </span>
            </div>

            {/* Template Items List */}
            {templates.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                No saved templates
              </div>
            ) : (
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                {templates.map((tmpl) => (
                  <div
                    key={tmpl.name}
                    onClick={() => handleApplyTemplate(tmpl)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      gap: 8,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontWeight: 500 }}>
                      {tmpl.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteTemplate(e, tmpl.name)}
                      title="Delete template"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--muted)",
                        padding: "2px",
                        cursor: "pointer",
                        borderRadius: 3,
                        display: "flex",
                        alignItems: "center",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--red)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Save & Reset Actions */}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
              {!isSaving ? (
                <button
                  type="button"
                  onClick={() => setIsSaving(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "6px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--accent, #2962ff)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Plus size={12} />
                  <span>Save as Template...</span>
                </button>
              ) : (
                <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Template name..."
                    value={newTemplateName}
                    autoFocus
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTemplate();
                      if (e.key === "Escape") setIsSaving(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "4px 8px",
                      fontSize: 11,
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "inherit",
                      outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setIsSaving(false)}
                      className="ghost"
                      style={{ padding: "3px 8px", fontSize: 10, borderRadius: 3, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveTemplate}
                      className="primary"
                      disabled={!newTemplateName.trim()}
                      style={{ padding: "3px 8px", fontSize: 10, borderRadius: 3, cursor: "pointer" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleResetDefaults}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: 10,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <RotateCcw size={11} />
                <span>Reset to Defaults</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />

      {/* Color Picker */}
      <div
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
        title="Line color"
      >
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Color</span>
        <ColorPicker
          value={selected.color || selected.style?.color || "#2962ff"}
          onChange={(c) => set({ color: c, fill: c })}
          label="Line color"
          size={20}
        />
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />

      {/* Width Buttons */}
      <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            type="button"
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); set({ width: w }); }}
            title={`Width ${w}px`}
            className={selected.width === w ? "primary" : "ghost"}
            style={{ padding: "2px 5px", fontSize: 11, minWidth: 20, cursor: "pointer", borderRadius: 4 }}
          >
            {w}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />

      {/* Style Buttons */}
      <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
        {[
          { v: "solid", label: "—" },
          { v: "dashed", label: "╌" },
          { v: "dotted", label: "┄" },
        ].map((s) => (
          <button
            key={s.v}
            type="button"
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); set({ style: s.v }); }}
            title={s.v}
            className={selected.lineStyleName === s.v ? "primary" : "ghost"}
            style={{ padding: "2px 5px", fontSize: 12, minWidth: 22, cursor: "pointer", borderRadius: 4 }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />

      <Btn icon={Settings} onClick={() => setSettingsOpen(true)} title="Settings (full options)" />
      <Btn icon={Copy} onClick={() => cloneSelected(selected?.id)} title="Clone" />
      <Btn icon={BringToFront} onClick={() => bringToFront(selected?.id)} title="Bring to front ( ] )" />
      <Btn icon={SendToBack} onClick={() => sendToBack(selected?.id)} title="Send to back ( [ )" />
      <Btn icon={selected.locked ? Unlock : Lock} onClick={() => toggleLock(selected?.id)} active={selected.locked} title={selected.locked ? "Unlock" : "Lock"} />
      <Btn icon={selected.hidden ? EyeOff : Eye} onClick={() => toggleHide(selected?.id)} active={selected.hidden} title={selected.hidden ? "Show" : "Hide"} />

      <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />
      <Btn icon={Trash2} onClick={() => deleteSelected(selected?.id)} danger title="Delete (Del)" />
    </div>
  );
}
