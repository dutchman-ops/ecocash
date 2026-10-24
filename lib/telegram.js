async function call(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    throw new Error((data && data.description) || `Telegram responded ${res.status}`);
  }
  return data.result;
}

async function sendMessage(token, chatId, text, extra) {
  return call(token, 'sendMessage', { chat_id: String(chatId), text, ...(extra || {}) });
}

async function editMessageText(token, chatId, messageId, text, extra) {
  return call(token, 'editMessageText', {
    chat_id: String(chatId),
    message_id: messageId,
    text,
    ...(extra || {}),
  });
}

async function answerCallbackQuery(token, callbackQueryId, text) {
  return call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

module.exports = { sendMessage, editMessageText, answerCallbackQuery };
