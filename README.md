# ChatGPT Relay

A lightweight Node.js app that lets users authenticate with just a username and chat with OpenAI’s ChatGPT API. Each exchange sends the five most recent messages as context so conversations stay coherent without storing huge histories. Sessions are persisted server-side so users can log out and back in without losing their thread. Conversations now persist per-username across sessions via a simple on-disk store, and the UI surfaces the running version (e.g., `v1.1.0`) in the header. The Dockerized deployment replaces the previous “Hello from the NAS” page and continues to serve on port **8081**.

## Features

- Username-only login with session persistence (no passwords for this quick test).
- Chat UI built with vanilla HTML/CSS/JS, with Enter-to-send (Shift+Enter for a newline), streaming assistant responses, and a visible version pill.
- Server proxies requests to OpenAI, keeps the last five messages as context, and persists up to 40 messages per user to disk (backed by `data/history.json`).
- Logout / re-login support per session with automatic history restore.
- Helper script to expose Docker + HTTP proxies so Codex (or any remote automation) can drive your local environment safely.

## Prerequisites

- Node.js 18+ (20 recommended) and npm.
- Docker Desktop (only if you still use the earlier Compose workflows).
- `socat` (`brew install socat`) for the proxy helper script.
- An OpenAI API key with access to the chat model you want (`gpt-4o-mini` by default).

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` (kept locally only) and set:
   - `OPENAI_API_KEY` – your OpenAI key.
   - `SESSION_SECRET` – any random string for signing session cookies.
   - Optional: `OPENAI_MODEL` (defaults to `gpt-4o-mini`), `PORT` (default `8081`), and `HISTORY_MAX_MESSAGES` (default `100` messages retained per user).

3. **Persistent chat history directory**
   ```bash
   mkdir -p data
   ```
   History is stored in `data/history.json` (auto-created at runtime). It’s bind-mounted into the container so conversations survive restarts.

4. **Prepare production environment file**
   ```bash
   cp .env.example .env.production
   ```
   This file travels with `docker-compose.prod.yml` on the NAS and stores the production OpenAI key/secret. Do **not** commit either `.env` file.

5. **(Optional) Start helper proxies**
   If you want me (or remote tooling) to access your local Docker daemon and the chat UI, run:
   ```bash
   bash scripts/start-proxies.sh
   ```
Leave that terminal open; it exposes:
- `tcp://127.0.0.1:23750` → `/var/run/docker.sock`
- `http://127.0.0.1:23751` → `http://127.0.0.1:8081` (change via `HTTP_FORWARD_TARGET` if you ever move the app)

## MCP toolbelt & hybrid agent service

- A lightweight FastAPI service in `agent-service/` connects to Docker’s MCP Gateway via `agno`’s `MCPTools`. It lists every MCP tool, refreshes connections, and exposes a simple HTTP API (`/tools`, `/call-tool`).
- The Node backend asks this service for tool metadata before every turn and passes them to OpenAI via the official function-calling interface. When the model chooses a tool, the backend calls the FastAPI service, posts the result into the transcript, then resumes the model with the new context.
- A built-in fallback tool `demo_generate_number` lives inside the service so local smoke tests work even before you plug in real MCP servers.
- The Docker MCP Gateway container now mounts `mcp/catalog.yaml`, which pins the `fetch` and `node-code-sandbox` servers and injects the mounts they need (most importantly `/var/run/docker.sock` for the sandbox). This keeps the configuration portable (NAS-friendly) and guarantees the toolbelt always matches the repo state.

### Configuring Docker MCP Gateway

1. Review `mcp/catalog.yaml` to confirm the servers you want (defaults to Fetch + Node.js Sandbox). Add secrets there if the chosen MCPs require them.
2. Provide any required secrets via the Docker MCP CLI, e.g. `docker mcp secret set fetch.api_key=<TOKEN>`.
3. Update `.env` with the gateway URL the FastAPI service should call (defaults to `http://mcp-gateway:8080` inside Compose).
4. `docker compose -f docker-compose.dev.yml up --build` now brings up three services:
   - `app`: the existing Node/Express server + UI
   - `agent-service`: FastAPI bridge that speaks MCP
   - `mcp-gateway`: Docker’s official MCP gateway container

### Deterministic / offline mode

Set `FAKE_OPENAI_MODE=1` (and keep the default trigger prompt `please call JS that outputs 10`) to avoid OpenAI calls during CI. In this mode the server:

- Detects the fake prompt and pretends the assistant chose the `demo_generate_number` tool.
- Actually calls the tool via the FastAPI service so we still exercise the full MCP path.
- Streams a friendly explanation (“the tool returned 10”) after the synthetic tool call completes.

