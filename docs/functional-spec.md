# ChatRelay Functional Specification

## 1. Overview

ChatRelay is a multi-agent AI chat application that streams conversations between users and OpenAI's GPT models while providing access to MCP (Model Context Protocol) tools through a sophisticated agent delegation system. The system consists of:

- **Frontend**: Vanilla HTML/JS with SSE streaming and debug panel
- **Backend**: Express server with multi-agent coordinator pattern
- **Agent System**: Main coordinator that delegates to specialized helper agents (research, code)
- **MCP Toolbelt**: FastAPI service connecting to Docker MCP Gateway
- **Debug System**: Real-time monitoring of agent activity and tool execution
- **Persistence**: Session-scoped conversation history and knowledge graph memory

## 2. Core User Flows

### 2.1 Login / Session Restore
- User enters username (no password required)
- Session cookie `chat.sid` tracks user session
- Frontend calls `/api/session` to restore conversation history (up to 100 messages)
- Frontend calls `/api/meta` to get system version
- Previous messages displayed including tool calls and helper delegations

### 2.2 Chatting with Multi-Agent System
- User sends message via `POST /api/chat`
- Backend routes to **Main Coordinator** agent
- Main coordinator decides strategy:
  - Handle simple queries directly
  - Delegate research tasks to **Research Helper** (`call_research_agent`)
  - Delegate code execution to **Code Helper** (`call_code_agent`)
  - Use MCP tools directly when appropriate
- Tokens stream to UI via SSE `delta` events
- Helper activity shown in status bar (e.g., "🔍 Research Helper is working...")
- On completion, `done` event sends complete message array (server as source of truth)
- Frontend renders full conversation including tool calls

### 2.3 Helper Agent Delegation
**Example - Research Task**:
1. User: "Search npm for express framework"
2. Main coordinator analyzes request
3. Main calls `call_research_agent({task: "Search npm for express", context: "..."})`
4. Research helper spawned (ephemeral)
5. Research helper uses `_search_npm_packages` tool
6. Research helper returns results
7. Main coordinator synthesizes response for user
8. Research helper destroyed

**Example - Code Execution**:
1. User: "Run console.log('Hello')"
2. Main coordinator delegates to code helper
3. Code helper spawned with task
4. Code helper uses `_run_js_ephemeral` tool
5. Code executes in Docker sandbox
6. Code helper returns output
7. Main presents result to user
8. Code helper destroyed

### 2.4 Tool Invocation Loop
- Agent (main or helper) decides to use MCP tool
- OpenAI returns tool calls in response
- Backend executes via `/call-tool` (FastAPI → MCP Gateway → MCP server)
- Tool result appended to conversation
- Agent continues with next iteration (up to 5 for main, 4-5 for helpers)
- Tool calls included in conversation history for context

### 2.5 Knowledge Graph Memory
- Agents store information in knowledge graph:
  - `_create_entities` - Create nodes (projects, packages, preferences)
  - `_create_relations` - Link related information
  - `_add_observations` - Add metadata and notes
- Memory persists across helper spawns
- Memory shared between main and all helpers
- Memory scoped to user session (12 hours)
- Later queries can access stored knowledge via `_read_graph`, `_search_nodes`

### 2.6 Debug Monitoring
- User opens http://localhost:8081/debug.html
- Debug panel shows real-time events:
  - OpenAI API calls and responses
  - Tool executions (name, args, results)
  - Helper agent spawns and completions
  - Main coordinator iterations
  - Errors and warnings
- Events poll every 2 seconds
- Statistics sidebar shows counts
- Memory viewer displays knowledge graph
- Smart auto-scroll (respects user scrolling)

## 3. Agent Architecture

