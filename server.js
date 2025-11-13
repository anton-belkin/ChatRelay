const path = require('path');
const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const { version: APP_VERSION } = require('./package.json');
const historyStore = require('./lib/historyStore');
const toolBridge = require('./lib/toolBridge');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 8081;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const FAKE_OPENAI_MODE = process.env.FAKE_OPENAI_MODE === '1';
const DEFAULT_FAKE_TOOL_PROMPT = 'please call JS that outputs 10';
const FAKE_TOOL_PROMPT = (
  process.env.FAKE_TOOL_PROMPT || (FAKE_OPENAI_MODE ? DEFAULT_FAKE_TOOL_PROMPT : '')
).trim();
const FAKE_TOOL_NAME = process.env.FAKE_TOOL_NAME || 'demo.generate_number';
const FAKE_TOOL_ARGUMENTS = process.env.FAKE_TOOL_ARGUMENTS || '{"value": 10}';
let FAKE_TOOL_ARGUMENTS_PARSED = {};
try {
  FAKE_TOOL_ARGUMENTS_PARSED = JSON.parse(FAKE_TOOL_ARGUMENTS);
} catch (error) {
  FAKE_TOOL_ARGUMENTS_PARSED = { value: 10 };
}
const MAX_TOOL_ITERATIONS = Math.max(1, parseInt(process.env.TOOL_LOOP_LIMIT || '4', 10));

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  console.warn('[startup] OPENAI_API_KEY is not set. Chat endpoint will fail until you add it.');
}

const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'chat.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

const ensureLoggedIn = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
};

const getConversation = (req) => {
  if (!req.session.messages) {
    const saved = req.session.user ? historyStore.getHistory(req.session.user.username) : [];
    req.session.messages = saved.map((entry) => normalizeStoredEntry(entry)).filter(Boolean);
  }
  return req.session.messages;
};

app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.json({ authenticated: false, version: APP_VERSION });
  }
  return res.json({
    authenticated: true,
    username: req.session.user.username,
    messages: getConversation(req),
    version: APP_VERSION,
  });
});

app.get('/api/meta', (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get('/api/tools', async (req, res) => {
  try {
    const tools = await toolBridge.listToolsForApi();
    res.json({ tools, version: APP_VERSION });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Failed to load tools' });
  }
});

app.post('/api/login', (req, res) => {
  const { username } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const safeUsername = username.trim();
  req.session.user = { username: safeUsername };
  req.session.messages = historyStore.getHistory(safeUsername);
  return res.json({
    authenticated: true,
    username: req.session.user.username,
    messages: req.session.messages,
    version: APP_VERSION,
  });
});

app.post('/api/logout', ensureLoggedIn, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out' });
    }
    return res.json({ success: true });
  });
});

const setupSse = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  return (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
};

const CONTEXT_MESSAGE_COUNT = Math.max(6, parseInt(process.env.CHAT_CONTEXT_MESSAGES || '8', 10));
const SUPPORTED_ROLES = new Set(['system', 'assistant', 'user', 'tool', 'function', 'developer']);

const buildSystemPrompt = (username) =>
  `You are a friendly assistant chatting with ${username}. Keep replies under 120 words unless extra detail is explicitly requested.`;

const matchesDeterministicPrompt = (text) => {
  if (!FAKE_OPENAI_MODE || !FAKE_TOOL_PROMPT) return false;
  if (!text || typeof text !== 'string') return false;
  return text.trim().toLowerCase() === FAKE_TOOL_PROMPT.toLowerCase();
};

const shouldUseDeterministicTools = (text) => matchesDeterministicPrompt(text);

const trimContext = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-CONTEXT_MESSAGE_COUNT);
};

const sanitizeForModel = (messages) =>
  trimContext(messages)
    .filter((msg) => msg && typeof msg.role === 'string')
    .map((msg) => {
      const normalized = {
        role: SUPPORTED_ROLES.has(msg.role) ? msg.role : 'assistant',
        content: msg.content || '',
      };
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        normalized.tool_calls = msg.tool_calls;
      }
      if (msg.role === 'tool' && msg.tool_call_id) {
        normalized.tool_call_id = msg.tool_call_id;
      }
      if (msg.name) {
        normalized.name = msg.name;
      }
      return normalized;
    });

const normalizeStoredEntry = (entry) => {
  if (!entry) return entry;
  if (entry.role === 'sandbox') {
    return { ...entry, role: 'assistant', origin: entry.origin || 'sandbox' };
  }
  return entry;
};

const simulateDeterministicTurn = ({ iteration, sendToken }) => {
  if (iteration === 0) {
    const intro =
      'Understood. I will call the demo.generate_number tool to fetch the number you asked about.';
    if (typeof sendToken === 'function') {
      sendToken(intro);
    }
    return {
      content: intro,
      toolCalls: [
        {
          id: `fake-tool-${Date.now()}`,
          type: 'function',
          function: {
            name: FAKE_TOOL_NAME,
            arguments: JSON.stringify(FAKE_TOOL_ARGUMENTS_PARSED),
          },
        },
      ],
    };
  }
  const summary = 'The tool returned value 10. Let me know if you need anything else.';
  if (typeof sendToken === 'function') {
    sendToken(summary);
  }
  return { content: summary, toolCalls: [] };
};

