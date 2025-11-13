import { test, expect } from '@playwright/test';

const uniqueUser = () => `codex-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const JS_TRIGGER_PROMPT = 'please call JS that outputs 10';

async function login(page, username: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Enter chat' }).click();
  await expect(page.locator('#chat-section')).toBeVisible();
}

async function sendMessage(page, message: string) {
  const textarea = page.locator('#message-input');
  await textarea.fill(message);

  const chatResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/chat') && response.request().method() === 'POST';
  });

  await textarea.press('Enter');
  await expect(page.locator('.bubble.assistant').last()).toBeVisible();

  const chatResponse = await chatResponsePromise;
  await chatResponse.finished();
}

test.describe('ChatGPT Relay', () => {
  test('displays version badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#version-pill')).toHaveText(/v\d+\.\d+\.\d+/);
  });

  test('user can chat and persist history between sessions', async ({ page }) => {
    const username = uniqueUser();

    await login(page, username);
    await sendMessage(page, 'Hello from Playwright');

    const userBubble = page.locator('.bubble.user').last();
    await expect(userBubble).toContainText('Hello from Playwright');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.locator('#login-section')).toBeVisible();

    await login(page, username);
    await expect(page.locator('.bubble.user').first()).toContainText('Hello from Playwright');
  });

  test('reveals tool execution details and final reasoning', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);
    await sendMessage(page, JS_TRIGGER_PROMPT);

    const assistantBubbles = page.locator('.bubble.assistant');
    const toolBubble = page.locator('.bubble.tool').last();
    await expect(toolBubble).toContainText('demo.generate_number');
    await expect(toolBubble).toContainText('value: 10');

    const finalAssistant = assistantBubbles.last();
    await expect(finalAssistant).toContainText('value is 10');
    await expect(finalAssistant).not.toContainText('Requested JavaScript');
  });

});
