#!/usr/bin/env bash
set -euo pipefail

: "${PLAYWRIGHT_SSH_TARGET:?Set PLAYWRIGHT_SSH_TARGET to the SSH target hosting the MCP Playwright server (e.g. user@host)}"
: "${PLAYWRIGHT_REMOTE_PATH:?Set PLAYWRIGHT_REMOTE_PATH to the absolute path of this repo in that environment}"

E2E_BASE_URL="${E2E_BASE_URL:-http://host.docker.internal:8081}"
REMOTE_RESULTS_DIR="${PLAYWRIGHT_REMOTE_RESULTS_DIR:-test-results}"
REMOTE_REPORT_DIR="${PLAYWRIGHT_REMOTE_REPORT_DIR:-playwright-report}"

echo "[run-e2e] Target: ${PLAYWRIGHT_SSH_TARGET} :: ${PLAYWRIGHT_REMOTE_PATH}"
echo "[run-e2e] Base URL: ${E2E_BASE_URL}"

set +e
ssh -o BatchMode=yes "${PLAYWRIGHT_SSH_TARGET}" <<EOF
set -euo pipefail
cd "${PLAYWRIGHT_REMOTE_PATH}"
export E2E_BASE_URL="${E2E_BASE_URL}"
npm install
npx playwright test --reporter=list,html --output="${REMOTE_RESULTS_DIR}"
EOF
status=$?
set -e

echo "[run-e2e] Fetching reports (exit code: ${status})"
rm -rf "./${REMOTE_RESULTS_DIR}" "./${REMOTE_REPORT_DIR}"
scp -r "${PLAYWRIGHT_SSH_TARGET}:${PLAYWRIGHT_REMOTE_PATH}/${REMOTE_RESULTS_DIR}" "./${REMOTE_RESULTS_DIR}" >/dev/null 2>&1 || true
scp -r "${PLAYWRIGHT_SSH_TARGET}:${PLAYWRIGHT_REMOTE_PATH}/${REMOTE_REPORT_DIR}" "./${REMOTE_REPORT_DIR}" >/dev/null 2>&1 || true

if [[ ${status} -eq 0 ]]; then
  echo "[run-e2e] Tests passed. HTML report: ${REMOTE_REPORT_DIR}/index.html"
else
  echo "[run-e2e] Tests failed (exit code ${status}). Inspect ${REMOTE_REPORT_DIR}/index.html for details." >&2
fi

exit "${status}"
