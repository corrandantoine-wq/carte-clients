// Administration (collaborateurs, champs HubSpot) et liaison d'un client à HubSpot (simulée).
const { test, expect, seed, login } = require('../support/fixtures');

test('ajouter un collaborateur', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  await page.fill('#memberForm [name=email]', 'Claire@Soc.fr');
  await page.click('#memberForm .btn');
  await expect(page.locator('#membersList')).toContainText('claire@soc.fr');
  expect(await page.evaluate(() => window.__db.members.map(m => m.email))).toContain('claire@soc.fr');
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
