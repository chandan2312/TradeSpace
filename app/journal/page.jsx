import JournalView from "@/components/journal/JournalView";
import Link from "next/link";
import { ArrowLeft, Cpu } from "lucide-react";

export const metadata = {
  title: "Autonomous Journal — TradeSpace",
  description: "Advanced multi-model autonomous trading journal with AG-Grid spreadsheet analytics.",
};

export default function JournalPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg, #0e1116)",
        color: "var(--fg, #d7dce6)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 20px",
        boxSizing: "border-box",
      }}
    >
      {/* Top Navbar navigation breadcrumbs */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border)",
            }}
          >
            <ArrowLeft size={13} /> Charts
          </Link>

          <Link
            href="/autonomous"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--accent)",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(41, 98, 255, 0.12)",
              border: "1px solid rgba(41, 98, 255, 0.3)",
            }}
          >
            <Cpu size={13} /> Autonomous Cockpit
          </Link>
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
          TRADESPACE ENTERPRISE · JOURNAL v2.0
        </div>
      </nav>

      {/* Main Journal View */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <JournalView />
      </main>
    </div>
  );
}
