import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [url, destination] = process.argv.slice(2);
const output = resolve(destination);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const response = await page.goto(url);
  if (!response?.ok()) throw new Error(`Render page: ${response?.status()}`);
  await page.waitForFunction(() => window.matchedAgentA !== undefined);
  const frames = await page.evaluate(async () => (await window.matchedAgentA).frames);
  for (const frame of frames) {
    const jpeg = await page.evaluate(async frame => (await window.matchedAgentA).render(frame), frame);
    await writeFile(resolve(output, `${frame}.jpg`), Buffer.from(jpeg, 'base64'));
  }
  console.log(`Rendered ${frames.length} Agent A frames`);
} finally {
  await browser.close();
}
