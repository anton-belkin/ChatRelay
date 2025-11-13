# ChatRelay – Architecture & Integration Notes

## Overview

ChatRelay is a multi-agent AI chat application that integrates OpenAI's GPT models with MCP (Model Context Protocol) tools and a sophisticated agent delegation system.

**System Components**:
- **Frontend**: Vanilla HTML/CSS/JS (`public/`) with SSE-based streaming
- **Backend**: Express + session storage (`server.js`), with multi-agent coordinator
- **Agent System**: Main coordinator that delegates to specialized helper agents
- **MCP Toolbelt Service**: FastAPI app (`agent-service/`) connecting to Docker MCP Gateway
- **Debug Panel**: Real-time system monitoring interface
- **Persistence**: Session-scoped conversation history and knowledge graph

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  index.html  │  │  app.js      │  │ debug.html   │      │
│  │  (Main UI)   │  │  (SSE/Logic) │  │ (Debug UI)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP/SSE
┌─────────────────────────────────────────────────────────────┐
│                    Express Backend (server.js)               │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Main Coordinator (mainCoordinator.js)        │ │
│  │  - Persistent across conversation                      │ │
│  │  - Full context window                                 │ │
│  │  - Delegates to helper agents                          │ │
│  │  - Uses all MCP tools + helper agent tools             │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Helper Executor (helperExecutor.js)            │ │
│  │                                                          │ │
│  │  Spawns ephemeral helpers:                              │ │
│  │  ┌──────────────┐  ┌──────────────┐                    │ │
│  │  │  Research 🔍 │  │   Code ⚙️    │                    │ │
│  │  │  - Web fetch │  │  - Sandbox   │                    │ │
│  │  │  - NPM search│  │  - JS exec   │                    │ │
│  │  └──────────────┘  └──────────────┘                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Session Management & History (historyStore.js)        │ │
│  │  - Per-user conversation persistence                   │ │
│  │  - data/history.json (max 100 messages)                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Debug Event Collector (debugEventCollector.js)        │ │
│  │  - Session-scoped event tracking                       │ │
│  │  - OpenAI calls, tool executions, agent spawns         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│            FastAPI Toolbelt (agent-service/)                 │
│  - Tool discovery (/tools)                                   │
│  - Tool execution (/call-tool)                               │
│  - Connects to MCP Gateway via agno.tools.mcp                │
└─────────────────────────────────────────────────────────────┘
                            ↓ MCP Protocol
┌─────────────────────────────────────────────────────────────┐
│              Docker MCP Gateway                              │
│  Configured MCP Servers (mcp/catalog.yaml):                  │
│  - Fetch (Reference) - _fetch tool                           │
│  - Node.js Sandbox - _run_js, _sandbox_*, _search_npm_*     │
│  - Memory/Knowledge Graph - entities, relations, obs         │
└─────────────────────────────────────────────────────────────┘
```

## Multi-Agent Coordinator Pattern

### Main Coordinator
**File**: `lib/agents/mainCoordinator.js`

The main coordinator:
- **Persistent**: Maintains state across entire conversation
- **Full Context**: Has access to complete conversation history
- **Tool Access**: Can use all MCP tools + delegate to helpers via pseudo-tools:
  - `call_research_agent({task, context})` - Delegate research tasks
  - `call_code_agent({task, context})` - Delegate code execution
- **Iteration Loop**: Processes up to 5 iterations per user message
- **Message History**: Returns complete conversation including tool calls

**System Prompt**: Instructs agent on when to delegate vs handle directly

### Helper Agents
**File**: `lib/agents/helperExecutor.js`

Helpers are:
- **Ephemeral**: Spawned per delegation, destroyed after completion
- **Specialized**: Focused system prompts and filtered tool access
- **Limited Context**: Receive only last 6-10 messages for focus
- **Stateless**: No persistent memory (use knowledge graph instead)

#### Research Helper
- **Tools**: `_fetch`, `_search_npm_packages`, memory tools
- **Context Window**: 6 messages
- **Max Iterations**: 4
- **Model**: `gpt-4o-mini`

#### Code Helper
- **Tools**: `_run_js*`, `_sandbox_*`, `_get_dependency_types`, memory tools
- **Context Window**: 8 messages
- **Max Iterations**: 5
- **Model**: `gpt-4o` (configurable, falls back to main model)

**Configuration**: `lib/agents/agentRegistry.js`

## Streaming Architecture

### SSE Event Flow

```javascript
// 1. Token streaming (main coordinator or helper)
event: delta
data: {"token": "Hello"}

