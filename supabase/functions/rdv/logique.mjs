// Règles de la fonction « rdv », sans accès au réseau (testées par tests/unit/rdv.test.mjs).

export const RESULTATS = { commande: 'Commande passée', devis: 'Devis à envoyer', relance: 'À relancer', absent: 'Client absent / annulé' };
export const CONSERVATION_AUDIO = 'P6M'; // les enregistrements sont supprimés de HubSpot après 6 mois
export const FENETRE_JOURS = 14;        // rendez-vous proposés : de 14 jours avant à 14 jours après aujourd'hui

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (d, opts) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', ...opts });
const jourHeure = d => date(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Rendez-vous HubSpot → liste triée du plus proche de maintenant au plus lointain.
export function trierRdv(meetings, now = Date.now()) {
  const fenetre = FENETRE_JOURS * 86400_000;
  return meetings
    .map(m => {
      const p = m.properties ?? {};
      const debut = Date.parse(p.hs_meeting_start_time ?? p.hs_timestamp ?? '');
      const fin = Date.parse(p.hs_meeting_end_time ?? '') || debut;
      return { id: String(m.id), titre: p.hs_meeting_title || 'Rendez-vous', debut, fin, resultat: p.hs_meeting_outcome || '' };
    })
    .filter(m => Number.isFinite(m.debut) && Math.abs(m.debut - now) <= fenetre)
    .sort((a, b) => ecart(a, now) - ecart(b, now))
    .map(m => ({ ...m, debut: new Date(m.debut).toISOString(), fin: new Date(m.fin).toISOString() }));
}
// Un rendez-vous en cours compte comme « maintenant ».
const ecart = (m, now) => (now >= m.debut && now <= m.fin ? 0 : Math.min(Math.abs(m.debut - now), Math.abs(m.fin - now)));

// Compte rendu écrit dans les notes internes du rendez-vous HubSpot (texte enrichi).
export function notesCompteRendu(v, { client = '', relanceLe = null } = {}) {
  const lignes = [
    `<p><strong>Compte rendu Carte Clients</strong> — ${esc(jourHeure(v.at))} — ${esc(v.user_email)}</p>`,
    `<p>${v.type === 'appel' ? 'Appel' : 'Visite'}${client ? ` · ${esc(client)}` : ''}${v.resultat ? ` · <strong>${esc(RESULTATS[v.resultat] ?? v.resultat)}</strong>` : ''}</p>`,
  ];
  if (String(v.notes ?? '').trim()) lignes.push(`<p>${esc(v.notes.trim()).replace(/\r?\n/g, '<br>')}</p>`);
  const relance = relanceLe ?? v.relance_le;
  if (relance) lignes.push(`<p>Relance prévue le ${esc(date(relance + 'T12:00:00Z', { day: '2-digit', month: '2-digit', year: 'numeric' }))}</p>`);
  if (v.audio_consentement) lignes.push(`<p>🎙 Enregistrement audio joint (${dureeTexte(v.audio_duree)}). Accord du client confirmé à ${esc(date(v.audio_consentement, { hour: '2-digit', minute: '2-digit' }))}. Supprimé automatiquement après 6 mois.</p>`);
  return lignes.join('');
}

export function dureeTexte(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
}

// Ajoute le compte rendu aux notes déjà présentes sur le rendez-vous (remplacé, pas dupliqué, si on renvoie).
export function fusionnerNotes(existantes, ajout, visiteId) {
  const marque = `<!-- cr:${visiteId} -->`;
  const avant = String(existantes ?? '').replace(new RegExp(`${marque}[\\s\\S]*?<!-- /cr -->`, 'g'), '').trim().replace(/(<br>\s*)+$/, '').trim();
  return `${avant}${avant ? '<br>' : ''}${marque}${ajout}<!-- /cr -->`;
}

// Liste « id1;id2 » des pièces jointes d'un rendez-vous, sans doublon.
export function ajouterPieceJointe(existantes, id) {
  const ids = String(existantes ?? '').split(';').map(s => s.trim()).filter(Boolean);
  if (!ids.includes(String(id))) ids.push(String(id));
  return ids.join(';');
}

export const TYPES_AUDIO = { webm: 'audio/webm', mp4: 'audio/mp4', m4a: 'audio/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
export function nomFichierAudio(v, client = '') {
  const ext = String(v.audio_path ?? '').split('.').pop().toLowerCase();
  const propre = String(client).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  const jour = date(v.at, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[^\d]+/g, '-').replace(/-$/, '');
  return `RDV-${propre}-${jour}.${TYPES_AUDIO[ext] ? ext : 'webm'}`;
}

// Titre et horaires d'un rendez-vous créé par l'appli quand aucun n'était planifié.
export function nouveauRdv(v, client) {
  const fin = Date.parse(v.at);
  const debut = fin - Math.max(Number(v.audio_duree) || 0, 30 * 60) * 1000;
  return {
    hs_meeting_title: `${v.type === 'appel' ? 'Appel' : 'Visite'} — ${client}`.slice(0, 250),
    hs_timestamp: new Date(debut).toISOString(),
    hs_meeting_start_time: new Date(debut).toISOString(),
    hs_meeting_end_time: new Date(fin).toISOString(),
  };
}
