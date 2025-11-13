/**
 * Agent Executor
 *
 * Executes a specific agent with its context and tools.
 * Handles the lifecycle: spawn → execute → cleanup (automatic via scope)
 */

const agentRegistry = require('./agentRegistry');
const toolBridge = require('../toolBridge');

/**
 * Execute an agent with given context
 *
 * @param {Object} params - Execution parameters
 * @param {string} params.agentId - Agent to execute
 * @param {string} params.userMessage - User's message for this agent
 * @param {string} params.username - Current user
 * @param {Array} params.sessionContext - User's conversation history (for context)
 * @param {Object} params.memoryContext - Knowledge graph context from memory MCP
 * @param {Function} params.streamModelResponse - Function to call OpenAI with streaming
 * @param {Function} params.sendToken - SSE token sender
 * @param {Function} params.shouldStop - Check if client cancelled
 * @returns {Object} Result with { content, toolCalls, iterations }
 */
async function executeAgent({
  agentId,
  userMessage,
  username,
  sessionContext = [],
  memoryContext = null,
  streamModelResponse,
  sendToken,
  shouldStop
}) {
  // 1. Get agent configuration
  const agent = agentRegistry.getAgent(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  // 2. Get all available tools and filter for this agent
  const allTools = await toolBridge.refreshTools();
  const agentTools = agentRegistry.filterToolsForAgent(agentId, allTools);
  const openAiTools = agentTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  // 3. Build agent-specific conversation context
  const agentMessages = buildAgentMessages({
    agent,
    userMessage,
    username,
    sessionContext,
    memoryContext
  });

  // 4. Execute agent's task loop (similar to current handleAssistantResponse)
  const result = {
    content: '',
    toolCalls: [],
    iterations: 0,
    agentId
  };

  let currentMessages = [...agentMessages];
  let iteration = 0;

  while (iteration < agent.maxIterations) {
    iteration++;
    result.iterations = iteration;

    // Check if client cancelled
    if (shouldStop && shouldStop()) {
      console.log(`[agentExecutor] Agent ${agentId} stopped by client`);
      break;
    }

    // Call model with agent's tools
    const response = await streamModelResponse({
      messages: currentMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      model: agent.model,
      sendToken,
      shouldStop
    });

    // Update result
    if (response.content) {
      result.content = response.content;
    }

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const toolCall of response.toolCalls) {
      const toolResult = await toolBridge.executeToolCall(toolCall);
      toolResults.push({
        role: 'tool',
        name: toolResult.name,
        content: toolResult.content,
        tool_call_id: toolCall.id,
        origin: 'tool-response'
      });
    }

    // Append assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls
    });

    // Append tool results
    currentMessages = currentMessages.concat(toolResults);

    // Store final tool calls
    result.toolCalls = response.toolCalls;
  }

  // 5. Agent automatically "destroyed" when function scope exits
  // (ephemeral - no cleanup needed)

  return result;
}

/**
 * Build conversation messages for agent execution
 * @param {Object} params - Message building parameters
 * @returns {Array} Array of messages for OpenAI
 */
function buildAgentMessages({
  agent,
  userMessage,
  username,
  sessionContext,
  memoryContext
}) {
  const messages = [];

  // 1. Agent's system prompt
  messages.push({
    role: 'system',
    content: agent.systemPrompt
  });

  // 2. User identity
  if (username) {
    messages.push({
      role: 'system',
      content: `Current user: ${username}`
    });
  }

  // 3. Memory context (if available from knowledge graph)
  if (memoryContext && memoryContext.trim()) {
    messages.push({
      role: 'system',
      content: `Relevant knowledge graph context:\n${memoryContext}`
    });
  }

  // 4. Recent conversation context (trimmed to agent's context window)
  if (sessionContext && sessionContext.length > 0) {
    const recentContext = sessionContext.slice(-agent.contextWindow);
    const contextSummary = recentContext
      .map(msg => `${msg.role}: ${msg.content?.substring(0, 100) || ''}`)
      .join('\n');

    if (contextSummary) {
      messages.push({
        role: 'system',
        content: `Recent conversation context:\n${contextSummary}`
      });
    }
  }

  // 5. User's current message
  messages.push({
    role: 'user',
    content: userMessage
  });

  return messages;
}

/**
 * Get memory context for user from knowledge graph
 * @param {string} username - User identifier
 * @returns {string} Formatted memory context or empty string
 */
async function getMemoryContext(username) {
  try {
    // Use _read_graph to get relevant user context
    const graphResult = await toolBridge.executeToolCall({
      id: 'memory-context-read',
      function: {
        name: '_read_graph',
        arguments: JSON.stringify({})
      }
    });

    if (graphResult && graphResult.content) {
      // Filter for user-specific entities/relations
      const content = graphResult.content;
      // For now, return full graph (can be filtered by username in future)
      return content.substring(0, 1000); // Limit context size
    }
  } catch (error) {
    console.error('[agentExecutor] Failed to get memory context:', error.message);
  }

  return '';
}

module.exports = {
  executeAgent,
  getMemoryContext
};
