// Règles de la fonction serveur « rdv » (rendez-vous HubSpot, comptes rendus, enregistrements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trierRdv, notesCompteRendu, fusionnerNotes, ajouterPieceJointe, nomFichierAudio, nouveauRdv, dureeTexte } from '../../supabase/functions/rdv/logique.mjs';

const NOW = Date.parse('2026-11-19T14:00:00Z');
const m = (id, start, end, title) => ({ id, properties: { hs_meeting_title: title, hs_meeting_start_time: start, hs_meeting_end_time: end } });

test('rendez-vous : le plus proche de maintenant en premier, ceux trop lointains écartés', () => {
  const list = trierRdv([
    m(1, '2026-11-25T09:00:00Z', '2026-11-25T10:00:00Z', 'Dans 6 jours'),
    m(2, '2026-11-19T13:30:00Z', '2026-11-19T14:30:00Z', 'En cours'),
    m(3, '2026-11-18T09:00:00Z', '2026-11-18T10:00:00Z', 'Hier'),
    m(4, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', 'Il y a 7 semaines'),
    { id: 5, properties: { hs_meeting_title: 'Sans date' } },
  ], NOW);
  assert.deepEqual(list.map(r => r.titre), ['En cours', 'Hier', 'Dans 6 jours']);
  assert.equal(list[0].id, '2');
});

test('compte rendu : texte lisible, caractères spéciaux protégés, consentement mentionné', () => {
  const html = notesCompteRendu({ at: '2026-11-19T13:05:00Z', user_email: 'bob@soc.fr', type: 'visite', resultat: 'devis',
    notes: 'Prix <à revoir>\nRappeler Mme Dupont', relance_le: '2026-11-26', audio_consentement: '2026-11-19T12:10:00Z', audio_duree: 2735 }, { client: 'Boulangerie & Fils' });
  assert.match(html, /19\/11\/2026 14:05/);              // heure de Paris
  assert.match(html, /Boulangerie &amp; Fils/);
  assert.match(html, /Devis à envoyer/);
  assert.match(html, /Prix &lt;à revoir&gt;<br>Rappeler/);
  assert.match(html, /Relance prévue le 26\/11\/2026/);
  assert.match(html, /45 min 35 s/);
  assert.match(html, /Accord du client confirmé à 13:10/);
});

test('renvoyer un compte rendu le remplace dans les notes au lieu de le dupliquer', () => {
  const une = fusionnerNotes('<p>Ordre du jour</p>', '<p>CR v1</p>', 'abc');
  const deux = fusionnerNotes(une, '<p>CR v2</p>', 'abc');
  assert.equal(deux, '<p>Ordre du jour</p><br><!-- cr:abc --><p>CR v2</p><!-- /cr -->');
  assert.equal(fusionnerNotes('', '<p>x</p>', 'z'), '<!-- cr:z --><p>x</p><!-- /cr -->');
});

test('pièces jointes du rendez-vous : ajout sans doublon', () => {
  assert.equal(ajouterPieceJointe('', 7), '7');
  assert.equal(ajouterPieceJointe('3;7', '7'), '3;7');
  assert.equal(ajouterPieceJointe('3', 8), '3;8');
});

test('nom du fichier audio et rendez-vous créé quand rien n’était planifié', () => {
  const v = { at: '2026-11-19T13:05:00Z', audio_path: 'x.mp4', audio_duree: 3600, type: 'visite' };
  assert.equal(nomFichierAudio(v, 'Boulangerie Dupont (Paris)'), 'RDV-Boulangerie-Dupont-Paris-19-11-2026-14-05.mp4');
  const r = nouveauRdv(v, 'Boulangerie Dupont');
  assert.equal(r.hs_meeting_title, 'Visite — Boulangerie Dupont');
  assert.equal(r.hs_meeting_end_time, '2026-11-19T13:05:00.000Z');
  assert.equal(r.hs_meeting_start_time, '2026-11-19T12:05:00.000Z');
  assert.equal(dureeTexte(42), '42 s');
  assert.equal(dureeTexte(3725), '1 h 02');
});
