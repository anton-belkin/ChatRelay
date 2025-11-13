# Multi-Agent Architecture

ChatRelay uses a multi-agent coordinator pattern where a persistent main agent delegates specialized tasks to ephemeral helper agents.

## Overview

The multi-agent system consists of:

1. **Main Coordinator** - Persistent agent that manages conversation and delegates tasks
2. **Helper Agents** - Ephemeral specialists spawned for specific tasks
3. **Knowledge Graph Memory** - Shared MCP memory for cross-agent context
4. **Debug Event System** - Real-time monitoring of agent activity

## Architecture

```
User Request
    ↓
Main Coordinator (Persistent)
  - Manages full conversation
  - Access to all tools + helper agent tools
  - Decides when to delegate
    ↓
    ├─→ call_research_agent({task, context})
    │     ↓
    │   Research Helper 🔍 (Ephemeral)
    │   - Web fetching
    │   - NPM package search
    │   - Knowledge graph storage
    │
    └─→ call_code_agent({task, context})
          ↓
        Code Helper ⚙️ (Ephemeral)
        - Sandbox execution
        - JavaScript running
        - Package installation
    ↓
Shared Knowledge Graph (MCP Memory)
  - Entities, relations, observations
  - Persists across helper spawns
  - Session-scoped (12 hours)
```

## Main Coordinator

**File**: [lib/agents/mainCoordinator.js](../lib/agents/mainCoordinator.js)

### Configuration

```javascript
{
  id: 'main',
  name: 'Main Coordinator',
  persistent: true,
  contextWindow: -1,  // Full conversation history
  maxIterations: 5,
  model: 'gpt-4o-mini',
  toolPatterns: [/.*/]  // All tools
}
```

### System Prompt

The main coordinator's prompt:
- Explains available MCP tools (fetch, sandbox, memory, etc.)
- Documents available helper agents (research, code)
- Instructs when to delegate vs handle directly
- Emphasizes knowledge graph usage for persistent context

**Key Guidelines**:
- Use helpers for complex multi-step tasks requiring specialized expertise
- Handle simple questions and coordination directly
- Delegate research to research helper
- Delegate code execution to code helper
- Store important findings in knowledge graph

### Available Tools

**MCP Tools** (from gateway):
- `_fetch` - Fetch web content
- `_search_npm_packages` - Search npm registry
- `_run_js*` - Execute JavaScript
- `_sandbox_*` - Manage sandboxes
- `_create_entities`, `_create_relations`, `_add_observations` - Memory tools
- `_read_graph`, `_search_nodes`, `_open_nodes` - Memory queries

**Helper Agent Tools** (pseudo-tools for delegation):
- `call_research_agent({task, context})` - Delegate to research helper
- `call_code_agent({task, context})` - Delegate to code helper

### Execution Flow

1. **Receive user message**
2. **Iteration loop** (up to 5 iterations):
   - Call OpenAI with conversation + tools
   - If response has tool calls:
     - Execute each tool (MCP or helper delegation)
     - Append results to conversation
     - Continue to next iteration
   - If no tool calls:
     - Return final response
     - Break loop
3. **Return complete message history** including all tool calls/responses

## Helper Agents

**File**: [lib/agents/helperExecutor.js](../lib/agents/helperExecutor.js)

### Research Helper

**Purpose**: Web research and information gathering

**Configuration**:
```javascript
{
  id: 'research',
  name: 'Research Helper',
  persistent: false,  // Ephemeral
  contextWindow: 6,   // Limited context
  maxIterations: 4,
  model: 'gpt-4o-mini',
  toolPatterns: [
    /^_fetch$/,
    /^_search_npm_packages$/,
    /^_create_entities$/,
    /^_create_relations$/,
    /^_add_observations$/,
    /^_read_graph$/,
    /^_search_nodes$/,
    /^_open_nodes$/
  ]
}
```

**System Prompt**:
- Research specialist role
- Process: Understand task → Use tools → Analyze → Store in knowledge graph → Return summary
- Focus on specific task, not full conversation
- Always cite sources
- Store findings for future reference

**When Delegated**:
- Main coordinator calls `call_research_agent({task: "...", context: "..."})`
- Helper spawned with:
  - Task description from main
  - Relevant context (last 6 messages)
  - Filtered tool access (fetch, npm search, memory)
- Helper executes research
- Results returned to main coordinator
- Helper destroyed

