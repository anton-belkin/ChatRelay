# Debug Panel Guide

The ChatRelay debug panel provides real-time visibility into the multi-agent system's internal operations.

## Overview

**URL**: http://localhost:8081/debug.html

The debug panel displays:
- OpenAI API calls and responses
- MCP tool executions
- Helper agent spawns and completions
- Main coordinator iterations
- Errors and warnings
- Knowledge graph memory contents

## Interface Layout

```
┌────────────────────────────────────────────────────────────┐
│ 🔍 System Debug Panel          alice | Connected           │
│ [Auto-scroll: ON] [Refresh] [Clear] [View Memory]          │
├──────────────┬─────────────────────────────────────────────┤
│              │                                              │
│  Statistics  │           Event Stream                       │
│              │                                              │
│  Total: 145  │  [14:32:01] main-iteration                  │
│  OpenAI: 23  │  Iteration 1 started                        │
│  Tools: 67   │                                              │
│  Helpers: 11 │  [14:32:02] helper-spawn                    │
│              │  Research Helper spawned                    │
│              │  Task: Search npm for express               │
│              │                                              │
│              │  [14:32:03] tool-execution                  │
│              │  Tool: _search_npm_packages                 │
│              │  Result: Found 50 packages (245ms)          │
│              │                                              │
│              │  [14:32:05] helper-complete                 │
│              │  Research Helper completed (2 iterations)   │
│              │                                              │
└──────────────┴─────────────────────────────────────────────┘
```

## Features

### 1. Real-Time Event Streaming

Events update every 2 seconds automatically.

**Event Types**:

#### OpenAI API Events
```json
{
  "type": "openai-call",
  "timestamp": "2025-01-13T14:32:01.234Z",
  "data": {
    "model": "gpt-4o-mini",
    "messageCount": 8,
    "toolCount": 15,
    "iteration": 1
  }
}
```

```json
{
  "type": "openai-response",
  "timestamp": "2025-01-13T14:32:02.456Z",
  "data": {
    "contentPreview": "I'll search for express packages...",
    "toolCalls": ["call_research_agent"],
    "finishReason": "tool_calls"
  }
}
```

#### Tool Execution Events
```json
{
  "type": "tool-execution",
  "timestamp": "2025-01-13T14:32:03.789Z",
  "data": {
    "toolName": "_search_npm_packages",
    "args": {"searchTerm": "express"},
    "resultPreview": "Found 50 packages...",
    "executionTime": 245
  }
}
```

#### Helper Agent Events
```json
{
  "type": "helper-spawn",
  "timestamp": "2025-01-13T14:32:02.123Z",
  "data": {
    "helper": "research",
    "helperName": "Research Helper",
    "task": "Search npm for express",
    "context": "User building web API"
  }
}
```

```json
{
  "type": "helper-iteration",
  "timestamp": "2025-01-13T14:32:03.456Z",
  "data": {
    "helper": "research",
    "iteration": 1,
    "message": "Searching packages..."
  }
}
```

```json
{
  "type": "helper-complete",
  "timestamp": "2025-01-13T14:32:05.789Z",
  "data": {
    "helper": "research",
    "iterations": 2,
    "resultPreview": "Found several packages..."
  }
}
```

```json
{
  "type": "helper-error",
  "timestamp": "2025-01-13T14:32:06.012Z",
  "data": {
    "helper": "code",
    "error": "Tool execution timeout",
    "iteration": 3
  }
}
```

#### Main Coordinator Events
```json
{
  "type": "main-iteration",
  "timestamp": "2025-01-13T14:32:01.123Z",
  "data": {
    "iteration": 1,
    "messageCount": 12,
    "toolCallCount": 1
  }
}
```

### 2. Statistics Sidebar

Displays aggregate counts:
- **Total Events**: All events in current session
- **OpenAI Calls**: Number of API requests
- **Tools Executed**: Number of tool invocations
- **Helpers Spawned**: Number of helper agent spawns

Updates in real-time as events occur.

### 3. Smart Auto-Scroll

Auto-scroll behavior:
- **When at bottom**: Automatically scrolls to show new events
- **When scrolled up**: Pauses auto-scroll, lets user read
- **When scrolling to bottom**: Resumes auto-scroll

Toggle via "Auto-scroll: ON/OFF" button.

**Implementation**:
```javascript
const isAtBottom = () => {
  const threshold = 100;  // pixels from bottom
  const scrollTop = container.scrollTop;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  return scrollHeight - scrollTop - clientHeight < threshold;
};

// Only scroll if user is at bottom
if (isAtBottom() || !isUserScrolling) {
  container.scrollTop = container.scrollHeight;
}
```

