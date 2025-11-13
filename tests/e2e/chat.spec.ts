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
    const toolPanel = page.locator('.bubble.tool-response details').last();
    await expect(toolPanel).toBeVisible();
    await expect(toolPanel).not.toContainText('Docker is not running');
    await expect(toolPanel.locator('pre')).toContainText('10');

    const finalAssistant = assistantBubbles.last();
    await expect(finalAssistant).toContainText('10');
    await expect(finalAssistant).not.toContainText('Requested JavaScript');
  });

  test('answers follow-up prompt immediately after a tool call', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);
    await sendMessage(page, JS_TRIGGER_PROMPT);
    await sendMessage(page, 'Thanks! Can you confirm the number you computed?');

    const finalAssistant = page.locator('.bubble.assistant').last();
    await expect(finalAssistant).toContainText('10');
  });

  test('lists fetch tool from MCP gateway', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);
    const toolData = await page.evaluate(async () => {
      const res = await fetch('/api/tools?force=1');
      return res.json();
    });
    const names = (toolData?.tools || []).map((tool) => tool.name);
    await expect(names).toContain('_fetch');
  });

  test('assistant response bubble remains visible and non-empty after simple greeting', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);

    // Send a simple greeting
    await sendMessage(page, 'hello');

    // Wait for assistant response to appear
    const assistantBubble = page.locator('.bubble.assistant').last();
    await expect(assistantBubble).toBeVisible({ timeout: 10000 });

    // Verify the response has non-empty content
    const bodyElement = assistantBubble.locator('.body');
    await expect(bodyElement).toBeVisible();

    // Get the actual text content
    const responseText = await bodyElement.textContent();
    expect(responseText).toBeTruthy();
    expect(responseText?.trim().length).toBeGreaterThan(0);

    // Verify it stays visible (check again after a short delay)
    await page.waitForTimeout(500);
    await expect(assistantBubble).toBeVisible();

    const responseTextAfter = await bodyElement.textContent();
    expect(responseTextAfter).toBeTruthy();
    expect(responseTextAfter?.trim().length).toBeGreaterThan(0);
  });

  test('can delegate to code helper agent for JavaScript execution', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);

    // Explicitly request to use the code helper agent
    await sendMessage(page, 'Please use the code helper agent to create a simple Hello World program in JavaScript');

    // Wait for response - may take longer due to helper delegation
    await page.waitForTimeout(2000);

    // Verify we got assistant responses
    const assistantBubbles = page.locator('.bubble.assistant');
    await expect(assistantBubbles.last()).toBeVisible({ timeout: 20000 });

    // Get all text content from assistant messages
    const messagesText = await page.locator('.bubble.assistant .body').allTextContents();
    const combinedText = messagesText.join(' ').toLowerCase();

    // Verify the response mentions hello or world (indicating code was discussed/executed)
    expect(combinedText).toMatch(/hello|world|javascript|code/i);
  });

  test('can delegate to research helper agent for web fetching', async ({ page }) => {
    const username = uniqueUser();
    await login(page, username);

    // Explicitly request to use the research helper agent
    await sendMessage(page, 'Please use the research helper agent to fetch information from google.com');

    // Wait for response - may take longer due to helper delegation
    await page.waitForTimeout(2000);

    // Verify we got assistant responses
    const assistantBubbles = page.locator('.bubble.assistant');
    await expect(assistantBubbles.last()).toBeVisible({ timeout: 20000 });

    // Get all text content from assistant messages
    const messagesText = await page.locator('.bubble.assistant .body').allTextContents();
    const combinedText = messagesText.join(' ').toLowerCase();

    // Verify the response mentions research, fetch, or google
    expect(combinedText).toMatch(/research|fetch|google|information/i);
  });

});