### Code Helper

**Purpose**: Code execution in sandboxed environments

**Configuration**:
```javascript
{
  id: 'code',
  name: 'Code Helper',
  persistent: false,  // Ephemeral
  contextWindow: 8,   // More context for code understanding
  maxIterations: 5,
  model: 'gpt-4o',   // Stronger model for code
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
  ]
}
```

**System Prompt**:
- Code execution specialist role
- Process: Understand task → Setup sandbox → Execute → Store patterns → Cleanup → Return results
- Limited context (last 8 messages)
- Validate inputs, handle errors
- Explain what code does
- Clean up sandboxes when done

**When Delegated**:
- Main coordinator calls `call_code_agent({task: "...", context: "..."})`
- Helper spawned with:
  - Code task from main
  - Relevant context (last 8 messages)
  - Filtered tool access (sandbox, memory)
- Helper executes code
- Results returned to main coordinator
- Helper destroyed

## Helper Execution Process

**File**: [lib/agents/helperExecutor.js](../lib/agents/helperExecutor.js)

```javascript
async function executeHelper({
  helperId,      // 'research' or 'code'
  task,          // Task description from main
  context,       // Context from main
  username,      // User session
  conversation,  // Recent messages
  streamModelResponse,  // OpenAI streaming function
  sendToken,     // Token streaming callback
  shouldStop     // Stop check function
}) {
  // 1. Load helper config
  const helperConfig = agentRegistry.getHelperAgent(helperId);

  // 2. Build helper messages
  const helperMessages = [
    { role: 'system', content: helperConfig.systemPrompt },
    ...conversation.slice(-helperConfig.contextWindow),
    { role: 'user', content: `Task: ${task}\n\nContext: ${context}` }
  ];

  // 3. Filter tools for this helper
  const helperTools = filterToolsForAgent(helperConfig, allTools);

  // 4. Execute helper iteration loop
  let iteration = 0;
  let currentMessages = [...helperMessages];

  while (iteration < helperConfig.maxIterations) {
    const response = await streamModelResponse({
      messages: currentMessages,
      tools: helperTools,
      model: helperConfig.model,
      sendToken,
      username
    });

    if (!response.toolCalls?.length) {
      // No more tool calls, helper done
      return {
        content: response.content,
        iterations: iteration,
        helperId
      };
    }

    // Execute tool calls
    for (const toolCall of response.toolCalls) {
      const result = await executeTool(toolCall);
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result
      });
    }

    iteration++;
  }

  // 5. Cleanup and return
  return {
    content: finalContent,
    iterations: iteration,
    helperId
  };
}
```

## Knowledge Graph Memory

**MCP Server**: Memory/Knowledge Graph

### Purpose
Shared persistent storage for:
- Project context
- User preferences
- Research findings
- Code snippets
- Cross-agent communication

### Lifecycle
- **Scope**: Per-user session
- **Duration**: 12 hours (session timeout)
- **Persistence**: Survives helper agent spawns
- **Sharing**: Accessible to main and all helpers

### Tools

**Create**:
- `_create_entities({entities: [{name, entityType, observations}]})` - Create nodes
- `_create_relations({relations: [{from, to, relationType}]})` - Link nodes
- `_add_observations({observations: [{entityName, contents}]})` - Add metadata

**Query**:
- `_read_graph()` - Get entire knowledge graph
- `_search_nodes({query})` - Search by keywords
- `_open_nodes({names})` - Get specific nodes

**Delete**:
- `_delete_entities({entityNames})` - Remove nodes
- `_delete_relations({relations})` - Remove links
- `_delete_observations({deletions})` - Remove metadata

### Usage Patterns

**Research Helper**:
```javascript
// Store research findings
_create_entities({
  entities: [
    {
      name: 'express',
      entityType: 'npm-package',
      observations: ['Fast, minimalist web framework for Node.js']
    }
  ]
});

_create_relations({
  relations: [
    { from: 'user-project', to: 'express', relationType: 'uses' }
  ]
});
```

**Code Helper**:
```javascript
// Store code patterns
_create_entities({
  entities: [
    {
      name: 'hello-world-snippet',
      entityType: 'code-snippet',
      observations: ['console.log("Hello, World!");']
    }
  ]
});
```

**Main Coordinator**:
```javascript
// Read project context
const graph = await _read_graph();
// Use context to inform delegation decisions
```

