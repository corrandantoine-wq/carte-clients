// Comptes rendus de visite : rendez-vous HubSpot, enregistrement du rendez-vous (avec accord du client),
// envoi dans HubSpot, reprise après coupure, liste « Mes comptes rendus ».
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, extra = {}) => ({ id, nom, adresse: '', code_postal: '75001', ville: 'Paris', telephone: '', email: '', notes: '', lat: 48.8566, lng: 2.3522,
  hubspot_id: '555', code_client: null, created_by: 'u-admin', assigned_to: null, ...extra });

// Micro simulé : un son de synthèse (aucun vrai micro dans les tests).
async function fakeMic(page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(), osc = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start(); await ctx.resume();
      return dest.stream;
    };
  });
}
const db = (page, expr) => page.evaluate(expr);

test('compte rendu avec enregistrement, rattaché au rendez-vous HubSpot planifié', async ({ page }) => {
  await fakeMic(page);
  await seed(page, { clients: [client('a', 'Boulangerie Dupont')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await expect(page.locator('#crDialog')).toBeVisible();
  // Le rendez-vous en cours est proposé d'office.
  await expect(page.locator('#crRdv')).toHaveValue('7001');
  await expect(page.locator('#crRdv option').first()).toContainText('Présentation gamme');
  // Pas d'enregistrement sans l'accord du client.
  await expect(page.locator('#recStart')).toBeDisabled();
  await page.check('#recConsent');
  await page.click('#recStart');
  await expect(page.locator('#recLive')).toBeVisible();
  await expect(page.locator('#recWarn')).toContainText('déverrouillé');
  await page.waitForTimeout(1500);
  await page.click('#recPause');
  await expect(page.locator('#recState')).toHaveText('En pause');
  await page.click('#recPause');
  await page.click('#recStop');
  await expect(page.locator('#recDone')).toBeVisible();
  await page.click('#crForm .seg span:text("Devis à envoyer")');
  await page.fill('#crNotes', 'Intéressé par la gamme bio');
  await page.click('#crSave');
  await expect(page.locator('#crDialog')).toBeHidden();

  // Envoyé dans HubSpot : compte rendu dans le rendez-vous 7001, audio joint, stockage temporaire vidé.
  await expect.poll(() => db(page, () => window.__db.visites[0]?.hubspot_statut)).toBe('envoye');
  const v = await db(page, () => window.__db.visites[0]);
  expect(v).toMatchObject({ hubspot_meeting_id: '7001', resultat: 'devis', notes: 'Intéressé par la gamme bio', user_email: 'bob@soc.fr', audio_path: null });
  expect(v.audio_consentement).not.toBeNull();
  expect(await db(page, () => window.__db.hubspot.meetings['7001'])).toMatchObject({ attachments: ['f0'], outcome: 'COMPLETED' });
  expect(await db(page, () => Object.keys(window.__db.storage).length)).toBe(0);

  // Visible sur la fiche et dans la liste.
  await expect(page.locator('#visitsBody .visit')).toHaveCount(1);
  await expect(page.locator('#visitsBody')).toContainText('Devis à envoyer');
  await expect(page.locator('#visitsBody .hs-st')).toHaveText('Dans HubSpot');
  await page.click('#visitsBody [data-act=v-listen]');
  await expect(page.locator('#visitsBody audio')).toHaveCount(1);
  await page.click('#backBtn');
  await expect(page.locator('#list li[data-id="a"] .seen')).toHaveText('vu aujourd’hui');
});

test('client non relié à HubSpot : compte rendu gardé dans l’appli, pas d’enregistrement', async ({ page }) => {
  await seed(page, { clients: [client('a', 'Garage Martin', { hubspot_id: null })] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await expect(page.locator('#crRdv')).toBeDisabled();
  await expect(page.locator('#crRdvHint')).toContainText('reliez d’abord ce client');
  await expect(page.locator('#recConsent')).toBeDisabled();
  await page.click('#crSave');
  await expect(page.locator('#toast')).toContainText('au moins un résultat');
  await page.click('#crForm .seg span:text("Client absent / annulé")');
  await page.click('#crSave');
  await expect(page.locator('#visitsBody .visit')).toHaveCount(1);
  expect(await db(page, () => window.__db.visites[0].hubspot_statut)).toBe('aucun');
  expect(await db(page, () => window.__db.hubspot.calls.filter(c => c.action === 'envoyer').length)).toBe(0);
});

test('aucun rendez-vous planifié : un rendez-vous est créé ; HubSpot en panne puis « Renvoyer »', async ({ page }) => {
  await seed(page, { clients: [client('a', 'Fromagerie')], rdv: [], hubspotDown: true });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await expect(page.locator('#crRdvHint')).toContainText('un rendez-vous sera créé');
  await expect(page.locator('#crRdv')).toHaveValue('new');
  await page.fill('#crNotes', 'Commande de Noël');
  await page.click('#crSave');
  await expect(page.locator('#visitsBody .hs-st')).toHaveText('Envoi HubSpot échoué');
  await expect(page.locator('#visitsBody .visit-err')).toContainText('503');
  await page.evaluate(() => { window.__SEED__.hubspotDown = false; });
  await page.click('#visitsBody [data-act=v-retry]');
  await expect(page.locator('#visitsBody .hs-st')).toHaveText('Dans HubSpot');
  expect(await db(page, () => window.__db.visites[0].hubspot_meeting_id)).toBe('9001');
});

test('fermer pendant un enregistrement demande confirmation et n’enregistre rien', async ({ page }) => {
  await fakeMic(page);
  await seed(page, { clients: [client('a', 'Boulangerie Dupont')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await page.check('#recConsent');
  await page.click('#recStart');
  await expect(page.locator('#recLive')).toBeVisible();
  const asked = [];
  page.on('dialog', d => asked.push(d.message()));
  await page.click('#crCancel');
  await expect(page.locator('#crDialog')).toBeHidden();
  expect(asked.join()).toContain('Abandonner');
  expect(await db(page, () => window.__db.visites.length)).toBe(0);
});

test('enregistrement interrompu (appli fermée) : récupéré à la réouverture', async ({ page }) => {
  await fakeMic(page);
  await seed(page, { clients: [client('a', 'Boulangerie Dupont')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await page.check('#recConsent');
  await page.click('#recStart');
  await page.waitForTimeout(5600); // un morceau de 5 s est sauvegardé sur le téléphone
  await login(page, 'bob@soc.fr'); // l'appli est rouverte
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=cr]');
  await expect(page.locator('#recRecover')).toContainText('Enregistrement interrompu retrouvé');
  await page.click('[data-recover=keep]');
  await expect(page.locator('#recDone')).toBeVisible();
  await expect(page.locator('#recConsent')).toBeChecked();
  await page.click('#crSave');
  await expect.poll(() => db(page, () => window.__db.visites[0]?.hubspot_statut)).toBe('envoye');
  expect(await db(page, () => window.__db.visites[0].audio_duree)).toBeGreaterThan(3);
});

test('mes comptes rendus : liste de la semaine, clients à revoir, export réservé à l’admin', async ({ page }) => {
  const old = new Date(Date.now() - 45 * 86400e3).toISOString();
  await seed(page, {
    clients: [client('a', 'Vu récemment', { assigned_to: 'bob@soc.fr' }), client('b', 'Jamais vu', { assigned_to: 'bob@soc.fr' }), client('c', 'Vu il y a longtemps', { assigned_to: 'bob@soc.fr' })],
    visites: [
      { id: 'v1', client_id: 'a', user_id: 'u-bob', user_email: 'bob@soc.fr', at: new Date().toISOString(), type: 'visite', resultat: 'commande', notes: 'ok', hubspot_statut: 'envoye' },
      { id: 'v2', client_id: 'c', user_id: 'u-bob', user_email: 'bob@soc.fr', at: old, type: 'appel', resultat: 'relance', notes: '', hubspot_statut: 'aucun' }],
  });
  await login(page, 'bob@soc.fr');
  await page.click('#menuBtn');
  await page.click('[data-action=reports]');
  await expect(page.locator('#reportsList li[data-client]')).toHaveCount(1);
  await expect(page.locator('#reportsList')).toContainText('Commande passée');
  await expect(page.locator('#staleList li[data-client]')).toHaveText([/Jamais vu.*jamais vu/, /Vu il y a longtemps.*vu il y a 45 j/]);
  await expect(page.locator('#reportsExport')).toBeHidden();
  await page.click('#staleList li[data-client="b"]');
  await expect(page.locator('#detail h2')).toHaveText('Jamais vu');
});
