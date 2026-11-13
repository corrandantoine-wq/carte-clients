// Import d'une base clients (extraction ERP, CSV ou Excel) : lecture du fichier,
// reconnaissance des colonnes et préparation de l'import (nouveaux / mis à jour).
import { num, norm } from './utils.js';

// Champs de l'appli et noms de colonnes habituels (ERP français et internationaux).
export const FIELDS = [
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

// Clé identifiant un format de fichier (ses colonnes), pour mémoriser la correspondance choisie.
export const mappingKey = headers => headers.map(norm).join('|');

export function guessMapping(headers, savedMappings = {}) {
  const saved = savedMappings[mappingKey(headers)];
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
export async function readTable(file) {
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
export function fixCp(v) { v = String(v ?? '').trim(); return /^\d{4}$/.test(v) ? '0' + v : v; }
export function fixTel(v) { v = String(v ?? '').trim(); return /^[1-9]\d{8}$/.test(v) ? '0' + v : v; }

// Transforme une ligne du fichier en client, avec uniquement les champs choisis.
export function rowToClient(r, m) {
  const get = k => (m[k] != null ? String(r[m[k]] ?? '').trim() : '');
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
export function planImport(data, mapping, clients) {
  const byCode = new Map(clients.filter(c => c.code_client).map(c => [c.code_client, c]));
  const inFile = new Map(), noCode = [];
  let skipped = 0;
  for (const r of data) {
    const c = rowToClient(r, mapping);
    if (!c.nom) { skipped++; continue; }
    if (c.code_client) { if (!inFile.has(c.code_client)) inFile.set(c.code_client, c); } // doublon : on garde la 1re ligne
    else noCode.push(c);
  }
  const updates = [], creates = [];
  for (const [code, c] of inFile) (byCode.has(code) ? updates : creates).push(c);
  return { byCode, updates, creates, noCode, skipped, dupInFile: data.length - skipped - noCode.length - inFile.size };
}
