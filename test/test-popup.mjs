import { chromium } from 'playwright-core';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? 'https://prefeitura.poa.br/';
const output = path.resolve(process.argv[3] ?? path.join(HERE, 'output'));
await mkdir(output, { recursive: true });

const tmp = await mkdtemp(path.join(tmpdir(), 'popup-'));
const ext = path.join(tmp, 'extension');
await cp(path.join(HERE, '..', 'extension'), ext, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  ignoreDefaultArgs: ['--disable-extensions'],
  acceptDownloads: true,
});
try {
  const manager = await ctx.newPage();
  await manager.goto('chrome://extensions');
  const info = await manager.evaluate(() => new Promise((r) => chrome.developerPrivate.getExtensionsInfo({}, r)));
  const extension = info.find((x) => x.name.includes('Hearing Accessibility'));
  assert.equal(extension.state, 'ENABLED');
  await manager.close();

  const page = await ctx.newPage();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const popup = await ctx.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  popup.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await popup.goto(`chrome-extension://${extension.id}/popup.html`);
  await page.bringToFront();

  await popup.click('#evaluate');
  await popup.waitForFunction(() => !document.querySelector('#result').hidden, null, { timeout: 60000 });
  await popup.waitForFunction(() => !document.querySelector('#status').textContent.startsWith('Checking'), null, { timeout: 90000 });
  const r = await popup.evaluate(() => ({
    score: document.querySelector('#score').textContent,
    rows: document.querySelectorAll('#rows tr').length,
    videos: [...document.querySelectorAll('#videos li')].map((li) => li.textContent),
    status: document.querySelector('#status').textContent,
  }));
  assert.deepEqual(errors, []);
  assert.equal(r.rows, 14);
  assert.equal(r.status, '', r.status);

  const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#export')]);
  await download.saveAs(path.join(output, 'popup.csv'));
  const csv = await readFile(path.join(output, 'popup.csv'), 'utf8');
  assert.equal(csv.trim().split('\n').length, 15, 'header + 14 criteria');
  await popup.setViewportSize({ width: 480, height: 900 });
  await popup.screenshot({ path: path.join(output, 'popup.png'), fullPage: true });
  console.log(`ok — popup on ${target}: score ${r.score}, 14 criteria, ${r.videos.length} YouTube video(s), CSV with 14 rows, 0 errors`);
} finally {
  await ctx.close();
  await rm(tmp, { recursive: true, force: true });
}
