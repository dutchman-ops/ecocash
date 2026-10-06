const { sendMessage } = require('../lib/telegram');
const { listUsers } = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_TOKEN;
  const adminId = process.env.SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !adminId) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    await sendMessage(token, adminId, text);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream delivery failed' });
  }

  let delivered = 0;
  let fanOut = 'unavailable';
  try {
    const users = await listUsers();
    const results = await Promise.allSettled(users.map((chatId) => sendMessage(token, chatId, text)));
    delivered = results.filter((r) => r.status === 'fulfilled').length;
    fanOut = 'ok';
  } catch (err) {
    fanOut = 'unavailable';
  }

  return res.status(200).json({ ok: true, delivered, fanOut });
};
