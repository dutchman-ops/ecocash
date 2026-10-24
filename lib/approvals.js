const crypto = require('node:crypto');
const { setJson, getJson } = require('./store');

const PREFIX = 'ecocash:approval:';
const WINDOW_MS = 5 * 60 * 1000;
const STORE_TTL_S = 60 * 60;

async function create({ stage, text }) {
  const id = crypto.randomBytes(5).toString('hex');
  const now = Date.now();
  const record = {
    id,
    stage,
    text,
    status: 'pending',
    action: null,
    createdAt: now,
    expiresAt: now + WINDOW_MS,
    messages: [],
  };
  await setJson(PREFIX + id, record, STORE_TTL_S);
  return record;
}

async function get(id) {
  if (!/^[a-f0-9]{10}$/.test(String(id))) return null;
  return getJson(PREFIX + id);
}

async function save(record) {
  await setJson(PREFIX + record.id, record, STORE_TTL_S);
}

function extend(record, ms = WINDOW_MS) {
  record.expiresAt = Math.max(Date.now(), record.expiresAt) + ms;
  return record.expiresAt;
}

module.exports = { create, get, save, extend, WINDOW_MS };
