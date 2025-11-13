/**
 * Main Coordinator
 *
 * The main agent that manages conversations and delegates to helper agents.
 * This is the only persistent agent - helpers are ephemeral.
 */

const agentRegistry = require('./agentRegistry');
const helperExecutor = require('./helperExecutor');
const toolBridge = require('../toolBridge');
const debugEvents = require('../debugEventCollector');

/**
 * Handle user request with main coordinator agent
 *
 * @param {Object} params - Request parameters
 * @param {string} params.userMessage - User's current message
 * @param {string} params.username - Current user
 * @param {Array} params.conversation - Full conversation history
 * @param {Function} params.streamModelResponse - Function to call OpenAI
 * @param {Function} params.sendToken - SSE event sender
 * @param {Function} params.shouldStop - Check if client cancelled
 * @param {boolean} params.enableHelpers - Whether helper agents are enabled
 * @param {boolean} params.debug - Enable debug mode
 * @returns {Object} Result with content and metadata
 */
async function handleRequest({
  userMessage,
  username,
  conversation,
  streamModelResponse,
  sendToken,
  shouldStop,
  enableHelpers = true,
  debug = true
}) {
  // Get main agent configuration
  const mainAgent = agentRegistry.getMainAgent();

  // Get all available MCP tools
  const mcpTools = await toolBridge.refreshTools();

  // Add helper agent "tools" if enabled
  const helperTools = enableHelpers ? agentRegistry.getHelperAgentTools() : [];

  // Combine MCP tools + helper agent tools
  const allTools = [...mcpTools, ...helperTools];

  // Convert to OpenAI format
  const openAiTools = allTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  // Build conversation context for main agent
  // Main agent gets full history (contextWindow: -1)
  const mainAgentMessages = [
    {
      role: 'system',
      content: mainAgent.systemPrompt
    },
    {
      role: 'system',
      content: `Current user: ${username}`
    },
    ...conversation, // Full conversation history
    {
      role: 'user',
      content: userMessage
    }
  ];

  // Execute main agent's loop
  let currentMessages = [...mainAgentMessages];
  let iteration = 0;
  let finalContent = '';
  let finalToolCalls = [];

  while (iteration < mainAgent.maxIterations) {
    iteration++;

    if (shouldStop && shouldStop()) {
      console.log('[mainCoordinator] Stopped by client');
      break;
    }

    // Call OpenAI with all tools (MCP + helpers)
    const response = await streamModelResponse({
      messages: currentMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      model: mainAgent.model,
      sendToken,
      shouldStop
    });

    finalContent = response.content || '';
    finalToolCalls = response.toolCalls || [];

    // Debug logging: main coordinator iteration
    if (debug) {
      debugEvents.logMainIteration(username, {
        iteration,
        hasToolCalls: finalToolCalls.length > 0,
        toolCount: finalToolCalls.length
      });
    }

    // If no tool calls, add final assistant message and we're done
    if (!finalToolCalls.length) {
      currentMessages.push({
        role: 'assistant',
        content: finalContent
      });
      break;
    }

    // Execute tool calls (both MCP tools and helper agents)
    const toolResults = [];

    for (const toolCall of response.toolCalls) {
      const toolName = toolCall.function.name;
      let args;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        args = {};
      }

      // Check if this is a helper agent call
      const helperTool = helperTools.find(t => t.name === toolName);

      if (helperTool) {
        // This is a helper agent delegation
        if (debug && sendToken) {
          sendToken('helper-spawn', {
            helper: helperTool.helperId,
            helperName: agentRegistry.getHelperAgent(helperTool.helperId).name,
            task: args.task,
            timestamp: new Date().toISOString()
          });
        }

        // Debug logging: helper spawn
        if (debug) {
          debugEvents.logHelperSpawn(username, {
            helperId: helperTool.helperId,
            helperName: agentRegistry.getHelperAgent(helperTool.helperId).name,
            task: args.task
          });
        }

        try {
          // Execute helper agent
          const helperResult = await helperExecutor.executeHelper({
            helperId: helperTool.helperId,
            task: args.task,
            context: args.context || '',
            username,
            conversation: conversation.slice(-6), // Pass last 6 messages as context
            streamModelResponse,
            sendToken: debug ? sendToken : null,
            shouldStop
          });

          if (debug && sendToken) {
            sendToken('helper-complete', {
              helper: helperTool.helperId,
              iterations: helperResult.iterations,
              timestamp: new Date().toISOString()
            });
          }

          // Debug logging: helper complete
          if (debug) {
            debugEvents.logHelperComplete(username, {
              helperId: helperTool.helperId,
              iterations: helperResult.iterations,
              result: helperResult.content
            });
          }

          toolResults.push({
            role: 'tool',
            name: toolName,
            content: helperResult.content || 'Helper completed successfully',
            tool_call_id: toolCall.id,
            origin: 'helper-agent'
          });
        } catch (error) {
          console.error(`[mainCoordinator] Helper ${helperTool.helperId} failed:`, error.message);

          if (debug && sendToken) {
            sendToken('helper-error', {
              helper: helperTool.helperId,
              error: error.message
            });
          }

          // Debug logging: helper error
          if (debug) {
            debugEvents.logHelperError(username, {
              helperId: helperTool.helperId,
              error
            });
          }

          toolResults.push({
            role: 'tool',
            name: toolName,
            content: `Helper agent error: ${error.message}`,
            tool_call_id: toolCall.id,
            origin: 'helper-agent'
          });
        }
      } else {
        // This is a regular MCP tool call
        const startTime = Date.now();
        try {
          const toolResult = await toolBridge.executeToolCall(toolCall);

          // Debug logging: tool execution
          if (debug) {
            debugEvents.logToolExecution(username, {
              toolName,
              args,
              result: toolResult.content,
              executionTime: Date.now() - startTime
            });
          }

          toolResults.push({
            role: 'tool',
            name: toolResult.name,
            content: toolResult.content,
            tool_call_id: toolCall.id,
            origin: 'mcp-tool'
          });
        } catch (error) {
          // Debug logging: tool error
          if (debug) {
            debugEvents.logToolExecution(username, {
              toolName,
              args,
              error,
              executionTime: Date.now() - startTime
            });
          }
          throw error;
        }
      }
    }

    // Append assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls
    });

    // Append tool results
    currentMessages = currentMessages.concat(toolResults);
  }

  // Return the complete message history from this agent's execution
  // Extract only the new messages (after the initial system prompts and context)
  const newMessages = currentMessages.slice(mainAgentMessages.length);

  return {
    content: finalContent,
    toolCalls: finalToolCalls,
    iterations: iteration,
    agent: 'main',
    messages: newMessages // All messages generated during execution (assistant + tool results)
  };
}

/**
 * Get status of main coordinator
 * @param {boolean} enableHelpers - Whether helpers are enabled
 * @returns {Object} Status information
 */
function getStatus(enableHelpers = true) {
  const mainAgent = agentRegistry.getMainAgent();
  const helpers = enableHelpers ? agentRegistry.getAllHelpers() : {};

  return {
    mode: enableHelpers ? 'coordinator-with-helpers' : 'single-agent',
    mainAgent: {
      id: mainAgent.id,
      name: mainAgent.name,
      persistent: mainAgent.persistent
    },
    helpers: Object.keys(helpers).map(id => ({
      id,
      name: helpers[id].name,
      description: helpers[id].description,
      enabled: enableHelpers
    })),
    backward_compatible: !enableHelpers
  };
}

module.exports = {
  handleRequest,
  getStatus
};
