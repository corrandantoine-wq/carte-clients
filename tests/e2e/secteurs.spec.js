// Secteurs : commercial attitré, filtre « Mes clients », attribution par l'administrateur.
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, assigned_to = null) => ({ id, nom, adresse: '', code_postal: '75001', ville: 'Paris', telephone: '', email: '', notes: '', lat: 48.86, lng: 2.34, hubspot_id: null, code_client: null, created_by: 'u-admin', deleted_at: null, assigned_to });

test('un commercial prend un client libre, le retrouve dans « Mes clients », puis le rend', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Client libre'), client('c2', 'Client de l’admin', 'admin@soc.fr')] });
  await login(page, 'bob@soc.fr');
  await page.click('.chip[data-mine]');
  await expect(page.locator('#title')).toHaveText('Mes clients');
  await expect(page.locator('#list')).toContainText('Aucun client ne vous est attribué');
  await page.click('[data-empty=allowners]');
  await page.click('#list li[data-id="c1"]');
  await expect(page.locator('.owner-row')).toContainText('Non attribué');
  await page.click('[data-act=take]');
  await expect(page.locator('.owner-row .val')).toHaveText('Vous');
  expect(await page.evaluate(() => window.__db.clients.find(c => c.id === 'c1').assigned_to)).toBe('bob@soc.fr');
  await page.click('#backBtn');
  await page.click('.chip[data-mine]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  await expect(page.locator('#list li[data-id="c1"] .badge.mine')).toHaveText('vous');
  await page.click('#list li[data-id="c1"]');
  await page.click('[data-act=release]');
  await expect(page.locator('.owner-row .val')).toHaveText('Non attribué');
});

test('un commercial ne peut pas prendre le client d’un collègue', async ({ page }) => {
  await seed(page, { clients: [client('c2', 'Client de l’admin', 'admin@soc.fr')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="c2"]');
  await expect(page.locator('.owner-row .val')).toHaveText('admin@soc.fr');
  await expect(page.locator('[data-act=take], [data-act=release], [data-assign]')).toHaveCount(0);
});

test('l’administrateur attribue un client et filtre par commercial', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Pharmacie'), client('c2', 'Garage')] });
  await login(page);
  await page.click('#list li[data-id="c1"]');
  await page.selectOption('[data-assign]', 'bob@soc.fr');
  await expect(page.locator('[data-assign]')).toHaveValue('bob@soc.fr');
  expect(await page.evaluate(() => window.__db.clients.find(c => c.id === 'c1').assigned_to)).toBe('bob@soc.fr');
  await page.click('#backBtn');
  await page.selectOption('#ownerSel', 'bob@soc.fr');
  await expect(page.locator('#title')).toHaveText('Secteur de bob');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  await page.selectOption('#ownerSel', 'none');
  await expect(page.locator('#list li[data-id="c2"]')).toBeVisible();
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  // L'attribution est dans l'historique
  await page.selectOption('#ownerSel', '');
  await page.click('#list li[data-id="c1"]');
  await page.click('#hist summary');
  await expect(page.locator('#histBody')).toContainText('Commercial attitré : vide → « bob@soc.fr »');
});
