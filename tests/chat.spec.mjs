import { chromium } from 'playwright';

export const runChatFlow = async ({ baseUrl = 'http://host.docker.internal:8081', username = `codex-${Date.now()}` } = {}) => {
  const browser = await chromium.connectOverCDP(process.env.PLAYWRIGHT_ENDPOINT || 'ws://127.0.0.1:9222');
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Enter chat' }).click();
  await page.waitForSelector('#chat-section:not(.hidden)');

  const textarea = page.locator('#message-input');
  await textarea.fill('Hello from Playwright MCP');
  await textarea.press('Enter');
  await page.waitForSelector('.bubble.assistant');

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForSelector('#login-section:not(.hidden)');

  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Enter chat' }).click();
  await page.waitForSelector('.bubble');

  await browser.close();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runChatFlow().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