### 4. Event Controls

**Refresh Button**:
- Manually fetch latest events
- Useful if auto-polling is slow

**Clear Events Button**:
- Clears all events for current user
- Calls `POST /api/debug/clear`
- Useful for starting fresh

**View Memory Button**:
- Opens modal with knowledge graph
- Shows entities, relations, observations
- Formatted JSON display

### 5. User Session Indicator

Shows current logged-in user:
- **"Not Logged In"** - No session cookie
- **"alice"** - Logged in as alice

Events are filtered by session automatically.

### 6. Connection Status

Indicates API connectivity:
- **"Connected"** (green) - Successfully polling events
- **"Disconnected"** (red) - Failed to fetch events

## API Endpoints

### GET /api/debug/events

Returns all debug events for current user session.

**Request**:
```bash
curl http://localhost:8081/api/debug/events \
  -H "Cookie: chat.sid=..."
```

**Response**:
```json
[
  {
    "type": "openai-call",
    "timestamp": "2025-01-13T14:32:01.234Z",
    "id": "1705155121234-abc123",
    "data": {...}
  },
  ...
]
```

### POST /api/debug/clear

Clears all debug events for current user.

**Request**:
```bash
curl -X POST http://localhost:8081/api/debug/clear \
  -H "Cookie: chat.sid=..."
```

**Response**:
```json
{
  "success": true,
  "message": "Debug events cleared for user alice"
}
```

### GET /api/debug/memory

Returns knowledge graph memory for current user.

**Request**:
```bash
curl http://localhost:8081/api/debug/memory \
  -H "Cookie: chat.sid=..."
```

**Response**:
```json
{
  "entities": [...],
  "relations": [...],
  "observations": [...]
}
```

## Event Collection System

**File**: `lib/debugEventCollector.js`

### Architecture

```javascript
// Session-scoped event storage
const sessionEvents = new Map();  // username -> events[]

// Add event
function addEvent(username, event) {
  if (!sessionEvents.has(username)) {
    sessionEvents.set(username, []);
  }

  const eventWithMeta = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    id: generateId()
  };

  events.push(eventWithMeta);

  // Limit to 500 events per session
  if (events.length > 500) {
    events.splice(0, events.length - 500);
  }
}
```

### Integration Points

**Main Coordinator** (`lib/agents/mainCoordinator.js`):
```javascript
if (AGENT_DEBUG_MODE) {
  debugEvents.logMainIteration(username, {
    iteration,
    messageCount: currentMessages.length,
    toolCallCount: toolCalls.length
  });
}
```

**Helper Executor** (`lib/agents/helperExecutor.js`):
```javascript
debugEvents.logHelperSpawn(username, {
  helper: helperId,
  helperName: config.name,
  task,
  context
});
```

**OpenAI Streaming** (`lib/openaiStream.js`):
```javascript
if (username && AGENT_DEBUG_MODE) {
  debugEvents.logOpenAICall(username, {
    model,
    messages: payload,
    tools,
    iteration
  });
}
```

**Tool Bridge** (`lib/toolBridge.js`):
```javascript
debugEvents.logToolExecution(username, {
  toolName,
  args,
  result,
  executionTime
});
```

### Helper Functions

```javascript
// Log OpenAI API call
debugEvents.logOpenAICall(username, data);

// Log OpenAI response
debugEvents.logOpenAIResponse(username, data);

// Log tool execution
debugEvents.logToolExecution(username, data);

// Log helper spawn
debugEvents.logHelperSpawn(username, data);

// Log helper iteration
debugEvents.logHelperIteration(username, data);

// Log helper completion
debugEvents.logHelperComplete(username, data);

// Log helper error
debugEvents.logHelperError(username, data);

// Log main coordinator iteration
debugEvents.logMainIteration(username, data);

// Get all events for user
debugEvents.getEvents(username);

// Clear events for user
debugEvents.clearEvents(username);
```

## Configuration

### Environment Variables

```bash
# Enable debug mode (shows agent activity in main UI)
AGENT_DEBUG_MODE=1
```

When `AGENT_DEBUG_MODE=1`:
- Debug events are collected
- Status bar in main UI shows agent activity
- SSE events include helper-spawn, helper-progress, etc.

When `AGENT_DEBUG_MODE=0`:
- Debug panel still works but with limited events
- No agent activity in main UI
- Minimal SSE events

### Event Limits

**Max Events Per Session**: 500
- Oldest events removed when limit exceeded
- Configurable in `lib/debugEventCollector.js`:
```javascript
const MAX_EVENTS_PER_SESSION = 500;
```

