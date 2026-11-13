/* Carte Clients — affiche une base clients sur une carte et suit la position
 * de l'utilisateur en temps réel pour lister les clients les plus proches.
 * Données stockées localement dans le navigateur (localStorage). */
(() => {
  'use strict';

  const STORAGE_KEY = 'carte-clients:v1';
  const SETTINGS_KEY = 'carte-clients:settings';
  const MAX_LIST = 300;
  const RADII = [1, 2, 5, 10, 25, 50, 100, 0]; // 0 = tous

  // ---------- État ----------
  let clients = load(STORAGE_KEY, []);
  const settings = Object.assign({ radius: 10, follow: true, layer: 'plan' }, load(SETTINGS_KEY, {}));
  if (settings.onlyRadius === false) settings.radius = 0;
  delete settings.onlyRadius;
  let me = null;            // { lat, lng, accuracy }
  let lastListPos = null;
  let watchId = null;
  let query = '';
  let selectedId = null;

  // ---------- Utilitaires ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clients)); }
    catch { toast("Impossible d'enregistrer : stockage du navigateur plein ou bloqué."); }
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const hasPos = c => Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const fullAddress = c => [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;
  const byId = id => clients.find(c => c.id === id);

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
    const words = String(name || '?').split(/[\s'’\-]+/).filter(w => w && !STOP.has(w.toLowerCase()));
    return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  }
  const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#b45309', '#0d9488', '#c026d3'];
  function colorFor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  const avatar = c => `<div class="avatar" style="background:${colorFor(c.nom)}">${esc(initials(c.nom))}</div>`;

  let toastTimer;
  function toast(msg, ms = 3000) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
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
  };
  const routeUrl = c => `https://www.google.com/maps/dir/?api=1&destination=${hasPos(c) ? `${c.lat},${c.lng}` : encodeURIComponent(fullAddress(c))}`;
  const wazeUrl = c => hasPos(c) ? `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(fullAddress(c))}&navigate=yes`;
  const telUrl = c => `tel:${String(c.telephone).replace(/[^\d+]/g, '')}`;

  // ---------- Carte & fonds ----------
  const map = L.map('map', { zoomControl: false, maxZoom: 19, minZoom: 3 }).setView([46.6, 2.4], 6);
  map.attributionControl.setPrefix(false);
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const planLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: CARTO_ATTR });
  const planDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: CARTO_ATTR });
  const sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagerie &copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
  ]);
  let baseLayer = null;
  function applyBaseLayer() {
    const next = settings.layer === 'sat' ? sat : darkMq.matches ? planDark : planLight;
    if (next === baseLayer) return;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = next.addTo(map);
    $('#layerBtn').classList.toggle('on', settings.layer === 'sat');
  }
  darkMq.addEventListener?.('change', applyBaseLayer);
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
  function pinIcon(c, state) {
    const key = initials(c.nom) + '|' + state;
    if (!iconCache.has(key)) {
      iconCache.set(key, L.divIcon({ className: 'pin-wrap', html: `<div class="pin ${state}"><span>${esc(initials(c.nom))}</span></div>`,
        iconSize: [34, 34], iconAnchor: [17, 42] }));
    }
    return iconCache.get(key);
  }
  const stateOf = c => (c.id === selectedId ? 'selected' : inRadius(distTo(c)) ? 'near' : 'far');

  function renderMarkers() {
    cluster.clearLayers(); markers.clear();
    const layers = [];
    for (const c of clients) {
      if (!hasPos(c)) continue;
      const st = stateOf(c);
      const m = L.marker([c.lat, c.lng], { icon: pinIcon(c, st), title: c.nom, near: st !== 'far', riseOnHover: true });
      m.on('click', () => select(c.id));
      markers.set(c.id, m); layers.push(m);
    }
    cluster.addLayers(layers);
  }

  function updateMarkerStates() {
    let changed = false;
    for (const c of clients) {
      const m = markers.get(c.id); if (!m) continue;
      const st = stateOf(c), icon = pinIcon(c, st);
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

  // ---------- Rayon (chips) ----------
  function renderChips() {
    $('#chips').innerHTML = RADII.map(r => `<button class="chip" role="radio" data-r="${r}" aria-checked="${settings.radius === r}">${r ? `${r} km` : 'Tous'}</button>`).join('');
    $('#chips [aria-checked="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function setRadius(r) {
    settings.radius = r; saveSettings(); renderChips(); updateRadiusCircle(); refresh();
    if (me && r) fitVisible(radiusCircle.getBounds()); else fitAll();
  }
  $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) setRadius(+b.dataset.r); });
  function updateRadiusCircle() {
    if (!me || !settings.radius) { map.removeLayer(radiusCircle); return; }
    radiusCircle.setLatLng([me.lat, me.lng]).setRadius(settings.radius * 1000);
    if (!map.hasLayer(radiusCircle)) radiusCircle.addTo(map);
  }

  // ---------- Liste ----------
  function matches(c) {
    if (!query) return true;
    const hay = `${c.nom} ${c.adresse} ${c.code_postal} ${c.ville} ${c.telephone} ${c.email} ${c.notes}`.toLowerCase();
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
    $('#title').textContent = query ? 'Résultats' : (settings.radius && me) ? 'Autour de vous' : 'Tous les clients';
    $('#subtitle').textContent = query ? `${rows.length} client${s(rows.length)} trouvé${s(rows.length)}`
      : !me ? `${total} client${s(total)} · ${watchId == null ? 'position indisponible' : 'recherche de votre position…'}`
      : settings.radius ? `${nearCount} client${s(nearCount)} à moins de ${settings.radius} km · ${total} au total`
      : `${total} client${s(total)} · triés par distance`;

    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = total === 0
        ? emptyState(I.users, 'Aucun client pour l’instant', 'Importez votre fichier clients (CSV) ou essayez avec des données d’exemple.',
            '<div><button class="btn primary" data-empty="import">Importer un CSV</button> <button class="btn ghost" data-empty="sample">Exemple</button></div>')
        : query ? emptyState(I.search, 'Aucun résultat', 'Essayez un autre nom, une ville ou un code postal.')
        : emptyState(I.radar, `Personne à moins de ${settings.radius} km`, 'Élargissez la zone de recherche.',
            '<div><button class="btn ghost" data-empty="wider">Élargir le rayon</button></div>');
      return;
    }
    list.innerHTML = rows.slice(0, MAX_LIST).map(({ c, d, near }) => `
      <li class="item" data-id="${esc(c.id)}">
        ${avatar(c)}
        <div class="info">
          <div class="name">${esc(c.nom)}${hasPos(c) ? '' : '<span class="badge">non localisé</span>'}</div>
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

  // ---------- Fiche client ----------
  function renderDetail() {
    const c = byId(selectedId); if (!c) return closeDetail();
    const d = distTo(c);
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
        <a class="act" href="${esc(wazeUrl(c))}" target="_blank" rel="noopener">${I.car}Waze</a>
        <a class="act${c.email ? '' : ' disabled'}" href="${c.email ? `mailto:${esc(c.email)}` : '#'}">${I.mail}E-mail</a>
      </div>
      <div class="d-rows">
        ${row(I.pin, 'Adresse', fullAddress(c), fullAddress(c) ? routeUrl(c) : null)}
        ${row(I.phone, 'Téléphone', c.telephone, c.telephone ? telUrl(c) : null)}
        ${row(I.mail, 'E-mail', c.email, c.email ? `mailto:${c.email}` : null)}
        ${row(I.note, 'Notes', c.notes)}
      </div>
      <div class="d-foot">
        <button class="btn ghost" data-act="edit">${I.edit}Modifier</button>
        <button class="btn danger" data-act="delete">${I.trash}Supprimer</button>
      </div>`;
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
  map.on('click', () => { if (selectedId) closeDetail(); });

  $('#detail').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const c = byId(selectedId); if (!act || !c) return;
    if (act === 'edit') openForm(c);
    if (act === 'delete' && confirm(`Supprimer « ${c.nom} » ?`)) {
      clients = clients.filter(x => x !== c); save(); closeDetail(); renderMarkers(); renderList();
      toast('Client supprimé');
    }
  });

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

  // ---------- Géocodage ----------
  async function geocode(address) {
    if (!address) return null;
    try { // Base Adresse Nationale (France) — rapide, sans clé
      const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
      if (r.ok) {
        const f = (await r.json()).features?.[0];
        if (f && f.properties.score > 0.4) return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      }
    } catch {}
    try { // Repli international : Nominatim (OpenStreetMap), 1 requête/seconde max
      await new Promise(res => setTimeout(res, 1100));
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { 'Accept-Language': 'fr' } });
      if (r.ok) { const j = await r.json(); if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon }; }
    } catch {}
    return null;
  }

  let geocoding = false;
  async function geocodeMissing() {
    if (geocoding) return;
    const todo = clients.filter(c => !hasPos(c) && fullAddress(c));
    if (!todo.length) { toast('Tous les clients avec une adresse sont déjà localisés.'); return; }
    geocoding = true;
    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      toast(`Localisation des adresses… ${i + 1}/${todo.length}`, 60000);
      const p = await geocode(fullAddress(todo[i]));
      if (p) { Object.assign(todo[i], p); ok++; }
      if (i % 10 === 9) { save(); renderMarkers(); renderList(); }
      await new Promise(res => setTimeout(res, 120));
    }
    geocoding = false;
    save(); renderMarkers(); refresh();
    toast(`${ok}/${todo.length} adresses localisées${ok < todo.length ? '. Complétez les autres à la main.' : '.'}`, 5000);
  }

  // ---------- Import / export CSV ----------
  const ALIASES = {
    nom: ['nom', 'name', 'client', 'raison sociale', 'raison_sociale', 'societe', 'société', 'entreprise', 'company', 'enseigne'],
    adresse: ['adresse', 'address', 'rue', 'street', 'adresse1', 'adresse 1'],
    code_postal: ['code_postal', 'code postal', 'cp', 'zip', 'postcode', 'postal_code', 'codepostal'],
    ville: ['ville', 'city', 'commune', 'localite', 'localité'],
    telephone: ['telephone', 'téléphone', 'tel', 'tél', 'phone', 'mobile', 'portable'],
    email: ['email', 'e-mail', 'mail', 'courriel'],
    notes: ['notes', 'note', 'commentaire', 'commentaires', 'remarques', 'comment'],
    lat: ['latitude', 'lat', 'y'],
    lng: ['longitude', 'lng', 'lon', 'long', 'x'],
    prenom: ['prenom', 'prénom', 'firstname', 'first name'],
  };
  const norm = s => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function mapHeaders(fields) {
    const out = {};
    for (const [key, names] of Object.entries(ALIASES)) {
      const n = names.map(norm);
      const f = fields.find(h => n.includes(norm(h)));
      if (f) out[key] = f;
    }
    return out;
  }

  function importCsv(file) {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: ({ data, meta }) => {
        const h = mapHeaders(meta.fields || []);
        if (!h.nom && !h.adresse) { toast('Colonnes non reconnues : il faut au moins « nom » ou « adresse ».', 6000); return; }
        const added = data.map(row => {
          const get = k => (h[k] ? String(row[h[k]] ?? '').trim() : '');
          const nom = [get('prenom'), get('nom')].filter(Boolean).join(' ') || get('adresse');
          return { id: uid(), nom, adresse: get('adresse'), code_postal: get('code_postal'), ville: get('ville'),
            telephone: get('telephone'), email: get('email'), notes: get('notes'), lat: num(get('lat')), lng: num(get('lng')) };
        }).filter(c => c.nom);
        clients = clients.concat(added);
        save(); renderMarkers(); renderList(); if (!me) fitAll();
        const missing = added.filter(c => !hasPos(c)).length;
        toast(`${added.length} clients importés${missing ? `, ${missing} à localiser…` : '.'}`, 4000);
        if (missing) geocodeMissing();
      },
      error: e => toast('Erreur de lecture du CSV : ' + e.message, 6000),
    });
  }

  function exportCsv() {
    const rows = clients.map(c => ({ nom: c.nom, adresse: c.adresse, code_postal: c.code_postal, ville: c.ville,
      telephone: c.telephone, email: c.email, notes: c.notes, latitude: c.lat ?? '', longitude: c.lng ?? '' }));
    const csv = Papa.unparse(rows, { delimiter: ';' });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clients-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function loadSample() {
    try { const r = await fetch('exemple-clients.csv'); importCsv(new File([await r.blob()], 'exemple.csv')); }
    catch { toast('Impossible de charger le fichier d’exemple.'); }
  }

  function fitAll() {
    const pts = clients.filter(hasPos).map(c => [c.lat, c.lng]);
    if (me) pts.push([me.lat, me.lng]);
    if (pts.length) fitVisible(L.latLngBounds(pts), 14);
  }

  // ---------- Formulaire client ----------
  const dlg = $('#clientDialog'), form = $('#clientForm');
  function openForm(c = null, latlng = null) {
    form.reset();
    $('#dialogTitle').textContent = c ? 'Modifier le client' : 'Nouveau client';
    const v = c || {};
    for (const k of ['id', 'nom', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'notes']) form.elements[k].value = v[k] ?? '';
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
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close('cancel'); }); // clic sur le fond
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'save') return;
    const f = form.elements;
    const data = { nom: f.nom.value.trim(), adresse: f.adresse.value.trim(), code_postal: f.code_postal.value.trim(),
      ville: f.ville.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(), notes: f.notes.value.trim(),
      lat: num(f.latitude.value), lng: num(f.longitude.value) };
    if (!data.nom) return;
    let c = byId(f.id.value);
    if (c) {
      const addrChanged = fullAddress(c) !== fullAddress(data);
      const posUnchanged = c.lat === data.lat && c.lng === data.lng;
      Object.assign(c, data);
      if (addrChanged && posUnchanged) { c.lat = c.lng = null; } // adresse modifiée → re-géocoder
    } else { c = { id: uid(), ...data }; clients.push(c); }
    if (!hasPos(c) && fullAddress(c)) {
      toast('Localisation de l’adresse…');
      const p = await geocode(fullAddress(c));
      if (p) Object.assign(c, p); else toast('Adresse introuvable : saisissez les coordonnées GPS.', 5000);
    }
    save(); renderMarkers(); renderList();
    toast('Client enregistré', 1500);
    select(c.id);
  });

  // Appui long / clic droit sur la carte → ajouter un client à cet endroit.
  map.on('contextmenu', e => openForm(null, e.latlng));

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
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  $('#csvInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCsv(f); e.target.value = ''; menu.hidden = true; });
  menu.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action; if (!action) return;
    menu.hidden = true;
    if (action === 'add') openForm();
    if (action === 'export') exportCsv();
    if (action === 'geocode') geocodeMissing();
    if (action === 'sample') loadSample();
    if (action === 'clear' && confirm(`Supprimer définitivement les ${clients.length} clients de cet appareil ?`)) {
      clients = []; save(); closeDetail(); renderMarkers(); renderList();
    }
  });

  // ---------- Démarrage ----------
  applyBaseLayer();
  setSnap('half');
  renderChips(); renderMarkers(); renderList();
  $('#locateBtn').classList.toggle('active', settings.follow);
  fitAll();
  startWatch();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