## Debug Event System

**File**: [lib/debugEventCollector.js](../lib/debugEventCollector.js)

### Event Types

**Helper Lifecycle**:
- `helper-spawn` - Helper agent spawned
- `helper-iteration` - Helper iteration progress
- `helper-complete` - Helper finished successfully
- `helper-error` - Helper encountered error

**Main Coordinator**:
- `main-iteration` - Main coordinator iteration

**OpenAI API**:
- `openai-call` - API request sent
- `openai-response` - API response received

**Tools**:
- `tool-execution` - Tool executed

### Debug UI

**URL**: http://localhost:8081/debug.html

Features:
- Real-time event stream (2s polling)
- Statistics (total events, API calls, tools, helpers)
- Event filtering and search
- Memory viewer (knowledge graph visualization)
- Smart auto-scroll

See [debug-panel.md](./debug-panel.md) for details.

## SSE Event Streaming

The frontend receives real-time updates via Server-Sent Events:

```javascript
// Helper spawned
event: helper-spawn
data: {
  "helper": "research",
  "helperName": "Research Helper",
  "task": "Search npm for express",
  "timestamp": "2025-01-13T..."
}

// Helper progress
event: helper-progress
data: {
  "helper": "research",
  "message": "Searching packages..."
}

// Helper complete
event: helper-complete
data: {
  "helper": "research",
  "iterations": 2,
  "timestamp": "2025-01-13T..."
}

// Conversation complete
event: done
data: {
  "content": "I found several packages...",
  "messages": [...]  // Complete conversation history
}
```

Frontend (`public/app.js`) updates status bar based on events:
- 🔍 "Main agent delegating to Research Helper..."
- ⚙️ "Code Helper is processing..."
- ✅ "Complete"

## Configuration

### Environment Variables

```bash
# Agent Models
OPENAI_MODEL=gpt-4o-mini              # Main + research agents
OPENAI_MODEL_CODE=gpt-4o              # Code helper (optional)

# Debug
AGENT_DEBUG_MODE=1                     # Show agent activity in UI

# Tool Loop Limits (affects all agents)
TOOL_LOOP_LIMIT=5                      # Max iterations
```

### Agent Registry

**File**: [lib/agents/agentRegistry.js](../lib/agents/agentRegistry.js)

To modify agent configuration:

1. **Change system prompt**:
```javascript
MAIN_AGENT_CONFIG.systemPrompt = `...new prompt...`;
```

2. **Change tool access**:
```javascript
HELPER_AGENT_CONFIGS.research.toolPatterns = [
  /^_fetch$/,
  /^_new_tool$/,  // Add new tool
  // ...
];
```

3. **Change iteration limits**:
```javascript
HELPER_AGENT_CONFIGS.code.maxIterations = 10;  // Increase iterations
```

4. **Change context window**:
```javascript
HELPER_AGENT_CONFIGS.research.contextWindow = 10;  // More context
```

## Testing

### Unit Tests

**File**: [tests/unit/helperAgents.test.js](../tests/unit/helperAgents.test.js)

```bash
npm run test:unit
```

Tests:
- Helper agent execution (research, code)
- Tool filtering
- Iteration limits
- Error handling
- Message history

### E2E Tests

**File**: [tests/e2e/chat.spec.ts](../tests/e2e/chat.spec.ts)

```bash
npm run test:e2e
```

Tests:
- Research helper delegation
- Code helper delegation
- Response visibility
- Tool execution through helpers

### Manual Testing

1. Start system:
```bash
bash scripts/dev-deploy.sh
```

2. Open chat: http://localhost:8081

3. Test research delegation:
```
User: Please use the research helper to search npm for express
Expected: Research helper spawned, searches packages, returns results
```

4. Test code delegation:
```
User: Please use the code helper to run console.log("Hello")
Expected: Code helper spawned, executes code, returns output
```

5. Check debug panel: http://localhost:8081/debug.html
   - Should show helper-spawn events
   - Tool execution details
   - Iteration counts

## Extending the System

### Adding a New Helper

1. **Define in agentRegistry.js**:
```javascript
HELPER_AGENT_CONFIGS.database = {
  id: 'database',
  name: 'Database Helper',
  description: 'SQL and database operations',
  systemPrompt: `You are a database specialist...`,
  toolPatterns: [
    /^_execute_sql$/,
    /^_query_database$/,
    /^_create_entities$/,  // Memory tools
    // ...
  ],
  model: 'gpt-4o-mini',
  maxIterations: 4,
  contextWindow: 8,
  persistent: false
};
```