### 3.1 Main Coordinator
- **File**: `lib/agents/mainCoordinator.js`
- **Persistent**: Maintains state across conversation
- **Context**: Full conversation history
- **Tools**: All MCP tools + helper delegation tools (`call_research_agent`, `call_code_agent`)
- **Iterations**: Up to 5 per message
- **Model**: `gpt-4o-mini` (configurable via `OPENAI_MODEL`)

### 3.2 Research Helper
- **File**: `lib/agents/helperExecutor.js`
- **Ephemeral**: Spawned per delegation, destroyed after completion
- **Context**: Last 6 messages
- **Tools**: `_fetch`, `_search_npm_packages`, memory tools
- **Iterations**: Up to 4
- **Model**: `gpt-4o-mini`

### 3.3 Code Helper
- **File**: `lib/agents/helperExecutor.js`
- **Ephemeral**: Spawned per delegation, destroyed after completion
- **Context**: Last 8 messages
- **Tools**: `_run_js*`, `_sandbox_*`, `_get_dependency_types`, memory tools
- **Iterations**: Up to 5
- **Model**: `gpt-4o` (configurable via `OPENAI_MODEL_CODE`, falls back to `OPENAI_MODEL`)

### 3.4 Agent Registry
- **File**: `lib/agents/agentRegistry.js`
- Defines agent configurations (prompts, tools, limits)
- Functions: `getMainAgent()`, `getHelperAgent(id)`, `filterToolsForAgent()`
- Helper tools created as pseudo-tools for main coordinator

## 4. MCP Toolbelt & Gateway

### 4.1 Docker MCP Gateway
- Mounts `mcp/catalog.yaml` for server configuration
- Configured servers:
  - **fetch**: Web content retrieval (`_fetch`)
  - **node-code-sandbox**: JavaScript execution (`_run_js`, `_sandbox_*`, `_search_npm_packages`)
  - **memory**: Knowledge graph (`_create_entities`, `_create_relations`, `_read_graph`, etc.)
- Requires `/var/run/docker.sock` mount for sandbox containers
- Port: 8080

### 4.2 FastAPI Toolbelt Service
- **File**: `agent-service/app.py`
- Connects to MCP Gateway via `agno.tools.mcp.MCPTools`
- Endpoints:
  - `GET /tools` - List all MCP tools (cached 60s)
  - `POST /call-tool` - Execute MCP tool
  - `GET /tools?force=1` - Bypass cache
- Port: 8090

## 5. Persistence & Storage

### 5.1 Conversation History
- **File**: `lib/historyStore.js`
- **Storage**: `data/history.json`
- **Limit**: 100 messages per user (`HISTORY_MAX_MESSAGES`)
- **Includes**: User messages, assistant responses, tool calls, helper delegations
- **Purpose**: Context for future messages, session restore

### 5.2 Session Management
- **Implementation**: `express-session`
- **Cookie**: `chat.sid` (12-hour expiry)
- **Data**: Username, creation time
- **Scope**: Per-user isolation

### 5.3 Knowledge Graph Memory
- **MCP Server**: Memory/Knowledge Graph
- **Scope**: Per-user session
- **Duration**: 12 hours (expires with session)
- **Persistence**: Survives helper agent spawns
- **Sharing**: Accessible to main and all helpers

### 5.4 Debug Events
- **File**: `lib/debugEventCollector.js`
- **Storage**: In-memory, session-scoped
- **Limit**: 500 events per session
- **Lifetime**: Session duration (not persisted across restarts)

## 6. Non-Functional Requirements

### 6.1 Streaming UX
- Real-time token streaming via SSE
- `delta` events for each token
- Helper activity updates (`helper-spawn`, `helper-progress`, `helper-complete`)
- Tool execution visibility
- Status bar shows current agent activity

### 6.2 Security
- API keys in backend environment only (never exposed to frontend)
- Sandboxed code execution in Docker containers
- `--security-opt no-new-privileges` for sandboxes
- CPU/memory limits on sandbox containers
- Session-based user isolation
- No authentication (suitable for local/private deployment)

