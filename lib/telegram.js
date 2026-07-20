const TG_TOKEN_LEGACY = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_LEGACY = process.env.TELEGRAM_CHAT_ID;

const TG_TOKEN_PRICE = process.env.TELEGRAM_BOT_TOKEN_PRICE || TG_TOKEN_LEGACY;
const TG_CHAT_PRICE = process.env.TELEGRAM_CHAT_ID_PRICE || TG_CHAT_LEGACY;

// Strict routing: no legacy fallbacks for Setup or Priority. 
// If the token is missing, the alert drops instead of bleeding into the price channel.
const TG_TOKEN_SETUP = process.env.TELEGRAM_BOT_TOKEN_SETUP;
const TG_CHAT_SETUP = process.env.TELEGRAM_CHAT_ID_SETUP;

const TG_TOKEN_PRIORITY = process.env.TELEGRAM_BOT_TOKEN_PRIORITY;
const TG_CHAT_PRIORITY = process.env.TELEGRAM_CHAT_ID_PRIORITY;

export function telegramConfigured() {
  return !!TG_TOKEN_PRICE || !!TG_TOKEN_SETUP || !!TG_TOKEN_PRIORITY;
}

export async function sendTelegram(text, type = "PRICE", photoUrl = null) {
  let token = TG_TOKEN_PRICE;
  let chat = TG_CHAT_PRICE;
  
  if (type === "SETUP") { token = TG_TOKEN_SETUP; chat = TG_CHAT_SETUP; }
  else if (type === "PRIORITY") { token = TG_TOKEN_PRIORITY; chat = TG_CHAT_PRIORITY; }

  if (!token || !chat) return false;
  
  try {
    const endpoint = photoUrl ? "sendPhoto" : "sendMessage";
    const body = photoUrl 
      ? JSON.stringify({ chat_id: chat, caption: text, parse_mode: "HTML", photo: photoUrl })
      : JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" });

    const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!data.ok) console.error(`[telegram] send failed (${type}):`, data.description);
    return data.ok;
  } catch (err) {
    console.error(`[telegram] error (${type}):`, err.message);
    return false;
  }
}
