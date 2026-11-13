/* Carte Clients — affiche une base clients sur une carte et suit la position
 * de l'utilisateur en temps réel pour lister les clients les plus proches.
 * Données stockées localement dans le navigateur (localStorage). */
(() => {
  'use strict';

  const STORAGE_KEY = 'carte-clients:v1';
  const SETTINGS_KEY = 'carte-clients:settings';
  const MAX_LIST = 300;

  // ---------- État ----------
  let clients = load(STORAGE_KEY, []);
  const settings = Object.assign({ radius: 10, onlyRadius: true, follow: true }, load(SETTINGS_KEY, {}));
  let me = null;            // { lat, lng, accuracy }
  let lastListPos = null;   // position utilisée pour le dernier calcul de liste
  let watchId = null;
  let query = '';

  // ---------- Utilitaires ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clients)); }
    catch { toast("⚠️ Impossible d'enregistrer : stockage du navigateur plein ou bloqué."); }
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const hasPos = c => Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const fullAddress = c => [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(km) {
    if (km == null) return '—';
    return km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  let toastTimer;
  function toast(msg, ms = 3000) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ---------- Carte ----------
  const map = L.map('map', { zoomControl: false }).setView([46.6, 2.4], 6);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributeurs OpenStreetMap'
  }).addTo(map);

  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  map.addLayer(cluster);
  const markers = new Map(); // id -> marker

  const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000, interactive: false });
  const accCircle = L.circle([0, 0], { radius: 0, color: '#1d4ed8', weight: 1, fillOpacity: 0.1, interactive: false });
  const radiusCircle = L.circle([0, 0], { radius: 0, color: '#16a34a', weight: 2, dashArray: '6 6', fill: false, interactive: false });

  const pinIcon = near => L.divIcon({ className: '', html: `<div class="client-pin${near ? ' near' : ''}"></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
  const ICON_FAR = pinIcon(false), ICON_NEAR = pinIcon(true);

  function popupHtml(c) {
    const d = me && hasPos(c) ? haversine(me, c) : null;
    const dest = hasPos(c) ? `${c.lat},${c.lng}` : encodeURIComponent(fullAddress(c));
    return `<div class="popup">
      <h3>${esc(c.nom)}</h3>
      ${fullAddress(c) ? `<p>${esc(fullAddress(c))}</p>` : ''}
      ${c.telephone ? `<p>📞 <a href="tel:${esc(c.telephone.replace(/\s/g, ''))}">${esc(c.telephone)}</a></p>` : ''}
      ${c.email ? `<p>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
      ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
      ${d != null ? `<p><strong>À ${fmtDist(d)}</strong> de vous (à vol d'oiseau)</p>` : ''}
      <div class="actions">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener">🧭 Google Maps</a>
        <a href="https://waze.com/ul?ll=${dest}&navigate=yes" target="_blank" rel="noopener">🚗 Waze</a>
        <button class="secondary" data-edit="${esc(c.id)}">✏️ Modifier</button>
        <button class="danger" data-del="${esc(c.id)}">🗑️</button>
      </div></div>`;
  }

  function renderMarkers() {
    cluster.clearLayers(); markers.clear();
    const layers = [];
    for (const c of clients) {
      if (!hasPos(c)) continue;
      const m = L.marker([c.lat, c.lng], { icon: ICON_FAR, title: c.nom });
      m.bindPopup(() => popupHtml(c), { maxWidth: 280 });
      markers.set(c.id, m); layers.push(m);
    }
    cluster.addLayers(layers);
    updateMarkerColors();
  }

  function updateMarkerColors() {
    for (const c of clients) {
      const m = markers.get(c.id); if (!m) continue;
      const near = !!me && haversine(me, c) <= settings.radius;
      const icon = near ? ICON_NEAR : ICON_FAR;
      if (m.options.icon !== icon) m.setIcon(icon);
    }
  }

  // ---------- Liste ----------
  function matches(c) {
    if (!query) return true;
    const hay = `${c.nom} ${c.adresse} ${c.code_postal} ${c.ville} ${c.telephone} ${c.email} ${c.notes}`.toLowerCase();
    return query.split(/\s+/).every(w => hay.includes(w));
  }

  function renderList() {
    const rows = [];
    let inRadius = 0;
    for (const c of clients) {
      if (!matches(c)) continue;
      const d = me && hasPos(c) ? haversine(me, c) : null;
      if (d != null && d <= settings.radius) inRadius++;
      if (settings.onlyRadius && me && !query && (d == null || d > settings.radius)) continue;
      rows.push({ c, d });
    }
    rows.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || String(a.c.nom).localeCompare(b.c.nom));

    const total = clients.length;
    $('#countLabel').textContent = me
      ? `${inRadius} client${inRadius > 1 ? 's' : ''} à moins de ${settings.radius} km · ${total} au total`
      : `${total} client${total > 1 ? 's' : ''}`;

    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = `<li class="empty">${total === 0
        ? 'Aucun client. Ouvrez le menu ☰ pour importer un CSV ou charger des clients d\'exemple.'
        : query ? 'Aucun client ne correspond à la recherche.'
        : 'Aucun client dans ce rayon. Augmentez le rayon ou décochez le filtre.'}</li>`;
      return;
    }
    list.innerHTML = rows.slice(0, MAX_LIST).map(({ c, d }) => `
      <li data-id="${esc(c.id)}">
        <div class="info">
          <div class="name">${esc(c.nom)}${hasPos(c) ? '' : '<span class="badge">non localisé</span>'}</div>
          <div class="addr">${esc(fullAddress(c) || c.telephone || '')}</div>
        </div>
        <div class="dist">${fmtDist(d)}</div>
      </li>`).join('') + (rows.length > MAX_LIST ? `<li class="empty">… et ${rows.length - MAX_LIST} autres (affinez la recherche)</li>` : '');
  }

  function refresh() { renderList(); updateMarkerColors(); }

  // ---------- Géolocalisation temps réel ----------
  function onPosition(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const first = !me;
    me = { lat, lng, accuracy };
    meMarker.setLatLng([lat, lng]); accCircle.setLatLng([lat, lng]).setRadius(accuracy);
    radiusCircle.setLatLng([lat, lng]).setRadius(settings.radius * 1000);
    if (first) { meMarker.addTo(map); accCircle.addTo(map); radiusCircle.addTo(map); }
    $('#gpsStatus').textContent = `Position en direct · précision ±${Math.round(accuracy)} m · ${new Date().toLocaleTimeString('fr-FR')}`;

    if (first) map.fitBounds(radiusCircle.getBounds(), { maxZoom: 15 });
    else if (settings.follow) map.panTo([lat, lng], { animate: true });

    // Recalcule la liste seulement si on a bougé de plus de 15 m.
    if (!lastListPos || haversine(lastListPos, me) > 0.015) { lastListPos = { ...me }; refresh(); }
  }

  function onPositionError(err) {
    const msg = { 1: 'Localisation refusée — autorisez-la dans le navigateur.', 2: 'Position indisponible.', 3: 'Délai de localisation dépassé.' }[err.code] || err.message;
    $('#gpsStatus').textContent = `Position : ${msg}`;
    if (err.code === 1) { toast('📍 ' + msg, 5000); stopWatch(); }
  }

  function startWatch() {
    if (!('geolocation' in navigator)) { $('#gpsStatus').textContent = 'Géolocalisation non supportée.'; return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }

  function setFollow(on) {
    settings.follow = on; saveSettings();
    $('#locateBtn').classList.toggle('active', on);
    if (on && me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 13));
  }
  $('#locateBtn').addEventListener('click', () => { startWatch(); setFollow(!settings.follow || !me ? true : false); });
  map.on('dragstart', () => { if (settings.follow) setFollow(false); });

  // Économie de batterie : on coupe le GPS quand l'appli est en arrière-plan.
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
      toast(`🌍 Géocodage ${i + 1}/${todo.length}…`, 60000);
      const p = await geocode(fullAddress(todo[i]));
      if (p) { Object.assign(todo[i], p); ok++; }
      if (i % 10 === 9) { save(); renderMarkers(); renderList(); }
      await new Promise(res => setTimeout(res, 120)); // respect des quotas
    }
    geocoding = false;
    save(); renderMarkers(); renderList();
    toast(`✅ ${ok}/${todo.length} adresses localisées${ok < todo.length ? ' — complétez les autres à la main.' : '.'}`, 5000);
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
      complete: async ({ data, meta }) => {
        const h = mapHeaders(meta.fields || []);
        if (!h.nom && !h.adresse) { toast('❌ Colonnes non reconnues. Il faut au moins « nom » ou « adresse ».', 6000); return; }
        const added = data.map(row => {
          const get = k => (h[k] ? String(row[h[k]] ?? '').trim() : '');
          const nom = [get('prenom'), get('nom')].filter(Boolean).join(' ') || get('adresse');
          return { id: uid(), nom, adresse: get('adresse'), code_postal: get('code_postal'), ville: get('ville'),
            telephone: get('telephone'), email: get('email'), notes: get('notes'), lat: num(get('lat')), lng: num(get('lng')) };
        }).filter(c => c.nom);
        clients = clients.concat(added);
        save(); renderMarkers(); renderList(); fitAll();
        const missing = added.filter(c => !hasPos(c)).length;
        toast(`📥 ${added.length} clients importés${missing ? ` — ${missing} à géocoder…` : '.'}`, 4000);
        if (missing) geocodeMissing();
      },
      error: e => toast('❌ Erreur de lecture CSV : ' + e.message, 6000),
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

  function fitAll() {
    const pts = clients.filter(hasPos).map(c => [c.lat, c.lng]);
    if (pts.length && (!me || !settings.follow)) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
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
    dlg.showModal();
  }
  $('#useMyPos').addEventListener('click', () => {
    if (!me) { toast('Position pas encore disponible.'); return; }
    form.elements.latitude.value = me.lat.toFixed(6); form.elements.longitude.value = me.lng.toFixed(6);
  });
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'save') return;
    const f = form.elements;
    const data = { nom: f.nom.value.trim(), adresse: f.adresse.value.trim(), code_postal: f.code_postal.value.trim(),
      ville: f.ville.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(), notes: f.notes.value.trim(),
      lat: num(f.latitude.value), lng: num(f.longitude.value) };
    if (!data.nom) return;
    let c = clients.find(x => x.id === f.id.value);
    if (c) {
      const addrChanged = fullAddress(c) !== fullAddress(data);
      const posUnchanged = c.lat === data.lat && c.lng === data.lng;
      Object.assign(c, data);
      if (addrChanged && posUnchanged) { c.lat = c.lng = null; } // adresse modifiée → re-géocoder
    } else { c = { id: uid(), ...data }; clients.push(c); }
    if (!hasPos(c) && fullAddress(c)) {
      toast('🌍 Localisation de l\'adresse…');
      const p = await geocode(fullAddress(c));
      if (p) Object.assign(c, p); else toast('⚠️ Adresse introuvable : saisissez latitude/longitude.', 5000);
    }
    save(); renderMarkers(); renderList();
    if (hasPos(c)) { map.setView([c.lat, c.lng], Math.max(map.getZoom(), 15)); setFollow(false); markers.get(c.id)?.openPopup(); }
  });

  // Appui long / clic droit sur la carte → ajouter un client à cet endroit.
  map.on('contextmenu', e => openForm(null, e.latlng));

  // ---------- Interactions ----------
  function focusClient(id) {
    const c = clients.find(x => x.id === id); if (!c) return;
    if (!hasPos(c)) { openForm(c); return; }
    setFollow(false);
    const m = markers.get(id);
    cluster.zoomToShowLayer(m, () => m.openPopup());
    if (window.innerWidth < 900) document.body.classList.remove('collapsed');
  }
  $('#list').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) focusClient(li.dataset.id); });

  map.on('popupopen', e => {
    const el = e.popup.getElement();
    el.querySelector('[data-edit]')?.addEventListener('click', ev => { map.closePopup(); openForm(clients.find(c => c.id === ev.currentTarget.dataset.edit)); });
    el.querySelector('[data-del]')?.addEventListener('click', ev => {
      const c = clients.find(x => x.id === ev.currentTarget.dataset.del);
      if (c && confirm(`Supprimer « ${c.nom} » ?`)) { clients = clients.filter(x => x !== c); save(); map.closePopup(); renderMarkers(); renderList(); }
    });
  });

  let searchTimer;
  $('#search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim().toLowerCase(); renderList(); }, 150);
  });

  const radius = $('#radius');
  radius.value = settings.radius; $('#radiusOut').textContent = `${settings.radius} km`;
  radius.addEventListener('input', () => {
    settings.radius = +radius.value; $('#radiusOut').textContent = `${settings.radius} km`;
    radiusCircle.setRadius(settings.radius * 1000); saveSettings(); refresh();
  });
  radius.addEventListener('change', () => { if (me) map.fitBounds(radiusCircle.getBounds(), { maxZoom: 15 }); });

  const only = $('#onlyRadius');
  only.checked = settings.onlyRadius;
  only.addEventListener('change', () => { settings.onlyRadius = only.checked; saveSettings(); renderList(); });

  $('#panelHandle').addEventListener('click', () => {
    $('#panel').classList.toggle('collapsed');
    document.body.classList.toggle('collapsed', $('#panel').classList.contains('collapsed'));
    setTimeout(() => map.invalidateSize(), 250);
  });

  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  $('#csvInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCsv(f); e.target.value = ''; menu.hidden = true; });
  menu.addEventListener('click', async e => {
    const action = e.target.closest('button')?.dataset.action; if (!action) return;
    menu.hidden = true;
    if (action === 'add') openForm(null, me);
    if (action === 'export') exportCsv();
    if (action === 'geocode') geocodeMissing();
    if (action === 'sample') {
      try { const r = await fetch('exemple-clients.csv'); importCsv(new File([await r.blob()], 'exemple.csv')); }
      catch { toast('❌ Impossible de charger le fichier d\'exemple.'); }
    }
    if (action === 'clear' && confirm(`Supprimer définitivement les ${clients.length} clients de cet appareil ?`)) {
      clients = []; save(); renderMarkers(); renderList();
    }
  });

  // ---------- Démarrage ----------
  renderMarkers(); renderList();
  $('#locateBtn').classList.toggle('active', settings.follow);
  if (!me) fitAll();
  startWatch();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
