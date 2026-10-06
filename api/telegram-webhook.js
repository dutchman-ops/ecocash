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
  if (!message || typeof message.text !== 'string') {
    return res.status(200).json({ ok: true });
  }

  const token = process.env.TELEGRAM_TOKEN;
  const adminId = String(process.env.SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '');
  const senderId = String(message.chat.id);
  const text = message.text.trim();

  if (!token || !adminId) {
    console.error('Telegram env vars missing');
    return res.status(200).json({ ok: true });
  }

  const reply = (target, content) => sendMessage(token, target, content).catch((err) => {
    console.error('Reply failed', err.message);
  });

  if (senderId === adminId) {
    const match = CHAT_ID.exec(text);

    if (match && text.startsWith('/add')) {
      const added = await addUser(match[1]).catch(() => null);
      if (added === null) return reply(senderId, 'Storage unavailable');
      return reply(senderId, added ? `User added: ${match[1]}` : `Already added: ${match[1]}`);
    }

    if (match && text.startsWith('/remove')) {
      const removed = await removeUser(match[1]).catch(() => null);
      if (removed === null) return reply(senderId, 'Storage unavailable');
      return reply(senderId, removed ? `User removed: ${match[1]}` : `Not found: ${match[1]}`);
    }

    if (text === '/list') {
      const users = await listUsers().catch(() => null);
      if (users === null) return reply(senderId, 'Storage unavailable');
      return reply(senderId, users.length ? `Users:\n${users.join('\n')}` : 'No users yet');
    }

    if (text.startsWith('/start')) {
      return reply(senderId, HELP);
    }

    return reply(senderId, `Unknown command\n\n${HELP}`);
  }

  const allowed = await isUser(senderId).catch(() => false);
  if (allowed && /^\/start(?:@\w+)?$/.test(text)) {
    return reply(senderId, 'Bot is working');
  }

  return res.status(200).json({ ok: true });
};
