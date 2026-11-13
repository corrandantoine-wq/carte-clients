// Corbeille (suppression réversible) et historique des modifications.
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, created_by = 'u-admin', extra = {}) => ({ id, nom, adresse: '', code_postal: '75001', ville: 'Paris', telephone: '0102030405', email: '', notes: '', lat: 48.86, lng: 2.34, hubspot_id: null, code_client: null, created_by, deleted_at: null, ...extra });

test('supprimer met à la corbeille, et « Annuler » restaure aussitôt', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Garage Martin')] });
  await login(page);
  await page.click('#list li[data-id="c1"]');
  await page.click('[data-act=delete]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(0);
  await expect(page.locator('#toastMsg')).toHaveText('« Garage Martin » mis à la corbeille');
  await page.click('#toastAction');
  await expect(page.locator('#list li[data-id="c1"]')).toBeVisible();
  expect(await page.evaluate(() => window.__db.clients[0].deleted_at)).toBeNull();
});

test('la corbeille : un collaborateur restaure, un admin supprime définitivement', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Ancien client', 'u-admin', { deleted_at: '2026-11-10T10:00:00Z' }), client('c2', 'Client actif')] });
  await login(page, 'bob@soc.fr');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1); // les clients à la corbeille ne s'affichent pas
  await page.click('#menuBtn');
  await page.click('[data-action=trash]');
  await expect(page.locator('#trashList li[data-id="c1"]')).toContainText('Ancien client');
  await expect(page.locator('#trashList [data-purge]')).toHaveCount(0); // pas de suppression définitive pour un collaborateur
  await page.click('#trashList li[data-id="c1"] [data-restore]');
  await expect(page.locator('#trashList')).toContainText('La corbeille est vide');
  await page.click('#trashDialog [data-close]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(2);
});

test('l’admin vide la corbeille', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'A jeter', 'u-bob', { deleted_at: '2026-11-10T10:00:00Z' })] });
  await login(page);
  await page.click('#menuBtn');
  await page.click('[data-action=trash]');
  await page.click('#trashEmpty');
  await expect(page.locator('#trashList')).toContainText('La corbeille est vide');
  expect(await page.evaluate(() => window.__db.clients.length)).toBe(0);
});

test('un collaborateur ne peut pas mettre à la corbeille le client d’un autre', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Client de l’admin')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="c1"]');
  await expect(page.locator('[data-act=delete]')).toHaveCount(0);
});

test('historique : qui a modifié quoi', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Pharmacie du Port')] });
  await login(page);
  await page.click('#list li[data-id="c1"]');
  await page.click('[data-act=edit]');
  await page.fill('#clientForm [name=telephone]', '0491000003');
  await page.click('#clientForm [value=save]');
  await page.click('#hist summary');
  const item = page.locator('#histBody .hist-item').first();
  await expect(item).toContainText('Modification');
  await expect(item).toContainText('vous');
  await expect(item).toContainText('Téléphone : « 0102030405 » → « 0491000003 »');
});
