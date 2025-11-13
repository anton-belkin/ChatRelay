# ChatGPT Relay – Architecture & Integration Notes

## Overview

- **Frontend**: Vanilla HTML/CSS/JS (`public/`) with SSE-based streaming (`public/app.js`). It now renders an MCP “toolbelt” so users can see which tools are connected.
- **Backend**: Express + session storage (`server.js`), persisting up to 40 messages/user through `lib/historyStore.js`. It proxies OpenAI chat completions, handles SSE tokens, and now mediates tool calls through a generic bridge.
- **MCP Toolbelt Service**: `agent-service/` is a FastAPI app that connects to Docker’s MCP Gateway via `agno.tools.mcp.MCPTools`. It lists all available tools and exposes `/call-tool` so the Node backend doesn’t have to speak MCP directly.
- **Tool Discovery & Execution**: Before every turn the backend fetches tool definitions, passes them to OpenAI as function calls, and whenever the model invokes a tool it sends the call to the FastAPI service, streams the result back to the UI, and resumes the model.
- **Persistence**: `data/history.json` (bind-mounted via compose). `.gitignore` excludes the generated history file.
- **Testing**: Playwright suite (`tests/e2e/chat.spec.ts`) runs via `npm run test:e2e`. With `FAKE_OPENAI_MODE=1`, tests exercise the tool bridge without calling OpenAI.

## Key Decisions & Findings

1. **Streaming SSE** remains unchanged. The UI expects `delta` + `done` events, so tool notes are streamed as textual inserts to avoid breaking the event contract.
2. **Hybrid tool orchestration**: Instead of crafting bespoke `<run_js>` tags, we rely on OpenAI’s function calling. `lib/toolBridge.js` fetches MCP tool metadata, caches it, and maps it into OpenAI’s schema. This keeps the Node layer focused on SSE/session logic while the FastAPI service manages MCP transports, retries, and secrets.
3. **Docker MCP Gateway** is now part of the dev compose stack. The FastAPI service connects via Streamable HTTP (`MCP_TRANSPORT=streamable-http`). Secrets are still managed through `docker mcp secret set …` outside the repo.
4. **Deterministic tool mode**: `FAKE_OPENAI_MODE=1` plus the `FAKE_TOOL_PROMPT` flag short-circuits OpenAI calls but continues to exercise the MCP pathway by invoking the local `demo_generate_number` tool via the FastAPI service. Playwright relies on this for CI.
5. **Resilience**: Tool metadata is cached with a configurable TTL. If the MCP Gateway is down, the bridge logs once and falls back to the built-in local tool so the UI/API stay responsive.

## TODO / Next Steps

- [ ] Expand the FastAPI toolbelt with health/metrics endpoints (latency per call, retries, etc.).
- [ ] Allow multiple MCP servers to be merged and surfaced with richer metadata (prompts/resources, not just tools).
- [ ] Consider streaming tool responses back through the FastAPI service so long-running MCP calls can report progress.
- [ ] Add an auth layer between the Node app and the tool service if/when we expose it beyond localhost.

## Deployment Notes

- `docker-compose.dev.yml` now spins up three services: the Node app, the FastAPI toolbelt (`agent-service`), and Docker’s MCP Gateway. Production compose mirrors this layout; ensure each service has the right secrets.
- The Node app still uses the same `Dockerfile`, but `agent-service/Dockerfile` builds a Python 3.11 image with FastAPI + agno + mcp.
- Deploy with `docker compose -f docker-compose.dev.yml up --build -d --remove-orphans`, then run `FAKE_OPENAI_MODE=1 npx playwright test` (or disable the flag to hit OpenAI).
