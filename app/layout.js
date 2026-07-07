import "./globals.css";

export const metadata = {
  title: "TradeSpace",
  description: "MT5 live charts with TradingView-style alerts → Telegram",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
