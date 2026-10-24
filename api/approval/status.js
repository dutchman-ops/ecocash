const { get } = require('../../lib/approvals');

module.exports = async (req, res) => {
  const id = req.query && req.query.id;

  if (!id || typeof id !== 'string') {
    return res.status(200).json({ status: 'expired', action: null, expiresAt: 0, stage: null });
  }

  try {
    const record = await get(String(id).slice(0, 20));

    if (!record) {
      return res.status(200).json({ status: 'expired', action: null, expiresAt: 0, stage: null });
    }

    const now = Date.now();
    let status = record.status;
    if (status === 'pending' && now > record.expiresAt) {
      status = 'expired';
    }

    return res.status(200).json({
      status,
      action: record.action,
      expiresAt: record.expiresAt,
      stage: record.stage,
    });
  } catch (err) {
    console.error('Approval status error:', err);
    return res.status(200).json({ status: 'expired', action: null, expiresAt: 0, stage: null });
  }
};
