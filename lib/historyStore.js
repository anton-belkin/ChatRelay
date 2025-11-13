const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'history.json');
const MAX_MESSAGES = Number(process.env.HISTORY_MAX_MESSAGES || 100);

let cache = {};
let initialized = false;

const ensureDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const loadStore = () => {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_PATH)) {
      cache = {};
      return;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('[historyStore] Failed to load history file:', error.message);
    cache = {};
  }
};

const persist = () => {
  try {
    ensureDir();
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.error('[historyStore] Failed to persist history:', error.message);
  }
};

const init = () => {
  if (initialized) return;
  loadStore();
  initialized = true;
};

const getHistory = (username) => {
  if (!username) return [];
  init();
  const history = cache[username] || [];
  return history.slice(-MAX_MESSAGES);
};

const saveHistory = (username, messages) => {
  if (!username) return;
  init();
  const trimmed = messages.slice(-MAX_MESSAGES);
  cache[username] = trimmed;
  persist();
};

module.exports = {
  init,
  getHistory,
  saveHistory,
};
