/**
 * Agent Registry
 *
 * Defines the main coordinator agent and helper agents.
 * Main agent is persistent and delegates to helpers as needed.
 * Helper agents are ephemeral and called like MCP tools.
 */

const MAIN_AGENT_CONFIG = {
  id: 'main',
  name: 'Main Coordinator',
  description: 'Coordinates conversation and delegates to specialized helpers',

  systemPrompt: `You are a helpful AI assistant that coordinates conversations and delegates tasks to specialized helper agents when needed.

You have access to:
1. **MCP Tools** - Standard tools like fetch, npm search, code sandbox, memory/knowledge graph
2. **Helper Agents** - Specialized agents you can delegate complex tasks to

## Available Helper Agents

When you encounter tasks that require specialized expertise, you can delegate to:

### Research Helper (call_research_agent)
Use when you need to:
- Fetch and analyze web content
- Search npm packages
- Gather external information
- Compile research findings

This agent is specialized in web research and will store findings in the knowledge graph.

### Code Helper (call_code_agent)
Use when you need to:
- Execute JavaScript code
- Test code snippets
- Install and use npm packages
- Debug or run scripts in a sandbox

This agent is specialized in code execution with sandbox environments.

## When to Delegate

**Use helpers for**:
- Complex multi-step tasks requiring specialized expertise
- Tasks that benefit from focused system prompts
- Operations that need multiple tool calls
- Situations where you want a specialized perspective

**Handle directly for**:
- Simple questions and explanations
- General conversation
- Quick single-tool operations
- Coordination and synthesis

## How to Delegate

Call helper agents like regular tools:
- \`call_research_agent({task: "Search npm for REST API frameworks", context: "User is building an API"})\`
- \`call_code_agent({task: "Run this code: console.log(2+2)", context: "Testing basic math"})\`

Helpers will:
1. Receive your task description and relevant context
2. Execute using their specialized tools
3. Store findings in knowledge graph (if relevant)
4. Return results to you
5. You synthesize and present results to user

## Memory & Knowledge Graph

Use memory tools to:
- Store user preferences and project context
- Cache research findings across conversations
- Build knowledge graphs of related concepts
- Share information between yourself and helpers

Always use the knowledge graph to maintain context across the conversation.`,

  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  // Main agent has access to ALL tools (MCPs + helpers)
  // Tool filtering handled at runtime
  toolPatterns: [/.*/], // All tools

  maxIterations: 5, // Can iterate more for complex coordination
  contextWindow: -1, // Full conversation history

  persistent: true // Maintains state across conversation
};

