(() => {
  const STATUS = {
    MET: 'met',
    PARTIAL: 'partial',
    NOT_MET: 'not_met',
    NOT_APPLICABLE: 'not_applicable',
    MANUAL: 'manual',
  };
  const FACTOR = { met: 1, partial: 0.5, not_met: 0 };

  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ');
      if (t.trim()) return t.trim();
    }
    if (el.getAttribute('title')?.trim()) return el.getAttribute('title').trim();
    if ((el.tagName === 'IMG' || el.type === 'image') && el.getAttribute('alt')?.trim()) return el.getAttribute('alt').trim();
    if (text(el)) return text(el);
    const img = el.querySelector('img[alt]:not([alt=""]), svg title');
    if (img) return img.getAttribute('alt') || text(img);
    if (el.tagName === 'INPUT' && el.value) return el.value;
    return '';
  };

  const VIDEO_PROVIDERS = /youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|dailymotion\.com|facebook\.com\/plugins\/video/i;
  const AUDIO_PROVIDERS = /soundcloud\.com|spotify\.com|anchor\.fm|podbean\.com|deezer\.com|mixcloud\.com/i;
  const TRANSCRIPT_TERM = /transcri[çc][ãa]o|transcrito|vers[ãa]o em texto|texto do (v[íi]deo|[áa]udio)/i;

  const nativeVideos = [...document.querySelectorAll('video')];
  const nativeAudios = [...document.querySelectorAll('audio')];
  const iframes = [...document.querySelectorAll('iframe')];
  const videoEmbeds = iframes.filter((f) => VIDEO_PROVIDERS.test(f.src || f.dataset.src || ''));
  const audioEmbeds = iframes.filter((f) => AUDIO_PROVIDERS.test(f.src || f.dataset.src || ''));
  const externalVideoLinks = [...new Set(
    [...document.querySelectorAll('a[href]')].filter((a) => VIDEO_PROVIDERS.test(a.href)).map((a) => a.href)
  )];
  const hasVideo = nativeVideos.length + videoEmbeds.length > 0;
  const hasAudio = nativeAudios.length + audioEmbeds.length > 0;
  const hasMedia = hasVideo || hasAudio;

  const transcriptLinks = [...document.querySelectorAll('a, button, summary, details, h2, h3, h4')].filter((el) =>
    TRANSCRIPT_TERM.test(text(el))
  );

  const vlibras =
    !!document.querySelector('[vw], [vw-access-button], .vw-plugin-wrapper') ||
    [...document.scripts].some((s) => /vlibras\.gov\.br/i.test(s.src));

  const criteria = [];
  const add = (c) => criteria.push(c);

  {
    let status = STATUS.NOT_APPLICABLE;
    let evidence = 'No video found on the page.';
    if (nativeVideos.length) {
      const captioned = nativeVideos.filter((v) => v.querySelector('track[kind="captions"], track[kind="subtitles"]')).length;
      status = captioned === nativeVideos.length ? STATUS.MET : captioned > 0 ? STATUS.PARTIAL : STATUS.NOT_MET;
      evidence = `${captioned} of ${nativeVideos.length} <video> with a caption <track>.`;
      if (videoEmbeds.length) evidence += ` Plus ${videoEmbeds.length} embedded video(s) that need manual checking.`;
    } else if (videoEmbeds.length) {
      const forcedCaptions = videoEmbeds.filter((f) => /cc_load_policy=1/.test(f.src)).length;
      status = STATUS.MANUAL;
      evidence = `${videoEmbeds.length} embedded video(s) (YouTube/Vimeo). The plugin cannot see inside the player: open each video and check whether captions are manual or automatic.`;
      if (forcedCaptions) evidence += ` ${forcedCaptions} with cc_load_policy=1 (captions on by default).`;
    } else if (externalVideoLinks.length) {
      status = STATUS.MANUAL;
      evidence = `No player on the page, but ${externalVideoLinks.length} link(s) to an external video/channel (e.g. ${externalVideoLinks[0]}). Check captions there.`;
    }
    add({
      id: 'V1', category: 'Video with audio', question: 'Do recorded videos have captions?', weight: 3,
      status, evidence, reference: 'WCAG 2.2 (1.2.2, A); e-MAG 5.1',
    });
  }

  add({
    id: 'V2', category: 'Video with audio', question: 'Are captions synchronized and accurate (manual)?', weight: 2,
    status: hasVideo || externalVideoLinks.length ? STATUS.MANUAL : STATUS.NOT_APPLICABLE,
    evidence: hasVideo || externalVideoLinks.length ? 'Requires watching the video: cannot be automated.' : 'No video found on the page.',
    reference: 'WCAG 2.2 (1.2.2, A); e-MAG 5.1; YouTube (automatic captions may contain errors)',
  });

  add({
    id: 'V3', category: 'Video with audio', question: 'Do videos have a text transcript?', weight: 3,
    status: !hasVideo
      ? externalVideoLinks.length ? STATUS.MANUAL : STATUS.NOT_APPLICABLE
      : transcriptLinks.length ? STATUS.MET : STATUS.NOT_MET,
    evidence: !hasVideo
      ? externalVideoLinks.length ? 'Videos only on an external platform: check for a transcript there.' : 'No video found on the page.'
      : transcriptLinks.length
        ? `Found: "${text(transcriptLinks[0]).slice(0, 80)}".`
        : 'No link or block mentioning a transcript near the content (text heuristic).',
    reference: 'WCAG 2.2 (1.2.3, A / 1.2.8, AAA); e-MAG 5.1',
  });

  add({
    id: 'V4', category: 'Video with audio', question: 'Do live streams have real-time captions?', weight: 4,
    status: STATUS.MANUAL,
    evidence: 'Depends on a live stream happening at evaluation time: check manually.',
    reference: 'WCAG 2.2 (1.2.4, AA)',
  });

  add({
    id: 'V5', category: 'Video with audio', question: 'Is there a Libras (Brazilian Sign Language) translation?', weight: 5,
    status: vlibras ? STATUS.PARTIAL : STATUS.NOT_MET,
    evidence: vlibras
      ? 'VLibras widget present (automatic avatar). Counts as partial: a human interpreter in the videos needs manual checking.'
      : 'No VLibras on the page. A human interpreter in the videos needs manual checking.',
    reference: 'WCAG 2.2 (1.2.6, AAA); Law 10.436/2002, art. 2; Decree 5.626/2005',
  });

  add({
    id: 'A1', category: 'Audio and sound', question: 'Does audio-only content (podcast, radio) have a text alternative?', weight: 3,
    status: !hasAudio ? STATUS.NOT_APPLICABLE : transcriptLinks.length ? STATUS.MET : STATUS.NOT_MET,
    evidence: !hasAudio
      ? 'No <audio> or podcast player found.'
      : `${nativeAudios.length} <audio> and ${audioEmbeds.length} embedded player(s); transcript ${transcriptLinks.length ? 'found' : 'not found'}.`,
    reference: 'WCAG 2.2 (1.2.1, A); e-MAG 5.2',
  });

  {
    const native = [...nativeVideos, ...nativeAudios];
    const autoplayWithSound = native.filter((m) => m.autoplay && !m.muted);
    const autoplayEmbeds = [...videoEmbeds, ...audioEmbeds].filter(
      (f) => /[?&]autoplay=1/.test(f.src) && !/[?&]mute=1/.test(f.src)
    );
    const total = autoplayWithSound.length + autoplayEmbeds.length;
    add({
      id: 'A2', category: 'Audio and sound', question: 'Does no sound start by itself (autoplay with audio)?', weight: 2,
      status: !hasMedia ? STATUS.NOT_APPLICABLE : total === 0 ? STATUS.MET : STATUS.NOT_MET,
      evidence: !hasMedia ? 'No media on the page.' : total === 0 ? 'No media with autoplay and sound.' : `${total} media with autoplay and no mute.`,
      reference: 'WCAG 2.2 (1.4.2, A); e-MAG 5.4',
    });

    const embedded = [...videoEmbeds, ...audioEmbeds];
    const withoutControls = [
      ...native.filter((m) => !m.controls),
      ...embedded.filter((f) => /[?&]controls=0(&|$)/.test(f.src)),
    ];
    const totalMedia = native.length + embedded.length;
    add({
      id: 'A3', category: 'Audio and sound', question: 'Can playback be paused and the volume adjusted?', weight: 2,
      status: !hasMedia
        ? STATUS.NOT_APPLICABLE
        : withoutControls.length === 0
          ? STATUS.MET
          : withoutControls.length < totalMedia
            ? STATUS.PARTIAL
            : STATUS.NOT_MET,
      evidence: !hasMedia
        ? 'No media on the page.'
        : `${totalMedia - withoutControls.length} of ${totalMedia} media with visible controls` +
          (embedded.some((f) => /[?&]controls=0(&|$)/.test(f.src)) ? ' (embedded YouTube player with controls=0, which hides pause and volume).' : '.'),
      reference: 'WCAG 2.2 (1.4.2, A); e-MAG 5.4',
    });
  }

  add({
    id: 'A4', category: 'Audio and sound', question: 'Does background sound not interfere with speech?', weight: 1,
    status: hasMedia ? STATUS.MANUAL : STATUS.NOT_APPLICABLE,
    evidence: hasMedia ? 'Requires listening to the content: cannot be automated.' : 'No media on the page.',
    reference: 'WCAG 2.2 (1.4.7, AAA)',
  });

  {
    const interactive = [...document.querySelectorAll('button, [role="button"], a[href]')].filter(visible);
    const unnamed = interactive.filter((el) => !accessibleName(el));
    const ratio = interactive.length ? unnamed.length / interactive.length : 0;
    add({
      id: 'C1', category: 'Controls and navigation', question: 'Do buttons and links have an accessible name (screen reader)?', weight: 2,
      status: !interactive.length ? STATUS.NOT_APPLICABLE : unnamed.length === 0 ? STATUS.MET : ratio <= 0.05 ? STATUS.PARTIAL : STATUS.NOT_MET,
      evidence: `${unnamed.length} of ${interactive.length} visible buttons/links without an accessible name (${(ratio * 100).toFixed(1)}%).`,
      reference: 'WCAG 2.2 (4.1.2, A); e-MAG 3.5',
      details: unnamed.slice(0, 5).map((el) => el.outerHTML.slice(0, 160)),
    });
  }

  {
    const notFocusable = [...document.querySelectorAll('[onclick], [role="button"]')].filter((el) => {
      if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) return false;
      const t = el.getAttribute('tabindex');
      return t === null || Number(t) < 0;
    }).filter(visible);
    add({
      id: 'C2', category: 'Controls and navigation', question: 'Does everything clickable work with the keyboard?', weight: 2,
      status: notFocusable.length === 0 ? STATUS.MET : notFocusable.length <= 3 ? STATUS.PARTIAL : STATUS.NOT_MET,
      evidence: `${notFocusable.length} clickable element(s) without keyboard focus.`,
      reference: 'WCAG 2.2 (2.1.1, A); e-MAG 2.1',
      details: notFocusable.slice(0, 5).map((el) => el.outerHTML.slice(0, 160)),
    });
  }

  {
    const accesskeys = document.querySelectorAll('[accesskey]').length;
    const skipLinks = [...document.querySelectorAll('a[href^="#"]')].filter((a) =>
      /conte[úu]do|menu|busca|rodap[ée]|ir para|pular/i.test(accessibleName(a))
    ).length;
    add({
      id: 'C3', category: 'Controls and navigation', question: 'Are there keyboard shortcuts / links to skip blocks (accessibility bar)?', weight: 2,
      status: accesskeys >= 2 && skipLinks >= 1 ? STATUS.MET : accesskeys + skipLinks > 0 ? STATUS.PARTIAL : STATUS.NOT_MET,
      evidence: `${accesskeys} accesskey(s) and ${skipLinks} skip link(s) ("skip to content" etc.).`,
      reference: 'WCAG 2.2 (2.4.1, A); e-MAG 1.5 and 4.1 (shortcuts)',
    });
  }

  {
    const accessibilityLink = [...document.querySelectorAll('a[href]')].find(
      (a) => /acessibilidade/i.test(accessibleName(a)) || /acessibilidade/i.test(a.pathname)
    );
    add({
      id: 'C4', category: 'Controls and navigation', question: 'Does the site have an accessibility page?', weight: 1,
      status: accessibilityLink ? STATUS.MET : STATUS.NOT_MET,
      evidence: accessibilityLink ? `Link: ${accessibilityLink.href}` : 'No link with the text "acessibilidade".',
      reference: 'e-MAG 4.5 (accessibility page); LBI, art. 63, § 1 (symbol)',
    });
  }

  add({
    id: 'C5', category: 'Controls and navigation', question: 'Is the content understandable without hearing the audio?', weight: 3,
    status: STATUS.MANUAL,
    evidence: 'Evaluator judgment: cannot be automated.',
    reference: 'WCAG 2.2 (1.1.1, A); LBI, art. 63',
  });

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
    url: location.href,
    title: document.title,
    evaluatedAt: new Date().toISOString(),
    inventory: {
      nativeVideos: nativeVideos.length,
      embeddedVideos: videoEmbeds.length,
      nativeAudios: nativeAudios.length,
      embeddedAudios: audioEmbeds.length,
      externalVideoLinks: externalVideoLinks.length,
      vlibras,
      youtubeUrls: [...new Set(
        [...document.querySelectorAll('a[href], iframe[src], iframe[data-src]')]
          .map((el) => el.href || el.src || el.dataset.src || '')
          .filter((u) => /youtube(-nocookie)?\.com|youtu\.be/i.test(u))
      )],
    },
    criteria,
    score,
    rating,
    pendingManual: criteria.filter((c) => c.status === STATUS.MANUAL).map((c) => c.id),
  };
})();