// 2. Helper agent spawned
event: helper-spawn
data: {"helper": "research", "helperName": "Research Helper", "task": "..."}

// 3. Helper progress updates
event: helper-progress
data: {"helper": "research", "message": "Fetching content..."}

// 4. Helper completion
event: helper-complete
data: {"helper": "research", "iterations": 2}

// 5. Conversation complete
event: done
data: {"content": "...", "messages": [...]}
```

### Token Streaming
- `streamModelResponse()` in `lib/openaiStream.js` handles OpenAI streaming
- Tokens are streamed via SSE to frontend immediately
- Frontend (`app.js`) accumulates tokens in message bubble
- On completion, server sends full message array (source of truth)

## Tool Bridge & Execution

**File**: `lib/toolBridge.js`

### Tool Discovery
1. Fetch tool metadata from FastAPI service (`/tools`)
2. Cache with 60s TTL (configurable via `TOOL_CACHE_TTL_MS`)
3. Filter tools per agent (main gets all, helpers get subset)
4. Convert to OpenAI function calling format

### Tool Execution
1. OpenAI returns `tool_calls` in response
2. Backend executes via `POST /call-tool` to FastAPI service
3. FastAPI routes to appropriate MCP server via gateway
4. Result streamed back through SSE as tool response
5. Tool result appended to conversation, next iteration begins

### Tool Loop Protection
- Max iterations: 5 (main), 4-5 (helpers)
- Loop counter prevents infinite tool calling
- Debug events track each iteration

## Debug Event System

**File**: `lib/debugEventCollector.js`

### Event Types
- `openai-call` - Track model API calls (iteration, message count, tool count)
- `openai-response` - Log responses (content preview, tool calls, finish reason)
- `tool-execution` - Tool name, args, result preview, execution time
- `helper-spawn` - Helper spawned with task description
- `helper-iteration` - Helper iteration progress
- `helper-complete` - Helper finished with result
- `helper-error` - Helper encountered error
- `main-iteration` - Main coordinator iteration

### Event Storage
- Session-scoped (username-based)
- Max 500 events per session
- In-memory storage (not persisted across restarts)
- Accessible via `/api/debug/events`, `/api/debug/clear`, `/api/debug/memory`

### Debug UI
**File**: `public/debug.html`, `public/debug.js`

- Separate page with full-screen layout
- Real-time event streaming (2s polling)
- Statistics sidebar (total events, OpenAI calls, tools, helpers)
- Smart auto-scroll (respects user scrolling)
- Memory viewer (knowledge graph visualization)

## Persistence & Storage

### Conversation History
**File**: `lib/historyStore.js`

- Per-user storage in `data/history.json`
- Max 100 messages per user (`HISTORY_MAX_MESSAGES`)
- Includes tool requests and responses for full context
- Loaded on session restore

### Knowledge Graph Memory
**MCP Server**: Memory/Knowledge Graph

- Session-scoped (12 hours)
- Entities, relations, observations
- Shared between main and helper agents
- Survives across agent spawns
- Tools: `_create_entities`, `_create_relations`, `_add_observations`, `_read_graph`, etc.

## Key Decisions & Findings

### 1. Multi-Agent Coordinator Pattern
**Decision**: Main coordinator delegates to ephemeral helpers instead of single-agent with intent classification

**Rationale**:
- Delegation is explicit and traceable (helper agent tools)
- Main coordinator decides when to delegate vs handle directly
- Helpers have focused prompts and filtered tools
- Clearer execution model than automatic intent routing

**Trade-offs**:
- More explicit (main must choose to delegate)
- Token overhead for delegation (extra function call)
- Better debugging and transparency

### 2. Helper Agent Lifecycle
**Decision**: Ephemeral helpers (spawned and destroyed per task)

**Rationale**:
- No memory leaks or state pollution
- Clean multi-user isolation
- Simple lifecycle management
- Stateless design (memory goes to knowledge graph)

**Trade-offs**:
- Cannot maintain long-running background tasks
- Context limited to recent messages
- Must rebuild state from knowledge graph each spawn

### 3. Server-Authoritative Message History
**Decision**: Server returns complete message array in `done` event

**Rationale**:
- Fixes "disappearing response bubble" bug
- Ensures tool calls and responses are included
- Single source of truth
- Frontend just renders what server provides

**Implementation**: `onComplete` handler in `app.js` replaces local message array

### 4. Debug Event Collection
**Decision**: In-memory session-scoped event tracking

**Rationale**:
- Real-time system monitoring for development
- No external dependencies (no database)
- Automatic cleanup (per session)
- Minimal performance impact

**Trade-offs**:
- Events lost on server restart
- Memory usage grows with session activity (capped at 500 events)

### 5. Smart Auto-Scroll in Debug Panel
**Decision**: Only auto-scroll when user is at bottom

**Rationale**:
- Allows user to scroll up and read past events
- Automatically resumes when user scrolls to bottom
- Better UX than forced scrolling

**Implementation**: Track scroll position and user scroll direction in `debug.js`

## Deployment

### Development
```bash
bash scripts/dev-deploy.sh
```

Starts three Docker containers:
- `app` (Node.js Express server) - Port 8081
- `agent-service` (FastAPI tool bridge) - Port 8090
- `mcp-gateway` (Docker MCP Gateway) - Port 8080

### Production
See [deployment.md](./deployment.md) for:
- GitHub Actions CI/CD
- Container registry setup (GHCR)
- NAS deployment
- Environment configuration

### Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini              # Main/research agents
OPENAI_MODEL_CODE=gpt-4o              # Code helper (optional)

# Server
PORT=8081
SESSION_SECRET=...
NODE_ENV=production

# History
HISTORY_MAX_MESSAGES=100

# Tool Bridge
TOOL_SERVICE_URL=http://agent-service:8090
TOOL_CACHE_TTL_MS=60000
TOOL_LOOP_LIMIT=5

# MCP
MCP_GATEWAY_URL=http://mcp-gateway:8080
MCP_TRANSPORT=streamable-http

# Debug
AGENT_DEBUG_MODE=1                     # Show agent activity in UI
```

