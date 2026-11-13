// Services publics de l'IGN (Géoplateforme), gratuits et sans clé :
// géocodage des adresses (unitaire et par lot) et calcul d'itinéraire.
import { num, sleep } from './utils.js';

// Service public de géocodage (IGN / Base Adresse Nationale) : https://data.geopf.fr/geocodage
export const GEO = 'https://data.geopf.fr/geocodage';
export const MIN_SCORE = 0.5;
// Le résultat est-il cohérent avec le code postal fourni (même département) ?
export const sameDept = (cp, found) => !cp || !found || String(cp).slice(0, 2) === String(found).slice(0, 2);

export async function geocode(address, cp = '') {
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
export async function geocodeBatch(list, onProgress = () => {}, mainLineOnly = false) {
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

// Itinéraire le plus rapide en voiture (temps hors trafic). a, b : { lat, lng }.
export const ROUTE_API = 'https://data.geopf.fr/navigation/itineraire';
export async function fetchRoute(a, b) {
  const url = `${ROUTE_API}?resource=bdtopo-osrm&profile=car&optimization=fastest&start=${a.lng},${a.lat}&end=${b.lng},${b.lat}` +
    '&geometryFormat=geojson&getSteps=false&timeUnit=minute&distanceUnit=kilometer';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`service indisponible (${r.status})`);
  const res = await r.json();
  if (!Number.isFinite(res.duration) || !res.geometry?.coordinates?.length) throw new Error('aucun itinéraire trouvé');
  return res;
}
