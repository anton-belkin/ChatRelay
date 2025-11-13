# ChatRelay Functional Specification

## 1. Overview

ChatRelay is a lightweight web app that streams conversations between end users and OpenAI's Chat Completions API while exposing Model Context Protocol (MCP) tools via a dedicated Docker MCP Gateway. The system consists of:

- A vanilla HTML/JS frontend with SSE streaming.
- An Express backend that handles authentication, persistence, OpenAI proxying, and tool orchestration.
- A FastAPI "toolbelt" service that connects to the Docker MCP Gateway and exposes `/tools` and `/call-tool` endpoints.
- A Docker MCP Gateway configured with the Fetch (Reference) and Node.js Sandbox servers for deterministic tooling.

## 2. Core User Flows

1. **Login / Session Restore**
   - User enters a username (no password). Session cookie `chat.sid` tracks the user.
   - On page load, `/api/session` restores up to 40 recent messages; `/api/meta` advertises the running version.

2. **Chatting with OpenAI**
   - `POST /api/chat` streams SSE events (`delta`, `done`, `error`).
   - The backend keeps per-user history (`data/history.json`) and forwards trimmed context to OpenAI (`CONTEXT_MESSAGE_COUNT`, default 8 messages).
   - Messages stream token-by-token to the UI; `done` replaces the local transcript with the authoritative history copy.

3. **Tool Invocation Loop**
   - Each turn includes a system message describing available MCP tools (fetched via `/tools`).
   - When OpenAI emits tool calls, the backend:
     1. Stores and streams a *tool request* note (collapsed in the UI).
     2. Executes the call via `/call-tool` (FastAPI → MCP Gateway → containerized MCP server).
     3. Stores and streams a *tool response* note (also collapsed) before resuming the conversation with the tool output appended as a user message.

4. **Follow-up Messaging**
   - Subsequent prompts immediately reuse the updated conversation (tool request + response entries retained as context).
   - Message input auto-focuses after each turn so users can send a follow-up without additional clicks.

## 3. Toolbelt & Gateway Requirements

- The Docker MCP Gateway mounts `mcp/catalog.yaml`, which pins:
  - `fetch` (Fetch Reference server) – exposes the `_fetch` tool for retrieving markdown from URLs.
  - `node-code-sandbox` (Node.js Sandbox server) – exposes `_run_js`, `_run_js_ephemeral`, `_sandbox_*`, `_search_npm_packages`, `_get_dependency_types`.
- The gateway container must mount `/var/run/docker.sock` so the Node.js sandbox can launch nested containers.
- The FastAPI service caches tool metadata (60s TTL) but `/api/tools?force=1` always hits the gateway to reflect catalog changes immediately.

## 4. Persistence & Storage

- Conversation history per user lives in `data/history.json` (capped at `HISTORY_MAX_MESSAGES`, default 100).
- Tool request/response entries are stored alongside normal messages to preserve provenance and to support follow-up questions without loss of context.
- Sessions survive browser refreshes as long as the session cookie remains valid.

## 5. Non-Functional Requirements

- **Streaming UX:** Every server response must emit SSE `delta` tokens swiftly to keep the UI responsive. Tool operations stream intermediate notes so users know execution status.
- **Security:** No OpenAI API keys or secrets are shipped to the frontend. Tool invocations run in containers with `--security-opt no-new-privileges` and explicit CPU/memory limits configured by the gateway.
- **Portability:** The entire stack (app, toolbelt, gateway) runs under Docker Compose using only repo-local assets (no dependency on Docker Desktop's embedded MCP toolkit).

## 6. Test Coverage Summary

| Test | Purpose |
|------|---------|
| `displays version badge` | Smoke test for `/api/meta` + frontend render. |
| `user can chat and persist history between sessions` | Verifies auth flow, SSE streaming, and persistence. |
| `reveals tool execution details and final reasoning` | Ensures Node.js Sandbox calls succeed and tool bubbles render. |
| `answers follow-up prompt immediately after a tool call` | Guards against the regression where the first post-tool prompt stalled. |
| `lists fetch tool from MCP gateway` | Verifies `/api/tools?force=1` surfaces `_fetch`, confirming gateway connectivity. |

Future additions should follow this doc to validate new MCP servers or UX capabilities before release.
