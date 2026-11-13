// Temps de trajet entre deux clients (itinéraire simulé).
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, ville, lat, lng) => ({ id, nom, adresse: '', code_postal: '', ville, telephone: '', email: '', notes: '', lat, lng, hubspot_id: null, code_client: null, created_by: 'u-admin' });

test('trajet A → B depuis la fiche, inversion et retour', async ({ page }) => {
  await seed(page, { clients: [client('a', 'Client Paris', 'Paris', 48.8566, 2.3522), client('b', 'Client Versailles', 'Versailles', 48.8049, 2.1204)] });
  await login(page);
  await page.click('.chip[data-r="0"]');
  await page.click('#list li[data-id="a"]');
  await page.click('[data-act=route]');
  await expect(page.locator('#rA')).toHaveValue('Client Paris');
  await expect(page.locator('#rB')).toBeFocused();
  await page.fill('#rB', 'versail');
  await page.click('#rSuggest [data-pick="b"]');
  await expect(page.locator('.r-time')).toHaveText(/\d+ min/);
  await expect(page.locator('.r-card')).toContainText('Client Paris → Client Versailles');
  await expect(page.locator('.route-pin')).toHaveCount(2);
  await page.click('#rSwap');
  await expect(page.locator('#rA')).toHaveValue('Client Versailles');
  await expect(page.locator('.r-card')).toContainText('Client Versailles → Client Paris');
  await page.click('#routeBack');
  await expect(page.locator('#detailView')).toBeVisible();
  await expect(page.locator('.route-pin')).toHaveCount(0);
});

test('« Ma position » comme point de départ', async ({ page }) => {
  await seed(page, { clients: [client('b', 'Client Lyon', 'Lyon', 45.764, 4.8357)] });
  await login(page);
  await page.click('#routeBtn');
  await page.click('#rSuggest [data-pick=me]');
  await page.click('#rSuggest [data-pick="b"]');
  await expect(page.locator('.r-card')).toContainText('Ma position → Client Lyon');
  await expect(page.locator('.r-time')).toHaveText(/h/);
});
