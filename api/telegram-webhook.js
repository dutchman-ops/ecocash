const { sendMessage } = require('../lib/telegram');
const { addUser, removeUser, listUsers, isUser } = require('../lib/store');

const HELP = [
  'Admin commands:',
  '/add #<chat_id> - allow a user',
  '/remove #<chat_id> - remove a user',
  '/list - show allowed users',
].join('\n');

const CHAT_ID = /^\/(?:add|remove)(?:@\w+)?\s+#?(-?\d{3,20})$/;

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