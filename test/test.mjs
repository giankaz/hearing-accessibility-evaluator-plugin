import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { splitYoutubeLinks, readCaptions, captionStatus, checkCaptions, applyCaptions, safeYoutubeUrl } from '../extension/captions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVALUATOR = await readFile(path.join(HERE, '..', 'extension', 'evaluator.js'), 'utf8');

const EXPECTED = {
  V1: 'partial',
  V2: 'manual',
  V3: 'not_met',
  V5: 'not_met',
  A1: 'not_met',
  A2: 'not_met',
  A3: 'partial',
  C1: 'not_met',
  C2: 'partial',
  C3: 'met',
  C4: 'met',
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
await page.route(/youtube\.com/, (route) => route.fulfill({ body: '' }));
await page.goto(pathToFileURL(path.join(HERE, 'test-page.html')).href);
const r = await page.evaluate(EVALUATOR);
await browser.close();

const actual = Object.fromEntries(r.criteria.map((c) => [c.id, c.status]));
for (const [id, status] of Object.entries(EXPECTED)) {
  assert.equal(actual[id], status, `${id}: expected ${status}, got ${actual[id]} — ${r.criteria.find((c) => c.id === id).evidence}`);
}
assert.match(r.criteria.find((c) => c.id === 'A3').evidence, /controls=0/);
assert.equal(r.inventory.youtubeUrls.length, 3, 'two embeds and one channel link');
console.log(`ok — ${Object.keys(EXPECTED).length} criteria checked; score ${r.score} (${r.rating})`);

const youtubePage = (status, tracks) =>
  `<meta name="title" content="Video ${status}">"playabilityStatus":{"status":"${status}"${status === 'OK' ? '' : ',"reason":"Private video"'}}` +
  `"videoDetails":{}` + (tracks ? `"captionTracks":${JSON.stringify(tracks)},"audioTracks"` : '');
const FAKE_YOUTUBE = {
  'https://www.youtube.com/watch?v=abc123abc12': youtubePage('OK', [{ languageCode: 'pt' }, { languageCode: 'pt', kind: 'asr' }]),
  'https://www.youtube.com/watch?v=xyz98765432': youtubePage('OK', [{ languageCode: 'pt', kind: 'asr' }]),
  'https://www.youtube.com/watch?v=non00000000': youtubePage('OK', null),
  'https://www.youtube.com/watch?v=priv0000000': youtubePage('LOGIN_REQUIRED', null),
  'https://www.youtube.com/@testchannel/videos': '"videoId":"non00000000" "videoId":"priv0000000" "videoId":"non00000000"',
};
const fakeFetch = async (url) => {
  assert.ok(url in FAKE_YOUTUBE, `unexpected URL: ${url}`);
  return FAKE_YOUTUBE[url];
};

assert.deepEqual(
  splitYoutubeLinks(['https://www.youtube.com/embed/abc123abc12?controls=0', 'https://youtu.be/xyz98765432', 'https://www.youtube.com/@testchannel']),
  { videos: ['abc123abc12', 'xyz98765432'], channels: ['https://www.youtube.com/@testchannel'] }
);
assert.equal(readCaptions(FAKE_YOUTUBE['https://www.youtube.com/watch?v=abc123abc12']).captions, 'manual');
assert.equal(readCaptions(FAKE_YOUTUBE['https://www.youtube.com/watch?v=xyz98765432']).captions, 'automatic');
assert.equal(readCaptions(FAKE_YOUTUBE['https://www.youtube.com/watch?v=non00000000']).captions, 'none');
assert.deepEqual(
  (({ captions, reason }) => ({ captions, reason }))(readCaptions(FAKE_YOUTUBE['https://www.youtube.com/watch?v=priv0000000'])),
  { captions: 'unavailable', reason: 'Private video' }
);

const captions = await checkCaptions(
  ['https://www.youtube.com/embed/abc123abc12', 'https://youtu.be/xyz98765432', 'https://www.youtube.com/@testchannel'],
  fakeFetch
);
assert.deepEqual(captions.videos.map((v) => [v.id, v.source, v.captions]), [
  ['abc123abc12', 'page', 'manual'],
  ['xyz98765432', 'page', 'automatic'],
  ['non00000000', 'channel', 'none'],
  ['priv0000000', 'channel', 'unavailable'],
]);
assert.equal(captions.status, 'partial');
assert.equal(captionStatus([{ captions: 'manual' }, { captions: 'unavailable' }]), 'met');
assert.equal(captionStatus([{ captions: 'none' }]), 'not_met');
assert.equal(captionStatus([{ captions: 'unavailable' }]), null);

const withCaptions = applyCaptions(r, captions);
assert.equal(withCaptions.criteria.find((c) => c.id === 'V1').status, 'partial');
const factor = { met: 1, partial: 0.5, not_met: 0 };
const scorable = withCaptions.criteria.filter((c) => c.status in factor);
const expectedScore = Math.round((scorable.reduce((s, c) => s + c.weight * factor[c.status], 0) / scorable.reduce((s, c) => s + c.weight, 0)) * 100) / 10;
assert.equal(withCaptions.score, expectedScore);
const allPrivate = applyCaptions(r, { videos: [{ captions: 'unavailable', reason: 'Private video' }], status: null });
assert.equal(allPrivate.score, r.score);
assert.match(allPrivate.criteria.find((c) => c.id === 'V1').evidence, /Private video/);
console.log(`ok — captions.mjs: 4 video types, channel, status and score (${r.score} -> ${withCaptions.score})`);

const requests = [];
await checkCaptions(
  [
    'https://evil.example/youtube.com/@channel',
    'https://www.youtube.com.evil.example/@channel',
    'https://evil.example/?u=youtu.be/abcdefghijk',
    'https://evil.example/youtube.com/c/%2e%2e%2f%2e%2e',
    'javascript:alert(1)//youtube.com/@x',
    'http://127.0.0.1:8080/?youtube.com/watch?v=abcdefghijk',
  ],
  async (url) => { requests.push(url); return ''; }
);
assert.ok(requests.length > 0, 'the links should produce requests (all to YouTube)');
for (const url of requests) assert.equal(new URL(url).origin, 'https://www.youtube.com', `request left YouTube: ${url}`);
for (const bad of ['https://evil.example/', 'http://www.youtube.com/x', 'https://www.youtube.com:8443/x', 'https://a@www.youtube.com/x', 'file:///C:/x']) {
  assert.throws(() => safeYoutubeUrl(bad), /refused/, `should refuse ${bad}`);
}
console.log(`ok — SSRF: ${requests.length} requests from malicious links, all to https://www.youtube.com; 5 outside addresses refused`);
