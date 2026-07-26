"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function JournalForm({ trade, onClose }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: trade?.title || "",
    date: trade?.date ? new Date(trade.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    session: trade?.session || "",
    asset: trade?.asset || "",
    result: trade?.result || "Profit",
    side: trade?.side || "Long",
    rr: trade?.rr || 0,
    pnl: trade?.pnl || 0,
    maxRr: trade?.maxRr || 0,
    maxRrType: trade?.maxRrType || "Before Breakeven",
    tradeIdea: trade?.tradeIdea || "",
    learning: trade?.learning || "",
    account: trade?.account || "",
    imageUrl: trade?.imageUrl || ""
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image too large (max 2MB)");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, imageUrl: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const url = trade ? `/api/journal/${trade._id}` : `/api/journal`;
      const method = trade ? "PUT" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      if (data.ok) {
        toast.success(trade ? "Entry updated" : "Entry created");
        onClose(true); // true means refresh needed
      } else {
        toast.error(data.error || "Failed to save entry");
      }
    } catch (err) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!trade || !confirm("Delete this entry?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/journal/${trade._id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        toast.success("Entry deleted");
        onClose(true);
      } else {
        toast.error(data.error || "Failed to delete");
      }
    } catch (err) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#121212] border border-neutral-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-[#1A1A1A]">
          <h2 className="text-lg font-semibold">{trade ? "Edit Entry" : "New Journal Entry"}</h2>
          <button onClick={() => onClose(false)} className="text-gray-400 hover:text-white transition-colors">
            ✕
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-grow custom-scrollbar">
          <form id="journal-form" onSubmit={handleSubmit} className="space-y-6">
            
            {/* Image Preview & Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400">Chart Screenshot</label>
              <div className="flex gap-4 items-end">
                <div className="w-48 h-32 bg-neutral-900 border border-neutral-800 rounded overflow-hidden flex items-center justify-center relative">
                  {formData.imageUrl ? (
                    <img src={formData.imageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-neutral-500 text-xs">No Image</span>
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <input 
                    type="url" name="imageUrl" value={formData.imageUrl} onChange={handleChange} 
                    placeholder="Image URL or Base64" 
                    className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none"
                  />
                  <input 
                    type="file" accept="image/*" onChange={handleImageUpload}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-neutral-800 file:text-white hover:file:bg-neutral-700"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Title / ID</label>
                  <input required name="title" value={formData.title} onChange={handleChange} placeholder="e.g. NQ-BT001" className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Date & Time</label>
                  <input required type="datetime-local" name="date" value={formData.date} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none style-date-picker" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Asset</label>
                    <input required name="asset" value={formData.asset} onChange={handleChange} placeholder="NQ, EURUSD" className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Session</label>
                    <select name="session" value={formData.session} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none">
                      <option value="">Select...</option>
                      <option value="New York Open">New York Open</option>
                      <option value="London Open">London Open</option>
                      <option value="Asian Session">Asian Session</option>
                      <option value="NY (17:00-23:00)">NY (17:00-23:00)</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Side</label>
                    <select name="side" value={formData.side} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none">
                      <option value="Long">Long</option>
                      <option value="Short">Short</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Result</label>
                    <select name="result" value={formData.result} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none">
                      <option value="Profit">Profit</option>
                      <option value="Loss">Loss</option>
                      <option value="Breakeven">Breakeven</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">PnL ($)</label>
                    <input type="number" step="0.01" name="pnl" value={formData.pnl} onChange={handleChange} placeholder="1850.00" className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Account</label>
                    <input name="account" value={formData.account} onChange={handleChange} placeholder="FP10KP1" className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">RR</label>
                    <input type="number" step="0.01" name="rr" value={formData.rr} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Max RR</label>
                    <input type="number" step="0.01" name="maxRr" value={formData.maxRr} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Max RR Type</label>
                    <select name="maxRrType" value={formData.maxRrType} onChange={handleChange} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none">
                      <option value="Before Breakeven">Before Breakeven</option>
                      <option value="Before SL">Before SL</option>
                      <option value="Before TP">Before TP</option>
                      <option value="None">None</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Trade Idea / Confluence</label>
                  <textarea name="tradeIdea" value={formData.tradeIdea} onChange={handleChange} placeholder="Inducement Sweeps, Sharp Reversal..." rows={3} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none" />
                </div>
                
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Learning / Notes</label>
                  <textarea name="learning" value={formData.learning} onChange={handleChange} placeholder="Wait for proper low/high liquidity sweep..." rows={3} className="w-full bg-[#1A1A1A] border border-neutral-800 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none" />
                </div>
              </div>
            </div>
            
          </form>
        </div>
        
        <div className="p-4 border-t border-neutral-800 bg-[#1A1A1A] flex justify-between">
          {trade ? (
            <button type="button" onClick={handleDelete} disabled={loading} className="px-4 py-2 text-red-500 hover:bg-red-900/20 rounded text-sm font-medium transition-colors">
              Delete
            </button>
          ) : <div></div>}
          
          <div className="flex gap-3">
            <button type="button" onClick={() => onClose(false)} disabled={loading} className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm font-medium">
              Cancel
            </button>
            <button type="submit" form="journal-form" disabled={loading} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50">
              {loading ? "Saving..." : "Save Entry"}
            </button>
          </div>
        </div>
        
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .style-date-picker::-webkit-calendar-picker-indicator {
          filter: invert(1);
          cursor: pointer;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 4px;
        }
      `}} />
    </div>
  );
}