## Testing

### Unit Tests
```bash
npm run test:unit        # 64 tests including helper agent tests
```

Tests cover:
- Agent registry (configuration)
- Helper execution (research, code)
- Main coordinator (delegation, message history)
- Tool bridge (caching, filtering)
- History store (persistence)

### E2E Tests
```bash
npm run test:e2e         # 8 Playwright tests
```

Tests include:
- Login and session restore
- Token streaming and response visibility
- Tool execution (MCP tools)
- Helper agent delegation (research, code)
- Follow-up messages after tool calls

### Test Strategy
1. **Read before edit** - Always read file contents before modifying
2. **Server as source of truth** - Test expects server's complete message array
3. **Real delegations** - E2E tests use actual helper agents with real prompts
4. **Debug logging** - All major operations logged to debug events

## File Structure

```
ChatRelay/
├── public/
│   ├── index.html           # Main chat UI
│   ├── app.js               # Frontend logic, SSE handling
│   ├── debug.html           # Debug panel UI
│   ├── debug.js             # Debug panel logic
│   └── styles.css           # Styling
├── lib/
│   ├── agents/
│   │   ├── agentRegistry.js       # Agent configurations
│   │   ├── mainCoordinator.js     # Main persistent agent
│   │   └── helperExecutor.js      # Helper spawning/execution
│   ├── debugEventCollector.js     # Event tracking
│   ├── historyStore.js            # Conversation persistence
│   ├── openaiStream.js            # OpenAI streaming
│   └── toolBridge.js              # MCP tool integration
├── agent-service/
│   ├── app.py                     # FastAPI service
│   ├── requirements.txt
│   └── Dockerfile
├── mcp/
│   └── catalog.yaml               # MCP server configuration
├── tests/
│   ├── unit/                      # Jest unit tests
│   └── e2e/                       # Playwright E2E tests
├── data/
│   └── history.json               # Conversation storage
├── docs/                          # Documentation
├── server.js                      # Express backend
├── docker-compose.dev.yml         # Development stack
└── docker-compose.prod.yml        # Production stack
```

## Next Steps

### Planned Features
- [ ] Agent-to-agent communication (helpers can spawn other helpers)
- [ ] Supervisor agent (coordinates multiple parallel helpers)
- [ ] Persistent knowledge graph (cross-session memory)
- [ ] Agent performance metrics (success rates, latency tracking)
- [ ] Tool execution timeout handling

### Experimental
- [ ] Parallel helper execution (multiple helpers running concurrently)
- [ ] User-defined custom helpers (configurable via UI)
- [ ] LLM-based intent classification (fallback for ambiguous cases)
- [ ] Agent learning (improve delegation based on outcomes)

## References

- [Multi-Agent Guide](./multi-agent.md) - Detailed multi-agent documentation
- [Deployment Guide](./deployment.md) - CI/CD and production setup
- [Debug Panel Guide](./debug-panel.md) - Debug interface documentation
- [Functional Spec](./functional-spec.md) - Core requirements and flows
