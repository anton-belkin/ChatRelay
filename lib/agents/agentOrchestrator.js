/**
 * Agent Orchestrator
 *
 * Main coordination layer for multi-agent system.
 * Routes requests to appropriate agents and manages execution.
 */

const intentClassifier = require('./intentClassifier');
const agentExecutor = require('./agentExecutor');
const agentRegistry = require('./agentRegistry');

/**
 * Handle a user request with multi-agent orchestration
 *
 * @param {Object} params - Orchestration parameters
 * @param {string} params.userMessage - User's message
 * @param {string} params.username - Current user
 * @param {Array} params.conversation - Full conversation history
 * @param {Function} params.streamModelResponse - Function to call OpenAI
 * @param {Function} params.sendToken - SSE event sender
 * @param {Function} params.shouldStop - Check if client cancelled
 * @param {boolean} params.debug - Enable debug mode (show agent switches)
 * @returns {Object} Result with { content, messages, agentUsed }
 */
async function handleRequest({
  userMessage,
  username,
  conversation,
  streamModelResponse,
  sendToken,
  shouldStop,
  debug = true // Default to transparent mode for debugging
}) {
  // 1. Classify intent and select agent
  const agentId = intentClassifier.classifyIntent(userMessage, conversation);
  const agent = agentRegistry.getAgent(agentId);

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // 2. Send agent selection event (if debug mode)
  if (debug && sendToken) {
    sendToken('agent-spawn', {
      agent: agentId,
      agentName: agent.name,
      reason: `Detected intent: ${agentId}`,
      timestamp: new Date().toISOString()
    });
  }

  // 3. Get memory context for this user
  let memoryContext = null;
  try {
    memoryContext = await agentExecutor.getMemoryContext(username);
  } catch (error) {
    console.error('[orchestrator] Failed to get memory context:', error.message);
  }

  // 4. Execute the selected agent
  let result;
  try {
    if (debug && sendToken) {
      sendToken('agent-progress', {
        agent: agentId,
        status: 'executing',
        message: `${agent.name} is processing your request...`
      });
    }

    result = await agentExecutor.executeAgent({
      agentId,
      userMessage,
      username,
      sessionContext: conversation,
      memoryContext,
      streamModelResponse,
      sendToken,
      shouldStop
    });

    if (debug && sendToken) {
      sendToken('agent-complete', {
        agent: agentId,
        iterations: result.iterations,
        toolCalls: result.toolCalls?.length || 0,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`[orchestrator] Agent ${agentId} execution failed:`, error);

    if (debug && sendToken) {
      sendToken('agent-error', {
        agent: agentId,
        error: error.message
      });
    }

    // Fallback to general agent if specialized agent fails
    if (agentId !== 'general') {
      console.log('[orchestrator] Falling back to general agent');

      if (debug && sendToken) {
        sendToken('agent-spawn', {
          agent: 'general',
          agentName: 'General Assistant',
          reason: 'Fallback after error',
          timestamp: new Date().toISOString()
        });
      }

      result = await agentExecutor.executeAgent({
        agentId: 'general',
        userMessage,
        username,
        sessionContext: conversation,
        memoryContext,
        streamModelResponse,
        sendToken,
        shouldStop
      });
    } else {
      throw error; // Can't fallback from general agent
    }
  }

  // 5. Return result with agent metadata
  return {
    content: result.content,
    toolCalls: result.toolCalls,
    iterations: result.iterations,
    agentUsed: agentId,
    agentName: agent.name
  };
}

/**
 * Delegate a task to a specific agent (for explicit delegation)
 *
 * @param {Object} params - Delegation parameters
 * @param {string} params.agentId - Specific agent to use
 * @param {string} params.task - Task description
 * @param {string} params.username - Current user
 * @param {Array} params.conversation - Full conversation history
 * @param {Function} params.streamModelResponse - Function to call OpenAI
 * @param {Function} params.sendToken - SSE event sender
 * @param {Function} params.shouldStop - Check if client cancelled
 * @returns {Object} Result with content and metadata
 */
async function delegateToAgent({
  agentId,
  task,
  username,
  conversation,
  streamModelResponse,
  sendToken,
  shouldStop
}) {
  const agent = agentRegistry.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  console.log(`[orchestrator] Explicitly delegating to ${agentId}: "${task.substring(0, 50)}..."`);

  sendToken('agent-spawn', {
    agent: agentId,
    agentName: agent.name,
    reason: 'Explicit delegation',
    timestamp: new Date().toISOString()
  });

  const memoryContext = await agentExecutor.getMemoryContext(username);

  const result = await agentExecutor.executeAgent({
    agentId,
    userMessage: task,
    username,
    sessionContext: conversation,
    memoryContext,
    streamModelResponse,
    sendToken,
    shouldStop
  });

  sendToken('agent-complete', {
    agent: agentId,
    iterations: result.iterations,
    timestamp: new Date().toISOString()
  });

  return {
    content: result.content,
    toolCalls: result.toolCalls,
    agentUsed: agentId,
    agentName: agent.name
  };
}

/**
 * Get orchestrator status and available agents
 * @returns {Object} Status information
 */
function getStatus() {
  const agents = agentRegistry.getAllAgents();
  return {
    enabled: true,
    mode: 'multi-agent',
    availableAgents: Object.keys(agents).map(id => ({
      id,
      name: agents[id].name,
      description: agents[id].description
    }))
  };
}

module.exports = {
  handleRequest,
  delegateToAgent,
  getStatus
};
