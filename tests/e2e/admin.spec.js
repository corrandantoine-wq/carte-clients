// Administration (collaborateurs, champs HubSpot) et liaison d'un client à HubSpot (simulée).
const { test, expect, seed, login } = require('../support/fixtures');

test('inviter un collaborateur : ajout à la liste et e-mail d’invitation', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  await page.fill('#memberForm [name=email]', 'Claire@Soc.fr');
  await page.click('#memberForm .btn');
  await expect(page.locator('#membersList')).toContainText('claire@soc.fr');
  await expect(page.locator('#toastMsg')).toHaveText('Invitation envoyée à claire@soc.fr.');
  expect(await page.evaluate(() => window.__db.members.map(m => m.email))).toContain('claire@soc.fr');
  expect(await page.evaluate(() => window.__db.invites)).toEqual(['claire@soc.fr']);
});

test('renvoyer l’invitation à quelqu’un qui a déjà un compte actif', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  await page.click('#membersList li[data-email="bob@soc.fr"] [data-invite]');
  await expect(page.locator('#toastMsg')).toContainText('bob@soc.fr a déjà un compte actif');
});

test('double clic sur « Inviter » : une seule invitation, aucun message d’erreur', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  await page.fill('#memberForm [name=email]', 'claire@soc.fr');
  await page.dblclick('#memberForm .btn');
  await expect(page.locator('#memberForm .btn')).toBeDisabled(); // bloqué pendant l'envoi
  await expect(page.locator('#toastMsg')).toHaveText('Invitation envoyée à claire@soc.fr.');
  await expect(page.locator('#memberForm .btn')).toBeEnabled();
  expect(await page.evaluate(() => window.__db.inviteCalls)).toBe(1);
  expect(await page.evaluate(() => window.__db.invites)).toEqual(['claire@soc.fr']);
});

test('renvoyer une invitation encore en attente', async ({ page }) => {
  await seed(page, { members: [{ email: 'gre@soc.fr', role: 'user' }], users: [{ id: 'u-gre', email: 'gre@soc.fr', password: null, confirmed: false }] });
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  const resend = page.locator('#membersList li[data-email="gre@soc.fr"] [data-invite]');
  await resend.click(); await resend.click(); // deux appuis rapides
  await expect(page.locator('#toastMsg')).toHaveText('Invitation renvoyée à gre@soc.fr (elle était encore en attente).');
  expect(await page.evaluate(() => window.__db.inviteCalls)).toBe(1);
});

test('choisir les champs HubSpot affichés', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=crmfields]');
  await page.check('#fieldsList input[value=annualrevenue]');
  await page.click('#fieldsSave');
  await expect.poll(() => page.evaluate(() => window.__db.crm_fields.map(f => f.property))).toContain('annualrevenue');
});

test('relier un client à HubSpot et afficher ses données', async ({ page }) => {
  await seed(page, { clients: [{ id: 'c1', nom: 'Boulangerie Dupont', adresse: '', code_postal: '75004', ville: 'Paris', telephone: '', email: '', notes: '', lat: 48.8556, lng: 2.358, hubspot_id: null, code_client: null, created_by: 'u-admin' }] });
  await login(page);
  await page.click('#list li[data-id="c1"]');
  await page.click('[data-act=hs-link]');
  await page.click('#hsResults [data-hs="1001"]');
  await expect(page.locator('#crm')).toContainText('Boulangerie Dupont SAS');
  await expect(page.locator('#crm')).toContainText('Étape du cycle de vie');
  expect(await page.evaluate(() => window.__db.clients[0].hubspot_id)).toBe('1001');
});

test('importer le fichier client depuis HubSpot : nouveaux clients et mise à jour par fiche', async ({ page }) => {
  await seed(page, {
    clients: [{ id: 'c1', nom: 'Dupont', adresse: '', code_postal: '75004', ville: 'Paris', telephone: '', email: '', notes: 'Note du commercial', lat: 48.8556, lng: 2.358, hubspot_id: '1001', code_client: 'CLI9', created_by: 'u-admin' }],
    hubspotCompanies: [
      ['1001', 'Boulangerie Dupont SAS', '12 rue de Rivoli', '', '75004', 'Paris', '0102030405', 'dupont.fr'],
      ['1002', 'Crèmerie Lyonnaise', '3 place Bellecour', '', '69002', 'Lyon', '', ''],
    ],
  });
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=hsimport]');
  await expect(page.locator('#impFileInfo')).toContainText('HubSpot · 2 lignes');
  await expect(page.locator('select[data-field=hubspot_id]')).toHaveValue('0');
  await expect(page.locator('#impSummary')).toContainText('1 nouveau client');
  await expect(page.locator('#impSummary')).toContainText('(même fiche HubSpot)');
  await page.click('#impGo');
  await expect(page.locator('#impSteps li').last()).toHaveClass('done');
  const db = await page.evaluate(() => window.__db.clients);
  expect(db).toHaveLength(2);
  expect(db.find(c => c.id === 'c1')).toMatchObject({ nom: 'Boulangerie Dupont SAS', code_client: 'CLI9', notes: 'Note du commercial', hubspot_id: '1001' });
  expect(db.find(c => c.hubspot_id === '1002')).toMatchObject({ nom: 'Crèmerie Lyonnaise', ville: 'Lyon' });
  expect(db.find(c => c.hubspot_id === '1002').lat).not.toBeNull();

  // Un second import ne crée aucun doublon.
  await page.click('#impCancel');
  await page.click('#userBtn');
  await page.click('[data-action=hsimport]');
  await expect(page.locator('#impSummary')).toContainText('2 clients déjà présents mis à jour');
});

test('import HubSpot pas encore branché : message clair', async ({ page }) => {
  await seed(page, { hubspotOff: true });
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=hsimport]');
  await expect(page.locator('#toastMsg')).toContainText('HubSpot n\'est pas encore configuré');
});
