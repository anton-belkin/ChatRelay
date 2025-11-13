const loginSection = document.getElementById('login-section');
const chatSection = document.getElementById('chat-section');
const chatLog = document.getElementById('chat-log');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logout-btn');
const sendBtn = document.getElementById('send-btn');
const versionEl = document.getElementById('version-pill');
const template = document.getElementById('message-template');
const toolbeltSection = document.getElementById('toolbelt');
const toolListEl = document.getElementById('tool-list');
const toolStatusEl = document.getElementById('tool-status');
const toolRefreshBtn = document.getElementById('tool-refresh-btn');

const state = {
  username: null,
  messages: [],
  busy: false,
  version: '—',
  tools: [],
};

const renderMessages = () => {
  chatLog.innerHTML = '';
  state.messages.forEach((entry) => {
    const clone = template.content.cloneNode(true);
    const bubble = clone.querySelector('.bubble');
    const role = entry.role || 'assistant';
    const origin = entry.origin || '';
    bubble.classList.add(role);
    if (origin === 'sandbox') {
      bubble.classList.add('sandbox');
    }
    if (role === 'tool' || origin === 'tool') {
      bubble.classList.add('tool');
    }

    let authorLabel = 'Assistant';
    if (role === 'user') {
      authorLabel = state.username;
    }
    if (origin === 'sandbox') {
      authorLabel = 'JavaScript Sandbox';
    } else if (role === 'tool' || origin === 'tool') {
      authorLabel = entry.name ? `Tool • ${entry.name}` : 'Tool output';
    }
    clone.querySelector('.meta').textContent = authorLabel;
    clone.querySelector('p').textContent = entry.content;
    chatLog.appendChild(clone);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
};

const renderTools = () => {
  if (!toolbeltSection) return;
  toolbeltSection.classList.remove('hidden');
  if (!state.tools.length) {
    if (toolListEl) toolListEl.innerHTML = '';
    if (toolStatusEl) {
      toolStatusEl.textContent = 'No MCP tools detected.';
    }
    return;
  }
  if (toolStatusEl) {
    toolStatusEl.textContent = `${state.tools.length} tool${state.tools.length === 1 ? '' : 's'} connected.`;
  }
  if (toolListEl) {
    toolListEl.innerHTML = '';
    state.tools.forEach((tool) => {
      const li = document.createElement('li');
      li.textContent = tool.name || 'unnamed tool';
      const origin = document.createElement('span');
      origin.textContent = tool.origin || 'mcp';
      li.appendChild(origin);
      toolListEl.appendChild(li);
    });
  }
};

const setTools = (tools = []) => {
  state.tools = tools;
  renderTools();
};

const fetchTools = async () => {
  if (toolStatusEl) {
    toolStatusEl.textContent = 'Loading tools…';
  }
  try {
    const data = await safeFetch('/api/tools', { method: 'GET' });
    setTools(data.tools || []);
  } catch (error) {
    if (toolStatusEl) {
      toolStatusEl.textContent = `Failed to load tools: ${error.message}`;
    }
    setTools([]);
  }
};

const setVersion = (version) => {
  if (!versionEl) return;
  state.version = version ? version.replace(/^v/i, '') : '—';
  versionEl.textContent = state.version === '—' ? 'v—' : `v${state.version}`;
  versionEl.title = `UI version ${versionEl.textContent}`;
};

const setAuthenticated = ({ username, messages, version }) => {
  state.username = username;
  state.messages = messages ?? [];
  if (version) {
    setVersion(version);
  }
  loginSection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  renderMessages();
};

const clearSession = () => {
  state.username = null;
  state.messages = [];
  chatLog.innerHTML = '';
  loginSection.classList.remove('hidden');
  chatSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
};

const setBusy = (flag, text = '') => {
  state.busy = flag;
  statusEl.textContent = text;
  messageInput.disabled = flag;
  if (sendBtn) {
    sendBtn.disabled = flag;
  }
};

const safeFetch = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
};

const streamChat = async ({ message, onToken, onComplete }) => {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Chat request failed');
  }

  if (!res.body) {
    throw new Error('Empty response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processEvent = (event, data) => {
    if (!data) return;
    try {
      const payload = JSON.parse(data);
      if (event === 'delta') {
        onToken?.(payload.token || '');
      } else if (event === 'done') {
        onComplete?.(payload);
      } else if (event === 'error') {
        throw new Error(payload.message || 'Chat stream error');
      }
    } catch (error) {
      throw error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!chunk.trim()) continue;

      let event = 'message';
      let data = '';
      chunk.split('\n').forEach((line) => {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trim();
        }
      });
      processEvent(event, data);
    }
  }
};

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;
  setBusy(true, 'Signing in…');
  try {
    const data = await safeFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    setAuthenticated({ username: data.username, messages: data.messages ?? [], version: data.version });
    messageInput.focus();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const message = messageInput.value.trim();
  if (!message) return;

  state.messages.push({ role: 'user', content: message });
  const assistantIndex = state.messages.push({ role: 'assistant', content: '' }) - 1;
  renderMessages();
  messageInput.value = '';
  setBusy(true, 'ChatGPT is responding…');

  try {
    await streamChat({
      message,
      onToken: (token) => {
        if (!token) return;
        state.messages[assistantIndex].content += token;
        renderMessages();
      },
      onComplete: (payload) => {
        if (payload?.messages) {
          state.messages = payload.messages;
          renderMessages();
        }
      },
    });
  } catch (error) {
    statusEl.textContent = error.message;
    state.messages.splice(assistantIndex, 1);
    renderMessages();
  } finally {
    setBusy(false, '');
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await safeFetch('/api/logout', { method: 'POST' });
  } catch (error) {
    // ignore logout errors
  } finally {
    clearSession();
    usernameInput.focus();
  }
});

const bootstrap = async () => {
  try {
    const data = await safeFetch('/api/session', { method: 'GET' });
    if (data.authenticated) {
      setAuthenticated({ username: data.username, messages: data.messages, version: data.version });
    } else {
      clearSession();
      if (data.version) {
        setVersion(data.version);
      }
    }
  } catch (error) {
    clearSession();
  }

  if (state.version === '—') {
    try {
      const meta = await safeFetch('/api/meta', { method: 'GET' });
      if (meta.version) {
        setVersion(meta.version);
      }
    } catch (error) {
      // ignore
    }
  }

  await fetchTools().catch(() => {
    /* already handled */
  });
};

bootstrap();

if (sendBtn) {
  sendBtn.addEventListener('click', (event) => {
    event.preventDefault();
    chatForm.requestSubmit();
  });
}

if (messageInput) {
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
}

if (toolRefreshBtn) {
  toolRefreshBtn.addEventListener('click', () => {
    fetchTools();
  });
}
