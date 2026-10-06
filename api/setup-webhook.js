module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const setupSecret = process.env.SETUP_SECRET;
  if (!setupSecret || req.headers['x-setup-secret'] !== setupSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server not configured' });

  const host = req.headers.host;
  if (!host) return res.status(400).json({ error: 'Missing host' });

  const payload = {
    url: `https://${host}/api/telegram-webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  };

  try {
    const upstream = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data || !data.ok) {
      return res.status(502).json({ error: (data && data.description) || 'setWebhook failed' });
    }
    return res.status(200).json({ ok: true, url: payload.url });
  } catch (err) {
    return res.status(502).json({ error: 'setWebhook failed' });
  }
};
