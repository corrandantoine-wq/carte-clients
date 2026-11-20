// Données de la démonstration : entreprises FICTIVES autour de Lyon (noms et adresses inventés).
// Aucune donnée réelle : tout reste dans la mémoire du navigateur et disparaît à la fermeture.
(() => {
  const COMMUNES = [
    ['Lyon 3e', '69003', 45.7597, 4.8422], ['Lyon 7e', '69007', 45.7458, 4.8429], ['Lyon 9e', '69009', 45.7743, 4.8048],
    ['Villeurbanne', '69100', 45.7719, 4.8902], ['Vénissieux', '69200', 45.6975, 4.8868], ['Bron', '69500', 45.7383, 4.9131],
    ['Caluire-et-Cuire', '69300', 45.7953, 4.8467], ['Écully', '69130', 45.7744, 4.7775], ['Oullins', '69600', 45.7142, 4.8075],
    ['Vaulx-en-Velin', '69120', 45.7786, 4.9206], ['Saint-Priest', '69800', 45.6957, 4.9442], ['Décines-Charpieu', '69150', 45.7686, 4.9586],
    ['Meyzieu', '69330', 45.7667, 5.0036], ['Tassin-la-Demi-Lune', '69160', 45.7631, 4.7542], ['Limonest', '69760', 45.8372, 4.7714],
    ['Neuville-sur-Saône', '69250', 45.8761, 4.8414], ['Givors', '69700', 45.5906, 4.7689], ['Rillieux-la-Pape', '69140', 45.8203, 4.8983],
  ];
  const METIERS = ['Boulangerie', 'Épicerie fine', 'Café', 'Restaurant', 'Brasserie', 'Fromagerie', 'Cave à vins', 'Traiteur', 'Hôtel', 'Pâtisserie', 'Supérette', 'Crêperie'];
  const NOMS = ['du Parc', 'des Lilas', 'Saint-Martin', 'Le Comptoir', 'La Fontaine', 'Les Tilleuls', 'du Marché', 'Le Relais', 'Belle Rive', 'Le Moulin',
    'des Canuts', 'La Croix', 'Le Platane', 'du Pont', 'Les Glycines', 'La Halle', 'du Square', 'Le Phare', 'Les Coteaux', 'Bellevue'];
  const RUES = ['rue des Lilas', 'avenue des Platanes', 'place du Marché', 'rue de la République', 'boulevard des Tilleuls', 'rue du Moulin', 'rue des Écoles', 'chemin des Vignes'];
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // suite pseudo-aléatoire fixe : même démo à chaque ouverture
  const me = 'demo@carte-clients.fr', now = Date.now(), jour = 86400e3, iso = t => new Date(t).toISOString();
  const clients = [];
  for (let i = 0; i < 42; i++) {
    const [ville, cp, lat, lng] = COMMUNES[i % COMMUNES.length];
    const nom = `${METIERS[i % METIERS.length]} ${NOMS[(i * 7) % NOMS.length]}`;
    clients.push({
      id: `d${i + 1}`, nom, code_client: `C${String(1000 + i * 13).padStart(5, '0')}`,
      adresse: `${1 + Math.floor(rnd() * 80)} ${RUES[i % RUES.length]}`, code_postal: cp, ville,
      telephone: '', email: '', notes: i % 5 === 0 ? 'Livraison le matin avant 10 h.' : '',
      lat: lat + (rnd() - 0.5) * 0.03, lng: lng + (rnd() - 0.5) * 0.04,
      hubspot_id: i % 3 === 0 ? String(90000 + i) : null, created_by: 'u-demo', deleted_at: null,
      assigned_to: i % 2 === 0 ? me : null,
    });
  }
  const RES = ['commande', 'devis', 'relance', 'commande', 'absent'];
  const NOTES = ['Commande de 12 cartons, livraison mardi.', 'Intéressé par la nouvelle gamme : devis à envoyer.', 'Rappeler après les fêtes.', 'Réassort habituel.', 'Gérant absent, repasser.'];
  const visites = [];
  for (let i = 0; i < 14; i++) {
    const c = clients[(i * 3) % clients.length], at = iso(now - (i < 6 ? i * 0.6 : i * 4) * jour - 3 * 36e5);
    visites.push({ id: `v${i + 1}`, client_id: c.id, user_id: 'u-demo', user_email: me, at, type: i % 4 === 3 ? 'appel' : 'visite', resultat: RES[i % RES.length],
      notes: NOTES[i % NOTES.length], relance_le: null, hubspot_meeting_id: c.hubspot_id ? String(7000 + i) : null, audio_path: null, audio_duree: null,
      audio_consentement: null, hubspot_file_id: null, hubspot_statut: c.hubspot_id ? 'envoye' : 'aucun', hubspot_erreur: null });
  }
  window.__DEMO__ = { position: { latitude: 45.7605, longitude: 4.8590 }, email: me, password: 'demo-carte-clients' }; // Lyon Part-Dieu
  window.__SEED__ = {
    users: [{ id: 'u-demo', email: me, password: window.__DEMO__.password, confirmed: true }],
    members: [{ email: me, role: 'user' }],
    clients, visites,
    favorites: [{ user_id: 'u-demo', client_id: 'd2' }, { user_id: 'u-demo', client_id: 'd5' }],
    tournees: [{ id: 't1', user_id: 'u-demo', user_email: me, nom: 'Tournée du mardi', genre: 'modele', etapes: ['d4', 'd10', 'd16', 'd22', 'd28'], faites: [],
      distance_km: null, duree_min: null, created_at: iso(now - 7 * jour), updated_at: iso(now - 7 * jour) }],
  };
})();