**Event TTL**: Session duration (12 hours)
- Events cleared when session expires
- Not persisted across server restarts

## Usage Guide

### Development Workflow

1. **Open debug panel**: http://localhost:8081/debug.html
2. **Open main chat** in another tab/window: http://localhost:8081
3. **Send message** in main chat
4. **Watch debug panel** for:
   - Main coordinator iterations
   - Helper spawns
   - Tool executions
   - API calls

### Debugging Helper Agents

**Scenario**: Research helper not being called

1. Check debug panel for `helper-spawn` events
2. If no spawn, check `main-iteration` events
   - Is main coordinator deciding to delegate?
3. Check `openai-call` events
   - Are helper tools available in tool list?
4. Check `openai-response` events
   - Is main calling `call_research_agent`?

**Scenario**: Helper execution failing

1. Find `helper-spawn` event
2. Look for `helper-iteration` events
   - How many iterations?
   - What tools being called?
3. Check `tool-execution` events during helper lifetime
   - Are tools succeeding?
   - Execution times reasonable?
4. Look for `helper-error` or `helper-complete`
   - What's the final status?

### Monitoring Performance

**Token Usage**:
- Count `openai-call` events
- Each call shows `messageCount` and `toolCount`
- High counts indicate expensive operations

**Tool Execution Time**:
- `tool-execution` events show `executionTime` in ms
- Identify slow tools
- Consider caching or optimization

**Helper Efficiency**:
- Count `helper-spawn` events
- Check `iterations` in `helper-complete`
- High iteration counts may indicate unclear tasks

### Memory Investigation

1. Click "View Memory" button
2. Inspect knowledge graph:
   - What entities exist?
   - What relations are stored?
   - Are observations useful?
3. Check if helpers are using memory:
   - Look for `_create_entities` in tool executions
   - Look for `_read_graph` calls

## Troubleshooting

### Issue: No events showing

**Check**:
1. Are you logged in? (user badge should show username)
2. Is session valid? (try logging out and in again)
3. Have you sent any messages? (events only created during conversation)
4. Check browser console for errors

**Fix**:
```bash
# Check server logs
docker compose -f docker-compose.dev.yml logs app -f | grep debug

# Test endpoint directly
curl http://localhost:8081/api/debug/events -H "Cookie: chat.sid=YOUR_COOKIE"
```

### Issue: Events not updating

**Check**:
1. Is auto-refresh working? (check network tab in browser dev tools)
2. Is server responding? (connection status indicator)
3. Are new events being created? (try sending a chat message)

**Fix**:
- Click "Refresh" button manually
- Check server logs for errors
- Verify session cookie is valid

### Issue: Too many events, hard to find relevant ones

**Solution**:
- Use "Clear Events" to start fresh
- Focus on recent events (bottom of list)
- Look for specific event types:
  - `helper-spawn` for agent activity
  - `tool-execution` for tool calls
  - `*-error` for problems

### Issue: Memory view shows empty graph

**Possible causes**:
1. No memory tools have been used yet
2. Session expired (memory cleared)
3. MCP memory server not configured

**Check**:
```bash
# Verify memory tools available
curl http://localhost:8090/tools | jq '.tools[] | select(.name | contains("create_"))'

# Check MCP gateway logs
docker compose -f docker-compose.dev.yml logs mcp-gateway | grep memory
```

## Files Reference

- **Frontend**: `public/debug.html`, `public/debug.js`, `public/styles.css`
- **Backend**: `server.js` (debug endpoints)
- **Event Collector**: `lib/debugEventCollector.js`
- **Integration**: All agent files (`lib/agents/*.js`), `lib/openaiStream.js`, `lib/toolBridge.js`

## Advanced: Adding Custom Events

To add a new event type:

1. **Define event logger** in `lib/debugEventCollector.js`:
```javascript
function logCustomEvent(username, data) {
  addEvent(username, {
    type: 'custom-event',
    data
  });
}

module.exports = {
  // ... existing exports
  logCustomEvent
};
```

2. **Call from your code**:
```javascript
const debugEvents = require('./debugEventCollector');

if (AGENT_DEBUG_MODE) {
  debugEvents.logCustomEvent(username, {
    customField: 'value',
    timestamp: new Date().toISOString()
  });
}
```

3. **Update debug UI** in `public/debug.js`:
```javascript
function renderEvent(event) {
  switch (event.type) {
    // ... existing cases
    case 'custom-event':
      return `Custom: ${event.data.customField}`;
  }
}
```

## Related Documentation

- [Architecture](./architecture.md) - System architecture
- [Multi-Agent Guide](./multi-agent.md) - Agent system details
- [Functional Spec](./functional-spec.md) - Core requirements
