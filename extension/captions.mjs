const VIDEO_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
const CHANNEL = /youtube\.com\/(@[\w.%-]+|channel\/[\w-]+|c\/[\w%-]+|user\/[\w-]+)/;

export function safeYoutubeUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com' || u.username || u.password || u.port) {
    throw new Error(`address outside YouTube refused: ${u.origin}`);
  }
  return u.href;
}
const safeFetch = (fetchText) => (url) => fetchText(safeYoutubeUrl(url));

export function splitYoutubeLinks(urls) {
  const videos = new Set();
  const channels = new Set();
  for (const url of urls) {
    const v = url.match(VIDEO_ID);
    if (v) videos.add(v[1]);
    else {
      const c = url.match(CHANNEL);
      if (c) channels.add(`https://www.youtube.com/${c[1]}`);
    }
  }
  return { videos: [...videos], channels: [...channels] };
}

export async function recentChannelVideos(channel, fetchText, limit) {
  const html = await fetchText(`${channel}/videos`);
  return [...new Set([...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, limit);
}

export function readCaptions(videoHtml) {
  const title = (videoHtml.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '';
  const [, playability, reason] = videoHtml.match(/"playabilityStatus":\{"status":"(\w+)"(?:,"reason":"([^"]*)")?/) || [];
  if (playability && playability !== 'OK') {
    return { title, captions: 'unavailable', reason: reason || playability, tracks: [] };
  }
  const block = videoHtml.match(/"captionTracks":(\[.*?\])/);
  if (!block) {
    const validPage = videoHtml.includes('"videoDetails"');
    return { title, captions: validPage ? 'none' : 'unavailable', reason: validPage ? '' : 'incomplete video page', tracks: [] };
  }
  const tracks = JSON.parse(block[1]).map((f) => ({ language: f.languageCode, automatic: f.kind === 'asr' }));
  const manual = tracks.some((f) => !f.automatic);
  return { title, captions: manual ? 'manual' : 'automatic', tracks };
}

export function captionStatus(videos) {
  const assessed = videos.filter((v) => v.captions !== 'unavailable');
  if (!assessed.length) return null;
  const manual = assessed.filter((v) => v.captions === 'manual').length;
  const automatic = assessed.filter((v) => v.captions === 'automatic').length;
  if (manual === assessed.length) return 'met';
  if (manual + automatic > 0) return 'partial';
  return 'not_met';
}

export async function checkCaptions(urls, externalFetch, limit = 5) {
  const fetchText = safeFetch(externalFetch);
  const { videos, channels } = splitYoutubeLinks(urls);
  const ids = videos.slice(0, limit);
  for (const channel of channels) {
    if (ids.length >= limit) break;
    for (const id of await recentChannelVideos(channel, fetchText, limit)) {
      if (ids.length < limit && !ids.includes(id)) ids.push(id);
    }
  }
  const result = [];
  for (const id of ids) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    result.push({ id, url, source: videos.includes(id) ? 'page' : 'channel', ...readCaptions(await fetchText(url)) });
  }
  return { channels, videos: result, status: captionStatus(result) };
}

const FACTOR = { met: 1, partial: 0.5, not_met: 0 };
const LABEL = { met: 'met', partial: 'partial', not_met: 'not met' };

export function applyCaptions(evaluation, captions) {
  if (!captions) return evaluation;
  const count = (type) => captions.videos.filter((v) => v.captions === type).length;
  if (!captions.status) {
    const criteria = evaluation.criteria.map((c) =>
      c.id !== 'V1' ? c : { ...c, evidence: `${c.evidence} The ${captions.videos.length} YouTube video(s) linked from the page are unavailable (${[...new Set(captions.videos.map((v) => v.reason))].join('; ')}).` }
    );
    return { ...evaluation, criteria, youtubeCaptions: captions };
  }
  const criteria = evaluation.criteria.map((c) =>
    c.id !== 'V1'
      ? c
      : {
          ...c,
          status: captions.status,
          evidence:
            `${captions.videos.length} YouTube video(s) checked: ${count('manual')} with manual captions, ` +
            `${count('automatic')} automatic only, ${count('none')} without captions` +
            (count('unavailable') ? `, ${count('unavailable')} unavailable` : '') +
            ` (${LABEL[captions.status]}).`,
        }
  );
  const scorable = criteria.filter((c) => c.status in FACTOR);
  const totalWeight = scorable.reduce((s, c) => s + c.weight, 0);
  const points = scorable.reduce((s, c) => s + c.weight * FACTOR[c.status], 0);
  const score = totalWeight ? Math.round((points / totalWeight) * 100) / 10 : null;
  const rating =
    score === null ? 'No assessable criteria'
      : score <= 3 ? 'Poorly accessible'
        : score <= 5 ? 'Needs improvement'
          : score <= 8 ? 'Accessible, but could improve'
            : 'Fully accessible';
  return {
    ...evaluation,
    criteria,
    score,
    rating,
    youtubeCaptions: captions,
    pendingManual: criteria.filter((c) => c.status === 'manual').map((c) => c.id),
  };
}