2. **Update getHelperAgentTools()**:
   - Automatically creates `call_database_agent` tool

3. **Test**:
```javascript
// Main coordinator will now see and can call:
call_database_agent({
  task: "Query users table",
  context: "User wants to see all active users"
});
```

### Modifying Main Coordinator

To change when/how main delegates:

1. **Edit system prompt** in `agentRegistry.js`:
```javascript
MAIN_AGENT_CONFIG.systemPrompt = `
...
## When to Delegate

**Always delegate database queries** to database helper
**Always delegate API calls** to research helper
...
`;
```

2. **No code changes needed** - main coordinator learns from prompt

## Architecture Decisions

### Why Coordinator Pattern?

**Vs Intent Classification**:
- ✅ Explicit delegation (traceable)
- ✅ Main agent decides based on conversation context
- ✅ Simpler debugging (clear function calls)
- ✅ Flexible (can delegate multiple times, combine results)
- ❌ More tokens (delegation function call overhead)
- ❌ Relies on main agent's judgment

### Why Ephemeral Helpers?

**Vs Persistent Helpers**:
- ✅ No memory leaks
- ✅ No state pollution
- ✅ Clean multi-user isolation
- ✅ Simple lifecycle
- ❌ Cannot maintain long-running tasks
- ❌ Must rebuild context each spawn

**Solution**: Use knowledge graph for persistence

### Why Limited Context for Helpers?

**Vs Full Context**:
- ✅ Focused on specific task
- ✅ Lower token costs
- ✅ Faster execution
- ✅ Less model confusion
- ❌ May miss broader context

**Solution**: Main provides relevant context in delegation call

## Performance Considerations

### Token Usage

**Per Delegation**:
- Main coordinator: ~1000 tokens (full conversation)
- Helper agent: ~500 tokens (limited context)
- Delegation overhead: ~100 tokens (function call + result)

**Optimization**:
- Helpers use smaller context windows
- Research helper uses gpt-4o-mini
- Tool results summarized when possible

### Execution Time

**Typical Flow**:
1. User message → Main coordinator: ~2s
2. Main delegates to research: ~3s
3. Research executes tools: ~2s
4. Research returns to main: ~1s
5. Main synthesizes response: ~2s
**Total**: ~10s

**Parallel Execution** (future):
- Multiple helpers run concurrently
- Could reduce to ~5-6s

## Troubleshooting

### Helper Not Being Called

**Check main coordinator logs**:
```bash
docker compose -f docker-compose.dev.yml logs app -f | grep coordinator
```

**Verify helper tools are registered**:
```bash
curl http://localhost:8081/api/tools | jq '.tools[] | select(.origin == "helper-agent")'
```

**Expected**:
```json
[
  {"name": "call_research_agent", "origin": "helper-agent"},
  {"name": "call_code_agent", "origin": "helper-agent"}
]
```

### Helper Execution Fails

**Check debug events**:
```bash
curl http://localhost:8081/api/debug/events
```

**Look for**:
- `helper-spawn` - Was helper spawned?
- `helper-error` - What was the error?
- `tool-execution` - Did tools execute?

**Common issues**:
- Tool not available for helper (check toolPatterns)
- Iteration limit hit (check maxIterations)
- OpenAI API error (check logs)

### Knowledge Graph Not Working

**Check MCP gateway**:
```bash
docker compose -f docker-compose.dev.yml logs mcp-gateway | grep memory
```

**Verify memory tools**:
```bash
curl http://localhost:8090/tools | jq '.tools[] | select(.name | contains("create_"))'
```

**Test memory tool directly**:
```bash
curl -X POST http://localhost:8090/call-tool \
  -H "Content-Type: application/json" \
  -d '{"name":"_create_entities","arguments":{"entities":[{"name":"test","entityType":"test"}]}}'
```

## References

- [Architecture](./architecture.md) - Overall system architecture
- [Debug Panel](./debug-panel.md) - Debug interface documentation
- [Agent Registry](../lib/agents/agentRegistry.js) - Agent configurations
- [Main Coordinator](../lib/agents/mainCoordinator.js) - Main agent implementation
- [Helper Executor](../lib/agents/helperExecutor.js) - Helper spawning logic
