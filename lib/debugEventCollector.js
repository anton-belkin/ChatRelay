/**
 * Debug Event Collector
 *
 * Collects and manages debug events for system monitoring.
 * Events are session-scoped and can be streamed to clients.
 */

const MAX_EVENTS_PER_SESSION = 500;

// Map of username -> array of debug events
const sessionEvents = new Map();

/**
 * Add a debug event for a user session
 * @param {string} username - User identifier
 * @param {Object} event - Event data
 */
function addEvent(username, event) {
  if (!username) return;

  if (!sessionEvents.has(username)) {
    sessionEvents.set(username, []);
  }

  const events = sessionEvents.get(username);

  const eventWithMeta = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  };

  events.push(eventWithMeta);

  // Trim to max size
  if (events.length > MAX_EVENTS_PER_SESSION) {
    events.splice(0, events.length - MAX_EVENTS_PER_SESSION);
  }
}

/**
 * Get all events for a user session
 * @param {string} username - User identifier
 * @returns {Array} Array of events
 */
function getEvents(username) {
  if (!username) return [];
  return sessionEvents.get(username) || [];
}

/**
 * Clear events for a user session
 * @param {string} username - User identifier
 */
function clearEvents(username) {
  if (!username) return;
  sessionEvents.delete(username);
}

/**
 * Clear all events (for all users)
 */
function clearAllEvents() {
  sessionEvents.clear();
}

/**
 * Log an OpenAI API call
 */
function logOpenAICall(username, { model, messages, tools, iteration }) {
  addEvent(username, {
    type: 'openai-call',
    model,
    messageCount: messages?.length || 0,
    toolCount: tools?.length || 0,
    iteration,
    preview: messages?.[messages.length - 1]?.content?.substring(0, 100)
  });
}

/**
 * Log an OpenAI API response
 */
function logOpenAIResponse(username, { content, toolCalls, finishReason }) {
  addEvent(username, {
    type: 'openai-response',
    hasContent: !!content,
    contentLength: content?.length || 0,
    contentPreview: content?.substring(0, 100),
    toolCallCount: toolCalls?.length || 0,
    toolCalls: toolCalls?.map(tc => ({
      name: tc.function?.name,
      argsPreview: tc.function?.arguments?.substring(0, 50)
    })),
    finishReason
  });
}

/**
 * Log a tool execution
 */
function logToolExecution(username, { toolName, args, result, error, executionTime }) {
  addEvent(username, {
    type: 'tool-execution',
    toolName,
    args,
    resultPreview: result?.substring(0, 200),
    error: error?.message,
    executionTime
  });
}

/**
 * Log helper agent spawn
 */
function logHelperSpawn(username, { helperId, helperName, task }) {
  addEvent(username, {
    type: 'helper-spawn',
    helperId,
    helperName,
    task: task?.substring(0, 200)
  });
}

/**
 * Log helper agent iteration
 */
function logHelperIteration(username, { helperId, iteration, hasToolCalls, toolCount }) {
  addEvent(username, {
    type: 'helper-iteration',
    helperId,
    iteration,
    hasToolCalls,
    toolCount
  });
}

/**
 * Log helper agent completion
 */
function logHelperComplete(username, { helperId, iterations, result }) {
  addEvent(username, {
    type: 'helper-complete',
    helperId,
    iterations,
    resultPreview: result?.substring(0, 200)
  });
}

/**
 * Log helper agent error
 */
function logHelperError(username, { helperId, error }) {
  addEvent(username, {
    type: 'helper-error',
    helperId,
    error: error?.message || String(error)
  });
}

/**
 * Log main coordinator iteration
 */
function logMainIteration(username, { iteration, hasToolCalls, toolCount }) {
  addEvent(username, {
    type: 'main-iteration',
    iteration,
    hasToolCalls,
    toolCount
  });
}

module.exports = {
  addEvent,
  getEvents,
  clearEvents,
  clearAllEvents,
  logOpenAICall,
  logOpenAIResponse,
  logToolExecution,
  logHelperSpawn,
  logHelperIteration,
  logHelperComplete,
  logHelperError,
  logMainIteration
};