Playwright uses this mode to keep e2e coverage without burning tokens. Clear the flag in real environments so GPT-4o-mini can route tool calls on its own.


## Running the app

- **Development mode (host)**
  ```bash
  npm run dev
  ```
  Visit <http://localhost:8081>. Enter a username, chat, and log out when done.

- **Production mode (host)**
  ```bash
  npm start
  ```
  Ensure `NODE_ENV=production` so cookies are marked secure when hosted behind HTTPS.

## Docker workflows (port 8081)

- **Local Compose (mirrors NAS)**
  ```bash
  docker compose -f docker-compose.dev.yml up --build
  ```
  Uses the same `.env` file for secrets and exposes <http://localhost:8081>.

- **NAS deployment**
  1. Copy `docker-compose.prod.yml`, `.env.production`, and the `data/` directory (or create `/volume1/chat-relay/data/`) on the NAS.
  2. Replace `YOUR_DOCKERHUB_USER` in `docker-compose.prod.yml` with your Docker Hub handle (or the registry/image the GitHub workflow publishes).
  3. On the NAS:
     ```bash
     docker compose pull
     docker compose up -d --remove-orphans
     ```
     The container listens on port `8081`, so existing reverse proxies/firewall rules keep working.

## How it works

- `server.js` runs an Express server with `express-session`. Upon login, it stores the username and initializes an empty message array in the session.
- Each POST to `/api/chat` appends the user’s message, grabs the last five conversation entries, and calls OpenAI with a short system prompt plus those messages.
- The assistant reply is saved back into the session (capped at 40 stored messages to avoid unbounded growth) and returned to the client.
- The frontend (`public/app.js`) handles login/logout, renders the transcript, and calls the chat endpoint.

## API key placement recap

- `.env` (local development + `docker-compose.dev.yml`)
- `.env.production` (NAS / `docker-compose.prod.yml`)

Both files follow the template in `.env.example` and must contain the OpenAI key and session secret.

## Testing

### Automated Playwright suite

- Specs live in `tests/e2e` and run via `@playwright/test`. The shared config (`playwright.config.ts`) defaults to `http://127.0.0.1:8081`, so the CLI and the VS Code Playwright Test extension execute the exact same suite.
- **Important:** On macOS and similar locked-down environments, Chromium needs elevated permissions to launch from automation. When running `npm run test:e2e` make sure you allow the command to execute with elevated privileges (e.g., via the Codex CLI approval flow) so the headless browser can start.
- Run locally:
  ```bash
  npm install
  npm run test:e2e
  ```
  or trigger the tests from the Playwright panel in VS Code. Set `E2E_BASE_URL` when you need to point at another host/port (e.g., a remote staging box).
- `chat.spec.ts` covers version badge visibility, username-only login, Enter-to-send behavior, assistant replies, logout, and session persistence.

### Optional remote runner

If you prefer executing tests on another machine/container, use `scripts/run-e2e-playwright.sh`. It SSHes into the host, runs the suite, and copies the HTML report/result artifacts back:

```bash
export PLAYWRIGHT_SSH_TARGET=anton@test-runner   # SSH target that can reach your app
export PLAYWRIGHT_REMOTE_PATH=/workspace/VSCode2 # repo path on that host
bash scripts/run-e2e-playwright.sh
```

Reports appear under `./playwright-report/index.html`, and the script’s exit code mirrors Playwright’s so you can chain it into other automation.

## Deployment & Verification Checklist (Dev workflow)

These steps are the minimum required for me (or any automation) to refresh the development stack on your Mac:

1. **Start proxies** (needed for Docker + HTTP access from this CLI):
   ```bash
   bash scripts/start-proxies.sh
   # leave the terminal open
   ```
2. **Rebuild & run the container** via the Docker socket proxy:
   ```bash
   DOCKER_HOST=tcp://127.0.0.1:23750 docker compose -f docker-compose.dev.yml up --build -d --remove-orphans
   ```
3. **Run Playwright tests** (ensures UI + MCP toolbelt paths work):
   ```bash
   npx playwright test
   ```
4. **Investigate failures** using:
   - `playwright-report/index.html` (detailed UI failures)
   - `test-results/.../error-context.md`
   - `DOCKER_HOST=… docker logs vscode2-app-1 --tail 200`

Production/NAS deployment remains manual: build/tag/push the image you want, copy `docker-compose.prod.yml`, `.env.production`, and `data/` to the NAS, set the correct image reference, then on the NAS run `docker compose pull && docker compose up -d --remove-orphans`.
