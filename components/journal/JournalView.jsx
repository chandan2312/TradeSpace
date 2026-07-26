"use client";

import { useState, useEffect } from "react";
import JournalForm from "./JournalForm";

export default function JournalView() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTrade, setEditingTrade] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    try {
      const res = await fetch("/api/journal");
      const data = await res.json();
      setTrades(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load journal", err);
    } finally {
      setLoading(false);
    }
  };

  const openForm = (trade = null) => {
    setEditingTrade(trade);
    setShowForm(true);
  };

  const closeForm = (shouldRefresh) => {
    setShowForm(false);
    setEditingTrade(null);
    if (shouldRefresh) fetchTrades();
  };

  const renderResultBadge = (result) => {
    const res = (result || "").toLowerCase();
    if (res.includes("win") || res.includes("profit")) return <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>Profit</span>;
    if (res.includes("loss")) return <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>Loss</span>;
    return <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>Breakeven</span>;
  };

  const formatCurrency = (val) => {
    const num = Number(val);
    return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`;
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-white transition-colors" title="Back to Charts">
            ←
          </a>
          <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
        </div>
        <button
          onClick={() => openForm()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium text-sm transition-colors"
        >
          + New Entry
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-20">Loading journal...</div>
      ) : trades.length === 0 ? (
        <div className="text-center text-gray-500 py-20 border border-neutral-800 rounded-lg border-dashed">
          No entries yet. Click "New Entry" to log a trade.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trades.map((t) => (
            <div 
              key={t._id} 
              onClick={() => openForm(t)}
              className="bg-[#1A1A1A] border border-neutral-800 rounded-lg overflow-hidden cursor-pointer hover:border-neutral-600 transition-colors group flex flex-col"
            >
              <div className="h-48 bg-neutral-900 border-b border-neutral-800 relative w-full flex-shrink-0">
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt={t.title} className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">No Image</div>
                )}
              </div>
              
              <div className="p-4 flex flex-col flex-grow">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-gray-400">📈</span>
                  <span className="font-semibold text-sm tracking-wide">{t.title || "Untitled"}</span>
                </div>
                
                <div className="text-xs text-neutral-400 mb-4">
                  {new Date(t.date).toLocaleString(undefined, { 
                    month: '2-digit', day: '2-digit', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit'
                  })}
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4 mt-auto">
                  {t.asset && (
                    <span className="px-2 py-0.5 bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 rounded text-xs font-medium">
                      {t.asset}
                    </span>
                  )}
                  {t.session && (
                    <span className="px-2 py-0.5 bg-amber-900/30 text-amber-500 border border-amber-800/40 rounded text-xs font-medium">
                      {t.session}
                    </span>
                  )}
                  {t.side && (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                      (t.side||"").toLowerCase() === "long" 
                      ? "bg-blue-900/30 text-blue-400 border-blue-800/40" 
                      : "bg-rose-900/30 text-rose-400 border-rose-800/40"
                    }`}>
                      {t.side}
                    </span>
                  )}
                </div>
                
                <div className="text-sm font-medium mb-1">
                  {renderResultBadge(t.result)}
                </div>
                
                <div className="text-sm font-semibold mt-1">
                  {formatCurrency(t.pnl)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <JournalForm trade={editingTrade} onClose={closeForm} />
      )}
    </div>
  );
}
