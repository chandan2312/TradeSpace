const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

export function telegramConfigured() {
  return !!TG_TOKEN;
}

export async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!data.ok) console.error("[telegram] send failed:", data.description);
    return data.ok;
  } catch (err) {
    console.error("[telegram] error:", err.message);
    return false;
  }
}
