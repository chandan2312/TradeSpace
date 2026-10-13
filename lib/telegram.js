function getTelegramCredentials(type = "PRICE") {
  const tokenLegacy = process.env.TELEGRAM_BOT_TOKEN;
  const chatLegacy = process.env.TELEGRAM_CHAT_ID;

  const tokenPrice = process.env.TELEGRAM_BOT_TOKEN_PRICE || tokenLegacy;
  const chatPrice = process.env.TELEGRAM_CHAT_ID_PRICE || chatLegacy;

  let token = tokenPrice;
  let chat = chatPrice;

  if (type === "SETUP") {
    token = process.env.TELEGRAM_BOT_TOKEN_SETUP || tokenPrice;
    chat = process.env.TELEGRAM_CHAT_ID_SETUP || chatPrice;
  } else if (type === "PRIORITY") {
    token = process.env.TELEGRAM_BOT_TOKEN_PRIORITY || tokenPrice;
    chat = process.env.TELEGRAM_CHAT_ID_PRIORITY || chatPrice;
  }

  return {
    token,
    chat,
    fallbackToken: tokenPrice,
    fallbackChat: chatPrice,
  };
}

export function telegramConfigured() {
  const creds = getTelegramCredentials();
  return Boolean(creds.token || creds.fallbackToken || process.env.TELEGRAM_BOT_TOKEN_SETUP || process.env.TELEGRAM_BOT_TOKEN_PRIORITY);
}

const g = globalThis;
if (!g._tsTelegramRecent) g._tsTelegramRecent = new Map();

export async function sendTelegram(text, type = "PRICE", photoUrl = null) {
  const creds = getTelegramCredentials(type);
  let token = creds.token;
  let chat = creds.chat;

  if (!token || !chat) {
    token = creds.fallbackToken;
    chat = creds.fallbackChat;
  }

  if (!token || !chat) return false;

  // Global Deduplication: Suppress identical text to the same chat within 5 seconds
  const dedupKey = `${chat}:${text}`;
  const now = Date.now();
  const lastTime = g._tsTelegramRecent.get(dedupKey);
  if (lastTime && now - lastTime < 5000) {
    return true; // Already dispatched within 5s
  }
  g._tsTelegramRecent.set(dedupKey, now);
  if (g._tsTelegramRecent.size > 200) {
    for (const [k, t] of g._tsTelegramRecent.entries()) {
      if (now - t > 30000) g._tsTelegramRecent.delete(k);
    }
  }

  const endpoint = photoUrl ? "sendPhoto" : "sendMessage";
  const makeBody = (targetChat) => (photoUrl 
    ? JSON.stringify({ chat_id: targetChat, caption: text, parse_mode: "HTML", photo: photoUrl })
    : JSON.stringify({ chat_id: targetChat, text, parse_mode: "HTML" }));

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: makeBody(chat),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (!data.ok) {
      // If primary delivery failed and fallback credentials exist on a different channel/bot, retry
      if (creds.fallbackToken && creds.fallbackChat && (token !== creds.fallbackToken || chat !== creds.fallbackChat)) {
        if (!g._tsWarnedFallback) {
          console.warn(`[telegram] Channel (${chat}) returned '${data.description || "error"}'. Resiliently falling back to primary alert channel.`);
          g._tsWarnedFallback = true;
        }
        const fbRes = await fetch(`https://api.telegram.org/bot${creds.fallbackToken}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: makeBody(creds.fallbackChat),
          signal: AbortSignal.timeout(10_000),
        });
        const fbData = await fbRes.json();
        return fbData.ok;
      }
      console.error(`[telegram] send failed (${type}):`, data.description);
      return false;
    }
    return true;
  } catch (err) {
    // If request timed out or network error occurred, attempt fallback channel
    if (creds.fallbackToken && creds.fallbackChat && (token !== creds.fallbackToken || chat !== creds.fallbackChat)) {
      try {
        console.warn(`[telegram] Fetch error (${err.message}) on ${type} channel. Retrying on primary channel.`);
        const fbRes = await fetch(`https://api.telegram.org/bot${creds.fallbackToken}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: makeBody(creds.fallbackChat),
          signal: AbortSignal.timeout(10_000),
        });
        const fbData = await fbRes.json();
        return fbData.ok;
      } catch (fbErr) {
        console.error(`[telegram] Fallback channel fetch error (${type}):`, fbErr.message);
      }
    }
    console.error(`[telegram] error (${type}):`, err.message);
    return false;
  }
}
