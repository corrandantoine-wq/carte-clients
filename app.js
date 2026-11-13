/* Carte Clients — base clients commune sur une carte, avec suivi de la position
 * en temps réel, comptes collaborateurs (Supabase), favoris personnels et
 * données HubSpot sur chaque fiche. */
(() => {
  'use strict';

  const LEGACY_KEY = 'carte-clients:v1';        // ancienne base stockée dans le téléphone
  const SETTINGS_KEY = 'carte-clients:settings';
  const MAX_LIST = 300;
  const RADII = [1, 2, 5, 10, 25, 50, 100, 0]; // 0 = tous
  const COLS = 'id,code_client,nom,adresse,code_postal,ville,telephone,email,notes,lat,lng,hubspot_id,created_by,deleted_at';

  // ---------- État ----------
  let clients = [];
  let favorites = new Set();
  const settings = Object.assign({ radius: 10, follow: true, layer: 'plan', favOnly: false }, load(SETTINGS_KEY, {}));
  if (settings.onlyRadius === false) settings.radius = 0;
  delete settings.onlyRadius;
  let user = null;          // utilisateur Supabase connecté
  let isAdmin = false;
  let me = null;            // position { lat, lng, accuracy }
  let lastListPos = null;
  let watchId = null;
  let query = '';
  let selectedId = null;
  let channel = null;

  // ---------- Utilitaires ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  const saveSettings = () => store(SETTINGS_KEY, settings);
  const cacheKey = () => `carte-clients:cache:${user?.id}`;
  const saveCache = () => store(cacheKey(), { clients, favorites: [...favorites] });
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const hasPos = c => Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const fullAddress = c => [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;
  const byId = id => clients.find(c => c.id === id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canDelete = c => isAdmin || c.created_by === user?.id;

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const distTo = c => (me && hasPos(c) ? haversine(me, c) : null);
  const inRadius = d => d != null && settings.radius > 0 && d <= settings.radius;
  function fmtDist(km) {
    if (km == null) return '—';
    return km < 1 ? `${Math.round(km * 100) * 10} m` : km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
  }
  // Estimation grossière du temps en voiture (distance à vol d'oiseau × 1,3).
  function fmtEta(km) {
    const road = km * 1.3, speed = road < 5 ? 25 : road < 30 ? 50 : 80;
    const min = Math.max(1, Math.round(road / speed * 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', '&', 'à', 'au', 'aux', 'sarl', 'sas', 'eurl', 'sa']);
  function initials(name) {
    const words = String(name || '?').split(/[\s'’\-.@_]+/).filter(w => w && !STOP.has(w.toLowerCase()));
    return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  }
  const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#b45309', '#0d9488', '#c026d3'];
  function colorFor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  const avatar = c => `<div class="avatar" style="background:${colorFor(c.nom)}">${esc(initials(c.nom))}</div>`;

  let toastTimer;
  // Notification ; action facultative : { label: 'Annuler', run: () => … }.
  function toast(msg, ms = 3000, action = null) {
    const t = $('#toast'), b = $('#toastAction');
    $('#toastMsg').textContent = msg; t.hidden = false;
    b.hidden = !action; b.textContent = action?.label || '';
    b.onclick = action ? () => { t.hidden = true; action.run(); } : null;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), action ? Math.max(ms, 6000) : ms);
  }

  const I = {
    route: '<svg viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    car: '<svg viewBox="0 0 24 24"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-6h12l2 6v4H4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    radar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    ab: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  };
  const routeUrl = c => `https://www.google.com/maps/dir/?api=1&destination=${hasPos(c) ? `${c.lat},${c.lng}` : encodeURIComponent(fullAddress(c))}`;
  const wazeUrl = c => hasPos(c) ? `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(fullAddress(c))}&navigate=yes`;
  const telUrl = c => `tel:${String(c.telephone).replace(/[^\d+]/g, '')}`;

  // ---------- Connexion à Supabase ----------
  const cfg = window.CARTE_CLIENTS_CONFIG || {};
  const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

  // Exécute une requête Supabase et affiche une erreur lisible en cas d'échec.
  async function q(promise, what) {
    const { data, error } = await promise;
    if (error) {
      console.error(what, error);
      const msg = error.code === '23505' && /code_client/.test(error.message) ? 'ce code client est déjà utilisé par un autre client' : (error.message || 'erreur réseau');
      toast(`${what} : ${msg}`, 5000);
      throw error;
    }
    return data;
  }

  // ---------- Carte & fonds ----------
  const map = L.map('map', { zoomControl: false, maxZoom: 19, minZoom: 3 }).setView([46.6, 2.4], 6);
  map.attributionControl.setPrefix(false);
  // Fonds de carte de l'IGN (Géoplateforme) : gratuits, sans clé, licence ouverte Etalab.
  // Le mode sombre du plan est obtenu par un filtre CSS.
  const ign = (layer, format, opts = {}) => L.tileLayer(
    `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM` +
    `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`,
    { maxZoom: 19, maxNativeZoom: 19, ...opts });
  const IGN_ATTR = '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> – Géoplateforme';
  const plan = ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', { className: 'tiles-plan', attribution: IGN_ATTR });
  const sat = L.layerGroup([
    ign('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', { attribution: `Photographies aériennes ${IGN_ATTR}` }),
    ign('GEOGRAPHICALNAMES.NAMES', 'image/png', { minZoom: 6, maxZoom: 15 }), // noms des villes et quartiers (masqués de près, trop chargés)
  ]);
  let baseLayer = null;
  function applyBaseLayer() {
    const next = settings.layer === 'sat' ? sat : plan;
    if (next === baseLayer) return;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = next.addTo(map);
    $('#layerBtn').classList.toggle('on', settings.layer === 'sat');
  }
  $('#layerBtn').addEventListener('click', () => {
    settings.layer = settings.layer === 'sat' ? 'plan' : 'sat'; saveSettings(); applyBaseLayer();
    toast(settings.layer === 'sat' ? 'Vue satellite' : 'Vue plan', 1200);
  });
  $('#zoomIn').addEventListener('click', () => map.zoomIn());
  $('#zoomOut').addEventListener('click', () => map.zoomOut());

  // ---------- Marqueurs ----------
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 55, spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: cl => {
      const kids = cl.getAllChildMarkers(), n = kids.length;
      const near = kids.some(m => m.options.near);
      const size = n < 10 ? 38 : n < 100 ? 44 : 52;
      return L.divIcon({ className: 'cluster-wrap', html: `<div class="cluster${near ? ' near' : ''}">${n}</div>`, iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);
  const markers = new Map(); // id -> marker

  const iconCache = new Map();
  function pinIcon(c, state, fav) {
    const key = `${initials(c.nom)}|${state}|${fav}`;
    if (!iconCache.has(key)) {
      iconCache.set(key, L.divIcon({ className: 'pin-wrap',
        html: `<div class="pin ${state}"><span>${esc(initials(c.nom))}</span>${fav ? '<i class="pin-star">★</i>' : ''}</div>`,
        iconSize: [34, 34], iconAnchor: [17, 42] }));
    }
    return iconCache.get(key);
  }
  const stateOf = c => (c.id === selectedId ? 'selected' : inRadius(distTo(c)) ? 'near' : 'far');
  const visibleOnMap = c => hasPos(c) && (!settings.favOnly || favorites.has(c.id));

  function renderMarkers() {
    cluster.clearLayers(); markers.clear();
    const layers = [];
    for (const c of clients) {
      if (!visibleOnMap(c)) continue;
      const st = stateOf(c);
      const m = L.marker([c.lat, c.lng], { icon: pinIcon(c, st, favorites.has(c.id)), title: c.nom, near: st !== 'far', riseOnHover: true });
      m.on('click', () => onPinClick(c.id));
      markers.set(c.id, m); layers.push(m);
    }
    cluster.addLayers(layers);
  }

  function updateMarkerStates() {
    let changed = false;
    for (const c of clients) {
      const m = markers.get(c.id); if (!m) continue;
      const st = stateOf(c), icon = pinIcon(c, st, favorites.has(c.id));
      m.options.near = st !== 'far';
      if (m.options.icon !== icon) { m.setIcon(icon); m.setZIndexOffset(st === 'selected' ? 2000 : st === 'near' ? 500 : 0); changed = true; }
    }
    if (changed) cluster.refreshClusters();
  }

  // Ma position : point pulsant + cône de direction + cercle de précision + rayon.
  const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: 'me-wrap', html: '<div class="me"><div class="me-cone"></div><div class="me-pulse"></div><div class="me-dot"></div></div>', iconSize: [22, 22] }), zIndexOffset: 3000, interactive: false });
  const accCircle = L.circle([0, 0], { radius: 0, stroke: false, fillColor: '#1a73ff', fillOpacity: 0.12, interactive: false });
  const radiusCircle = L.circle([0, 0], { radius: 0, color: '#2563eb', weight: 2, opacity: 0.8, dashArray: '8 8', fillColor: '#2563eb', fillOpacity: 0.07, interactive: false });

  // ---------- Bottom sheet ----------
  const root = document.documentElement, sheet = $('#sheet');
  let sheetSnap = 'half';
  function snapHeights() {
    const vh = window.innerHeight;
    return { peek: 150, half: Math.round(vh * 0.46), full: vh - 80 };
  }
  const sheetHeight = () => (isDesktop() ? 0 : sheet.getBoundingClientRect().height);
  function setSnap(snap) {
    sheetSnap = snap;
    if (isDesktop()) { root.style.removeProperty('--sheet-h'); document.body.classList.remove('sheet-full'); return; }
    root.style.setProperty('--sheet-h', snapHeights()[snap] + 'px');
    sheet.dataset.snap = snap;
    document.body.classList.toggle('sheet-full', snap === 'full');
  }
  (() => {
    let startY = 0, startH = 0, lastY = 0, lastT = 0, v = 0, dragging = false;
    const down = e => {
      if (isDesktop() || e.target.closest('button, input, a')) return;
      dragging = true; startY = lastY = e.clientY; lastT = performance.now(); startH = sheet.getBoundingClientRect().height; v = 0;
      sheet.classList.add('dragging'); document.body.classList.add('dragging');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const move = e => {
      if (!dragging) return;
      const now = performance.now(); v = (lastY - e.clientY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
      const s = snapHeights();
      root.style.setProperty('--sheet-h', Math.min(s.full, Math.max(s.peek - 40, startH + (startY - e.clientY))) + 'px');
    };
    const up = e => {
      if (!dragging) return;
      dragging = false; sheet.classList.remove('dragging'); document.body.classList.remove('dragging');
      const s = snapHeights(), h = sheet.getBoundingClientRect().height;
      if (Math.abs(startY - e.clientY) < 6) { setSnap(sheetSnap === 'half' ? 'full' : 'half'); return; } // simple tap
      let target;
      if (v > 0.5) target = h > s.half ? 'full' : 'half';
      else if (v < -0.5) target = h < s.half ? 'peek' : 'half';
      else target = Object.entries(s).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
      setSnap(target);
    };
    document.querySelectorAll('#sheetGrab, .sheet-head, .detail-top').forEach(el => {
      el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    // Faire défiler la liste → agrandir le panneau, comme dans les applis de navigation.
    $('#list').addEventListener('scroll', () => { if (!isDesktop() && sheetSnap !== 'full' && $('#list').scrollTop > 40) setSnap('full'); }, { passive: true });
  })();
  window.addEventListener('resize', () => { setSnap(sheetSnap); map.invalidateSize(); });

  // Centre la carte sur un point en tenant compte du panneau qui masque une partie de l'écran.
  function showPoint(latlng, zoom = map.getZoom(), animate = true) {
    const p = map.project(latlng, zoom);
    const off = isDesktop() ? L.point(-(392 + 16) / 2, 0) : L.point(0, sheetHeight() / 2 - 30);
    const target = map.unproject(p.add(off), zoom);
    animate ? map.flyTo(target, zoom, { duration: 0.6 }) : map.setView(target, zoom, { animate: false });
  }
  function fitVisible(bounds, maxZoom = 15) {
    const pad = isDesktop()
      ? { paddingTopLeft: [430, 90], paddingBottomRight: [80, 40] }
      : { paddingTopLeft: [30, 90], paddingBottomRight: [30, sheetHeight() + 20] };
    map.fitBounds(bounds, { ...pad, maxZoom });
  }

  // ---------- Rayon & favoris (chips) ----------
  function renderChips() {
    $('#chips').innerHTML =
      `<button class="chip fav" data-fav aria-pressed="${settings.favOnly}">${I.star}Favoris${favorites.size ? ` · ${favorites.size}` : ''}</button><span class="chip-sep"></span>` +
      RADII.map(r => `<button class="chip" role="radio" data-r="${r}" aria-checked="${settings.radius === r}">${r ? `${r} km` : 'Tous'}</button>`).join('');
  }
  function setRadius(r) {
    settings.radius = r; saveSettings(); renderChips(); updateRadiusCircle(); refresh();
    if (me && r) fitVisible(radiusCircle.getBounds()); else fitAll();
  }
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.hasAttribute('data-fav')) {
      settings.favOnly = !settings.favOnly; saveSettings(); renderChips(); renderMarkers(); renderList();
      if (settings.favOnly && !favorites.size) toast('Aucun favori : ouvrez une fiche client et touchez l’étoile.', 3500);
      return;
    }
    setRadius(+b.dataset.r);
  });
  function updateRadiusCircle() {
    if (!me || !settings.radius) { map.removeLayer(radiusCircle); return; }
    radiusCircle.setLatLng([me.lat, me.lng]).setRadius(settings.radius * 1000);
    if (!map.hasLayer(radiusCircle)) radiusCircle.addTo(map);
  }

  // ---------- Liste ----------
  function matches(c) {
    if (settings.favOnly && !favorites.has(c.id)) return false;
    if (!query) return true;
    const hay = `${c.code_client || ''} ${c.nom} ${c.adresse} ${c.code_postal} ${c.ville} ${c.telephone} ${c.email} ${c.notes}`.toLowerCase();
    return query.split(/\s+/).every(w => hay.includes(w));
  }
  const emptyState = (icon, title, text, btn = '') => `<li class="empty"><div class="em-icon">${icon}</div><strong>${title}</strong>${text}${btn}</li>`;

  function renderList() {
    const rows = [];
    let nearCount = 0;
    for (const c of clients) {
      if (!matches(c)) continue;
      const d = distTo(c), near = inRadius(d);
      if (near) nearCount++;
      if (settings.radius && me && !query && !near) continue;
      rows.push({ c, d, near });
    }
    rows.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || String(a.c.nom).localeCompare(b.c.nom, 'fr'));

    const total = clients.length, s = n => (n > 1 ? 's' : '');
    const scope = settings.favOnly ? 'favori' : 'client';
    $('#title').textContent = query ? 'Résultats' : settings.favOnly ? 'Mes favoris' : (settings.radius && me) ? 'Autour de vous' : 'Tous les clients';
    const fr = v => v.toLocaleString('fr-FR');
    $('#subtitle').textContent = query ? `${fr(rows.length)} client${s(rows.length)} trouvé${s(rows.length)}`
      : !me ? `${fr(settings.favOnly ? favorites.size : total)} ${scope}${s(settings.favOnly ? favorites.size : total)} · ${watchId == null ? 'position indisponible' : 'recherche de votre position…'}`
      : settings.radius ? `${fr(nearCount)} ${scope}${s(nearCount)} à moins de ${settings.radius} km · ${fr(settings.favOnly ? favorites.size : total)} au total`
      : `${fr(rows.length)} ${scope}${s(rows.length)} · triés par distance`;

    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = total === 0
        ? emptyState(I.users, 'La base est vide', 'Importez le fichier clients de la société (CSV), ou ajoutez un client depuis le menu.',
            '<div><button class="btn primary" data-empty="import">Importer un CSV</button> <button class="btn ghost" data-empty="sample">Exemple</button></div>')
        : query ? emptyState(I.search, 'Aucun résultat', 'Essayez un autre nom, une ville ou un code postal.')
        : settings.favOnly && !favorites.size ? emptyState(I.star, 'Aucun favori', 'Ouvrez la fiche d’un client et touchez l’étoile pour l’ajouter ici.')
        : emptyState(I.radar, `Personne à moins de ${settings.radius} km`, 'Élargissez la zone de recherche.',
            '<div><button class="btn ghost" data-empty="wider">Élargir le rayon</button></div>');
      return;
    }
    list.innerHTML = rows.slice(0, MAX_LIST).map(({ c, d, near }) => `
      <li class="item" data-id="${esc(c.id)}">
        ${avatar(c)}
        <div class="info">
          <div class="name">${esc(c.nom)}${favorites.has(c.id) ? `<span class="star" title="Favori">${I.star}</span>` : ''}${hasPos(c) ? '' : '<span class="badge">non localisé</span>'}</div>
          <div class="addr">${esc(fullAddress(c) || c.telephone || '')}</div>
        </div>
        <div class="meta">
          <span class="dist${near ? ' near' : ''}">${fmtDist(d)}</span>
          <div class="quick">
            ${c.telephone ? `<a href="${esc(telUrl(c))}" aria-label="Appeler">${I.phone}</a>` : ''}
            <a href="${esc(routeUrl(c))}" target="_blank" rel="noopener" aria-label="Itinéraire">${I.route}</a>
          </div>
        </div>
      </li>`).join('') + (rows.length > MAX_LIST ? `<li class="empty">… et ${rows.length - MAX_LIST} autres. Affinez la recherche.</li>` : '');
  }

  $('#list').addEventListener('click', e => {
    if (e.target.closest('a')) return; // appel / itinéraire
    const em = e.target.closest('[data-empty]')?.dataset.empty;
    if (em === 'import') return $('#csvInput').click();
    if (em === 'sample') return loadSample();
    if (em === 'wider') return setRadius(RADII[Math.min(RADII.indexOf(settings.radius) + 1, RADII.length - 1)]);
    const li = e.target.closest('li[data-id]'); if (li) select(li.dataset.id);
  });

  function refresh() { renderList(); updateMarkerStates(); if (selectedId) renderDetail(); }
  let renderTimer;
  function scheduleFullRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderMarkers(); renderChips(); refresh(); saveCache(); }, 250);
  }

  // ---------- Fiche client ----------
  let detailFor = null;
  function renderDetail() {
    const c = byId(selectedId); if (!c) return closeDetail();
    // La fiche est redessinée quand la position change : on garde l'historique ouvert s'il l'était.
    const keepHist = detailFor === c.id && $('#hist')?.open ? $('#histBody').innerHTML : null;
    detailFor = c.id;
    const d = distTo(c);
    const fav = favorites.has(c.id);
    $('#favBtn').setAttribute('aria-pressed', fav);
    $('#favBtn').setAttribute('aria-label', fav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    const row = (icon, label, val, href) => !val ? '' : href
      ? `<a class="d-row" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${icon}<div><div class="lbl">${label}</div><div class="val">${esc(val)}</div></div></a>`
      : `<div class="d-row">${icon}<div><div class="lbl">${label}</div><div class="val">${esc(val)}</div></div></div>`;
    $('#detail').innerHTML = `
      <div class="d-head">${avatar(c)}<div><h2>${esc(c.nom)}</h2><div class="sub">${esc([c.code_postal, c.ville].filter(Boolean).join(' ') || 'Client')}</div></div></div>
      ${d != null ? `<div class="d-eta"><span class="big${inRadius(d) ? '' : ' far'}">${fmtDist(d)}</span><span class="muted">≈ ${fmtEta(d)} en voiture (estimation)</span></div>`
        : hasPos(c) ? '' : `<div class="d-eta"><span class="muted">Ce client n'est pas encore localisé sur la carte.</span></div>`}
      <div class="d-actions">
        <a class="act primary" href="${esc(routeUrl(c))}" target="_blank" rel="noopener">${I.route}Itinéraire</a>
        <a class="act${c.telephone ? '' : ' disabled'}" href="${c.telephone ? esc(telUrl(c)) : '#'}">${I.phone}Appeler</a>
        <button class="act${hasPos(c) ? '' : ' disabled'}" data-act="route">${I.ab}Trajet</button>
        <a class="act" href="${esc(wazeUrl(c))}" target="_blank" rel="noopener">${I.car}Waze</a>
        <a class="act${c.email ? '' : ' disabled'}" href="${c.email ? `mailto:${esc(c.email)}` : '#'}">${I.mail}E-mail</a>
      </div>
      <div class="d-rows">
        ${row(I.pin, 'Adresse', fullAddress(c), fullAddress(c) ? routeUrl(c) : null)}
        ${row(I.phone, 'Téléphone', c.telephone, c.telephone ? telUrl(c) : null)}
        ${row(I.mail, 'E-mail', c.email, c.email ? `mailto:${c.email}` : null)}
        ${row(I.note, 'Notes', c.notes)}
        ${row(I.users, 'Code client', c.code_client)}
      </div>
      <div id="crm" class="crm">${crmHtml(c)}</div>
      <details class="hist" id="hist"><summary>${I.note}Historique des modifications</summary><div class="hist-body" id="histBody"></div></details>
      <div class="d-foot">
        <button class="btn ghost" data-act="edit">${I.edit}Modifier</button>
        ${canDelete(c) ? `<button class="btn danger" data-act="delete">${I.trash}Supprimer</button>` : ''}
      </div>`;
    if (keepHist != null) { $('#hist').open = true; $('#histBody').innerHTML = keepHist; }
    if (c.hubspot_id) loadCrm(c);
  }

  function select(id) {
    const c = byId(id); if (!c) return;
    selectedId = id;
    $('#listView').hidden = true; $('#detailView').hidden = false; $('#detail').scrollTop = 0;
    renderDetail(); updateMarkerStates();
    if (!isDesktop() && sheetSnap !== 'half') setSnap('half');
    if (hasPos(c)) {
      setFollow(false);
      const m = markers.get(id);
      const go = () => showPoint([c.lat, c.lng], Math.max(map.getZoom(), 15));
      if (m && cluster.getVisibleParent(m) !== m) cluster.zoomToShowLayer(m, go);
      else setTimeout(go, 60);
    }
  }
  function closeDetail() {
    selectedId = null;
    $('#detailView').hidden = true; $('#listView').hidden = false;
    updateMarkerStates();
  }
  $('#backBtn').addEventListener('click', closeDetail);
  $('#closeBtn').addEventListener('click', () => { closeDetail(); if (!isDesktop()) setSnap('peek'); });
  map.on('click', () => { if (selectedId && !inRoute()) closeDetail(); });

  $('#detail').addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const c = byId(selectedId); if (!act || !c) return;
    if (act === 'edit') openForm(c);
    if (act === 'delete' && confirm(`Mettre « ${c.nom} » à la corbeille ?\nIl disparaîtra pour tous les collaborateurs (restauration possible depuis la corbeille).`)) {
      try { await trashClient(c); } catch {}
    }
    if (act === 'route') openRoute({ id: c.id });
    if (act === 'hs-link') openHubspotLink(c);
    if (act === 'hs-unlink' && confirm('Retirer le lien avec la fiche HubSpot ?')) {
      await updateClient(c.id, { hubspot_id: null }); renderDetail();
    }
    if (act === 'hs-retry') { crmCache.delete(c.hubspot_id); renderDetail(); }
  });

  // ---------- Favoris ----------
  $('#favBtn').addEventListener('click', async () => {
    const c = byId(selectedId); if (!c) return;
    const on = !favorites.has(c.id);
    on ? favorites.add(c.id) : favorites.delete(c.id); // affichage immédiat
    const redraw = () => { renderDetail(); renderChips(); settings.favOnly ? renderMarkers() : updateMarkerStates(); renderList(); };
    redraw();
    try {
      if (on) await q(sb.from('favorites').insert({ client_id: c.id }), 'Favori non enregistré');
      else await q(sb.from('favorites').delete().eq('client_id', c.id), 'Favori non retiré');
      toast(on ? 'Ajouté à vos favoris' : 'Retiré de vos favoris', 1400);
      saveCache();
    } catch {
      on ? favorites.delete(c.id) : favorites.add(c.id);
      redraw();
    }
  });

  // ---------- HubSpot ----------
  const crmCache = new Map(); // hubspot_id -> { at, data } | { at, error } | { loading }
  async function hubspot(action, payload = {}) {
    const { data, error } = await sb.functions.invoke('hubspot', { body: { action, ...payload } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function crmHtml(c) {
    const head = (extra = '') => `<div class="crm-head"><span class="hs-logo">H</span>Données HubSpot${extra}</div>`;
    if (!c.hubspot_id) {
      return head() + `<div class="crm-empty">Ce client n’est pas encore relié à une fiche HubSpot.</div>
        <div class="crm-foot" style="justify-content:flex-start"><button class="btn ghost" data-act="hs-link">${I.link}Lier à HubSpot</button></div>`;
    }
    const st = crmCache.get(c.hubspot_id);
    if (!st || st.loading) return head() + '<div class="crm-body"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:50%"></div></div>';
    if (st.error) return head() + `<div class="crm-empty">Impossible de charger les données HubSpot : ${esc(st.error)}</div>
      <div class="crm-foot"><button data-act="hs-retry">Réessayer</button>&nbsp;&nbsp;<button data-act="hs-unlink">Délier</button></div>`;
    const d = st.data;
    const rows = d.fields.map(f => `<div class="crm-row"><span class="k">${esc(f.label)}</span><span class="v">${esc(f.value || '—')}</span></div>`).join('');
    return head(`<a href="${esc(d.url)}" target="_blank" rel="noopener">Ouvrir ↗</a>`) +
      `<div class="crm-body">${rows || '<div class="crm-empty">Aucun champ configuré (menu → Champs HubSpot affichés).</div>'}</div>
       <div class="crm-foot"><button data-act="hs-link">Changer</button>&nbsp;&nbsp;<button data-act="hs-unlink">Délier</button></div>`;
  }
  async function loadCrm(c) {
    const id = c.hubspot_id, st = crmCache.get(id);
    if (st && (st.loading || Date.now() - st.at < 5 * 60_000)) return;
    crmCache.set(id, { loading: true });
    try { crmCache.set(id, { at: Date.now(), data: await hubspot('get', { id }) }); }
    catch (e) { crmCache.set(id, { at: Date.now(), error: e.message }); }
    if (selectedId === c.id && byId(c.id)?.hubspot_id === id) $('#crm').innerHTML = crmHtml(byId(c.id));
  }

  const hsDlg = $('#hsDialog');
  let hsTarget = null, hsTimer;
  function openHubspotLink(c) {
    hsTarget = c.id;
    $('#hsSearch').value = c.nom;
    $('#hsResults').innerHTML = '';
    hsDlg.showModal();
    searchHubspot();
  }
  async function searchHubspot() {
    const term = $('#hsSearch').value.trim(), list = $('#hsResults');
    if (term.length < 2) { list.innerHTML = '<li class="muted">Tapez au moins 2 lettres.</li>'; return; }
    list.innerHTML = '<li class="muted">Recherche dans HubSpot…</li>';
    try {
      const { results } = await hubspot('search', { q: term });
      if ($('#hsSearch').value.trim() !== term) return;
      list.innerHTML = results.length
        ? results.map(r => `<li class="click" data-hs="${esc(r.id)}"><div class="grow"><div class="t">${esc(r.name || '(sans nom)')}</div><div class="s">${esc(r.detail)}</div></div>${I.link}</li>`).join('')
        : '<li class="muted">Aucune fiche trouvée.</li>';
    } catch (e) { list.innerHTML = `<li class="muted">${esc(e.message)}</li>`; }
  }
  $('#hsSearch').addEventListener('input', () => { clearTimeout(hsTimer); hsTimer = setTimeout(searchHubspot, 350); });
  $('#hsResults').addEventListener('click', async e => {
    const li = e.target.closest('[data-hs]'); if (!li || !hsTarget) return;
    await updateClient(hsTarget, { hubspot_id: li.dataset.hs });
    hsDlg.close(); toast('Client relié à HubSpot');
    if (selectedId === hsTarget) renderDetail();
  });

  // ---------- Corbeille ----------
  async function trashClient(c) {
    await q(sb.from('clients').update({ deleted_at: new Date().toISOString() }).eq('id', c.id).select('id'), 'Suppression impossible');
    clients = clients.filter(x => x.id !== c.id);
    if (selectedId === c.id) closeDetail();
    scheduleFullRender();
    toast(`« ${c.nom} » mis à la corbeille`, 6000, { label: 'Annuler', run: () => restoreClient(c.id) });
  }
  async function restoreClient(id) {
    try {
      const row = await q(sb.from('clients').update({ deleted_at: null }).eq('id', id).select(COLS).single(), 'Restauration impossible');
      const c = clean(row);
      const i = clients.findIndex(x => x.id === id); i >= 0 ? (clients[i] = c) : clients.push(c);
      scheduleFullRender(); toast(`« ${c.nom} » restauré`);
      return c;
    } catch { return null; }
  }
  const trashDlg = $('#trashDialog');
  const fmtWhen = iso => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  async function openTrash() {
    trashDlg.showModal();
    trashDlg.querySelector('.admin-hint').hidden = !isAdmin;
    const list = $('#trashList');
    list.innerHTML = '<li class="muted">Chargement…</li>';
    try {
      const rows = await q(sb.from('clients').select(COLS + ',deleted_by').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500), 'Chargement de la corbeille');
      $('#trashEmpty').hidden = !isAdmin || !rows.length;
      list.innerHTML = rows.length ? rows.map(c => `
        <li data-id="${esc(c.id)}">${avatar(c)}
          <div class="grow"><div class="t">${esc(c.nom)}</div>
            <div class="s">${esc([c.ville, c.code_client].filter(Boolean).join(' · '))}${c.ville || c.code_client ? ' · ' : ''}supprimé le ${fmtWhen(c.deleted_at)}${c.deleted_by === user.id ? ' par vous' : ''}</div></div>
          <div class="trash-actions"><button class="btn ghost" data-restore>Restaurer</button>${isAdmin ? `<button class="icon-del" data-purge aria-label="Supprimer définitivement">${I.trash}</button>` : ''}</div>
        </li>`).join('') : '<li class="muted">La corbeille est vide.</li>';
    } catch { list.innerHTML = '<li class="muted">Impossible de charger la corbeille.</li>'; }
  }
  $('#trashList').addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    if (e.target.closest('[data-restore]')) { if (await restoreClient(li.dataset.id)) li.remove(); }
    if (e.target.closest('[data-purge]') && confirm('Supprimer définitivement ce client ? Cette action est irréversible.')) {
      try { await q(sb.from('clients').delete().eq('id', li.dataset.id), 'Suppression impossible'); li.remove(); toast('Client supprimé définitivement'); } catch {}
    }
    if (!$('#trashList li[data-id]')) openTrash();
  });
  $('#trashEmpty').addEventListener('click', async () => {
    if (prompt('Supprimer DÉFINITIVEMENT tous les clients de la corbeille ?\nTapez SUPPRIMER pour confirmer.') !== 'SUPPRIMER') return;
    try { await q(sb.from('clients').delete().not('deleted_at', 'is', null), 'Suppression impossible'); toast('Corbeille vidée'); openTrash(); } catch {}
  });

  // ---------- Historique d'un client ----------
  const FIELD_LABELS = { nom: 'Nom', code_client: 'Code client', adresse: 'Adresse', code_postal: 'Code postal', ville: 'Ville', telephone: 'Téléphone', email: 'E-mail', notes: 'Notes', hubspot_id: 'Lien HubSpot' };
  const ACTION_LABELS = { 'création': 'Création', 'modification': 'Modification', 'suppression': 'Mise à la corbeille', 'restauration': 'Restauration', 'suppression définitive': 'Suppression définitive' };
  const showVal = v => (v == null || v === '' ? 'vide' : `« ${esc(v)} »`);
  async function loadHistory(id) {
    const body = $('#histBody'); if (!body) return;
    body.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:60%"></div>';
    try {
      const rows = await q(sb.from('client_history').select('action,changes,user_email,at').eq('client_id', id).order('at', { ascending: false }).limit(30), 'Chargement de l’historique');
      if (selectedId !== id) return;
      body.innerHTML = rows.length ? rows.map(h => `
        <div class="hist-item">
          <div><span class="hist-act ${esc(h.action)}">${ACTION_LABELS[h.action] || esc(h.action)}</span></div>
          <div class="hist-meta">${fmtWhen(h.at)} · ${h.user_email ? (h.user_email === user.email ? 'vous' : esc(h.user_email)) : 'import / système'}</div>
          ${Object.keys(h.changes || {}).length ? `<ul class="hist-chg">${Object.entries(h.changes).map(([k, [a, b]]) =>
            `<li>${FIELD_LABELS[k] || esc(k)} : <del>${showVal(a)}</del> → <ins>${showVal(b)}</ins></li>`).join('')}</ul>` : ''}
        </div>`).join('') : '<div class="crm-empty">Aucune modification enregistrée.</div>';
    } catch { body.innerHTML = '<div class="crm-empty">Historique indisponible.</div>'; }
  }
  $('#detail').addEventListener('toggle', e => { if (e.target.id === 'hist' && e.target.open) loadHistory(selectedId); }, true);

  // ---------- Trajet A → B (temps de route) ----------
  // Service d'itinéraire de l'IGN (gratuit, sans clé, couvre la France). Temps estimé hors trafic.
  const ROUTE_API = 'https://data.geopf.fr/navigation/itineraire';
  const route = { A: null, B: null, active: 'A', layer: L.layerGroup(), cache: new Map(), returnTo: null, seq: 0 };
  const routeView = $('#routeView');
  const inRoute = () => !routeView.hidden;

  // Un point du trajet : un client ({ id }) ou ma position ({ me: true }).
  const pointPos = pt => pt?.me ? (me ? { lat: me.lat, lng: me.lng } : null) : (pt && byId(pt.id) && hasPos(byId(pt.id)) ? byId(pt.id) : null);
  const pointLabel = pt => pt?.me ? 'Ma position' : (byId(pt?.id)?.nom || '');

  function fmtDuration(min) {
    min = Math.max(1, Math.round(min));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }

  function openRoute(from = null) {
    route.returnTo = selectedId;
    if (selectedId) { selectedId = null; updateMarkerStates(); }
    $('#listView').hidden = true; $('#detailView').hidden = true; routeView.hidden = false;
    if (from) route.A = from;
    if (!isDesktop() && sheetSnap === 'peek') setSnap('half');
    syncRouteInputs();
    const target = !route.A ? 'A' : !route.B ? 'B' : null;
    if (target) { route.active = target; $(`#r${target}`).focus(); renderSuggest(); }
    else computeRoute();
  }
  function closeRoute() {
    route.layer.remove();
    routeView.hidden = true;
    $('#rSuggest').innerHTML = '';
    const back = route.returnTo; route.returnTo = null;
    if (back && byId(back)) select(back); else { $('#listView').hidden = false; }
  }
  $('#routeBtn').addEventListener('click', () => openRoute());
  $('#routeBack').addEventListener('click', closeRoute);

  function syncRouteInputs() {
    for (const k of ['A', 'B']) {
      const inp = $(`#r${k}`);
      inp.value = pointLabel(route[k]);
      inp.classList.toggle('filled', !!route[k]);
      routeView.querySelector(`[data-clear="${k}"]`).hidden = !route[k];
    }
  }

  // Suggestions : « Ma position », puis les clients qui correspondent (les plus proches d'abord).
  function renderSuggest() {
    const k = route.active, text = norm($(`#r${k}`).value);
    const filled = route[k] && $(`#r${k}`).value === pointLabel(route[k]);
    const words = filled ? [] : text.split(' ').filter(Boolean);
    const other = route[k === 'A' ? 'B' : 'A'];
    let list = clients.filter(c => c.id !== other?.id);
    if (words.length) list = list.filter(c => { const h = norm(`${c.nom} ${c.ville} ${c.code_postal} ${c.code_client || ''} ${c.adresse}`); return words.every(w => h.includes(w)); });
    else list = list.filter(c => favorites.has(c.id) || hasPos(c));
    list = list.map(c => ({ c, d: distTo(c) }))
      .sort((a, b) => (favorites.has(b.c.id) - favorites.has(a.c.id)) * (words.length ? 0 : 1) || (a.d ?? Infinity) - (b.d ?? Infinity))
      .slice(0, 8);
    const meItem = !other?.me && (!words.length || 'ma position'.includes(text))
      ? `<li data-pick="me"><span class="me-ico">${I.route}</span><div class="grow"><div class="t">Ma position</div><div class="s">${me ? 'Position GPS actuelle' : 'En attente du GPS…'}</div></div></li>` : '';
    $('#rSuggest').innerHTML = meItem + list.map(({ c, d }) => `
      <li data-pick="${esc(c.id)}">${avatar(c)}<div class="grow"><div class="t">${esc(c.nom)}${favorites.has(c.id) ? `<span class="star">${I.star}</span>` : ''}</div>
        <div class="s">${esc([c.ville, c.code_client].filter(Boolean).join(' · ') || fullAddress(c))}${hasPos(c) ? '' : ' · non localisé'}</div></div>
        <span class="d">${fmtDist(d)}</span></li>`).join('') ||
      (words.length ? '<li class="muted">Aucun client trouvé.</li>' : '');
    $('#rHint').hidden = false;
    $('#rResult').hidden = true;
  }

  function pickRoute(pt) {
    const k = route.active;
    if (pt.id && !hasPos(byId(pt.id))) return toast('Ce client n’est pas localisé : corrigez son adresse d’abord.', 3500);
    route[k] = pt;
    syncRouteInputs();
    $('#rSuggest').innerHTML = '';
    const other = k === 'A' ? 'B' : 'A';
    if (!route[other]) { route.active = other; $(`#r${other}`).focus(); renderSuggest(); }
    else { document.activeElement?.blur(); computeRoute(); }
  }

  $('#rSuggest').addEventListener('pointerdown', e => e.preventDefault()); // garder le clavier ouvert
  $('#rSuggest').addEventListener('click', e => {
    const li = e.target.closest('[data-pick]'); if (!li) return;
    pickRoute(li.dataset.pick === 'me' ? { me: true } : { id: li.dataset.pick });
  });
  for (const k of ['A', 'B']) {
    const inp = $(`#r${k}`);
    inp.addEventListener('focus', () => { route.active = k; inp.select(); renderSuggest(); });
    inp.addEventListener('input', () => { route.active = k; renderSuggest(); });
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      $('#rSuggest [data-pick]')?.click();
    });
  }
  routeView.addEventListener('click', e => {
    const k = e.target.closest('[data-clear]')?.dataset.clear; if (!k) return;
    e.preventDefault();
    route[k] = null; route.layer.clearLayers(); syncRouteInputs();
    route.active = k; $(`#r${k}`).focus(); renderSuggest();
  });
  $('#rSwap').addEventListener('click', () => {
    [route.A, route.B] = [route.B, route.A]; syncRouteInputs();
    if (route.A && route.B) computeRoute(); else renderSuggest();
  });

  // Toucher un client sur la carte pendant le choix du trajet remplit le champ actif.
  function onPinClick(id) {
    if (!inRoute()) return select(id);
    if (route.A && route.B) route.active = 'B';
    pickRoute({ id });
  }

  function drawRoute(geojson, a, b) {
    route.layer.clearLayers();
    const coords = geojson.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(coords, { color: '#ffffff', weight: 10, opacity: 0.9, interactive: false }).addTo(route.layer);
    L.polyline(coords, { color: '#2563eb', weight: 6, opacity: 0.95, interactive: false }).addTo(route.layer);
    const pin = cls => L.divIcon({ className: '', html: `<div class="route-pin ${cls}">${cls.toUpperCase()}</div>`, iconSize: [30, 30] });
    L.marker([a.lat, a.lng], { icon: pin('a'), zIndexOffset: 4000, interactive: false }).addTo(route.layer);
    L.marker([b.lat, b.lng], { icon: pin('b'), zIndexOffset: 4000, interactive: false }).addTo(route.layer);
    route.layer.addTo(map);
    setFollow(false);
    fitVisible(L.latLngBounds(coords), 16);
  }

  async function computeRoute() {
    const a = pointPos(route.A), b = pointPos(route.B);
    $('#rSuggest').innerHTML = ''; $('#rHint').hidden = true;
    const out = $('#rResult'); out.hidden = false;
    if (!a || !b) { out.innerHTML = `<div class="r-warn">${route.A?.me || route.B?.me ? 'Votre position n’est pas encore disponible.' : 'Choisissez un départ et une arrivée.'}</div>`; return; }
    if (haversine(a, b) < 0.02) { out.innerHTML = '<div class="r-warn">Le départ et l’arrivée sont au même endroit.</div>'; return; }
    const seq = ++route.seq;
    out.innerHTML = '<div class="r-card r-loading"><div class="skeleton" style="width:40%;height:28px"></div><div class="skeleton" style="width:70%"></div></div>';
    const key = [a.lat, a.lng, b.lat, b.lng].map(v => v.toFixed(5)).join(',');
    let res = route.cache.get(key);
    try {
      if (!res) {
        const url = `${ROUTE_API}?resource=bdtopo-osrm&profile=car&optimization=fastest&start=${a.lng},${a.lat}&end=${b.lng},${b.lat}` +
          '&geometryFormat=geojson&getSteps=false&timeUnit=minute&distanceUnit=kilometer';
        const r = await fetch(url);
        if (!r.ok) throw new Error(`service indisponible (${r.status})`);
        res = await r.json();
        if (!Number.isFinite(res.duration) || !res.geometry?.coordinates?.length) throw new Error('aucun itinéraire trouvé');
        route.cache.set(key, res);
      }
    } catch (e) {
      if (seq !== route.seq) return;
      const d = haversine(a, b);
      out.innerHTML = `<div class="r-card"><div class="r-main"><span class="r-time" style="color:var(--ink)">≈ ${fmtEta(d)}</span><span class="r-dist">${fmtDist(d * 1.3)}</span></div>
        <div class="r-warn">Calcul d’itinéraire impossible (${esc(e.message)}). Estimation à partir de la distance à vol d’oiseau.</div></div>`;
      return;
    }
    if (seq !== route.seq) return; // un autre calcul a été lancé entre-temps
    // Le service ne couvre que la France : un départ/arrivée « recalé » loin du point demandé signale un trajet hors de France.
    const snap = s => { const [lng, lat] = String(s).split(',').map(Number); return { lat, lng }; };
    const offRoad = Math.max(haversine(a, snap(res.start)), haversine(b, snap(res.end)));
    const arrival = new Date(Date.now() + res.duration * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
    out.innerHTML = `<div class="r-card">
      <div class="r-main"><span class="r-time">${fmtDuration(res.duration)}</span><span class="r-dist">${fmtDist(res.distance)}</span></div>
      <div class="r-sub">${esc(pointLabel(route.A))} → ${esc(pointLabel(route.B))}<br>Arrivée vers <b>${arrival}</b> en partant maintenant</div>
      ${offRoad > 3 ? '<div class="r-warn">Une partie du trajet est hors de France : le temps affiché est incomplet.</div>' : ''}
      <div class="r-note">Temps estimé hors trafic (itinéraire IGN, le plus rapide en voiture).</div>
      <div class="r-actions"><a class="btn primary" href="${gmaps}" target="_blank" rel="noopener">${I.route}Ouvrir dans Google Maps</a></div>
    </div>`;
    drawRoute(res.geometry, a, b);
  }

  // ---------- Géolocalisation temps réel ----------
  function onPosition(pos) {
    const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
    const first = !me;
    me = { lat, lng, accuracy };
    meMarker.setLatLng([lat, lng]); accCircle.setLatLng([lat, lng]).setRadius(accuracy);
    if (first) { meMarker.addTo(map); accCircle.addTo(map); }
    updateRadiusCircle();

    const el = meMarker.getElement()?.querySelector('.me');
    if (el) {
      const moving = Number.isFinite(heading) && (speed ?? 0) > 0.5;
      el.classList.toggle('has-heading', moving);
      if (moving) el.querySelector('.me-cone').style.transform = `rotate(${heading}deg)`;
    }
    $('#gpsDot').className = 'gps-dot live';
    $('#gpsDot').title = `GPS actif · précision ±${Math.round(accuracy)} m`;

    if (first && !selectedId) settings.radius ? fitVisible(radiusCircle.getBounds()) : fitAll();
    else if (settings.follow && !selectedId) showPoint([lat, lng], map.getZoom());

    if (!lastListPos || haversine(lastListPos, me) > 0.015) { lastListPos = { ...me }; refresh(); }
  }

  function onPositionError(err) {
    const msg = { 1: 'Localisation refusée : autorisez-la dans les réglages du navigateur.', 2: 'Position indisponible.', 3: 'La localisation met trop de temps.' }[err.code] || err.message;
    $('#gpsDot').className = 'gps-dot error'; $('#gpsDot').title = msg;
    if (err.code === 1) { toast(msg, 5000); stopWatch(); renderList(); }
  }

  function startWatch() {
    if (!user) return;
    if (!('geolocation' in navigator)) { toast('Géolocalisation non disponible sur cet appareil.'); return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }

  function setFollow(on) {
    settings.follow = on; saveSettings();
    $('#locateBtn').classList.toggle('active', on);
  }
  $('#locateBtn').addEventListener('click', () => {
    startWatch();
    if (!me) { toast('Recherche de votre position…'); setFollow(true); return; }
    if (settings.follow) { setFollow(false); return; }
    setFollow(true); showPoint([me.lat, me.lng], Math.max(map.getZoom(), 14));
  });
  map.on('dragstart', () => { if (settings.follow) setFollow(false); });

  // Économie de batterie : GPS coupé quand l'appli est en arrière-plan.
  document.addEventListener('visibilitychange', () => { document.hidden ? stopWatch() : startWatch(); });

  // ---------- Données (Supabase) ----------
  const clean = c => ({ ...c, lat: num(c.lat), lng: num(c.lng) });

  async function loadData() {
    const cached = load(cacheKey(), null);
    if (cached) {
      clients = cached.clients || []; favorites = new Set(cached.favorites || []);
      renderMarkers(); renderChips(); renderList();
    }
    try {
      const all = [];
      for (let from = 0; ; from += 1000) { // pagination (1000 lignes max par requête)
        const page = await q(sb.from('clients').select(COLS).is('deleted_at', null).order('nom').range(from, from + 999), 'Chargement des clients');
        all.push(...page);
        if (page.length < 1000) break;
      }
      const favs = await q(sb.from('favorites').select('client_id'), 'Chargement des favoris');
      clients = all.map(clean);
      favorites = new Set(favs.map(f => f.client_id));
      saveCache();
      renderMarkers(); renderChips(); refresh();
      if (!cached) fitAll();
    } catch { if (cached) toast('Hors ligne : affichage de la dernière copie enregistrée.', 4000); }
    offerLegacyImport();
  }

  // Temps réel : les ajouts / modifications des collègues apparaissent sans recharger.
  function subscribe() {
    channel?.unsubscribe();
    channel = sb.channel('clients-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, ({ eventType, new: row, old }) => {
        if (eventType === 'DELETE' || row?.deleted_at) { // supprimé ou mis à la corbeille
          const id = eventType === 'DELETE' ? old.id : row.id;
          clients = clients.filter(c => c.id !== id); if (selectedId === id) closeDetail();
        } else {
          const i = clients.findIndex(c => c.id === row.id);
          i >= 0 ? (clients[i] = clean(row)) : clients.push(clean(row));
        }
        scheduleFullRender();
      })
      .subscribe();
  }

  async function updateClient(id, patch) {
    const row = await q(sb.from('clients').update(patch).eq('id', id).select(COLS).single(), 'Modification impossible');
    const i = clients.findIndex(c => c.id === id);
    if (i >= 0) clients[i] = clean(row);
    saveCache();
    return clients[i];
  }

  async function insertClients(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i += 500) {
      const res = await q(sb.from('clients').insert(rows.slice(i, i + 500)).select(COLS), 'Enregistrement impossible');
      out.push(...res.map(clean));
    }
    for (const c of out) if (!byId(c.id)) clients.push(c);
    saveCache();
    return out;
  }

  // Ancienne version : les clients étaient stockés dans le téléphone → proposer de les verser dans la base commune.
  async function offerLegacyImport() {
    const legacy = load(LEGACY_KEY, null);
    if (!Array.isArray(legacy) || !legacy.length) return;
    const ok = confirm(`${legacy.length} client(s) sont enregistrés sur cet appareil (ancienne version de l’appli).\n\nLes ajouter à la base commune ?`);
    if (!ok) { localStorage.setItem(LEGACY_KEY + ':backup', localStorage.getItem(LEGACY_KEY)); localStorage.removeItem(LEGACY_KEY); return; }
    try {
      const added = await insertClients(legacy.map(c => toRow(c)));
      localStorage.setItem(LEGACY_KEY + ':backup', localStorage.getItem(LEGACY_KEY));
      localStorage.removeItem(LEGACY_KEY);
      scheduleFullRender(); toast(`${added.length} clients ajoutés à la base commune.`, 4000);
    } catch {}
  }

  const toRow = c => ({
    code_client: String(c.code_client ?? '').trim() || null,
    nom: c.nom, adresse: c.adresse || '', code_postal: c.code_postal || '', ville: c.ville || '',
    telephone: c.telephone || '', email: c.email || '', notes: c.notes || '',
    lat: num(c.lat), lng: num(c.lng),
  });

  // ---------- Géocodage ----------
  // Service public de géocodage (IGN / Base Adresse Nationale) : https://data.geopf.fr/geocodage
  const GEO = 'https://data.geopf.fr/geocodage';
  const MIN_SCORE = 0.5;
  // Le résultat est-il cohérent avec le code postal fourni (même département) ?
  const sameDept = (cp, found) => !cp || !found || String(cp).slice(0, 2) === String(found).slice(0, 2);

  async function geocode(address, cp = '') {
    if (!address) return null;
    try {
      const r = await fetch(`${GEO}/search?q=${encodeURIComponent(address)}&limit=1`);
      if (r.ok) {
        const f = (await r.json()).features?.[0];
        if (f && f.properties.score >= MIN_SCORE && sameDept(cp, f.properties.postcode)) return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      }
    } catch {}
    try { // Repli international : Nominatim (OpenStreetMap), 1 requête/seconde max
      await sleep(1100);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { 'Accept-Language': 'fr' } });
      if (r.ok) { const j = await r.json(); if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon }; }
    } catch {}
    return null;
  }

  // Géocodage par lot : jusqu'à 5 000 adresses par envoi (le service accepte 200 000 lignes / 50 Mo).
  async function geocodeBatch(list, onProgress = () => {}, mainLineOnly = false) {
    const found = new Map();
    const CHUNK = 5000;
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      const line = a => (mainLineOnly ? String(a || '').split(',')[0] : a || '');
      const csv = Papa.unparse(part.map(c => ({ id: c.id, adresse: line(c.adresse), code_postal: c.code_postal || '', ville: c.ville || '' })));
      const fd = new FormData();
      fd.append('data', new Blob([csv], { type: 'text/csv' }), 'adresses.csv');
      for (const col of ['adresse', 'code_postal', 'ville']) fd.append('columns', col);
      fd.append('postcode', 'code_postal');
      let text = '';
      for (let attempt = 0; attempt < 3 && !text; attempt++) {
        try { const r = await fetch(`${GEO}/search/csv`, { method: 'POST', body: fd }); if (r.ok) text = await r.text(); else await sleep(1500); }
        catch { await sleep(1500); }
      }
      if (text) {
        for (const r of Papa.parse(text, { header: true, skipEmptyLines: true }).data) {
          const lat = num(r.latitude), lng = num(r.longitude), score = num(r.result_score);
          if (lat != null && lng != null && score >= MIN_SCORE && sameDept(r.code_postal, r.result_postcode)) found.set(r.id, { lat, lng });
        }
      }
      onProgress(Math.min(i + CHUNK, list.length), list.length);
    }
    return found;
  }

  // Enregistre les coordonnées en base par paquets de 1 000.
  async function saveCoords(found) {
    const items = [...found].map(([id, p]) => ({ id, lat: p.lat, lng: p.lng }));
    for (let i = 0; i < items.length; i += 1000) {
      await q(sb.rpc('set_coords', { items: items.slice(i, i + 1000) }), 'Enregistrement des positions');
    }
    for (const { id, lat, lng } of items) { const c = byId(id); if (c) Object.assign(c, { lat, lng }); }
    saveCache();
  }

  // Localise les clients sans coordonnées : par lot d'abord, puis un par un (étranger…) pour un petit reste.
  let geocoding = false;
  async function geocodeMissing(list = clients, onProgress) {
    if (geocoding) return { ok: 0, total: 0 };
    const todo = list.filter(c => !hasPos(c) && fullAddress(c));
    if (!todo.length) { if (list === clients && !onProgress) toast('Tous les clients avec une adresse sont déjà localisés.'); return { ok: 0, total: 0 }; }
    geocoding = true;
    const report = onProgress || ((d, t) => toast(`Localisation des adresses… ${d}/${t}`, 60000));
    try {
      const found = await geocodeBatch(todo, (d) => report(Math.round(d * 0.8), todo.length));
      // 2e passe sans le complément d'adresse (« Bâtiment B », « ZI »…), qui gêne souvent le géocodeur.
      let rest = todo.filter(c => !found.has(c.id));
      if (rest.length) for (const [id, pos] of await geocodeBatch(rest, () => report(Math.round(todo.length * 0.9), todo.length), true)) found.set(id, pos);
      rest = todo.filter(c => !found.has(c.id));
      if (rest.length && rest.length <= 30) {
        for (const c of rest) { const p = await geocode(fullAddress({ ...c, adresse: String(c.adresse || '').split(',')[0] }), c.code_postal); if (p) found.set(c.id, p); }
      }
      await saveCoords(found);
      report(todo.length, todo.length);
      scheduleFullRender();
      if (!onProgress) toast(`${found.size}/${todo.length} adresses localisées${found.size < todo.length ? '. Complétez les autres à la main.' : '.'}`, 5000);
      return { ok: found.size, total: todo.length };
    } catch { return { ok: 0, total: todo.length }; }
    finally { geocoding = false; }
  }

  // ---------- Import (ERP, CSV, Excel) ----------
  // Champs de l'appli et noms de colonnes habituels (ERP français et internationaux).
  const FIELDS = [
    { key: 'nom', label: 'Nom / raison sociale', req: true, alias: ['nom', 'name', 'raison sociale', 'raison_sociale', 'nom client', 'nom du client', 'client', 'societe', 'société', 'entreprise', 'company', 'company name', 'enseigne', 'intitule', 'intitulé', 'intitule tiers', 'libelle', 'libellé', 'libelle tiers', 'denomination', 'dénomination', 'name 1', 'name1', 'customer name', 'nom raison sociale', 'designation', 'désignation'] },
    { key: 'code_client', label: 'Code client', key2: true, alias: ['code client', 'code_client', 'n client', 'no client', 'numero client', 'num client', 'numéro client', 'ref client', 'reference client', 'référence client', 'code tiers', 'n compte tiers', 'compte tiers', 'numero de compte', 'n compte', 'compte', 'code', 'id client', 'client id', 'customer', 'customer number', 'customer id', 'internal reference', 'reference', 'référence', 'ref', 'numero', 'numéro', 'matricule', 'identifiant'] },
    { key: 'adresse', label: 'Adresse', alias: ['adresse', 'adresse 1', 'adresse1', 'adresse ligne 1', 'adresse postale', 'adresse de facturation', 'adresse facturation', 'address', 'address 1', 'address line 1', 'street', 'rue', 'voie', 'billing street'] },
    { key: 'adresse2', label: 'Complément d’adresse', alias: ['adresse 2', 'adresse2', 'adresse ligne 2', 'complement', 'complément', 'complement adresse', 'complément d adresse', 'complement d adresse', 'street2', 'address 2', 'address line 2'] },
    { key: 'code_postal', label: 'Code postal', alias: ['code postal', 'code_postal', 'codepostal', 'cp', 'zip', 'zip code', 'postcode', 'postal code', 'postal_code', 'code postal facturation'] },
    { key: 'ville', label: 'Ville', alias: ['ville', 'city', 'commune', 'localite', 'localité', 'ville facturation', 'bureau distributeur'] },
    { key: 'telephone', label: 'Téléphone', alias: ['telephone', 'téléphone', 'tel', 'tél', 'telephone 1', 'tel 1', 'téléphone fixe', 'telephone fixe', 'phone', 'phone number', 'mobile', 'portable', 'gsm', 'standard'] },
    { key: 'email', label: 'E-mail', alias: ['email', 'e mail', 'mail', 'courriel', 'adresse e mail', 'adresse mail', 'email address'] },
    { key: 'notes', label: 'Notes', alias: ['notes', 'note', 'commentaire', 'commentaires', 'remarques', 'remarque', 'comment', 'observations', 'observation'] },
    { key: 'lat', label: 'Latitude', alias: ['latitude', 'lat', 'y', 'gps latitude'] },
    { key: 'lng', label: 'Longitude', alias: ['longitude', 'lng', 'lon', 'long', 'x', 'gps longitude'] },
    { key: 'hubspot_id', label: 'ID HubSpot', alias: ['hubspot id', 'hubspot_id', 'id hubspot', 'record id', 'company id', 'id de fiche d informations'] },
    { key: 'prenom', label: 'Prénom (si clients particuliers)', alias: ['prenom', 'prénom', 'firstname', 'first name'] },
  ];
  // Normalise un nom de colonne : minuscules, sans accents ni ponctuation.
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const MAPPING_KEY = 'carte-clients:mapping';

  function guessMapping(headers) {
    const saved = load(MAPPING_KEY, {})[headers.map(norm).join('|')];
    if (saved) return saved;
    const used = new Set(), out = {};
    // Les correspondances exactes d'abord, champ par champ, dans l'ordre de la liste d'alias.
    for (const f of FIELDS) {
      for (const a of f.alias.map(norm)) {
        const i = headers.findIndex((h, j) => !used.has(j) && norm(h) === a);
        if (i >= 0) { out[f.key] = i; used.add(i); break; }
      }
    }
    return out;
  }

  // Lit le fichier : Excel (.xlsx/.xls) ou texte (CSV) en UTF-8 ou en encodage Windows.
  async function readTable(file) {
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) await new Promise((ok, ko) => {
        const s = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', onload: ok, onerror: ko });
        document.head.appendChild(s);
      });
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return { rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false }), encoding: `Excel, feuille « ${wb.SheetNames[0]} »` };
    }
    const buf = await file.arrayBuffer();
    let text, encoding = 'UTF-8';
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('windows-1252').decode(buf); encoding = 'Windows (accents convertis)'; }
    return { rows: Papa.parse(text, { skipEmptyLines: 'greedy' }).data, encoding };
  }

  // Corrige les pertes habituelles d'Excel : zéros de tête des codes postaux et des téléphones.
  function fixCp(v) { v = String(v ?? '').trim(); return /^\d{4}$/.test(v) ? '0' + v : v; }
  function fixTel(v) { v = String(v ?? '').trim(); return /^[1-9]\d{8}$/.test(v) ? '0' + v : v; }

  const imp = { headers: [], data: [], mapping: {}, file: '' };
  // « 1 client ajouté », « 2 clients ajoutés »
  const pl = (v, one, many) => `${v.toLocaleString('fr-FR')} ${v > 1 ? many : one}`;
  const impDlg = $('#importDialog');

  async function openImport(file) {
    let table;
    try { table = await readTable(file); } catch (e) { return toast('Impossible de lire ce fichier : ' + (e.message || e), 6000); }
    const rows = (table.rows || []).filter(r => r.some(v => String(v ?? '').trim()));
    if (rows.length < 2) return toast('Le fichier ne contient pas de lignes de clients.', 5000);
    const seen = {};
    imp.headers = rows[0].map((h, i) => { h = String(h ?? '').trim() || `Colonne ${i + 1}`; seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h} (${seen[h]})` : h; });
    imp.data = rows.slice(1);
    imp.mapping = guessMapping(imp.headers);
    imp.file = file.name;
    $('#impFileInfo').textContent = `${file.name} · ${imp.data.length.toLocaleString('fr-FR')} lignes · ${imp.headers.length} colonnes · ${table.encoding}`;
    $('#impMap').hidden = false; $('#impRun').hidden = true;
    $('#impGo').hidden = false; $('#impGo').disabled = false; $('#impGo').textContent = 'Importer';
    $('#impCancel').textContent = 'Annuler';
    renderMapping();
    impDlg.showModal();
  }

  function renderMapping() {
    const opts = ['<option value="">— Ignorer —</option>', ...imp.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`)].join('');
    $('#impFields').innerHTML = FIELDS.map(f => `
      <label class="${f.req ? 'req' : ''}${f.key2 ? ' key' : ''}"><span>${esc(f.label)}</span>
        <select data-field="${f.key}" class="${imp.mapping[f.key] != null ? 'set' : ''}">${opts}</select>
      </label>`).join('');
    for (const sel of $('#impFields').querySelectorAll('select')) sel.value = imp.mapping[sel.dataset.field] ?? '';
    renderPreview();
  }
  $('#impFields').addEventListener('change', e => {
    const sel = e.target.closest('select'); if (!sel) return;
    if (sel.value === '') delete imp.mapping[sel.dataset.field]; else imp.mapping[sel.dataset.field] = +sel.value;
    sel.classList.toggle('set', sel.value !== '');
    renderPreview();
  });

  // Transforme une ligne du fichier en client, avec uniquement les champs choisis.
  function rowToClient(r) {
    const m = imp.mapping, get = k => (m[k] != null ? String(r[m[k]] ?? '').trim() : '');
    const c = {};
    const nom = [get('prenom'), get('nom')].filter(Boolean).join(' ');
    c.nom = nom || get('adresse');
    if (m.code_client != null) c.code_client = get('code_client') || null;
    if (m.adresse != null || m.adresse2 != null) c.adresse = [get('adresse'), get('adresse2')].filter(Boolean).join(', ');
    if (m.code_postal != null) c.code_postal = fixCp(get('code_postal'));
    if (m.ville != null) c.ville = get('ville');
    if (m.telephone != null) c.telephone = fixTel(get('telephone'));
    if (m.email != null) c.email = get('email');
    if (m.notes != null) c.notes = get('notes');
    if (m.lat != null && m.lng != null) { c.lat = num(get('lat')); c.lng = num(get('lng')); }
    if (m.hubspot_id != null) c.hubspot_id = /^\d+$/.test(get('hubspot_id')) ? get('hubspot_id') : null;
    return c;
  }

  // Prépare l'import : dédoublonne par code client et sépare nouveaux / mis à jour / sans code.
  function planImport() {
    const byCode = new Map(clients.filter(c => c.code_client).map(c => [c.code_client, c]));
    const inFile = new Map(), noCode = [];
    let skipped = 0;
    for (const r of imp.data) {
      const c = rowToClient(r);
      if (!c.nom) { skipped++; continue; }
      if (c.code_client) { if (!inFile.has(c.code_client)) inFile.set(c.code_client, c); } // doublon : on garde la 1re ligne
      else noCode.push(c);
    }
    const updates = [], creates = [];
    for (const [code, c] of inFile) (byCode.has(code) ? updates : creates).push(c);
    return { byCode, updates, creates, noCode, skipped, dupInFile: imp.data.length - skipped - noCode.length - inFile.size };
  }

  function renderPreview() {
    const shown = FIELDS.filter(f => imp.mapping[f.key] != null);
    $('#impPreview').innerHTML = !shown.length ? '<tr><td>Aucune colonne choisie.</td></tr>' :
      `<thead><tr>${shown.map(f => `<th>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>` +
      imp.data.slice(0, 5).map(r => `<tr>${shown.map(f => `<td>${esc(String(r[imp.mapping[f.key]] ?? ''))}</td>`).join('')}</tr>`).join('') + '</tbody>';
    const sum = $('#impSummary'), n = v => v.toLocaleString('fr-FR');
    if (imp.mapping.nom == null && imp.mapping.adresse == null) {
      sum.className = 'imp-summary warn'; sum.textContent = 'Choisissez au moins la colonne « Nom / raison sociale ».';
      $('#impGo').disabled = true; return;
    }
    $('#impGo').disabled = false;
    const p = planImport(), parts = [];
    if (p.creates.length + p.noCode.length) parts.push(`<b>${pl(p.creates.length + p.noCode.length, 'nouveau client', 'nouveaux clients')}</b>`);
    if (p.updates.length) parts.push(`<b>${pl(p.updates.length, 'client déjà présent mis à jour', 'clients déjà présents mis à jour')}</b> (même code client)`);
    if (p.dupInFile > 0) parts.push(pl(p.dupInFile, 'ligne en double dans le fichier ignorée', 'lignes en double dans le fichier ignorées'));
    if (p.skipped) parts.push(pl(p.skipped, 'ligne sans nom ignorée', 'lignes sans nom ignorées'));
    let warn = '';
    if (imp.mapping.code_client == null) warn = '<br>⚠️ Sans colonne « Code client », un nouvel import du même fichier créera des doublons.';
    sum.className = 'imp-summary' + (warn ? ' warn' : '');
    sum.innerHTML = parts.join(' · ') + warn;
  }

  function impStep(i, state, text) {
    const li = $('#impSteps').children[i];
    li.className = state; if (text) li.textContent = text;
  }
  const impBar = pct => { $('#impBar').style.width = Math.round(pct) + '%'; };

  $('#impGo').addEventListener('click', async () => {
    const p = planImport(), total = p.updates.length + p.creates.length + p.noCode.length;
    if (!total) return toast('Aucune ligne à importer.');
    // Mémorise la correspondance des colonnes pour le prochain import du même format.
    const maps = load(MAPPING_KEY, {}); maps[imp.headers.map(norm).join('|')] = imp.mapping; store(MAPPING_KEY, maps);

    $('#impMap').hidden = true; $('#impRun').hidden = false; $('#impGo').hidden = true; $('#impCancel').textContent = 'Fermer';
    $('#impResult').textContent = '';
    $('#impSteps').innerHTML = '<li>Enregistrement des clients</li><li>Localisation des adresses</li><li>Terminé</li>';
    impBar(0);
    impDlg.dataset.busy = '1';
    const n = v => v.toLocaleString('fr-FR');
    try {
      // 1. Envoi : mise à jour par code client, sinon ajout.
      impStep(0, 'on');
      const prep = c => {
        const old = p.byCode.get(c.code_client);
        if (!('lat' in c)) { // pas de coordonnées dans le fichier : on garde celles connues si l'adresse n'a pas changé
          const same = old && ['adresse', 'code_postal', 'ville'].every(k => !(k in c) || (c[k] || '') === (old[k] || ''));
          c.lat = same ? old.lat : null; c.lng = same ? old.lng : null;
        }
        if ('hubspot_id' in c && !c.hubspot_id && old?.hubspot_id) c.hubspot_id = old.hubspot_id; // ne pas perdre un lien existant
        c.deleted_at = null; // un client de l'ERP mis à la corbeille revient dans la base
        return c;
      };
      // Clients déjà connus : les notes saisies dans l'appli ne sont jamais remplacées par celles de l'ERP.
      const updates = p.updates.map(c => { c = prep(c); delete c.notes; return c; });
      const creates = p.creates.map(prep);
      const plain = p.noCode.map(c => ({ ...c, code_client: null }));
      const saved = [];
      const BATCH = 500;
      let done = 0;
      for (const group of [updates, creates]) { // chaque envoi doit avoir les mêmes colonnes
        for (let i = 0; i < group.length; i += BATCH) {
          const res = await q(sb.from('clients').upsert(group.slice(i, i + BATCH), { onConflict: 'code_client' }).select(COLS), 'Import');
          saved.push(...res.map(clean)); done += res.length;
          impStep(0, 'on', `Enregistrement des clients… ${n(done)}/${n(total)}`); impBar(done / total * 50);
        }
      }
      for (let i = 0; i < plain.length; i += BATCH) {
        const res = await q(sb.from('clients').insert(plain.slice(i, i + BATCH)).select(COLS), 'Import');
        saved.push(...res.map(clean)); done += res.length;
        impStep(0, 'on', `Enregistrement des clients… ${n(done)}/${n(total)}`); impBar(done / total * 50);
      }
      for (const c of saved) { const i = clients.findIndex(x => x.id === c.id); i >= 0 ? (clients[i] = c) : clients.push(c); }
      saveCache(); scheduleFullRender();
      impStep(0, 'done', pl(saved.length, 'client enregistré', 'clients enregistrés'));

      // 2. Localisation par lot des adresses sans coordonnées.
      const toLocate = saved.filter(c => !hasPos(c) && fullAddress(c));
      let geo = { ok: 0, total: 0 };
      if (toLocate.length) {
        impStep(1, 'on', `Localisation de ${n(toLocate.length)} adresses…`);
        geo = await geocodeMissing(toLocate, (d, t) => { impStep(1, 'on', `Localisation des adresses… ${n(d)}/${n(t)}`); impBar(50 + d / t * 50); });
        impStep(1, 'done', `${n(geo.ok)}/${pl(geo.total, 'adresse localisée', 'adresses localisées')}`);
      } else impStep(1, 'done', 'Toutes les adresses étaient déjà localisées');
      impBar(100);
      impStep(2, 'done', 'Import terminé');
      const created = p.creates.length + p.noCode.length;
      const miss = geo.total - geo.ok;
      $('#impResult').innerHTML = `<b>${pl(created, 'client ajouté', 'clients ajoutés')}</b> · <b>${pl(p.updates.length, 'mis à jour', 'mis à jour')}</b>` +
        (miss > 0 ? `<br>${miss > 1 ? `${n(miss)} adresses n’ont pas pu être localisées` : 'Une adresse n’a pas pu être localisée'} : retrouvez ${miss > 1 ? 'ces clients' : 'ce client'} dans la liste avec le badge « non localisé » pour corriger.` : '');
      $('#impResult').className = 'imp-summary' + (geo.total > geo.ok ? ' warn' : '');
      setTimeout(() => { if (!me) fitAll(); }, 400);
    } catch {
      const cur = [...$('#impSteps').children].findIndex(li => li.className === 'on');
      if (cur >= 0) impStep(cur, 'err');
      $('#impResult').className = 'imp-summary warn';
      $('#impResult').textContent = 'L’import a été interrompu. Les clients déjà envoyés sont enregistrés : relancez le même fichier pour terminer (les clients ayant un code ne seront pas dupliqués).';
    } finally { delete impDlg.dataset.busy; }
  });
  impDlg.addEventListener('cancel', e => { if (impDlg.dataset.busy) e.preventDefault(); });
  impDlg.addEventListener('click', e => { if (impDlg.dataset.busy && (e.target === impDlg || e.target.closest('[data-close]'))) e.stopImmediatePropagation(); }, true);

  function exportCsv() {
    const rows = clients.map(c => ({ code_client: c.code_client ?? '', nom: c.nom, adresse: c.adresse, code_postal: c.code_postal, ville: c.ville,
      telephone: c.telephone, email: c.email, notes: c.notes, latitude: c.lat ?? '', longitude: c.lng ?? '',
      hubspot_id: c.hubspot_id ?? '', favori: favorites.has(c.id) ? 'oui' : '' }));
    const csv = Papa.unparse(rows, { delimiter: ';' });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clients-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function loadSample() {
    try { const r = await fetch('exemple-clients.csv'); openImport(new File([await r.blob()], 'exemple-clients.csv')); }
    catch { toast('Impossible de charger le fichier d’exemple.'); }
  }

  function fitAll() {
    const pts = clients.filter(visibleOnMap).map(c => [c.lat, c.lng]);
    if (me) pts.push([me.lat, me.lng]);
    if (pts.length) fitVisible(L.latLngBounds(pts), 14);
  }

  // ---------- Formulaire client ----------
  const dlg = $('#clientDialog'), form = $('#clientForm');
  function openForm(c = null, latlng = null) {
    form.reset();
    $('#dialogTitle').textContent = c ? 'Modifier le client' : 'Nouveau client';
    const v = c || {};
    for (const k of ['id', 'code_client', 'nom', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'notes']) form.elements[k].value = v[k] ?? '';
    const ll = latlng || (hasPos(v) ? v : null);
    form.elements.latitude.value = ll ? (+ll.lat).toFixed(6) : '';
    form.elements.longitude.value = ll ? (+ll.lng).toFixed(6) : '';
    form.querySelector('.coords').open = !!latlng;
    dlg.showModal();
  }
  $('#useMyPos').addEventListener('click', () => {
    if (!me) { toast('Position pas encore disponible.'); return; }
    form.elements.latitude.value = me.lat.toFixed(6); form.elements.longitude.value = me.lng.toFixed(6);
  });
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close('cancel'); });
  }
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'save') return;
    const f = form.elements;
    const data = toRow({ code_client: f.code_client.value, nom: f.nom.value.trim(), adresse: f.adresse.value.trim(), code_postal: f.code_postal.value.trim(),
      ville: f.ville.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(), notes: f.notes.value.trim(),
      lat: f.latitude.value, lng: f.longitude.value });
    if (!data.nom) return;
    const old = byId(f.id.value);
    // Adresse modifiée sans toucher aux coordonnées → on relocalise.
    if (old && fullAddress(old) !== fullAddress(data) && old.lat === data.lat && old.lng === data.lng) { data.lat = data.lng = null; }
    if (!hasPos(data) && fullAddress(data)) {
      toast('Localisation de l’adresse…');
      const p = await geocode(fullAddress(data), data.code_postal);
      if (p) Object.assign(data, p); else toast('Adresse introuvable : saisissez les coordonnées GPS.', 5000);
    }
    try {
      const c = old ? await updateClient(old.id, data) : (await insertClients([data]))[0];
      scheduleFullRender();
      toast('Client enregistré', 1500);
      setTimeout(() => select(c.id), 300);
    } catch {}
  });

  // Appui long / clic droit sur la carte → ajouter un client à cet endroit.
  map.on('contextmenu', e => { if (user) openForm(null, e.latlng); });

  // ---------- Administration ----------
  const membersDlg = $('#membersDialog');
  async function renderMembers() {
    const list = $('#membersList');
    list.innerHTML = '<li class="muted">Chargement…</li>';
    try {
      const rows = await q(sb.from('members').select('email,role').order('email'), 'Chargement des collaborateurs');
      const mine = user.email.toLowerCase();
      list.innerHTML = rows.map(m => `
        <li data-email="${esc(m.email)}">
          <div class="avatar sm" style="background:${colorFor(m.email)}">${esc(initials(m.email))}</div>
          <div class="grow"><div class="t">${esc(m.email)}${m.email === mine ? ' <span class="s">(vous)</span>' : ''}</div></div>
          <select data-role ${m.email === mine ? 'disabled' : ''}>
            <option value="user"${m.role === 'user' ? ' selected' : ''}>Collaborateur</option>
            <option value="admin"${m.role === 'admin' ? ' selected' : ''}>Admin</option>
          </select>
          ${m.email === mine ? '' : `<button class="icon-del" data-del aria-label="Retirer">${I.trash}</button>`}
        </li>`).join('');
    } catch { list.innerHTML = '<li class="muted">Impossible de charger la liste.</li>'; }
  }
  $('#memberForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements, email = f.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Adresse e-mail invalide.');
    try {
      await q(sb.from('members').upsert({ email, role: f.role.value }), 'Ajout impossible');
      f.email.value = ''; toast(`${email} peut maintenant créer son compte.`, 3500); renderMembers();
    } catch {}
  });
  $('#membersList').addEventListener('change', async e => {
    const sel = e.target.closest('[data-role]'); if (!sel) return;
    const email = sel.closest('li').dataset.email;
    try { await q(sb.from('members').update({ role: sel.value }).eq('email', email), 'Modification impossible'); toast('Rôle mis à jour', 1500); }
    catch { renderMembers(); }
  });
  $('#membersList').addEventListener('click', async e => {
    if (!e.target.closest('[data-del]')) return;
    const email = e.target.closest('li').dataset.email;
    if (!confirm(`Retirer l’accès de ${email} ?`)) return;
    try { await q(sb.from('members').delete().eq('email', email), 'Suppression impossible'); renderMembers(); } catch {}
  });

  const fieldsDlg = $('#fieldsDialog');
  let allProps = [], chosen = [];
  async function openFields() {
    fieldsDlg.showModal();
    const list = $('#fieldsList');
    list.innerHTML = '<li class="muted">Chargement des champs HubSpot…</li>';
    try {
      const [cur, props] = await Promise.all([
        q(sb.from('crm_fields').select('property,label,position').order('position'), 'Chargement'),
        hubspot('properties'),
      ]);
      chosen = cur.map(f => f.property);
      allProps = props.properties;
      renderFields();
    } catch (e) { list.innerHTML = `<li class="muted">${esc(e.message || 'Erreur')}</li>`; }
  }
  function renderFields() {
    const term = norm($('#fieldsSearch').value);
    const items = allProps.filter(p => !term || norm(p.label + ' ' + p.name).includes(term))
      .sort((a, b) => (chosen.includes(b.name) - chosen.includes(a.name)) || a.label.localeCompare(b.label, 'fr'));
    $('#fieldsList').innerHTML = items.slice(0, 300).map(p => `
      <li><label style="display:flex;gap:12px;align-items:center;width:100%;cursor:pointer">
        <input type="checkbox" value="${esc(p.name)}" ${chosen.includes(p.name) ? 'checked' : ''}>
        <span class="grow"><span class="t">${esc(p.label)}</span><br><span class="s">${esc(p.name)}</span></span>
      </label></li>`).join('') || '<li class="muted">Aucun champ.</li>';
  }
  $('#fieldsSearch').addEventListener('input', renderFields);
  $('#fieldsList').addEventListener('change', e => {
    const v = e.target.value; if (!v) return;
    chosen = e.target.checked ? [...chosen, v] : chosen.filter(x => x !== v);
  });
  $('#fieldsSave').addEventListener('click', async () => {
    const rows = chosen.map((p, i) => ({ property: p, label: allProps.find(x => x.name === p)?.label || p, position: i + 1 }));
    try {
      await q(sb.from('crm_fields').delete().neq('property', ''), 'Enregistrement impossible');
      if (rows.length) await q(sb.from('crm_fields').insert(rows), 'Enregistrement impossible');
      crmCache.clear(); fieldsDlg.close(); toast('Champs HubSpot mis à jour');
      if (selectedId) renderDetail();
    } catch {}
  });

  // ---------- Recherche & menu ----------
  let searchTimer;
  const search = $('#search');
  search.addEventListener('input', () => {
    $('#clearSearch').hidden = !search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = search.value.trim().toLowerCase(); if (selectedId) closeDetail(); renderList(); }, 150);
  });
  search.addEventListener('focus', () => { if (!isDesktop() && sheetSnap === 'peek') setSnap('half'); });
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    search.blur();
    const first = $('#list li[data-id]'); if (first && query) select(first.dataset.id);
  });
  $('#clearSearch').addEventListener('click', () => { search.value = ''; query = ''; $('#clearSearch').hidden = true; renderList(); search.focus(); });

  const menu = $('#menu');
  const toggleMenu = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  $('#menuBtn').addEventListener('click', toggleMenu);
  $('#userBtn').addEventListener('click', toggleMenu);
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  $('#csvInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) openImport(f); e.target.value = ''; menu.hidden = true; });
  menu.addEventListener('click', async e => {
    const action = e.target.closest('button')?.dataset.action; if (!action) return;
    menu.hidden = true;
    if (action === 'add') openForm();
    if (action === 'export') exportCsv();
    if (action === 'geocode') geocodeMissing();
    if (action === 'members') { membersDlg.showModal(); renderMembers(); }
    if (action === 'crmfields') openFields();
    if (action === 'logout') { await sb.auth.signOut(); }
    if (action === 'trash') openTrash();
    if (action === 'clear') {
      const word = prompt(`Cette action met les ${clients.length} clients de la base commune à la corbeille, pour TOUS les collaborateurs.\nIls resteront restaurables depuis la corbeille.\n\nTapez SUPPRIMER pour confirmer.`);
      if (word !== 'SUPPRIMER') return;
      try {
        await q(sb.from('clients').update({ deleted_at: new Date().toISOString() }).is('deleted_at', null), 'Mise à la corbeille impossible');
        clients = []; closeDetail(); scheduleFullRender(); toast('Tous les clients sont dans la corbeille');
      } catch {}
    }
  });

  // ---------- Connexion / comptes ----------
  const auth = $('#auth'), authForm = $('#authForm');
  let authMode = 'login';
  function showAuth(view, msg, kind) {
    auth.hidden = false;
    $('#authForm').hidden = view !== 'form';
    $('#authDenied').hidden = view !== 'denied';
    $('#authSetup').hidden = view !== 'setup';
    if (view === 'denied') $('#deniedEmail').textContent = user?.email || '';
    authMessage(msg, kind);
  }
  function authMessage(msg, kind = 'error') {
    const el = $('#authMsg');
    el.hidden = !msg; el.textContent = msg || '';
    el.className = 'auth-msg' + (kind === 'ok' ? ' ok' : '');
  }
  function setAuthMode(mode) {
    authMode = mode;
    for (const b of document.querySelectorAll('#authTabs button')) b.setAttribute('aria-selected', b.dataset.mode === mode);
    $('#authTabs').hidden = mode === 'recovery';
    $('#pw2Label').hidden = mode === 'login';
    $('#pwLabel').hidden = false;
    authForm.elements.email.closest('label').hidden = mode === 'recovery';
    authForm.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#pwLabel').firstChild.textContent = mode === 'recovery' ? 'Nouveau mot de passe' : 'Mot de passe';
    $('#authSubmit').textContent = { login: 'Se connecter', signup: 'Créer mon compte', recovery: 'Enregistrer le mot de passe' }[mode];
    $('#forgotBtn').hidden = mode !== 'login';
    $('#authLead').textContent = mode === 'recovery' ? 'Choisissez votre nouveau mot de passe.'
      : mode === 'signup' ? 'Utilisez l’adresse e-mail que votre administrateur a autorisée.'
      : 'Connectez-vous avec votre adresse e-mail professionnelle.';
    authMessage('');
  }
  $('#authTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.mode); });
  const FR_ERRORS = [
    [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
    [/email not confirmed/i, 'Confirmez d’abord votre adresse en cliquant sur le lien reçu par e-mail.'],
    [/already registered|already exists/i, 'Un compte existe déjà avec cette adresse : connectez-vous.'],
    [/password should be at least/i, 'Le mot de passe doit contenir au moins 8 caractères.'],
    [/rate limit|too many/i, 'Trop de tentatives. Patientez quelques minutes.'],
    [/same password|different from the old/i, 'Choisissez un mot de passe différent de l’ancien.'],
  ];
  const frError = err => FR_ERRORS.find(([re]) => re.test(err?.message || ''))?.[1] || err?.message || 'Erreur inconnue';
  const redirectTo = () => location.href.split('#')[0].split('?')[0];

  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const f = authForm.elements, email = f.email.value.trim(), password = f.password.value;
    if (authMode !== 'recovery' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authMessage('Adresse e-mail invalide.');
    if (password.length < 8) return authMessage('Le mot de passe doit contenir au moins 8 caractères.');
    if (authMode !== 'login' && password !== f.password2.value) return authMessage('Les deux mots de passe ne correspondent pas.');
    const btn = $('#authSubmit'); btn.disabled = true;
    try {
      if (authMode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) authMessage(frError(error));
      } else if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
        if (error) authMessage(frError(error));
        else if (!data.session) { setAuthMode('login'); f.email.value = email; authMessage('Compte créé ! Cliquez sur le lien reçu par e-mail pour confirmer votre adresse, puis connectez-vous.', 'ok'); }
      } else {
        const { error } = await sb.auth.updateUser({ password });
        if (error) authMessage(frError(error));
        else { toast('Mot de passe modifié'); history.replaceState(null, '', redirectTo()); setAuthMode('login'); handleSession((await sb.auth.getSession()).data.session); }
      }
    } finally { btn.disabled = false; }
  });
  $('#forgotBtn').addEventListener('click', async () => {
    const email = authForm.elements.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authMessage('Saisissez d’abord votre adresse e-mail ci-dessus.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    authMessage(error ? frError(error) : 'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.', error ? 'error' : 'ok');
  });
  $('#retryBtn').addEventListener('click', async () => handleSession((await sb.auth.getSession()).data.session));
  $('#deniedLogout').addEventListener('click', () => sb.auth.signOut());

  let sessionUserId = null;
  async function handleSession(session) {
    if (authMode === 'recovery') return; // on attend le nouveau mot de passe
    if (!session) {
      sessionUserId = null; user = null; isAdmin = false;
      channel?.unsubscribe(); channel = null; stopWatch();
      clients = []; favorites = new Set(); closeDetail(); renderMarkers(); renderChips(); renderList();
      showAuth('form');
      return;
    }
    if (session.user.id === sessionUserId && auth.hidden) return; // simple rafraîchissement du jeton
    user = session.user;
    const { data: me_, error } = await sb.from('members').select('role').eq('email', user.email.toLowerCase()).maybeSingle();
    if (error) { showAuth('form', 'Connexion au serveur impossible : ' + error.message); return; }
    if (!me_) { showAuth('denied'); return; }
    sessionUserId = user.id;
    isAdmin = me_.role === 'admin';
    $('#userBtn').textContent = initials(user.email);
    $('#userBtn').style.background = colorFor(user.email);
    $('#menuAvatar').textContent = initials(user.email);
    $('#menuAvatar').style.background = colorFor(user.email);
    $('#menuEmail').textContent = user.email;
    $('#menuRole').textContent = isAdmin ? 'Administrateur' : 'Collaborateur';
    document.querySelector('.admin-only').hidden = !isAdmin;
    auth.hidden = true;
    await loadData();
    subscribe();
    startWatch();
  }

  // ---------- Démarrage ----------
  applyBaseLayer();
  setSnap('half');
  renderChips(); renderList();
  $('#locateBtn').classList.toggle('active', settings.follow);
  if (!sb) showAuth('setup');
  else {
    setAuthMode('login');
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setAuthMode('recovery'); showAuth('form'); return; }
      setTimeout(() => handleSession(session), 0); // hors du callback (recommandé par Supabase)
    });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