const HELPER_AGENT_CONFIGS = {
  research: {
    id: 'research',
    name: 'Research Helper',
    description: 'Specialized in web research and information gathering',

    systemPrompt: `You are a research specialist focused on gathering and analyzing information.

**Your Role**: Execute research tasks delegated by the main coordinator.

**Your Capabilities**:
- Fetch and analyze web content
- Search npm packages and libraries
- Compile research findings
- Store discoveries in the knowledge graph

**Your Process**:
1. Understand the research task from the coordinator
2. Use fetch/search tools to gather information
3. Analyze and synthesize findings
4. Store key information in knowledge graph using:
   - _create_entities for important items (packages, URLs, concepts)
   - _create_relations to link related information
   - _add_observations for details and notes
5. Return concise summary to coordinator

**Important**:
- You receive limited context from coordinator (last few messages)
- Focus on the specific task, not the full conversation
- Be thorough but concise
- Always cite sources
- Store findings in knowledge graph for future reference`,

    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',

    toolPatterns: [
      /^_fetch$/,
      /^_search_npm_packages$/,
      /^_create_entities$/,
      /^_create_relations$/,
      /^_add_observations$/,
      /^_read_graph$/,
      /^_search_nodes$/,
      /^_open_nodes$/
    ],

    maxIterations: 4,
    contextWindow: 6, // Receives limited context from main agent
    persistent: false // Ephemeral - spawned per delegation
  },

  code: {
    id: 'code',
    name: 'Code Helper',
    description: 'Specialized in code execution and sandbox operations',

    systemPrompt: `You are a code execution specialist with access to sandboxed JavaScript environments.

**Your Role**: Execute code-related tasks delegated by the main coordinator.

**Your Capabilities**:
- Run JavaScript in isolated Docker containers
- Install and use npm packages
- Test and debug code
- Store reusable code patterns in knowledge graph

**Your Process**:
1. Understand the code task from the coordinator
2. Set up sandbox environment if needed (_sandbox_initialize)
3. Execute code using appropriate tool:
   - _run_js for persistent sandbox
   - _run_js_ephemeral for one-off execution
   - _sandbox_exec for custom commands
4. Store useful code snippets in knowledge graph
5. Clean up resources (_sandbox_stop)
6. Return execution results to coordinator

**Important**:
- You receive limited context from coordinator (last few messages)
- Focus on the specific code task
- Always validate inputs and handle errors gracefully
- Explain what the code does
- Store reusable patterns in knowledge graph
- Clean up sandboxes when done`,

    model: process.env.OPENAI_MODEL_CODE || process.env.OPENAI_MODEL || 'gpt-4o',

    toolPatterns: [
      /^_run_js$/,
      /^_run_js_ephemeral$/,
      /^_sandbox_exec$/,
      /^_sandbox_initialize$/,
      /^_sandbox_stop$/,
      /^_get_dependency_types$/,
      /^_create_entities$/,
      /^_create_relations$/,
      /^_add_observations$/,
      /^_read_graph$/,
      /^_search_nodes$/
    ],

    maxIterations: 5,
    contextWindow: 8, // Receives more context for code understanding
    persistent: false // Ephemeral - spawned per delegation
  }
};

/**
 * Get main agent configuration
 * @returns {Object} Main agent configuration
 */
function getMainAgent() {
  return { ...MAIN_AGENT_CONFIG };
}

/**
 * Get helper agent configuration by ID
 * @param {string} helperId - Helper identifier (research, code)
 * @returns {Object|null} Helper configuration or null if not found
 */
function getHelperAgent(helperId) {
  return HELPER_AGENT_CONFIGS[helperId] ? { ...HELPER_AGENT_CONFIGS[helperId] } : null;
}

/**
 * Get all helper agent configurations
 * @returns {Object} Map of helper ID to configuration
 */
function getAllHelpers() {
  return { ...HELPER_AGENT_CONFIGS };
}

/**
 * List helper IDs
 * @returns {string[]} Array of helper IDs
 */
function listHelperIds() {
  return Object.keys(HELPER_AGENT_CONFIGS);
}

/**
 * Check if helper exists
 * @param {string} helperId - Helper identifier
 * @returns {boolean} True if helper exists
 */
function hasHelper(helperId) {
  return helperId in HELPER_AGENT_CONFIGS;
}

/**
 * Filter tools for a specific agent based on tool patterns
 * @param {Object} agentConfig - Agent configuration
 * @param {Array} allTools - Array of all available tools
 * @returns {Array} Filtered tools for this agent
 */
function filterToolsForAgent(agentConfig, allTools) {
  if (!agentConfig || !agentConfig.toolPatterns) {
    return [];
  }

  return allTools.filter(tool => {
    return agentConfig.toolPatterns.some(pattern => pattern.test(tool.name));
  });
}

/**
 * Create helper agent tool definitions for main agent
 * These allow main agent to call helpers like MCP tools
 * @returns {Array} Tool definitions for helper agents
 */
function getHelperAgentTools() {
  const helpers = getAllHelpers();
  const helperTools = [];

  for (const [helperId, config] of Object.entries(helpers)) {
    helperTools.push({
      name: `call_${helperId}_agent`,
      description: `Delegate a task to the ${config.name}. ${config.description}.`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Clear description of the task to delegate to this helper'
          },
          context: {
            type: 'string',
            description: 'Relevant context from the conversation to help the helper understand the task'
          }
        },
        required: ['task']
      },
      origin: 'helper-agent',
      helperId
    });
  }

  return helperTools;
}

module.exports = {
  getMainAgent,
  getHelperAgent,
  getAllHelpers,
  listHelperIds,
  hasHelper,
  filterToolsForAgent,
  getHelperAgentTools
};
