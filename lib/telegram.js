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

const g = globalThis;
if (!g._tsTelegramRecent) g._tsTelegramRecent = new Map();

export async function sendTelegram(text, type = "PRICE", photoUrl = null) {
  let token = TG_TOKEN_PRICE;
  let chat = TG_CHAT_PRICE;
  
  if (type === "SETUP") { token = TG_TOKEN_SETUP; chat = TG_CHAT_SETUP; }
  else if (type === "PRIORITY") { token = TG_TOKEN_PRIORITY; chat = TG_CHAT_PRIORITY; }

  if (!token || !chat) return false;

  // Global Deduplication: Suppress identical text to the same chat within 15 seconds
  const dedupKey = `${chat}:${text}`;
  const now = Date.now();
  const lastTime = g._tsTelegramRecent.get(dedupKey);
  if (lastTime && now - lastTime < 15000) {
    return true; // Already dispatched within 15s
  }
  g._tsTelegramRecent.set(dedupKey, now);
  if (g._tsTelegramRecent.size > 200) {
    for (const [k, t] of g._tsTelegramRecent.entries()) {
      if (now - t > 30000) g._tsTelegramRecent.delete(k);
    }
  }
  
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
    if (!data.ok) {
      if (data.description?.includes("chat not found") && type === "SETUP" && TG_TOKEN_PRICE && TG_CHAT_PRICE && (token !== TG_TOKEN_PRICE || chat !== TG_CHAT_PRICE)) {
        if (!g._tsWarnedChatNotFound) {
          console.warn(`[telegram] Setup channel (${chat}) returned 'chat not found'. Ensure @tradespace_currency_algo_bot is added as Administrator to channel ${chat}. Falling back to primary alert channel.`);
          g._tsWarnedChatNotFound = true;
        }
        const fallbackBody = photoUrl 
          ? JSON.stringify({ chat_id: TG_CHAT_PRICE, caption: text, parse_mode: "HTML", photo: photoUrl })
          : JSON.stringify({ chat_id: TG_CHAT_PRICE, text, parse_mode: "HTML" });
        const fbRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN_PRICE}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: fallbackBody,
          signal: AbortSignal.timeout(15_000),
        });
        const fbData = await fbRes.json();
        return fbData.ok;
      }
      console.error(`[telegram] send failed (${type}):`, data.description);
    }
    return data.ok;
  } catch (err) {
    console.error(`[telegram] error (${type}):`, err.message);
    return false;
  }
}
