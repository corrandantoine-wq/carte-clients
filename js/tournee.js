// Tournée : ordre de visite optimisé (le plus court en distance), sans réseau.
// Méthode : on part du plus proche, puis on améliore l'ordre en « décroisant » les trajets (2-opt).
// Suffisant et instantané jusqu'à une trentaine d'arrêts ; distances à vol d'oiseau, le temps
// réel de chaque tronçon est ensuite calculé par l'IGN.
import { haversine } from './utils.js';

export const MAX_ETAPES = 25;

// Longueur d'un parcours (départ facultatif, puis les arrêts dans l'ordre).
export function longueur(depart, arrets) {
  const pts = depart ? [depart, ...arrets] : arrets;
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

// arrets : [{ id, lat, lng }] ; depart : { lat, lng } ou null (on part alors du 1er arrêt).
export function optimiser(arrets, depart = null) {
  if (arrets.length < 3 && !depart) return [...arrets];
  // 1. Plus proche voisin.
  const reste = [...arrets], ordre = [];
  let cur = depart || reste.shift();
  if (!depart) ordre.push(cur);
  while (reste.length) {
    let best = 0, bd = Infinity;
    reste.forEach((p, i) => { const d = haversine(cur, p); if (d < bd) { bd = d; best = i; } });
    cur = reste.splice(best, 1)[0]; ordre.push(cur);
  }
  // 2. 2-opt : on inverse un morceau du parcours tant que ça le raccourcit.
  const fixeDebut = depart ? 0 : 1; // sans point de départ, le 1er arrêt reste le premier
  let mieux = true, tours = 0;
  while (mieux && tours++ < 50) {
    mieux = false;
    for (let i = fixeDebut; i < ordre.length - 1; i++) {
      for (let k = i + 1; k < ordre.length; k++) {
        const essai = [...ordre.slice(0, i), ...ordre.slice(i, k + 1).reverse(), ...ordre.slice(k + 1)];
        if (longueur(depart, essai) + 1e-9 < longueur(depart, ordre)) { ordre.splice(0, ordre.length, ...essai); mieux = true; }
      }
    }
  }
  return ordre;
}

// Tronçons (km, min) à partir de la réponse IGN ; à défaut, répartis selon les distances à vol d'oiseau.
export function troncons(points, res) {
  const n = points.length - 1;
  if (Array.isArray(res?.portions) && res.portions.length === n) {
    return res.portions.map(p => ({ km: +p.distance || 0, min: +p.duration || 0 }));
  }
  const vol = points.slice(1).map((p, i) => haversine(points[i], p));
  const total = vol.reduce((a, b) => a + b, 0) || 1;
  return vol.map(d => ({ km: (res?.distance ?? total * 1.3) * d / total, min: (res?.duration ?? total * 1.3) * d / total }));
}