### 6.3 Portability
- Fully self-contained Docker Compose stack
- No dependency on Docker Desktop MCP
- Local MCP Gateway instance
- Bind-mounted volumes for data persistence
- Environment-based configuration

### 6.4 Performance
- Tool metadata caching (60s TTL)
- Limited context windows for helpers (reduce token usage)
- Appropriate models per agent (gpt-4o-mini for most, gpt-4o for code)
- Connection pooling for API requests

## 7. Test Coverage

### 7.1 Unit Tests
**Command**: `npm run test:unit`

**Files**: `tests/unit/*.test.js`

**Coverage**:
- Agent registry configuration (11 tests)
- Helper agent execution (research, code)
- Tool filtering per agent
- Main coordinator delegation
- Message history handling
- Error handling

### 7.2 E2E Tests
**Command**: `npm run test:e2e`

**Framework**: Playwright

**Files**: `tests/e2e/chat.spec.ts`

**Tests** (8 total):
1. `displays version badge` - Smoke test for `/api/meta`
2. `user can chat and persist history` - Auth flow, SSE streaming, persistence
3. `reveals tool execution details` - MCP tool integration
4. `answers follow-up prompt` - Conversation continuation after tool use
5. `lists fetch tool` - Gateway connectivity
6. `assistant response remains visible` - Response persistence (guards against disappearing bubble bug)
7. `can delegate to code helper` - Code helper delegation and execution
8. `can delegate to research helper` - Research helper delegation

### 7.3 Manual Testing
**Script**: `bash test-multi-agent.sh`

Tests multi-agent flows end-to-end.

## 8. API Reference

### 8.1 Frontend APIs

**GET /api/meta**
- Returns system version and metadata
- No authentication required

**GET /api/session**
- Returns current session and conversation history
- Requires session cookie

**POST /api/chat**
- Sends message to AI
- Returns SSE stream with events: `delta`, `helper-spawn`, `helper-progress`, `helper-complete`, `done`, `error`
- Requires session cookie

**GET /api/tools**
- Lists available MCP tools
- Query param: `?force=1` to bypass cache
- Requires session cookie

### 8.2 Debug APIs

**GET /api/debug/events**
- Returns debug events for current user
- JSON array of event objects
- Requires session cookie

**POST /api/debug/clear**
- Clears debug events for current user
- Requires session cookie

**GET /api/debug/memory**
- Returns knowledge graph for current user
- Calls `_read_graph` tool
- Requires session cookie

## 9. Configuration

### 9.1 Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini              # Main/research agents
OPENAI_MODEL_CODE=gpt-4o              # Code helper

# Server
PORT=8081
SESSION_SECRET=random-string
NODE_ENV=production

# History
HISTORY_MAX_MESSAGES=100

# Tool Service
TOOL_SERVICE_URL=http://agent-service:8090
TOOL_CACHE_TTL_MS=60000
TOOL_LOOP_LIMIT=5

# MCP
MCP_GATEWAY_URL=http://mcp-gateway:8080
MCP_TRANSPORT=streamable-http

# Debug
AGENT_DEBUG_MODE=1
```

## 10. Deployment

### 10.1 Development
```bash
bash scripts/dev-deploy.sh
```

Access:
- Chat: http://localhost:8081
- Debug: http://localhost:8081/debug.html
- Tool Service: http://localhost:8090/tools
- MCP Gateway: http://localhost:8080

### 10.2 Production
See [deployment.md](./deployment.md) for detailed production setup including:
- GitHub Actions CI/CD
- Container registry (GHCR)
- NAS deployment
- Environment configuration
- Monitoring and backup

## 11. References

- [Architecture](./architecture.md) - System architecture overview
- [Multi-Agent Guide](./multi-agent.md) - Detailed agent system documentation
- [Debug Panel](./debug-panel.md) - Debug interface guide
- [Deployment](./deployment.md) - Production deployment guide
