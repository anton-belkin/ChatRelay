import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://host.docker.internal:8081';
const username = `codex-${Date.now()}`;

const run = async () => {
  const browser = await chromium.connectOverCDP(process.env.PLAYWRIGHT_ENDPOINT || 'ws://127.0.0.1:9222');
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
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

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
