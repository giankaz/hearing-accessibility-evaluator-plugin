import { checkCaptions, applyCaptions } from './captions.mjs';

const CAPTIONS = { manual: 'manual captions', automatic: 'automatic captions only', none: 'no captions', unavailable: 'could not be checked' };

const LABEL = {
  met: 'Met',
  partial: 'Partial',
  not_met: 'Not met',
  not_applicable: 'Not applicable',
  manual: 'Check manually',
};

const $ = (id) => document.getElementById(id);

async function readSaved() {
  const { evaluations = [] } = await chrome.storage.local.get('evaluations');
  return evaluations;
}

async function updateCounter() {
  const evaluations = await readSaved();
  $('count').textContent = evaluations.length;
  $('saved').textContent = evaluations.length
    ? `Evaluated pages: ${evaluations.map((e) => new URL(e.url).hostname).join(', ')}`
    : '';
}

function render(r) {
  $('result').hidden = false;
  $('score').textContent = r.score === null ? '—' : r.score.toFixed(1);
  $('rating').textContent = r.rating;
  $('rows').replaceChildren(
    ...r.criteria.map((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${c.id}</b> ${c.question}<div class="ev"></div></td>
        <td class="st ${c.status}">${LABEL[c.status]}</td>
        <td>${c.weight}</td>`;
      tr.querySelector('.ev').textContent = `${c.evidence} [${c.reference}]`;
      return tr;
    })
  );
  const videos = r.youtubeCaptions?.videos ?? [];
  $('videosTitle').hidden = !videos.length;
  $('videos').replaceChildren(
    ...videos.map((v) => {
      const li = document.createElement('li');
      li.textContent = `${v.title || v.id}: ${CAPTIONS[v.captions]}`;
      return li;
    })
  );
}

const fetchText = (url) => fetch(url).then((r) => r.text());

$('evaluate').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['evaluator.js'],
  });
  render(result);
  if (result.inventory.youtubeUrls.length) {
    $('status').textContent = 'Checking captions on YouTube...';
    try {
      result = applyCaptions(result, await checkCaptions(result.inventory.youtubeUrls, fetchText));
      render(result);
      $('status').textContent = '';
    } catch (error) {
      $('status').textContent = `Could not check captions on YouTube: ${error.message}`;
    }
  }
  const evaluations = (await readSaved()).filter((e) => e.url !== result.url);
  await chrome.storage.local.set({ evaluations: [...evaluations, result] });
  updateCounter();
});

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

$('export').addEventListener('click', async () => {
  const rows = [['url', 'evaluated_at', 'score', 'rating', 'criterion', 'category', 'question', 'weight', 'status', 'evidence', 'reference']];
  for (const e of await readSaved()) {
    for (const c of e.criteria) {
      rows.push([e.url, e.evaluatedAt, e.score, e.rating, c.id, c.category, c.question, c.weight, c.status, c.evidence, c.reference]);
    }
  }
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'hearing-accessibility-evaluations.csv';
  link.click();
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ evaluations: [] });
  $('result').hidden = true;
  updateCounter();
});

updateCounter();
