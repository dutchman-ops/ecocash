const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USERS_KEY = 'ecocash:bot:users';

async function command(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Upstash Redis is not configured');
  }
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Redis responded ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data ? data.result : null;
}

async function listUsers() {
  const result = await command('SMEMBERS', USERS_KEY);
  return Array.isArray(result) ? result : [];
}

async function isUser(chatId) {
  return (await command('SISMEMBER', USERS_KEY, String(chatId))) === 1;
}

async function addUser(chatId) {
  return (await command('SADD', USERS_KEY, String(chatId))) === 1;
}

async function removeUser(chatId) {
  return (await command('SREM', USERS_KEY, String(chatId))) === 1;
}

module.exports = { listUsers, isUser, addUser, removeUser };
