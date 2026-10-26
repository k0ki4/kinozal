(() => {
  'use strict';

  // ───────────────────────── Утилиты ─────────────────────────

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svg(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }

  const ICONS = {
    heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    fire: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    laugh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>',
    star: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    cry: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M8 11.5v2"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    bigPlay: '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>',
    toQueue: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h12M3 12h12M3 18h7"/><path d="M18 15v6M15 18h6"/></svg>',
    film: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>',
  };
  const REACT_COLORS = { heart: '#FF7AA8', fire: '#FF9F5A', laugh: '#FFD25A', star: '#8FB8FF', cry: '#7FD6E0' };

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = String(sec % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }
  function fmtClock(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function fmtSize(bytes) {
    if (bytes > 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' ГБ';
    return Math.round(bytes / 1024 ** 2) + ' МБ';
  }

  function parseYouTube(input) {
    const s = String(input || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    try {
      const url = new URL(s.startsWith('http') ? s : 'https://' + s);
      const host = url.hostname.replace(/^(www|m|music)\./, '');
      const ok = (id) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
      if (host === 'youtu.be') return ok(url.pathname.slice(1, 12));
      if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.searchParams.get('v')) return ok(url.searchParams.get('v'));
        const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) return m[2];
      }
    } catch { /* not a url */ }
    return null;
  }

  // ───────────────────────── Состояние ─────────────────────────

  const S = {
    me: null,
    users: [],
    features: { ytdlp: false, uploads: false, maxUploadMb: 0 },
    room: null,
    online: new Set(),
    ws: null,
    connected: false,
    offset: 0,          // сервер − клиент, мс
    bestRtt: Infinity,
    joined: false,      // нажал «Подключиться» (нужно браузеру для звука)
    loadedSid: null,
    mediaReady: false,
    ytError: null,
    local: null,        // { sid?, name, size, url } — свой файл
    pendingLocal: null,
    seeking: false,
    unread: 0,
    diary: [],          // записи дневника, от старых к новым
    diaryHasMore: false,
    wishlist: [],
    stats: null,
    libTab: 'queue',
  };

  const userName = (login) => (S.users.find((u) => u.login === login) || {}).name || login || '';
  const isMe = (login) => login === S.me;
  const who = (login) => (isMe(login) ? 'Ты' : userName(login));
  const partner = () => S.users.find((u) => u.login !== S.me);
  const serverNow = () => Date.now() + S.offset;

  function expectedPosition() {
    const r = S.room;
    if (!r) return 0;
    return r.playing ? r.position + (serverNow() - r.updatedAt) / 1000 : r.position;
  }

  // ───────────────────────── Соединение ─────────────────────────

  let reconnectDelay = 1000;
  let pingTimer = null;

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    S.ws = ws;

    ws.onopen = () => {
      S.connected = true;
      reconnectDelay = 1000;
      S.bestRtt = Infinity;
      ping(); setTimeout(ping, 400); setTimeout(ping, 1200);
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, 10000);
      renderPresence();
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };

    ws.onclose = async () => {
      S.connected = false;
      clearInterval(pingTimer);
      renderPresence();
      // если вход истёк — на страницу входа
      try {
        const r = await fetch('/api/me', { cache: 'no-store' });
        if (r.status === 401) { location.href = '/login'; return; }
      } catch { /* сеть недоступна */ }
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.7, 10000);
    };
  }

  function send(msg) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
  }

  function ping() { send({ type: 'ping', t: Date.now() }); }

  function onMessage(msg) {
    switch (msg.type) {
      case 'pong': {
        const now = Date.now();
        const rtt = now - msg.t;
        if (rtt <= S.bestRtt * 1.5 || rtt < 80) {
          S.bestRtt = Math.min(S.bestRtt, rtt);
          S.offset = msg.s + rtt / 2 - now;
        }
        break;
      }
      case 'init':
        S.me = msg.me;
        S.diary = msg.diary || [];
        S.diaryHasMore = (msg.diaryTotal || 0) > S.diary.length;
        S.wishlist = msg.wishlist || [];
        S.stats = msg.stats || null;
        setRoom(msg.state);
        renderAllMessages(msg.messages);
        renderWishlist();
        renderDiary();
        break;
      case 'wishlist':
        S.wishlist = msg.items || [];
        renderWishlist();
        break;
      case 'diary_upsert': {
        const i = S.diary.findIndex((e) => e.id === msg.entry.id);
        if (i >= 0) S.diary[i] = msg.entry; else S.diary.push(msg.entry);
        S.stats = msg.stats;
        renderDiary();
        break;
      }
      case 'diary_remove':
        S.diary = S.diary.filter((e) => e.id !== msg.id);
        S.stats = msg.stats;
        renderDiary();
        break;
      case 'diary_older':
        S.diary = (msg.entries || []).concat(S.diary);
        S.diaryHasMore = !!msg.hasMore;
        renderDiary();
        break;
      case 'state':
        setRoom(msg.state);
        break;
      case 'presence':
        S.online = new Set(msg.online);
        renderPresence();
        break;
      case 'chat':
        addMessage(msg.message, true);
        if (!isMe(msg.message.by)) {
          hideTyping();
          if (document.hidden) { S.unread += 1; document.title = `(${S.unread}) Наш кинозал`; }
        }
        break;
      case 'chat_cleared':
        renderAllMessages([]);
        break;
      case 'typing':
        showTyping(msg.by);
        break;
      case 'reaction':
        if (S.room) S.room.reactions = msg.counts;
        renderReactions();
        floatReaction(msg.kind, msg.by);
        break;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { S.unread = 0; document.title = 'Наш кинозал'; }
  });

  // ───────────────────────── Плееры ─────────────────────────

  const video = $('video');
  const ytBox = $('ytBox');

  const yt = {
    apiPromise: null, player: null, ready: false, videoId: null, sentMeta: false, ccTrackSet: false,
    // «Меню YouTube»: показать родные кнопки YouTube (там звуковая дорожка и качество)
    controls: store.get('kz_ytcontrols', 'off') === 'on',
    cmdAt: 0,        // когда сайт сам последний раз управлял плеером
    readyAt: 0,      // когда ролик загрузился
    roomAt: 0,       // когда пришло новое состояние комнаты
  };

  // Плей/пауза/перемотка через родные кнопки YouTube — отправляем второму
  function ytUserAction(stateCode) {
    if (!yt.controls || !S.room || !S.room.source || S.room.source.kind !== 'youtube') return;
    if (Date.now() - yt.cmdAt < 800) return; // это сделал сам сайт
    if (stateCode === 1 && !S.room.playing) control('play', player.time());
    else if (stateCode === 2 && S.room.playing) control('pause', player.time());
  }

  function updateClickCatch() {
    // поверх плеера лежит прозрачный слой для кликов; с меню YouTube он мешал бы нажимать его кнопки
    $('clickCatch').hidden = player.kind === 'yt' && yt.controls;
  }

  function setYtControls(on) {
    yt.controls = on;
    store.set('kz_ytcontrols', on ? 'on' : 'off');
    updateClickCatch();
    if (!yt.player) return;
    // настройки плеера YouTube меняются только пересозданием
    try { yt.player.destroy(); } catch { /* ignore */ }
    ytBox.replaceChildren(h('div', { id: 'ytHost' }));
    yt.player = null;
    yt.ready = false;
    S.mediaReady = false;
    if (player.kind === 'yt' && yt.videoId) ytLoad(yt.videoId, S.loadedSid);
  }

  // ── Настройки видео: субтитры, звук, качество (у каждого свои, не синхронизируются) ──
  // кнопки YouTube спрятаны, поэтому субтитрами YouTube управляем сами
  const cc = {
    on: store.get('kz_cc', 'off') === 'on',
    lang: store.get('kz_cclang', ''),
  };

  function ytModules() {
    try { return (yt.player.getOptions && yt.player.getOptions()) || []; } catch { return []; }
  }
  function ytTracks() {
    try { return yt.player.getOption('captions', 'tracklist') || []; } catch { return []; }
  }

  function applyCaptions() {
    if (!yt.ready) return;
    try {
      const loaded = ytModules().includes('captions');
      if (!cc.on) {
        if (loaded) yt.player.unloadModule('captions');
        return;
      }
      if (!loaded) { yt.player.loadModule('captions'); return; } // дорисуем, когда модуль загрузится
      if (cc.lang && !yt.ccTrackSet) {
        const has = ytTracks().some((t) => t.languageCode === cc.lang);
        if (has) { yt.player.setOption('captions', 'track', { languageCode: cc.lang }); yt.ccTrackSet = true; }
      }
    } catch { /* старая версия API — ничего страшного */ }
  }

  function setCaptions(on, lang) {
    cc.on = on;
    if (lang !== undefined) cc.lang = lang;
    store.set('kz_cc', on ? 'on' : 'off');
    store.set('kz_cclang', cc.lang);
    yt.ccTrackSet = false;
    if (yt.ready) {
      try {
        if (on) {
          if (!ytModules().includes('captions')) yt.player.loadModule('captions');
          if (cc.lang) { yt.player.setOption('captions', 'track', { languageCode: cc.lang }); yt.ccTrackSet = true; }
        } else {
          yt.player.unloadModule('captions');
        }
      } catch { /* ignore */ }
    }
  }

  // Названия дорожек: «Русский (AniLibria)», «Japanese» и т.п.
  const langNames = (() => {
    try { return new Intl.DisplayNames(['ru'], { type: 'language' }); } catch { return null; }
  })();
  function trackLabel(t, i, fallback) {
    const name = (t.name || t.label || '').trim();
    let lang = '';
    const code = (t.lang || t.language || '').trim();
    if (code && langNames) { try { lang = langNames.of(code); } catch { lang = code; } }
    if (lang) lang = lang.charAt(0).toUpperCase() + lang.slice(1);
    if (name && lang && !name.toLowerCase().includes(lang.toLowerCase())) return `${lang} · ${name}`;
    return name || lang || `${fallback} ${i + 1}`;
  }

  // Разделы меню: сначала то, что зависит от видео, в конце — общие настройки для двоих
  function settingsSections() {
    const sections = mediaSections();
    if (!sections.length) {
      sections.push({
        title: 'Настройки видео', items: [],
        note: player.kind === 'html' && !hls
          ? 'У этого видео нет дорожек или субтитров, которые видит браузер. Несколько озвучек в файле умеет показывать только Safari.'
          : 'У этого видео нет своих настроек.',
      });
    }
    const wait = !(S.room && S.room.settings && S.room.settings.waitForBuffer === false);
    sections.push({
      title: 'Вместе',
      items: [{
        label: 'Ждать, если у кого-то грузится', checked: wait, role: 'menuitemcheckbox',
        pick: () => send({ type: 'settings', waitForBuffer: !wait }),
      }],
      note: 'Если видео у кого-то подвисло, пауза ставится обоим и включается само, когда догрузится. Общая настройка — меняется у вас обоих.',
    });
    return sections;
  }

  function mediaSections() {
    const sections = [];
    const src = S.room && S.room.source;
    if (!src) return sections;

    if (player.kind === 'yt') {
      const tracks = cc.on ? ytTracks() : [];
      sections.push({
        title: 'Субтитры',
        items: [
          { label: 'Выключить', checked: !cc.on, pick: () => setCaptions(false) },
          { label: 'Включить', checked: cc.on && !cc.lang, pick: () => setCaptions(true, '') },
          ...tracks.map((t) => ({
            label: t.displayName || t.languageName || t.languageCode,
            checked: cc.on && cc.lang === t.languageCode,
            pick: () => setCaptions(true, t.languageCode),
          })),
        ],
        note: cc.on && !tracks.length ? 'Языки появятся, когда ролик начнёт играть. Не появились — у ролика нет субтитров.' : '',
      });
      sections.push({
        title: 'Звуковая дорожка и качество',
        items: [
          { label: 'Показать меню YouTube', checked: yt.controls, pick: () => setYtControls(!yt.controls) },
        ],
        note: yt.controls
          ? 'В правом нижнем углу плеера — шестерёнка YouTube: «Звуковая дорожка» и «Качество». Плей и перемотка там тоже общие. Скорость не меняй — собьётся синхронизация. Нажми пункт ещё раз, чтобы скрыть.'
          : 'Покажет родные кнопки YouTube: там можно выбрать звуковую дорожку (если у ролика их несколько) и качество. У каждого своё.',
      });
      return sections;
    }

    if (hls) {
      const levels = hls.levels || [];
      if (levels.length > 1) {
        const order = levels.map((l, i) => ({ l, i })).sort((a, b) => (b.l.height || b.l.bitrate) - (a.l.height || a.l.bitrate));
        sections.push({
          title: 'Качество',
          items: [
            { label: 'Авто', checked: hls.autoLevelEnabled, pick: () => { hls.currentLevel = -1; } },
            ...order.map(({ l, i }) => ({
              label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} кбит/с`,
              checked: !hls.autoLevelEnabled && hls.currentLevel === i,
              pick: () => { hls.currentLevel = i; },
            })),
          ],
        });
      }
      const audio = hls.audioTracks || [];
      if (audio.length > 1) {
        sections.push({
          title: 'Звуковая дорожка',
          items: audio.map((t, i) => ({
            label: trackLabel(t, i, 'Дорожка'),
            checked: hls.audioTrack === i,
            pick: () => { hls.audioTrack = i; store.set('kz_audiolang', t.lang || t.name || ''); },
          })),
        });
      }
      const subs = hls.subtitleTracks || [];
      if (subs.length) {
        sections.push({
          title: 'Субтитры',
          items: [
            { label: 'Выключить', checked: hls.subtitleTrack === -1, pick: () => { hls.subtitleTrack = -1; } },
            ...subs.map((t, i) => ({
              label: trackLabel(t, i, 'Субтитры'),
              checked: hls.subtitleTrack === i,
              pick: () => { hls.subtitleDisplay = true; hls.subtitleTrack = i; },
            })),
          ],
        });
      }
    } else if (player.kind === 'html') {
      // обычный видеофайл: дорожки видит только часть браузеров (например, Safari)
      const at = video.audioTracks;
      if (at && at.length > 1) {
        const list = Array.from(at);
        sections.push({
          title: 'Звуковая дорожка',
          items: list.map((t, i) => ({
            label: trackLabel({ name: t.label, lang: t.language }, i, 'Дорожка'),
            checked: t.enabled,
            pick: () => { list.forEach((x, j) => { x.enabled = j === i; }); },
          })),
        });
      }
      const tt = Array.from(video.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
      if (tt.length) {
        sections.push({
          title: 'Субтитры',
          items: [
            { label: 'Выключить', checked: tt.every((t) => t.mode !== 'showing'), pick: () => tt.forEach((t) => { t.mode = 'disabled'; }) },
            ...tt.map((t, i) => ({
              label: trackLabel({ name: t.label, lang: t.language }, i, 'Субтитры'),
              checked: t.mode === 'showing',
              pick: () => tt.forEach((x, j) => { x.mode = j === i ? 'showing' : 'disabled'; }),
            })),
          ],
        });
      }
    }
    return sections;
  }

  function renderSettingsMenu() {
    const btn = $('setBtn');
    btn.classList.toggle('on', player.kind === 'yt' && cc.on);
    const menu = $('setMenu');
    if (menu.hidden) return;
    const sections = settingsSections();
    const nodes = [];
    for (const sec of sections) {
      nodes.push(h('div', { class: 'cc-title' }, sec.title));
      for (const it of sec.items) {
        nodes.push(h('button', {
          type: 'button', class: 'cc-item', role: it.role || 'menuitemradio', 'aria-checked': String(!!it.checked),
          onclick: () => { it.pick(); setTimeout(renderSettingsMenu, 150); },
        }, it.label));
      }
      if (sec.note) nodes.push(h('div', { class: 'cc-note' }, sec.note));
    }
    menu.replaceChildren(...nodes);
  }
  const renderCcMenu = renderSettingsMenu;

  function openSettings() {
    $('setMenu').hidden = false;
    $('setBtn').setAttribute('aria-expanded', 'true');
    renderSettingsMenu();
  }
  function closeCcMenu() {
    $('setMenu').hidden = true;
    $('setBtn').setAttribute('aria-expanded', 'false');
  }
  $('setBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('setMenu').hidden) openSettings(); else closeCcMenu();
  });
  document.addEventListener('click', (e) => {
    if (!$('setMenu').hidden && !$('setWrap').contains(e.target)) closeCcMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('setMenu').hidden) { closeCcMenu(); $('setBtn').focus(); }
  });

  function loadYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (yt.apiPromise) return yt.apiPromise;
    yt.apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('net'));
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('timeout')); }, 12000);
    }).catch((e) => { yt.apiPromise = null; throw e; });
    return yt.apiPromise;
  }

  async function ytLoad(videoId, sid) {
    S.ytError = null;
    try {
      await loadYtApi();
    } catch {
      if (S.loadedSid === sid) { S.ytError = 'api'; renderOverlay(); }
      return;
    }
    if (S.loadedSid !== sid) return;
    yt.videoId = videoId;
    yt.sentMeta = false;
    yt.ccTrackSet = false;
    if (yt.player && yt.ready) {
      yt.cmdAt = Date.now();
      yt.player.cueVideoById({ videoId, startSeconds: Math.max(0, expectedPosition()) });
      yt.readyAt = Date.now();
      S.mediaReady = true;
      renderOverlay();
      syncTick();
      return;
    }
    if (yt.player) return; // ещё создаётся — onReady подхватит yt.videoId
    yt.player = new window.YT.Player('ytHost', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        controls: yt.controls ? 1 : 0, disablekb: yt.controls ? 0 : 1, rel: 0, modestbranding: 1, playsinline: 1,
        iv_load_policy: 3, fs: 0, origin: location.origin,
        cc_load_policy: cc.on ? 1 : 0, hl: 'ru',
        start: Math.floor(Math.max(0, expectedPosition())),
      },
      events: {
        onReady: () => {
          yt.ready = true;
          if (yt.player.getVideoData && yt.player.getVideoData().video_id !== yt.videoId) {
            yt.player.cueVideoById(yt.videoId);
          }
          yt.player.setVolume(Number($('volume').value) * 100);
          applyCaptions();
          if (S.room && S.room.source && S.room.source.kind === 'youtube') {
            yt.readyAt = Date.now();
            S.mediaReady = true;
            renderOverlay();
            syncTick();
          }
        },
        onStateChange: (e) => {
          if (!S.room || !S.room.source || S.room.source.kind !== 'youtube') return;
          if (e.data === 1) applyCaptions(); // YouTube подгружает субтитры при старте — сразу применяем свой выбор
          if (e.data === 1 || e.data === 2) ytUserAction(e.data);
          if (e.data === 1 && !yt.sentMeta) {
            yt.sentMeta = true;
            const d = yt.player.getVideoData ? yt.player.getVideoData() : null;
            if (d && d.title && !S.room.source.title) send({ type: 'meta', sid: S.room.source.sid, title: d.title });
          }
          if (e.data === 0) send({ type: 'ended', sid: S.room.source.sid, position: yt.player.getCurrentTime() });
        },
        onApiChange: () => {
          // модуль субтитров загрузился или выгрузился
          applyCaptions();
          renderCcMenu();
        },
        onError: (e) => {
          S.ytError = [101, 150].includes(e.data) ? 'embed' : 'video';
          renderOverlay();
        },
      },
    });
  }

  const player = {
    kind: null, // 'yt' | 'html'
    time() {
      if (this.kind === 'yt') return yt.ready && yt.player.getCurrentTime ? yt.player.getCurrentTime() || 0 : 0;
      return video.currentTime || 0;
    },
    duration() {
      if (this.kind === 'yt') return yt.ready && yt.player.getDuration ? yt.player.getDuration() || 0 : 0;
      return Number.isFinite(video.duration) ? video.duration : 0;
    },
    isPlaying() {
      if (this.kind === 'yt') {
        if (!yt.ready) return false;
        const st = yt.player.getPlayerState();
        return st === 1 || st === 3;
      }
      return !video.paused && !video.ended;
    },
    play() {
      if (this.kind === 'yt') { if (yt.ready) { yt.cmdAt = Date.now(); yt.player.playVideo(); } return Promise.resolve(); }
      return video.play();
    },
    pause() {
      if (this.kind === 'yt') { if (yt.ready) { yt.cmdAt = Date.now(); yt.player.pauseVideo(); } return; }
      video.pause();
    },
    seek(t) {
      if (this.kind === 'yt') { if (yt.ready) { yt.cmdAt = Date.now(); yt.player.seekTo(t, true); } return; }
      try { video.currentTime = t; } catch { /* ещё не загрузилось */ }
    },
    setVolume(v) {
      video.volume = v;
      if (yt.ready) yt.player.setVolume(v * 100);
    },
  };

  video.addEventListener('loadedmetadata', () => {
    renderSettingsMenu();
    S.mediaReady = true;
    renderOverlay();
    syncTick();
  });
  video.addEventListener('ended', () => {
    if (S.room && S.room.source) send({ type: 'ended', sid: S.room.source.sid, position: video.currentTime });
  });
  video.addEventListener('error', () => {
    if (!video.getAttribute('src') || hls) return;
    S.ytError = S.room && S.room.source && S.room.source.kind === 'url' ? 'direct' : 'html';
    renderOverlay();
  });
  video.addEventListener('loadeddata', () => {
    // название для прямой ссылки — из адреса, если его ещё нет
    const src = S.room && S.room.source;
    if (src && src.kind === 'url' && !src.title) send({ type: 'meta', sid: src.sid, title: sourceTitle(src) });
  });

  // ── Потоки .m3u8 (hls.js лежит на нашем же сервере) ──
  let hls = null;
  let hlsLoading = null;
  function loadHlsLib() {
    if (window.Hls) return Promise.resolve();
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/app/vendor/hls.min.js';
      s.onload = () => resolve();
      s.onerror = () => { hlsLoading = null; reject(new Error('hls')); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  async function playDirectUrl(url, sid) {
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
    if (!isHlsUrl(url) || nativeHls) {
      video.src = url;
      return;
    }
    try { await loadHlsLib(); } catch { S.ytError = 'direct'; renderOverlay(); return; }
    if (S.loadedSid !== sid) return;
    if (!window.Hls.isSupported()) { video.src = url; return; }
    hls = new window.Hls({ maxBufferLength: 60 });
    hls.on(window.Hls.Events.ERROR, (evt, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      S.ytError = 'direct';
      renderOverlay();
    });
    const E = window.Hls.Events;
    // если в прошлый раз выбирали озвучку — пробуем включить такую же
    hls.on(E.AUDIO_TRACKS_UPDATED, () => {
      const want = store.get('kz_audiolang', '');
      if (want) {
        const i = hls.audioTracks.findIndex((t) => (t.lang || t.name || '') === want);
        if (i >= 0 && i !== hls.audioTrack) hls.audioTrack = i;
      }
      renderSettingsMenu();
    });
    for (const ev of [E.MANIFEST_PARSED, E.LEVEL_SWITCHED, E.AUDIO_TRACK_SWITCHED, E.SUBTITLE_TRACKS_UPDATED, E.SUBTITLE_TRACK_SWITCH]) {
      hls.on(ev, () => renderSettingsMenu());
    }
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  function stopMedia() {
    S.mediaReady = false;
    S.ytError = null;
    if (hls) { try { hls.destroy(); } catch { /* ignore */ } hls = null; }
    if (yt.ready) { try { yt.player.stopVideo(); } catch { /* ignore */ } }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function applySource() {
    const src = S.room && S.room.source;
    const sid = src ? src.sid : null;
    if (sid === S.loadedSid) return;
    S.loadedSid = sid;
    stopMedia();

    if (S.local && S.local.sid && S.local.sid !== sid) {
      URL.revokeObjectURL(S.local.url);
      S.local = null;
    }
    if (!src) {
      player.kind = null;
      ytBox.hidden = true;
      video.hidden = true;
      $('setWrap').hidden = true;
      closeCcMenu();
      return;
    }

    $('setWrap').hidden = false;
    closeCcMenu();

    if (src.kind === 'youtube') {
      player.kind = 'yt';
      updateClickCatch();
      video.hidden = true;
      ytBox.hidden = false;
      ytLoad(src.ref, sid);
      return;
    }

    player.kind = 'html';
    updateClickCatch();
    ytBox.hidden = true;
    video.hidden = false;
    if (src.kind === 'upload') video.src = `/media/upload/${encodeURIComponent(src.ref)}`;
    else if (src.kind === 'proxy' || src.kind === 'site') video.src = `/media/yt/${encodeURIComponent(src.file)}`;
    else if (src.kind === 'url') playDirectUrl(src.ref, sid);
    else if (src.kind === 'local') {
      const p = S.pendingLocal;
      if (p && p.name === src.name && p.size === src.size) {
        S.local = { ...p, sid };
        S.pendingLocal = null;
      }
      if (S.local && S.local.sid === sid) video.src = S.local.url;
    }
  }

  // Держим плеер в том же месте, что и у второго человека
  function syncTick() {
    const r = S.room;
    if (!r || !r.source || !S.joined || !S.mediaReady || !player.kind) return;

    const dur = player.duration();
    let target = expectedPosition();
    if (dur && target > dur - 0.25) target = Math.max(0, dur - 0.25);

    const playing = player.isPlaying();
    if (r.playing && !playing) {
      const p = player.play();
      if (p && p.catch) p.catch((err) => {
        if (err && err.name === 'NotAllowedError') { S.joined = false; renderOverlay(); }
      });
    } else if (!r.playing && playing) {
      player.pause();
    }

    const diff = player.time() - target;
    const tolerance = player.kind === 'yt' ? 1.2 : 0.6;

    // Перемотали полосой в меню YouTube — это действие человека, отправляем его второму
    if (player.kind === 'yt' && yt.controls && Math.abs(diff) > 3) {
      const now = Date.now();
      let st = -1;
      try { st = yt.player.getPlayerState(); } catch { /* ignore */ }
      if ((st === 1 || st === 2) && now - yt.cmdAt > 2500 && now - yt.readyAt > 4000 && now - yt.roomAt > 2500) {
        control('seek', player.time());
        return;
      }
    }

    if (Math.abs(diff) > tolerance && !S.seeking) player.seek(target);
  }
  setInterval(syncTick, 500);

  // ── «Подожди меня»: если видео у меня подвисло — просим сервер поставить паузу обоим ──
  const buf = { sent: false, sid: null, stallSince: 0 };

  function bufferedAhead() {
    const t = video.currentTime;
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.3 && b.end(i) >= t) return b.end(i) - t;
    }
    return 0;
  }

  function mediaStalled() {
    if (player.kind === 'html') return !video.paused && video.readyState < 3;
    if (player.kind === 'yt' && yt.ready) {
      try { return yt.player.getPlayerState() === 3; } catch { return false; }
    }
    return false;
  }

  function mediaReadyEnough() {
    if (player.kind === 'html') {
      const left = (video.duration || 0) - video.currentTime;
      return video.readyState >= 4 || bufferedAhead() >= 4 || (left > 0 && left < 4 && video.readyState >= 3);
    }
    if (player.kind === 'yt' && yt.ready) {
      try {
        const frac = yt.player.getVideoLoadedFraction() || 0;
        const dur = yt.player.getDuration() || 0;
        return frac >= 0.99 || frac * dur - yt.player.getCurrentTime() >= 4;
      } catch { return true; }
    }
    return true;
  }

  function sendBuffering(on, sid) {
    buf.sent = on;
    buf.sid = on ? sid : null;
    buf.stallSince = 0;
    send({ type: 'buffering', on, sid });
  }

  setInterval(() => {
    const r = S.room;
    const src = r && r.source;
    if (!src || !S.mediaReady || !S.joined || !S.connected) {
      if (buf.sent && src) sendBuffering(false, buf.sid);
      buf.sent = false;
      buf.stallSince = 0;
      return;
    }
    if (buf.sent && buf.sid !== src.sid) { buf.sent = false; buf.sid = null; } // видео сменилось — сервер уже забыл

    if (!buf.sent) {
      const wanted = !(r.settings && r.settings.waitForBuffer === false);
      if (wanted && r.playing && mediaStalled()) {
        if (!buf.stallSince) buf.stallSince = Date.now();
        else if (Date.now() - buf.stallSince > 1500) sendBuffering(true, src.sid);
      } else {
        buf.stallSince = 0;
      }
      return;
    }
    // уже попросили подождать: сообщаем, когда догрузилось (или если кто-то нажал плей сам)
    if ((r.playing && !r.waiting && !mediaStalled()) || (!r.playing && mediaReadyEnough())) {
      sendBuffering(false, src.sid);
    }
  }, 500);

  // ───────────────────────── Действия ─────────────────────────

  function control(action, position) {
    const r = S.room;
    if (!r || !r.source) return;
    // сразу применяем у себя, сервер подтвердит
    if (action === 'play') r.playing = true;
    if (action === 'pause') r.playing = false;
    r.position = position;
    r.updatedAt = serverNow();
    r.lastAction = { by: S.me, action, position, at: serverNow() };
    send({ type: 'control', action, position, sid: r.source.sid });
    renderControls();
    syncTick();
  }

  function togglePlay() {
    if (!S.room || !S.room.source) return;
    if (!S.joined) { join(); return; }
    const pos = S.mediaReady ? player.time() : expectedPosition();
    control(S.room.playing ? 'pause' : 'play', pos);
  }

  function join() {
    S.joined = true;
    renderOverlay();
    // play() прямо в обработчике нажатия — так браузер разрешит звук
    if (S.room && S.room.playing && S.mediaReady) {
      player.seek(expectedPosition());
      const p = player.play();
      if (p && p.catch) p.catch(() => {});
    } else if (player.kind === 'html' && video.getAttribute('src')) {
      video.play().then(() => { if (!S.room.playing) video.pause(); }).catch(() => {});
    }
    syncTick();
  }

  $('playBtn').addEventListener('click', togglePlay);
  $('clickCatch').addEventListener('click', togglePlay);
  $('clickCatch').addEventListener('dblclick', (e) => { e.preventDefault(); toggleFullscreen(); });

  const seek = $('seek');
  seek.addEventListener('input', () => {
    S.seeking = true;
    updateTimeUi(Number(seek.value));
  });
  seek.addEventListener('change', () => {
    S.seeking = false;
    const pos = Number(seek.value);
    player.seek(pos);
    control('seek', pos);
  });

  const volume = $('volume');
  volume.value = store.get('kz_volume', '0.9');
  player.setVolume(Number(volume.value));
  volume.addEventListener('input', () => {
    player.setVolume(Number(volume.value));
    store.set('kz_volume', volume.value);
  });

  function toggleFullscreen() {
    const el = $('playerWrap');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen && player.kind === 'html') video.webkitEnterFullscreen();
  }
  $('fsBtn').addEventListener('click', toggleFullscreen);

  // ── Источник: YouTube ──

  let ytMode = store.get('kz_ytmode', 'youtube');
  let fileMode = store.get('kz_filemode', 'upload');
  let urlMode = store.get('kz_urlmode', 'direct');

  const TABS = { yt: ['tabYt', 'panelYt'], url: ['tabUrl', 'panelUrl'], file: ['tabFile', 'panelFile'] };
  function setTab(tab) {
    if (!TABS[tab]) tab = 'yt';
    for (const [name, [tabId, panelId]] of Object.entries(TABS)) {
      $(tabId).setAttribute('aria-selected', String(name === tab));
      $(panelId).hidden = name !== tab;
    }
    store.set('kz_tab', tab);
  }
  for (const [name, [tabId]] of Object.entries(TABS)) $(tabId).addEventListener('click', () => setTab(name));

  function renderModes() {
    if (ytMode === 'proxy' && !S.features.ytdlp) ytMode = 'youtube';
    if (fileMode === 'upload' && !S.features.uploads) fileMode = 'local';
    for (const b of document.querySelectorAll('[data-ytmode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.ytmode === ytMode));
      if (b.dataset.ytmode === 'proxy') {
        b.disabled = !S.features.ytdlp;
        b.title = S.features.ytdlp ? '' : 'Включается на своём сервере (VPS) с yt-dlp';
      }
    }
    for (const b of document.querySelectorAll('[data-filemode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.filemode === fileMode));
      if (b.dataset.filemode === 'upload') {
        b.disabled = !S.features.uploads;
        b.title = S.features.uploads ? '' : 'Загрузка выключена на сервере';
      }
    }
    $('ytHint').textContent = ytMode === 'youtube'
      ? 'Плеер YouTube грузится напрямую с YouTube — в России обоим нужен включённый VPN.'
      : 'Сервер сам скачает ролик и отдаст его вам. VPN не нужен, но придётся немного подождать.';
    if (!S.features.ytdlp && ytMode === 'youtube') {
      $('ytHint').textContent += ' Режим «Через сервер» появится, когда сайт будет на своём VPS.';
    }
    if (urlMode === 'server' && !S.features.ytdlp) urlMode = 'direct';
    for (const b of document.querySelectorAll('[data-urlmode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.urlmode === urlMode));
      if (b.dataset.urlmode === 'server') {
        b.disabled = !S.features.ytdlp;
        b.title = S.features.ytdlp ? '' : 'Включается на своём сервере (VPS) с yt-dlp';
      }
    }
    $('urlHint').textContent = urlMode === 'direct'
      ? 'Для прямых ссылок на видео: .mp4, .webm или поток .m3u8. Каждый браузер грузит видео сам, поэтому ссылка должна открываться у обоих.'
      : 'Для ссылки на страницу сайта (VK Видео, Rutube и сотни других). Сервер сам достанет видео и отдаст вам. Сайты с защитой (DRM) не скачать.';
    if (!S.features.ytdlp && urlMode === 'direct') {
      $('urlHint').textContent += ' Ссылки на страницы сайтов можно будет открывать «Через сервер», когда сайт будет на своём VPS.';
    }
    $('fileHint').textContent = fileMode === 'upload'
      ? `Файл загрузится на сервер, и вы оба будете смотреть его оттуда. Лучше всего mp4${S.features.maxUploadMb ? `, до ${S.features.maxUploadMb} МБ` : ''}.`
      : 'У каждого должен быть одинаковый файл. На сервер ничего не загружается — синхронизируется только управление.';
    $('ytQueue').hidden = false;
  }

  for (const b of document.querySelectorAll('[data-ytmode]')) {
    b.addEventListener('click', () => { ytMode = b.dataset.ytmode; store.set('kz_ytmode', ytMode); renderModes(); });
  }
  for (const b of document.querySelectorAll('[data-urlmode]')) {
    b.addEventListener('click', () => { urlMode = b.dataset.urlmode; store.set('kz_urlmode', urlMode); renderModes(); checkUrlInput(); });
  }
  for (const b of document.querySelectorAll('[data-filemode]')) {
    b.addEventListener('click', () => {
      fileMode = b.dataset.filemode;
      store.set('kz_filemode', fileMode);
      resetUploadBox();
      renderModes();
    });
  }

  function ytSourceFromInput() {
    const input = $('ytUrl');
    const id = parseYouTube(input.value);
    if (!id) {
      input.setCustomValidity('Не похоже на ссылку YouTube');
      input.reportValidity();
      setTimeout(() => input.setCustomValidity(''), 2000);
      return null;
    }
    input.value = '';
    return { kind: ytMode === 'proxy' ? 'proxy' : 'youtube', ref: id };
  }

  $('ytForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const src = ytSourceFromInput();
    if (!src) return;
    if (!S.joined) join();
    send({ type: 'load', source: src });
  });
  $('ytQueue').addEventListener('click', () => {
    const src = ytSourceFromInput();
    if (src) send({ type: 'queue_add', source: src });
  });

  // ── Источник: любая ссылка ──

  const VIDEO_FILE_RE = /\.(mp4|webm|m4v|mov|ogv|ogg|m3u8|mpd)(\?|#|$)/i;
  const isHlsUrl = (u) => /\.m3u8(\?|#|$)/i.test(u) || /[?&](format|type)=m3u8/i.test(u);

  function normalizeUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u;
    } catch {
      return null;
    }
  }

  // Подсказка прямо под полем: похоже ли это на видео
  function checkUrlInput() {
    const warn = $('urlWarn');
    const u = normalizeUrl($('urlInput').value);
    warn.hidden = true;
    if (!u) return;
    if (parseYouTube(u.href)) {
      warn.textContent = 'Это YouTube — откроется так же, как во вкладке YouTube.';
      warn.hidden = false;
    } else if (urlMode === 'direct' && u.protocol === 'http:' && location.protocol === 'https:') {
      warn.textContent = 'Ссылка без https — браузер может её заблокировать на защищённом сайте.';
      warn.hidden = false;
    } else if (urlMode === 'direct' && !VIDEO_FILE_RE.test(u.pathname + u.search)) {
      warn.textContent = S.features.ytdlp
        ? 'Похоже, это страница сайта, а не сам видеофайл. Для таких ссылок выбери «Через сервер».'
        : 'Похоже, это страница сайта, а не сам видеофайл. Попробуй — но если не включится, нужна прямая ссылка или режим «Через сервер» на VPS.';
      warn.hidden = false;
    }
  }
  $('urlInput').addEventListener('input', checkUrlInput);

  function urlSourceFromInput() {
    const input = $('urlInput');
    const u = normalizeUrl(input.value);
    if (!u) {
      input.setCustomValidity('Нужна ссылка, начинающаяся с https://');
      input.reportValidity();
      setTimeout(() => input.setCustomValidity(''), 2000);
      return null;
    }
    input.value = '';
    $('urlWarn').hidden = true;
    const ytId = parseYouTube(u.href);
    if (ytId) return { kind: urlMode === 'server' && S.features.ytdlp ? 'proxy' : 'youtube', ref: ytId };
    return { kind: urlMode === 'server' ? 'site' : 'url', ref: u.href };
  }

  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const src = urlSourceFromInput();
    if (!src) return;
    if (!S.joined) join();
    send({ type: 'load', source: src });
  });
  $('urlQueue').addEventListener('click', () => {
    const src = urlSourceFromInput();
    if (src) send({ type: 'queue_add', source: src });
  });

  // ── Источник: файл ──

  const fileInput = $('fileInput');
  let fileTarget = 'new'; // 'new' — выбрать новый файл, 'match' — подобрать файл под то, что включил второй
  let uploaded = null;

  $('pickFile').addEventListener('click', () => { fileTarget = 'new'; fileInput.click(); });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    if (fileTarget === 'match') {
      const src = S.room && S.room.source;
      if (!src || src.kind !== 'local') return;
      if ((file.name !== src.name || file.size !== src.size) &&
          !confirm(`Файл отличается: у тебя «${file.name}» (${fmtSize(file.size)}), а включён «${src.name}» (${fmtSize(src.size)}). Всё равно использовать?`)) return;
      if (S.local) URL.revokeObjectURL(S.local.url);
      S.local = { sid: src.sid, name: file.name, size: file.size, url: URL.createObjectURL(file) };
      S.loadedSid = null; // перезагрузить источник
      applySource();
      if (!S.joined) join();
      renderOverlay();
      return;
    }

    if (fileMode === 'local') {
      if (S.pendingLocal) URL.revokeObjectURL(S.pendingLocal.url);
      S.pendingLocal = { name: file.name, size: file.size, url: URL.createObjectURL(file) };
      if (!S.joined) join();
      send({ type: 'load', source: { kind: 'local', name: file.name, size: file.size } });
      return;
    }

    uploadFile(file);
  });

  function resetUploadBox() {
    uploaded = null;
    $('uploadBox').hidden = true;
    $('uploadActions').hidden = true;
    $('pickFile').disabled = false;
  }

  function uploadFile(file) {
    const max = S.features.maxUploadMb * 1024 * 1024;
    if (max && file.size > max) { alert(`Файл больше ${S.features.maxUploadMb} МБ`); return; }
    uploaded = null;
    $('uploadBox').hidden = false;
    $('uploadActions').hidden = true;
    $('uploadName').textContent = `Загружаем «${file.name}» · ${fmtSize(file.size)}`;
    $('uploadBar').style.width = '0%';
    $('pickFile').disabled = true;

    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.round((e.loaded / e.total) * 100);
        $('uploadBar').style.width = p + '%';
        $('uploadName').textContent = `Загружаем «${file.name}» · ${p}%`;
      }
    };
    xhr.onload = () => {
      $('pickFile').disabled = false;
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 401) { location.href = '/login'; return; }
      if (xhr.status !== 200) {
        $('uploadName').textContent = res.error || 'Не получилось загрузить файл';
        $('uploadBar').style.width = '0%';
        return;
      }
      uploaded = { kind: 'upload', ref: res.file, name: res.name };
      $('uploadBar').style.width = '100%';
      $('uploadName').textContent = `Готово: «${res.name}»`;
      $('uploadActions').hidden = false;
    };
    xhr.onerror = () => {
      $('pickFile').disabled = false;
      $('uploadName').textContent = 'Связь оборвалась во время загрузки';
    };
    xhr.send(form);
  }

  $('uploadPlay').addEventListener('click', () => {
    if (!uploaded) return;
    if (!S.joined) join();
    send({ type: 'load', source: uploaded });
    resetUploadBox();
  });
  $('uploadQueue').addEventListener('click', () => {
    if (!uploaded) return;
    send({ type: 'queue_add', source: uploaded });
    resetUploadBox();
  });

  // ── Реакции ──

  for (const b of document.querySelectorAll('[data-react]')) {
    b.append(svg(ICONS[b.dataset.react]), h('span', { class: 'n' }, '0'));
    b.addEventListener('click', () => send({ type: 'react', kind: b.dataset.react }));
  }

  function floatReaction(kind, by) {
    const el = h('div', { class: 'float' },
      h('div', { class: 'bubble' }, svg(ICONS[kind])),
      h('div', { class: 'who' }, who(by)));
    el.style.setProperty('--c', REACT_COLORS[kind] || '#fff');
    el.style.left = `${12 + Math.random() * 76}%`;
    $('floats').append(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ── Чат ──

  const messagesEl = $('messages');

  function messageEl(m) {
    return h('div', { class: `msg${isMe(m.by) ? ' mine' : ''}` },
      h('div', { class: 'bubble-text' }, m.text),
      h('div', { class: 'msg-meta' }, isMe(m.by) ? fmtClock(m.at) : `${userName(m.by)} · ${fmtClock(m.at)}`));
  }

  function renderAllMessages(list) {
    messagesEl.replaceChildren(...(list.length ? list.map(messageEl) : [
      h('div', { class: 'msg sys' }, h('div', { class: 'bubble-text' }, 'Тут будет ваш чатик')),
    ]));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(m) {
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    const placeholder = messagesEl.querySelector('.msg.sys');
    if (placeholder) placeholder.remove();
    messagesEl.append(messageEl(m));
    while (messagesEl.children.length > 200) messagesEl.firstChild.remove();
    if (nearBottom || isMe(m.by)) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  let lastTypingSent = 0;
  $('chatInput').addEventListener('input', () => {
    if (Date.now() - lastTypingSent > 2500) { lastTypingSent = Date.now(); send({ type: 'typing' }); }
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    input.value = '';
    lastTypingSent = 0;
  });

  let typingTimer = null;
  function showTyping(by) {
    $('typing').textContent = `${userName(by)} печатает…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(hideTyping, 3500);
  }
  function hideTyping() { $('typing').textContent = ''; }

  // ───────────────────────── Отрисовка ─────────────────────────

  function setRoom(state) {
    const prev = S.room;
    // второй нажал плей/паузу/перемотку — наш плеер сейчас догонит, это не наше действие
    if (!prev || !state || prev.updatedAt !== state.updatedAt || prev.playing !== state.playing) yt.roomAt = Date.now();
    S.room = state;
    applySource();
    renderControls();
    renderQueue();
    renderReactions();
    renderOverlay();
    renderPresence();
    renderSettingsMenu();
    syncTick();
  }

  function renderPresence() {
    const avatars = S.users.map((u) => {
      const on = S.online.has(u.login);
      return h('div', {
        class: `avatar${isMe(u.login) ? '' : ' partner'}${on ? ' on' : ''}`,
        title: `${u.name}: ${on ? 'онлайн' : 'не в сети'}`,
      }, (isMe(u.login) ? 'Я' : u.name.slice(0, 1)).toUpperCase(), h('span', { class: 'st' }));
    });
    $('avatars').replaceChildren(...avatars);

    const p = partner();
    const pOn = p && S.online.has(p.login);
    if (!S.connected) {
      $('presenceTitle').textContent = 'Нет связи с сервером';
      $('presenceSub').textContent = 'переподключаемся…';
    } else if (p) {
      $('presenceTitle').textContent = `${p.name} ${pOn ? 'онлайн' : 'не в сети'}`;
      $('presenceSub').textContent = pOn ? 'смотрит вместе с тобой' : 'появится — всё синхронизируется';
    }

    const dot = $('syncDot');
    dot.className = 'dot ' + (!S.connected ? 'bad' : pOn ? 'ok' : 'warn');
    const waiting = S.connected && S.room && S.room.waiting;
    dot.className = 'dot ' + (!S.connected ? 'bad' : waiting ? 'warn' : pOn ? 'ok' : 'warn');
    $('syncText').textContent = !S.connected ? 'Нет связи'
      : waiting ? 'Ждём, пока догрузится…'
        : pOn ? `Синхронно с ${p ? p.name : 'вторым'}` : 'Ждём второго';
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function sourceTitle(src) {
    if (!src) return 'Ничего не включено';
    if (src.title) return src.title;
    if (src.kind === 'youtube' || src.kind === 'proxy') return `YouTube · ${src.ref}`;
    if (src.kind === 'url') {
      try {
        const u = new URL(src.ref);
        const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
        if (last && !/^(index|playlist|master)\.m3u8$/i.test(last)) return `${last} · ${hostOf(src.ref)}`;
      } catch { /* ignore */ }
      return `Видео с ${hostOf(src.ref)}`;
    }
    if (src.kind === 'site') return `Видео с ${hostOf(src.ref)}`;
    return src.name || 'Видео';
  }

  function sourceLabel(src) {
    return {
      youtube: 'YouTube', proxy: 'YouTube через сервер', upload: 'Файл на сервере', local: 'Свой файл',
      url: `Ссылка · ${hostOf(src.ref)}`, site: `${hostOf(src.ref)} через сервер`,
    }[src.kind] || '';
  }

  function renderControls() {
    const r = S.room;
    const playing = !!(r && r.playing);
    $('icPlay').toggleAttribute('hidden', playing);
    $('icPause').toggleAttribute('hidden', !playing);
    $('playBtn').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    $('nowTitle').textContent = r && r.source ? `${sourceTitle(r.source)}` : 'Ничего не включено';

    const la = r && r.lastAction;
    if (la && r.source) {
      const text = {
        play: `${who(la.by)} — плей на ${fmtTime(la.position)}`,
        pause: `${who(la.by)} — пауза на ${fmtTime(la.position)}`,
        seek: `${who(la.by)} — перемотка на ${fmtTime(la.position)}`,
        load: `${who(la.by)} — включено новое видео`,
        wait: isMe(la.by) ? 'У тебя грузится — ждём, пока догрузится' : `${userName(la.by)}: видео грузится — ждём`,
        resume: la.by ? 'Догрузилось — продолжаем' : 'Ждали долго — продолжаем',
        wait_on: `${who(la.by)} — «ждать, если грузится»: включено`,
        wait_off: `${who(la.by)} — «ждать, если грузится»: выключено`,
      }[la.action] || '';
      $('lastAction').textContent = text;
    } else {
      $('lastAction').textContent = '';
    }

    const fc = $('fileChip');
    if (r && r.source && r.source.kind === 'local') {
      const mine = S.local && S.local.sid === r.source.sid;
      fc.hidden = false;
      fc.textContent = mine
        ? (S.local.name === r.source.name && S.local.size === r.source.size ? `${r.source.name} · файлы совпадают` : `${r.source.name} · у тебя другой файл`)
        : r.source.name;
    } else {
      fc.hidden = true;
    }
  }

  function updateTimeUi(forced) {
    const dur = player.kind && S.mediaReady ? player.duration() : 0;
    let t = forced !== undefined ? forced : (player.kind && S.mediaReady ? player.time() : expectedPosition());
    if (!S.room || !S.room.source) t = 0;
    seek.max = String(dur || 0);
    if (!S.seeking) seek.value = String(t);
    seek.style.setProperty('--p', dur ? `${Math.min(100, (t / dur) * 100)}%` : '0%');
    const timeEl = $('time');
    timeEl.firstChild.textContent = `${fmtTime(t)} `;
    timeEl.lastChild.textContent = `/ ${fmtTime(dur)}`;
  }
  setInterval(() => updateTimeUi(), 250);

  function renderReactions() {
    const counts = (S.room && S.room.reactions) || {};
    for (const b of document.querySelectorAll('[data-react]')) {
      b.querySelector('.n').textContent = String(counts[b.dataset.react] || 0);
    }
  }

  function renderQueue() {
    const q = (S.room && S.room.queue) || [];
    $('queueCount').textContent = String(q.length);
    $('queueEmpty').hidden = q.length > 0;
    $('queueList').replaceChildren(...q.map((item, i) => {
      const src = item.source;
      const thumb = h('div', { class: 'q-thumb' }, svg(ICONS.film));
      if (src.kind === 'youtube' || src.kind === 'proxy') {
        const img = h('img', { src: `https://i.ytimg.com/vi/${src.ref}/mqdefault.jpg`, alt: '', loading: 'lazy' });
        img.addEventListener('load', () => thumb.replaceChildren(img));
      }
      return h('li', { class: 'q-item' },
        h('span', { class: 'q-n' }, String(i + 1)),
        thumb,
        h('div', { class: 'q-info' },
          h('div', { class: 'q-title' }, sourceTitle(src)),
          h('div', { class: 'q-meta' }, `${sourceLabel(src)} · добавил${isMe(item.by) ? '(а) ты' : ` ${userName(item.by)}`}`)),
        h('div', { class: 'q-actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Включить сейчас', onclick: () => { if (!S.joined) join(); send({ type: 'queue_play', id: item.id }); } }, svg(ICONS.play)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Выше', disabled: i === 0, onclick: () => send({ type: 'queue_move', id: item.id, dir: 'up' }) }, svg(ICONS.up)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ниже', disabled: i === q.length - 1, onclick: () => send({ type: 'queue_move', id: item.id, dir: 'down' }) }, svg(ICONS.down)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Убрать из очереди', onclick: () => send({ type: 'queue_remove', id: item.id }) }, svg(ICONS.x))));
    }));
  }

  // ───────────────────────── Очередь · Хотелки · Дневник ─────────────────────────

  const LIB = { queue: ['libTabQueue', 'libQueue'], wish: ['libTabWish', 'libWish'], diary: ['libTabDiary', 'libDiary'] };
  function setLibTab(tab) {
    if (!LIB[tab]) tab = 'queue';
    S.libTab = tab;
    for (const [name, [tabId, panelId]] of Object.entries(LIB)) {
      $(tabId).setAttribute('aria-selected', String(name === tab));
      $(panelId).hidden = name !== tab;
    }
    store.set('kz_libtab', tab);
  }
  for (const [name, [tabId]] of Object.entries(LIB)) $(tabId).addEventListener('click', () => setLibTab(name));

  function thumbFor(src) {
    const thumb = h('div', { class: 'q-thumb' }, svg(ICONS.film));
    if ((src.kind === 'youtube' || src.kind === 'proxy') && /^[A-Za-z0-9_-]{11}$/.test(src.ref)) {
      const img = h('img', { src: `https://i.ytimg.com/vi/${src.ref}/mqdefault.jpg`, alt: '', loading: 'lazy' });
      img.addEventListener('load', () => thumb.replaceChildren(img));
    }
    return thumb;
  }

  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function fmtDate(ms, withYear) {
    const d = new Date(ms);
    const y = withYear || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
  }
  function dayLabel(ms) {
    const d = new Date(ms);
    const today = new Date();
    const yest = new Date(Date.now() - 864e5);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return 'Сегодня';
    if (same(d, yest)) return 'Вчера';
    return fmtDate(ms);
  }
  function fmtDuration(sec) {
    sec = Math.round(sec || 0);
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    if (hh && mm) return `${hh} ч ${mm} мин`;
    if (hh) return `${hh} ч`;
    return `${Math.max(1, mm)} мин`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  function smallIcon(kind) {
    const el = svg(ICONS[kind]);
    el.setAttribute('width', '15');
    el.setAttribute('height', '15');
    return el;
  }

  // Ссылка из поля «хотелок» → источник видео
  function sourceFromLink(raw) {
    const u = normalizeUrl(raw);
    if (!u) return null;
    const ytId = parseYouTube(u.href);
    if (ytId) return { kind: 'youtube', ref: ytId };
    if (!VIDEO_FILE_RE.test(u.pathname + u.search) && S.features.ytdlp) return { kind: 'site', ref: u.href };
    return { kind: 'url', ref: u.href };
  }

  // ── Хотелки ──

  $('wishForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('wishUrl');
    const src = sourceFromLink(input.value);
    if (!src) {
      input.setCustomValidity('Нужна ссылка, например https://youtu.be/…');
      input.reportValidity();
      setTimeout(() => input.setCustomValidity(''), 2000);
      return;
    }
    send({ type: 'wish_add', source: src, note: $('wishNote').value.trim() });
    input.value = '';
    $('wishNote').value = '';
  });

  function renderWishlist() {
    const list = S.wishlist || [];
    $('wishCount').textContent = String(list.length);
    $('wishEmpty').hidden = list.length > 0;
    $('wishList').replaceChildren(...list.map((item) => {
      const src = item.source;
      return h('li', { class: 'q-item' },
        thumbFor(src),
        h('div', { class: 'q-info' },
          h('div', { class: 'q-title' }, sourceTitle(src)),
          item.note ? h('div', { class: 'q-note' }, `«${item.note}»`) : null,
          h('div', { class: 'q-meta' }, `${isMe(item.by) ? 'Ты' : userName(item.by)} · ${fmtDate(item.at)} · ${sourceLabel(src)}`)),
        h('div', { class: 'q-actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Смотреть сейчас', title: 'Смотреть сейчас', onclick: () => { if (!S.joined) join(); send({ type: 'wish_play', id: item.id }); } }, svg(ICONS.play)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'В очередь', title: 'В очередь', onclick: () => send({ type: 'wish_queue', id: item.id }) }, svg(ICONS.toQueue)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Убрать из хотелок', title: 'Убрать', onclick: () => send({ type: 'wish_remove', id: item.id }) }, svg(ICONS.x))));
    }));
  }

  // ── Дневник и счётчики ──

  let editingNote = null; // id записи, к которой сейчас пишем пару слов

  function statTile(label, value, sub) {
    return h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value),
      sub ? h('div', { class: 'stat-sub' }, sub) : null);
  }

  function renderStats() {
    const st = S.stats;
    const box = $('statsBox');
    if (!st || (!st.together && !st.videos)) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    const r = st.reactions || {};
    const totalReacts = Object.values(r).reduce((a, b) => a + (b || 0), 0);
    box.replaceChildren(
      statTile('Вместе посмотрели', fmtDuration(st.together), st.firstAt ? `с ${fmtDate(st.firstAt, true)}` : null),
      statTile('Видео', `${st.videos}`, plural(st.videos, 'видео в дневнике', 'видео в дневнике', 'видео в дневнике')),
      statTile('Сердечек', `${r.heart || 0}`, `всего реакций: ${totalReacts}`),
      statTile('Самое смешное', st.funniest ? st.funniest.title || 'Без названия' : 'пока нет',
        st.funniest ? `${st.funniest.count} ${plural(st.funniest.count, 'смешок', 'смешка', 'смешков')}` : 'жмите «смешно» почаще'),
      statTile('Самое любимое', st.loved ? st.loved.title || 'Без названия' : 'пока нет',
        st.loved ? `${st.loved.count} ${plural(st.loved.count, 'сердечко', 'сердечка', 'сердечек')}` : null),
    );
  }

  function diaryItem(e) {
    const reacts = ['heart', 'laugh', 'fire', 'star', 'cry'].filter((k) => (e.reactions && e.reactions[k]) > 0);
    const notes = Object.entries(e.notes || {}).filter(([, t]) => t);
    const myNote = (e.notes || {})[S.me] || '';
    const editing = editingNote === e.id;

    let noteForm = null;
    if (editing) {
      const input = h('input', { class: 'input grow', type: 'text', maxlength: '500', value: myNote, placeholder: 'Пару слов об этом вечере…', 'aria-label': 'Пару слов' });
      const save = () => { send({ type: 'diary_note', id: e.id, text: input.value.trim() }); editingNote = null; renderDiary(); };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') { editingNote = null; renderDiary(); } });
      noteForm = h('div', { class: 'note-form' }, input,
        h('button', { type: 'button', class: 'btn', onclick: save }, 'Сохранить'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { editingNote = null; renderDiary(); } }, 'Отмена'));
      setTimeout(() => input.focus(), 0);
    }

    return h('div', { class: 'd-item' },
      thumbFor(e),
      h('div', { class: 'q-info' },
        h('div', { class: 'q-title' }, e.title || sourceTitle(e)),
        h('div', { class: 'd-meta' },
          h('span', {}, `${fmtDuration(e.together)} вместе · ${fmtClock(e.startedAt)}`),
          ...reacts.map((k) => {
            const chip = h('span', { class: 'd-react', title: { heart: 'Сердечки', laugh: 'Смешно', fire: 'Огонь', star: 'Звёзды', cry: 'Грустно' }[k] }, smallIcon(k), String(e.reactions[k]));
            chip.style.setProperty('--c', REACT_COLORS[k]);
            return chip;
          })),
        ...notes.map(([login, text]) => h('div', { class: 'd-note' }, h('b', {}, `${isMe(login) ? 'Ты' : userName(login)}: `), text)),
        noteForm,
        editing ? null : h('div', { class: 'd-actions' },
          h('button', { type: 'button', class: 'link-btn', onclick: () => { editingNote = e.id; renderDiary(); } }, myNote ? 'Изменить свои слова' : 'Пару слов'),
          e.rewatch ? h('button', { type: 'button', class: 'link-btn', onclick: () => { if (!S.joined) join(); send({ type: 'diary_rewatch', id: e.id }); } }, 'Посмотреть ещё раз') : null,
          h('button', { type: 'button', class: 'link-btn danger', onclick: () => { if (confirm(`Убрать «${e.title || 'это видео'}» из дневника?`)) send({ type: 'diary_delete', id: e.id }); } }, 'Убрать'))));
  }

  function renderDiary() {
    renderStats();
    const list = (S.diary || []).slice().reverse(); // новые сверху
    $('diaryEmpty').hidden = list.length > 0;
    $('diaryMore').hidden = !S.diaryHasMore;
    const nodes = [];
    let lastDay = null;
    for (const e of list) {
      const day = dayLabel(e.startedAt);
      if (day !== lastDay) { nodes.push(h('div', { class: 'd-day' }, day)); lastDay = day; }
      nodes.push(diaryItem(e));
    }
    $('diaryList').replaceChildren(...nodes);
  }

  $('diaryMore').addEventListener('click', () => {
    if (S.diary.length) send({ type: 'diary_more', before: S.diary[0].id });
  });

  // ── Темы ──

  function renderThemeMenu() {
    const menu = $('themeMenu');
    if (menu.hidden || !window.KZTheme) return;
    const choice = window.KZTheme.choice();
    menu.replaceChildren(
      h('div', { class: 'cc-title' }, 'Тема — только у тебя'),
      ...window.KZTheme.list.map((t) => h('button', {
        type: 'button', class: 'cc-item', role: 'menuitemradio', 'aria-checked': String(choice === t.id),
        onclick: () => { window.KZTheme.set(t.id); renderThemeMenu(); },
      }, h('span', { class: `swatch sw-${t.id}`, 'aria-hidden': 'true' }), h('span', {}, t.name, h('span', { class: 'cc-hint' }, t.hint)))),
    );
  }
  function closeThemeMenu() { $('themeMenu').hidden = true; $('themeBtn').setAttribute('aria-expanded', 'false'); }
  $('themeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('themeMenu');
    menu.hidden = !menu.hidden;
    $('themeBtn').setAttribute('aria-expanded', String(!menu.hidden));
    renderThemeMenu();
  });
  document.addEventListener('click', (e) => { if (!$('themeMenu').hidden && !$('themeWrap').contains(e.target)) closeThemeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('themeMenu').hidden) { closeThemeMenu(); $('themeBtn').focus(); } });

  function renderOverlay() {
    const box = $('overlay');
    const inner = $('overlayInner');
    const r = S.room;
    const show = (...nodes) => { inner.replaceChildren(...nodes); box.hidden = false; };

    if (!r) return show(h('h3', {}, 'Подключаемся…'));

    const prep = r.preparing;
    if (prep) {
      if (prep.stage === 'error') {
        return show(
          h('h3', {}, 'Не получилось скачать ролик'),
          h('p', {}, prep.hint || prep.error || 'Неизвестная ошибка'),
          prep.hint ? h('p', { class: 'muted' }, prep.error) : null,
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => send({ type: 'retry' }) }, 'Попробовать ещё раз'),
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => send({ type: 'cancel_prepare' }) }, 'Закрыть')));
      }
      const fill = h('div', { class: 'bar-fill' });
      fill.style.width = `${prep.percent || 0}%`;
      return show(
        h('h3', {}, prep.stage === 'merge' ? 'Склеиваем видео и звук…' : 'Сервер качает ролик…'),
        h('p', {}, prep.title || prep.label || 'Видео'),
        h('div', { class: 'bar' }, fill),
        h('p', { class: 'muted' }, `${prep.percent || 0}% · включится у обоих само`),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => send({ type: 'cancel_prepare' }) }, 'Отменить'));
    }

    if (!r.source) {
      return show(
        h('h3', {}, 'Здесь будет ваш ролик'),
        h('p', {}, 'Вставь ссылку на YouTube или выбери файл сверху.'));
    }

    if (r.source.kind === 'local' && !(S.local && S.local.sid === r.source.sid)) {
      return show(
        h('h3', {}, `${isMe(r.source.by) ? 'Ты включил(а)' : userName(r.source.by) + ' включил(а)'} свой файл`),
        h('p', {}, `«${r.source.name}» · ${fmtSize(r.source.size)}`),
        h('p', { class: 'muted' }, 'Выбери у себя такой же файл — управление будет общим.'),
        h('button', { type: 'button', class: 'btn', onclick: () => { fileTarget = 'match'; fileInput.click(); } }, 'Выбрать файл'));
    }

    if (S.ytError) {
      const text = {
        api: 'YouTube не загрузился. Включи VPN и обнови страницу — или включи ролик в режиме «Через сервер».',
        embed: 'Автор ролика запретил показ на других сайтах. Попробуй режим «Через сервер».',
        video: 'YouTube не смог открыть этот ролик.',
        html: 'Видео не открылось. Возможно, браузер не умеет этот формат (например, некоторые .mkv) — лучше mp4.',
        direct: S.features.ytdlp
          ? 'Видео по ссылке не открылось. Это может быть страница, а не видео, ссылка могла устареть, или сайт не даёт показывать видео на других сайтах. Попробуй вставить ссылку в режиме «Через сервер».'
          : 'Видео по ссылке не открылось. Это может быть страница, а не видео, ссылка могла устареть (у многих сайтов ссылки временные), или сайт не даёт показывать видео на других сайтах.',
      }[S.ytError];
      return show(h('h3', {}, 'Не получилось включить'), h('p', {}, text));
    }

    if (!S.joined) {
      const p = partner();
      return show(
        h('button', { type: 'button', class: 'big-play', 'aria-label': 'Подключиться к просмотру', onclick: join }, svg(ICONS.bigPlay)),
        h('h3', {}, 'Подключиться к просмотру'),
        h('p', {}, p && S.online.has(p.login) ? `${p.name} уже здесь` : 'Браузер просит одно нажатие, чтобы включить звук'));
    }

    box.hidden = true;
  }

  // ───────────────────────── Запуск ─────────────────────────

  async function start() {
    setTab(store.get('kz_tab', 'yt'));
    setLibTab(store.get('kz_libtab', 'queue'));
    try {
      const r = await fetch('/api/me', { cache: 'no-store' });
      if (r.status === 401) { location.href = '/login'; return; }
      const me = await r.json();
      S.me = me.me;
      S.users = me.users;
      S.features = me.features;
    } catch {
      /* попробуем через сокет */
    }
    const p = partner();
    if (p) $('chatInput').placeholder = `Написать ${p.name}…`;
    renderModes();
    renderPresence();
    renderOverlay();
    connect();
  }

  start();
})();
