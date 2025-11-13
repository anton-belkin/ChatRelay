const DEFAULT_SERVICE_URL = process.env.TOOL_SERVICE_URL || 'http://127.0.0.1:8090';
const TOOL_CACHE_TTL_MS = Math.max(5_000, parseInt(process.env.TOOL_CACHE_TTL_MS || '60000', 10));

let cachedTools = [];
let cacheFetchedAt = 0;
let inflightPromise = null;
let lastErrorLog = 0;

const now = () => Date.now();

const logOnce = (message) => {
  const stamp = now();
  if (stamp - lastErrorLog > 30_000) {
    console.warn(`[toolBridge] ${message}`);
    lastErrorLog = stamp;
  }
};

const safeUrl = (path) => {
  const base = DEFAULT_SERVICE_URL.replace(/\/$/, '');
  return `${base}${path}`;
};

const fetchJson = async (path, init) => {
  const target = safeUrl(path);
  const response = await fetch(target, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Tool service error (${response.status}): ${text || response.statusText}`);
  }
  return response.json();
};

const normalizeTool = (tool) => {
  if (!tool || typeof tool !== 'object') return null;
  const parameters = tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} };
  return {
    name: tool.name,
    description: tool.description || '',
    origin: tool.origin || 'mcp',
    parameters,
  };
};

const refreshTools = async (force = false) => {
  if (!force && cachedTools.length && now() - cacheFetchedAt < TOOL_CACHE_TTL_MS) {
    return cachedTools;
  }
  if (inflightPromise) {
    return inflightPromise;
  }
  inflightPromise = (async () => {
    try {
      const payload = await fetchJson(force ? '/tools?force=1' : '/tools');
      const rawTools = Array.isArray(payload?.tools) ? payload.tools : [];
      cachedTools = rawTools.map(normalizeTool).filter(Boolean);
      cacheFetchedAt = now();
      return cachedTools;
    } catch (error) {
      logOnce(error.message || 'Failed to load tools from agent service.');
      if (!cachedTools.length) {
        return [];
      }
      return cachedTools;
    } finally {
      inflightPromise = null;
    }
  })();
  return inflightPromise;
};

const getOpenAiTools = async () => {
  const tools = await refreshTools(false);
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
};

const executeToolCall = async ({ id, function: fn }) => {
  if (!fn || !fn.name) {
    throw new Error('Invalid tool call payload.');
  }
  let args = {};
  if (fn.arguments) {
    try {
      args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments;
    } catch (error) {
      throw new Error(`Invalid JSON arguments for ${fn.name}: ${error.message}`);
    }
  }
  const body = JSON.stringify({ name: fn.name, arguments: args, toolCallId: id });
  try {
    const result = await fetchJson('/call-tool', { method: 'POST', body });
    return result;
  } catch (error) {
    throw new Error(error.message || `Tool ${fn.name} failed`);
  }
};

const listToolsForApi = async ({ force = false } = {}) => {
  const tools = await refreshTools(force);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    origin: tool.origin,
    parameters: tool.parameters,
    cachedAt: cacheFetchedAt,
  }));
};

const describeToolbelt = async () => {
  const tools = await refreshTools(false);
  if (!tools.length) {
    return '';
  }
  const lines = tools.map((tool) => `${tool.name} (${tool.origin}) — ${tool.description || 'No description provided.'}`);
  return `Available tools:\n${lines.join('\n')}`;
};

module.exports = {
  getOpenAiTools,
  executeToolCall,
  listToolsForApi,
  describeToolbelt,
  refreshTools,
};
