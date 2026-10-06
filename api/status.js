module.exports = async (req, res) => {
  const env = (name) => Boolean(process.env[name]);

  const info = {
    env: {
      TELEGRAM_TOKEN: env('TELEGRAM_TOKEN'),
      SUPER_ADMIN_CHAT_ID: env('SUPER_ADMIN_CHAT_ID'),
      TELEGRAM_CHAT_ID: env('TELEGRAM_CHAT_ID'),
      TELEGRAM_WEBHOOK_SECRET: env('TELEGRAM_WEBHOOK_SECRET'),
      SETUP_SECRET: env('SETUP_SECRET'),
      UPSTASH_REDIS_REST_URL: env('UPSTASH_REDIS_REST_URL'),
      UPSTASH_REDIS_REST_TOKEN: env('UPSTASH_REDIS_REST_TOKEN'),
    },
    webhook: null,
  };

  const token = process.env.TELEGRAM_TOKEN;
  if (token) {
    try {
      const upstream = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const data = await upstream.json().catch(() => null);
      if (data && data.ok) {
        info.webhook = {
          url: data.result.url,
          has_custom_certificate: data.result.has_custom_certificate,
          pending_update_count: data.result.pending_update_count,
          last_error_date: data.result.last_error_date,
          last_error_message: data.result.last_error_message,
        };
        return res.status(200).json(info);
      }
    } catch (err) {
      info.webhookError = err.message;
    }
  }

  return res.status(200).json(info);
};