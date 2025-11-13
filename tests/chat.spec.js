export const steps = async (page) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://host.docker.internal:8081';
  const username = `codex-${Date.now()}`;

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
};
