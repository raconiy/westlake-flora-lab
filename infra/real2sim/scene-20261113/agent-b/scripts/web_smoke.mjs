// Agent B (Opus 5.5) — headless smoke test of the deployed module (real WebGL via SwiftShader).
// usage: node scripts/web_smoke.mjs <url> <outdir>
import puppeteer from '/root/real2sim/scene-20261113/agent-b/envs/node/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const exe = '/root/real2sim/scene-20261113/agent-b/envs/chrome/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage(); const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`)); page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
const t0 = Date.now(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__agentb && window.__agentb.ready, { timeout: 600000 });
const loadS = (Date.now() - t0) / 1000;
const info = await page.evaluate(() => ({ status: document.getElementById('status').textContent, instances: window.__agentb.instances.size,
  tris: (() => { let n = 0; window.__agentb.scene.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); }); return n; })() }));
await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: `${out}/01_overview.png` });
// reference camera with overlay
await page.click('#cams button:nth-child(8)'); await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: `${out}/02_refcam_overlay.png` });
await page.$eval('#refopacity', (e) => { e.value = 0; e.dispatchEvent(new Event('input')); }); await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: `${out}/03_refcam_cg.png` });
await page.click('#btn-exitcam');
// select a tree from the list, isolate it
await page.type('#search', 'tree_22'); await new Promise((r) => setTimeout(r, 300));
await page.click('#assets li'); await new Promise((r) => setTimeout(r, 800)); await page.click('#btn-isolate'); await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/04_isolate_tree22.png` });
const iso = await page.evaluate(() => [...window.__agentb.instances.values()].filter((r) => r.root.visible).map((r) => r.inst.instance_id));
await page.click('#btn-showall'); await page.$eval('#search', (e) => { e.value = 'bldg_rotunda'; e.dispatchEvent(new Event('input')); });
await page.click('#assets li'); await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: `${out}/05_select_rotunda.png` });
await page.click('#btn-hide'); const hidden = await page.evaluate(() => !window.__agentb.instances.get('inst_bldg_rotunda').root.visible);
await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: `${out}/06_rotunda_hidden.png` });
const res = { url, load_seconds: loadS, ...info, isolate_visible: iso, rotunda_hidden: hidden, errors: logs.filter((l) => /error|failed/i.test(l)) };
fs.writeFileSync(`${out}/smoke.json`, JSON.stringify({ ...res, logs }, null, 1)); console.log(JSON.stringify(res, null, 1));
await browser.close();
