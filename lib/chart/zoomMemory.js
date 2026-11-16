// lib/chart/zoomMemory.js — Per-symbol & per-timeframe zoom level memory
// Remembers user's visible bar count (zoom) and right-edge offset per symbol & timeframe.
// Seamlessly persists across symbol switches, loop/slideshow mode, and reloads.
"use client";

import { toCanonicalSymbol } from "../symbols/mapping.js";

const LS_ZOOM_KEY = "ts_symbol_zooms";
const memoryCache = new Map();
let isHydrated = false;
let saveDebounceTimer = null;

function hydrate() {
  if (isHydrated || typeof window === "undefined") return;
  isHydrated = true;
  try {
    const raw = localStorage.getItem(LS_ZOOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v.visibleBars === "number" && Number.isFinite(v.visibleBars)) {
            memoryCache.set(k, v);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[zoomMemory] failed to parse saved zooms:", e);
  }
}

function persistToLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    const obj = {};
    for (const [k, v] of memoryCache.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(LS_ZOOM_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn("[zoomMemory] failed to save zooms to localStorage:", e);
  }
}

/**
 * Retrieves the saved zoom settings for a symbol and timeframe.
 * Priority:
 * 1. Specific `${canonical}:${tf}`
 * 2. General `${canonical}`
 * @returns {{ visibleBars: number, rightOffset: number } | null}
 */
export function getSymbolZoom(symbol, tf) {
  if (!symbol) return null;
  hydrate();
  const canon = toCanonicalSymbol(symbol) || symbol;
  const specificKey = `${canon}:${tf || ""}`;
  const generalKey = canon;

  if (memoryCache.has(specificKey)) {
    return memoryCache.get(specificKey);
  }
  if (memoryCache.has(generalKey)) {
    return memoryCache.get(generalKey);
  }
  return null;
}

/**
 * Saves the current zoom settings for a symbol and timeframe.
 * Updates both the specific `${canonical}:${tf}` and general `${canonical}` entries.
 */
export function saveSymbolZoom(symbol, tf, zoom) {
  if (!symbol || !zoom || typeof zoom.visibleBars !== "number") return;
  hydrate();
  const canon = toCanonicalSymbol(symbol) || symbol;
  const specificKey = `${canon}:${tf || ""}`;
  const generalKey = canon;

  const entry = {
    visibleBars: Math.max(10, Math.min(2500, Math.round(zoom.visibleBars))),
    rightOffset: Math.max(-50, Math.min(150, Math.round(zoom.rightOffset ?? 12))),
    updatedAt: Date.now(),
  };

  memoryCache.set(specificKey, entry);
  memoryCache.set(generalKey, entry);

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(persistToLocalStorage, 250);
}