const streamModelResponse = async ({
  payload,
  tools,
  sendToken,
  shouldStop,
  deterministicToolFlow = false,
  iteration = 0,
}) => {
  if (deterministicToolFlow) {
    return simulateDeterministicTurn({ iteration, sendToken });
  }

  if (!openai) {
    if (FAKE_OPENAI_MODE) {
      const offlineText = 'Offline mode: response generated without calling OpenAI.';
      sendToken(offlineText);
      return { content: offlineText, toolCalls: [] };
    }
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const requestPayload = {
    model: MODEL,
    messages: payload,
    stream: true,
  };

  if (tools?.length) {
    requestPayload.tools = tools;
    requestPayload.tool_choice = 'auto';
  }

  const completion = await openai.chat.completions.create(requestPayload);

  let assistantText = '';
  const toolCallMap = new Map();

  const appendToken = (token) => {
    if (!token) return;
    assistantText += token;
    sendToken(token);
  };

  const appendToolCallDelta = (delta) => {
    delta.forEach((toolCall) => {
      const existing = toolCallMap.get(toolCall.index) || {
        id: toolCall.id || `tool-${Date.now()}-${toolCall.index}`,
        function: { name: '', arguments: '' },
        type: 'function',
      };
      if (toolCall.id) {
        existing.id = toolCall.id;
      }
      if (toolCall.function?.name) {
        existing.function.name = toolCall.function.name;
      }
      if (toolCall.function?.arguments) {
        existing.function.arguments = `${existing.function.arguments || ''}${toolCall.function.arguments}`;
      }
      toolCallMap.set(toolCall.index, existing);
    });
  };

  for await (const chunk of completion) {
    if (shouldStop()) {
      break;
    }
    const { delta } = chunk.choices?.[0] || {};
    if (!delta) continue;

    if (Array.isArray(delta.content)) {
      const contentText = delta.content
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry?.text) return entry.text;
          return '';
        })
        .join('');
      appendToken(contentText);
    } else if (delta.content) {
      appendToken(delta.content);
    }

    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
      appendToolCallDelta(delta.tool_calls);
    }
  }

  const toolCalls = Array.from(toolCallMap.values()).map((call) => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.function?.name,
      arguments: call.function?.arguments || '{}',
    },
  }));

  return {
    content: assistantText.trim(),
    toolCalls,
  };
};

const handleAssistantResponse = async ({
  username,
  conversation,
  sendToken,
  shouldStop,
  deterministicToolFlow = false,
}) => {
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    const modelConversation = sanitizeForModel(conversation);
    const [tools, toolbeltSummary] = await Promise.all([
      toolBridge.getOpenAiTools(),
      toolBridge.describeToolbelt(),
    ]);

    const payload = [{ role: 'system', content: buildSystemPrompt(username) }];
    if (toolbeltSummary) {
      payload.push({
        role: 'system',
        content: `${toolbeltSummary}\nUse these tools when they will improve the accuracy of your answer. Summarize the results clearly for the user.`,
      });
    }
    payload.push(...modelConversation);

    const { content, toolCalls } = await streamModelResponse({
      payload,
      tools,
      sendToken,
      shouldStop,
      deterministicToolFlow,
      iteration: iterations,
    });

    const assistantMessage = { role: 'assistant', content };
    if (toolCalls.length) {
      assistantMessage.tool_calls = toolCalls;
    }
    conversation.push(assistantMessage);

    if (!toolCalls.length) {
      return;
    }

    for (const call of toolCalls) {
      let outputText = '';
      try {
        const toolResult = await toolBridge.executeToolCall(call);
        outputText = toolResult?.content || 'Tool completed without returning content.';
      } catch (error) {
        outputText = `Tool ${call.function?.name || 'unknown'} failed: ${error.message}`;
      }
      const label = call.function?.name || 'tool';
      const note = `🔧 ${label}:\n${outputText}`;
      conversation.push({
        role: 'tool',
        name: label,
        content: outputText,
        tool_call_id: call.id,
        origin: 'tool',
      });
      sendToken(`\n${note}\n`);
    }

    iterations += 1;
  }

  throw new Error('Tool invocation limit exceeded.');
};

app.post('/api/chat', ensureLoggedIn, async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const deterministicToolFlow = shouldUseDeterministicTools(message);

  if (!openai && !deterministicToolFlow) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  const sendEvent = setupSse(res);
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  const conversation = getConversation(req);
  conversation.push({ role: 'user', content: message.trim() });

  const streamToken = (token) => {
    if (!token || clientClosed) return;
    sendEvent('delta', { token });
  };

  try {
    await handleAssistantResponse({
      username: req.session.user.username,
      conversation,
      sendToken: streamToken,
      shouldStop: () => clientClosed,
      deterministicToolFlow,
    });

    if (!clientClosed) {
      req.session.messages = conversation.slice(-40);
      historyStore.saveHistory(req.session.user.username, req.session.messages);
      sendEvent('done', { messages: req.session.messages });
    }
  } catch (error) {
    console.error('[chat]', error);
    if (!clientClosed) {
      sendEvent('error', { message: error.message || 'OpenAI request failed' });
    }
  } finally {
    if (!clientClosed) {
      res.end();
    }
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
