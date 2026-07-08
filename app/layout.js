import "./globals.css";

export const metadata = {
  title: "TradeSpace",
  description: "MT5 live charts with TradingView-style alerts → Telegram",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "TradeSpace", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html:
          `if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});`
        }} />
      </body>
    </html>
  );
}
