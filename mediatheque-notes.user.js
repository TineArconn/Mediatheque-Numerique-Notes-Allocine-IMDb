// ==UserScript==
// @name         Médiathèque Numérique – Notes Allociné & IMDb
// @namespace    https://vod.mediatheque-numerique.com/
// @version      1.5
// @description  Ajoute un badge avec les notes Allociné (Presse, Spectateurs) et IMDb sous chaque vignette de film.
// @match        https://vod.mediatheque-numerique.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      www.allocine.fr
// @connect      v3.sg.media-imdb.com
// @connect      www.omdbapi.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 jours
  const MAX_PARALLEL = 3;
  const CACHE_PREFIX = 'notes:v3:';
  let omdbKeyError = null; // message si la clé OMDb est refusée (401)

  // Clé OMDb (gratuite : https://www.omdbapi.com/apikey.aspx) pour la note IMDb
  const getOmdbKey = () => (GM_getValue('omdbKey') || '').trim();
  function askOmdbKey() {
    const k = prompt('Clé API OMDb (gratuite sur omdbapi.com/apikey.aspx) :', getOmdbKey());
    if (k !== null) { GM_setValue('omdbKey', k.trim()); location.reload(); }
  }
  GM_registerMenuCommand('Définir la clé OMDb (notes IMDb)', askOmdbKey);

  GM_addStyle(`
    .mn-notes {
      position: absolute; left: 0; right: 0; bottom: 0; z-index: 5;
      display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;
      padding: 4px; background: linear-gradient(transparent, rgba(0,0,0,.85));
      font: 600 12px/1.2 system-ui, sans-serif; color: #fff; pointer-events: auto;
    }
    .mn-notes span {
      padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,.6);
      white-space: nowrap; cursor: pointer;
    }
    /* Couleur selon la note (ramenée sur 5) */
    .mn-notes .mn-bad   { background: #c62828; color: #fff; }  /* < 2,5   : mauvais  */
    .mn-notes .mn-avg   { background: #ef8f00; color: #000; }  /* 2,5–3,5 : moyen    */
    .mn-notes .mn-good  { background: #7cb342; color: #000; }  /* 3,5–4,2 : correct  */
    .mn-notes .mn-great { background: #1b8a3a; color: #fff; box-shadow: 0 0 0 1px #ffd54f; } /* > 4,2 : génial */
    .mn-notes .mn-na    { opacity: .6; cursor: default; }
  `);

  // ---------- Utilitaires ----------
  function gmGet(url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url,
        headers: opts.headers,
        data: opts.data,
        timeout: 15000,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) return resolve(r.responseText);
          const err = new Error(`${r.status} ${url.replace(/apikey=[^&]*/, 'apikey=***')} ${(r.responseText || '').slice(0, 200)}`);
          err.status = r.status;
          err.body = r.responseText;
          reject(err);
        },
        onerror: () => reject(Object.assign(new Error('réseau ' + url), { transient: true })),
        ontimeout: () => reject(Object.assign(new Error('timeout ' + url), { transient: true })),
      });
    });
  }

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const yearOk = (a, b) => !a || !b || Math.abs(+a - +b) <= 1;

  // File d'attente pour limiter les requêtes simultanées
  let running = 0;
  const queue = [];
  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      running++;
      fn().then(resolve, reject).finally(() => { running--; pump(); });
    }
  }

  // ---------- Allociné ----------
  // Le réalisateur du film Allociné fait-il partie de ceux de la vignette ?
  // (ex. vignette « Steve McQueen, Steve McQueen (II) »)
  function sameDirector(movie, directors) {
    if (!directors || !directors.length) return false;
    const names = (movie.data?.director_name || []).map(norm);
    return directors.some((d) => names.some((n) => n === d || n.includes(d) || d.includes(n)));
  }

  async function allocineSearch(title, year, directors) {
    const json = JSON.parse(await gmGet('https://www.allocine.fr/_/autocomplete/' + encodeURIComponent(title)));
    const movies = (json.results || []).filter((r) => r.entity_type === 'movie');
    if (!movies.length) {
      // Titre raccourci : sans parenthèse (« Le Grand Silence (de Sergio Corbucci) »),
      // puis avant la virgule / les deux-points (« Blackthorn, la dernière chevauchée… »)
      let short = title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      if (short === title) short = title.split(/\s*[,:–-]\s+/)[0].trim();
      return short && short !== title && short.length >= 3 ? allocineSearch(short, year, directors) : null;
    }
    const t = norm(title);
    return (
      movies.find((m) => sameDirector(m, directors) && yearOk(m.data?.year, year)) ||
      movies.find((m) => norm(m.label) === t && yearOk(m.data?.year, year)) ||
      movies.find((m) => yearOk(m.data?.year, year)) ||
      movies[0]
    );
  }

  async function allocineRatings(id) {
    const url = `https://www.allocine.fr/film/fichefilm_gen_cfilm=${id}.html`;
    const doc = new DOMParser().parseFromString(await gmGet(url), 'text/html');
    const res = { url };
    doc.querySelectorAll('.rating-item').forEach((item) => {
      const label = norm(item.querySelector('.rating-title')?.textContent);
      const note = item.querySelector('.stareval-note')?.textContent.trim();
      const val = note && note !== '--' ? note : null;
      if (label === 'presse') res.press = val;
      else if (label === 'spectateurs') res.spec = val;
    });
    return res;
  }

  // ---------- IMDb ----------
  async function imdbSearch(title, year) {
    const q = norm(title).slice(0, 60);
    if (!q) return null;
    const json = JSON.parse(await gmGet(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`));
    const list = (json.d || []).filter((x) => /^tt/.test(x.id) && ['movie', 'tvMovie', 'tvMiniSeries', 'tvSeries'].includes(x.qid));
    if (!list.length) return null;
    const t = norm(title);
    return (
      list.find((x) => norm(x.l) === t && yearOk(x.y, year)) ||
      list.find((x) => yearOk(x.y, year)) ||
      null
    );
  }

  // Note IMDb via OMDb, par identifiant tt… ou, à défaut, par titre + année
  async function omdbRating({ tt, title, year }) {
    const key = getOmdbKey();
    const q = tt ? `i=${tt}` : `t=${encodeURIComponent(title)}${year ? '&y=' + year : ''}&type=movie`;
    if (omdbKeyError) throw Object.assign(new Error(omdbKeyError), { keyError: true });
    let json;
    try {
      json = JSON.parse(await gmGet(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&${q}`));
    } catch (e) {
      if (e.status === 401) {
        // OMDb répond 401 pour une clé invalide, non activée (lien de l'e-mail) ou quota dépassé
        let msg = 'clé refusée';
        try { msg = JSON.parse(e.body).Error || msg; } catch (_) { /* corps non JSON */ }
        omdbKeyError = 'OMDb : ' + msg;
        console.warn('[notes] ' + omdbKeyError + ' – vérifiez/activez la clé puis ressaisissez-la via le menu Tampermonkey.');
        throw Object.assign(new Error(omdbKeyError), { keyError: true });
      }
      throw Object.assign(e, { transient: true });
    }
    if (json.Response !== 'True') {
      const err = new Error('OMDb : ' + json.Error);
      if (/limit|api key/i.test(json.Error || '')) err.keyError = true;
      throw err;
    }
    const rating = parseFloat(json.imdbRating);
    return {
      id: json.imdbID,
      rating: isNaN(rating) ? null : rating,
      votes: parseInt((json.imdbVotes || '').replace(/\D/g, ''), 10) || null,
    };
  }

  // ---------- Récupération combinée + cache ----------
  async function fetchNotes(title, year, directors) {
    const key = CACHE_PREFIX + norm(title) + '|' + (year || '') + ((directors || []).length ? '|' + directors.join(',') : '');
    const cached = GM_getValue(key);
    if (cached && Date.now() - cached.t < CACHE_TTL) return cached.v;

    const out = {};
    try {
      const ac = await allocineSearch(title, year, directors);
      if (ac) {
        out.allocine = await allocineRatings(ac.entity_id);
        out.originalTitle = ac.original_label;
        out.year = year || ac.data?.year;
      }
    } catch (e) { console.warn('[notes] Allociné', title, e); }

    let imdbOk = true;
    try {
      // Le titre original (via Allociné) donne de meilleurs résultats sur IMDb
      let hit = null;
      try {
        hit = out.originalTitle && (await imdbSearch(out.originalTitle, out.year || year));
        if (!hit) hit = await imdbSearch(title, year);
      } catch (e) { console.warn('[notes] recherche IMDb', title, e); }

      if (!getOmdbKey()) {
        imdbOk = false; // pas de clé : on n'enregistre pas en cache pour réessayer plus tard
        if (hit) out.imdb = { id: hit.id, url: `https://www.imdb.com/title/${hit.id}/`, noKey: true };
      } else {
        const r = await omdbRating(hit ? { tt: hit.id } : { title: out.originalTitle || title, year });
        out.imdb = { url: `https://www.imdb.com/title/${r.id}/`, ...r };
      }
    } catch (e) {
      // Erreur de clé ou réseau : on n'enregistre rien en cache pour réessayer plus tard
      if (e.keyError || e.transient) {
        imdbOk = false;
        if (e.keyError) out.imdb = { keyError: e.message };
      } else {
        console.warn('[notes] IMDb', title, e.message); // ex. film absent d'OMDb
      }
    }

    if (imdbOk) GM_setValue(key, { t: Date.now(), v: out });
    return out;
  }

  // ---------- Affichage ----------
  function chip(cls, text, url, tip) {
    const s = document.createElement('span');
    s.className = cls + (url ? '' : ' mn-na');
    s.textContent = text;
    if (tip) s.title = tip;
    if (url) {
      s.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (url === 'omdb-key') askOmdbKey();
        else window.open(url, '_blank', 'noopener');
      });
    }
    return s;
  }

  // Seuils sur 5 : < 2,5 mauvais, 2,5–3,5 moyen, 3,5–4,2 correct, > 4,2 génial
  const TIERS = [
    { max: 2.5, cls: 'mn-bad', label: 'mauvais' },
    { max: 3.5, cls: 'mn-avg', label: 'moyen' },
    { max: 4.2, cls: 'mn-good', label: 'correct' },
    { max: Infinity, cls: 'mn-great', label: 'génial' },
  ];
  // score : note brute (texte "3,9" ou nombre), scale : 5 (Allociné) ou 10 (IMDb)
  function tier(score, scale) {
    const v = parseFloat(String(score ?? '').replace(',', '.'));
    if (isNaN(v)) return null;
    const on5 = (v * 5) / scale;
    return TIERS.find((t) => on5 < t.max);
  }

  function ratedChip(prefix, score, scale, url, tip) {
    const t = tier(score, scale);
    const c = chip(t ? t.cls : '', prefix + (score ?? '–'), url, tip + (t ? ' – ' + t.label : ''));
    if (!t) c.classList.add('mn-na');
    return c;
  }

  function render(badge, n) {
    badge.textContent = '';
    const a = n.allocine;
    badge.append(
      ratedChip('📰 ', a?.press, 5, a?.url, 'Allociné – Presse (/5)'),
      ratedChip('👥 ', a?.spec, 5, a?.url, 'Allociné – Spectateurs (/5)'),
      n.imdb?.noKey || !getOmdbKey()
        ? chip('', 'IMDb 🔑', 'omdb-key', 'Cliquer pour saisir une clé OMDb (gratuite) et afficher la note IMDb')
        : n.imdb?.keyError
        ? chip('', 'IMDb ⚠', 'omdb-key', n.imdb.keyError + ' – cliquer pour ressaisir la clé')
        : ratedChip('IMDb ', n.imdb?.rating, 10, n.imdb?.url,
          n.imdb?.votes ? `IMDb – ${n.imdb.votes.toLocaleString('fr-FR')} votes (/10)` : 'IMDb (/10)'),
    );
  }

  const pending = new Map(); // clé -> Promise des notes (évite les doublons)

  function cardInfo(link) {
    const aria = link.getAttribute('aria-label') || '';
    const titleEl = link.querySelector('h2, h3, [class*="__title"]');
    const title = (
      titleEl?.textContent ||
      (aria.match(/^(.*?), sorti en \d{4}/) || [])[1] ||
      (aria.match(/^Voir la fiche de (.+)$/) || [])[1] || // liste d'envies
      aria.split(',')[0]
    ).trim();
    const year = link.querySelector('[class*="yearDate"]')?.textContent.trim()
      || (aria.match(/sorti en (\d{4})/) || [])[1];
    // Liste d'envies : pas d'année, mais le réalisateur est affiché sous le titre
    const dirText = titleEl?.nextElementSibling?.tagName === 'SPAN' ? titleEl.nextElementSibling.textContent : '';
    const directors = [...new Set(dirText.split(',').map((d) => norm(d.replace(/\([^)]*\)/g, ''))).filter(Boolean))];
    return { title, year, directors };
  }

  function processCard(link) {
    const host = link.querySelector('[class*="__poster"]');
    if (!host || host.querySelector('.mn-notes')) return;
    const { title, year, directors } = cardInfo(link);
    if (!title) return;

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const badge = document.createElement('div');
    badge.className = 'mn-notes';
    badge.textContent = '…';
    host.appendChild(badge);

    const key = norm(title) + '|' + (year || '') + '|' + directors.join(',');
    if (!pending.has(key)) pending.set(key, enqueue(() => fetchNotes(title, year, directors)));
    pending.get(key)
      .then((n) => render(badge, n))
      .catch(() => { badge.textContent = '⚠'; });
  }

  // Ne charge les notes que quand la vignette approche de l'écran
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { io.unobserve(e.target); e.target.dataset.mnVisible = '1'; processCard(e.target); }
    }
  }, { rootMargin: '300px' });

  function scan() {
    document.querySelectorAll('a[href^="/films/"]').forEach((a) => {
      if (!a.querySelector('[class*="__poster"]')) return; // pas une vignette
      if (a.dataset.mnVisible) processCard(a); // ré-attache si React a re-rendu la vignette
      else if (!a.dataset.mnSeen) { a.dataset.mnSeen = '1'; io.observe(a); }
    });
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
