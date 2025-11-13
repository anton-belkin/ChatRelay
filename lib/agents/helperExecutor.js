/**
 * Helper Executor
 *
 * Executes ephemeral helper agents when delegated by main coordinator.
 * Helpers are spawned per task and destroyed after completion.
 */

const agentRegistry = require('./agentRegistry');
const toolBridge = require('../toolBridge');

/**
 * Execute a helper agent
 *
 * @param {Object} params - Execution parameters
 * @param {string} params.helperId - Helper to execute (research, code)
 * @param {string} params.task - Task description from main agent
 * @param {string} params.context - Relevant context from conversation
 * @param {string} params.username - Current user
 * @param {Array} params.conversation - Limited conversation context (last N messages)
 * @param {Function} params.streamModelResponse - Function to call OpenAI
 * @param {Function} params.sendToken - SSE event sender (optional)
 * @param {Function} params.shouldStop - Check if client cancelled
 * @returns {Object} Result with { content, iterations }
 */
async function executeHelper({
  helperId,
  task,
  context,
  username,
  conversation = [],
  streamModelResponse,
  sendToken,
  shouldStop
}) {
  // 1. Get helper configuration
  const helper = agentRegistry.getHelperAgent(helperId);
  if (!helper) {
    throw new Error(`Unknown helper: ${helperId}`);
  }

  console.log(`[helperExecutor] Spawning ${helperId} helper for task: "${task.substring(0, 50)}..."`);

  // 2. Get all MCP tools and filter for this helper
  const allMcpTools = await toolBridge.refreshTools();
  const helperTools = agentRegistry.filterToolsForAgent(helper, allMcpTools);

  // Convert to OpenAI format
  const openAiTools = helperTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  // 3. Build helper's conversation context
  const helperMessages = [
    {
      role: 'system',
      content: helper.systemPrompt
    },
    {
      role: 'system',
      content: `Current user: ${username}`
    }
  ];

  // Add limited conversation context if provided
  if (context && context.trim()) {
    helperMessages.push({
      role: 'system',
      content: `Context from main coordinator:\n${context}`
    });
  }

  // Add recent conversation messages (limited by helper's context window)
  if (conversation && conversation.length > 0) {
    const recentMessages = conversation.slice(-helper.contextWindow);
    if (recentMessages.length > 0) {
      helperMessages.push({
        role: 'system',
        content: `Recent conversation (for context):\n${formatConversationContext(recentMessages)}`
      });
    }
  }

  // Add the task from main coordinator
  helperMessages.push({
    role: 'user',
    content: `Task from coordinator: ${task}`
  });

  // 4. Execute helper's task loop
  let currentMessages = [...helperMessages];
  let iteration = 0;
  let finalContent = '';

  while (iteration < helper.maxIterations) {
    iteration++;

    if (shouldStop && shouldStop()) {
      console.log(`[helperExecutor] Helper ${helperId} stopped by client`);
      break;
    }

    // Call OpenAI with helper's tools
    const response = await streamModelResponse({
      messages: currentMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      model: helper.model,
      sendToken: null, // Helpers don't stream tokens directly to user
      shouldStop
    });

    finalContent = response.content || '';

    // If no tool calls, helper is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Execute MCP tool calls
    const toolResults = [];
    for (const toolCall of response.toolCalls) {
      const toolResult = await toolBridge.executeToolCall(toolCall);

      toolResults.push({
        role: 'tool',
        name: toolResult.name,
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
    }

    // Append assistant message + tool results
    currentMessages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls
    });

    currentMessages = currentMessages.concat(toolResults);
  }

  // 5. Helper automatically destroyed (function scope ends)
  console.log(`[helperExecutor] Helper ${helperId} completed in ${iteration} iterations`);

  return {
    content: finalContent,
    iterations: iteration,
    helperId
  };
}

/**
 * Format conversation messages for context
 * @param {Array} messages - Conversation messages
 * @returns {string} Formatted context
 */
function formatConversationContext(messages) {
  return messages
    .map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = (msg.content || '').substring(0, 200);
      return `${role}: ${content}`;
    })
    .join('\n');
}

module.exports = {
  executeHelper
};
