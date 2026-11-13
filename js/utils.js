// Fonctions utilitaires pures (sans accès à la page ni à l'état de l'appli).

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const hasPos = c => Number.isFinite(c.lat) && Number.isFinite(c.lng);
export const fullAddress = c => [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Distance à vol d'oiseau en km.
export function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function fmtDist(km) {
  if (km == null) return '—';
  return km < 1 ? `${Math.round(km * 100) * 10} m` : km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}
// Estimation grossière du temps en voiture (distance à vol d'oiseau × 1,3).
export function fmtEta(km) {
  const road = km * 1.3, speed = road < 5 ? 25 : road < 30 ? 50 : 80;
  const min = Math.max(1, Math.round(road / speed * 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export function fmtDuration(min) {
  min = Math.max(1, Math.round(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}


export const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', '&', 'à', 'au', 'aux', 'sarl', 'sas', 'eurl', 'sa']);
export function initials(name) {
  const words = String(name || '?').split(/[\s'’\-.@_]+/).filter(w => w && !STOP.has(w.toLowerCase()));
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
}
export const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#b45309', '#0d9488', '#c026d3'];
export function colorFor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }

// Normalise un nom de colonne : minuscules, sans accents ni ponctuation.
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Liens d'itinéraire et d'appel.
export const routeUrl = c => `https://www.google.com/maps/dir/?api=1&destination=${hasPos(c) ? `${c.lat},${c.lng}` : encodeURIComponent(fullAddress(c))}`;
export const wazeUrl = c => hasPos(c) ? `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(fullAddress(c))}&navigate=yes`;
export const telUrl = c => `tel:${String(c.telephone).replace(/[^\d+]/g, '')}`;
