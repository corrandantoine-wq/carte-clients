// Menu épuré, fiche client simplifiée et mises à jour légères (GPS, modifications des collègues).
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, ville, lat, lng) => ({ id, nom, adresse: '', code_postal: '', ville, telephone: '0102030405', email: 'contact@client.fr', notes: '', lat, lng, hubspot_id: null, code_client: null, created_by: 'u-admin' });

test('menu : usage quotidien d’abord, gestion de la base sur une 2e page', async ({ page }) => {
  await login(page);
  await page.click('#menuBtn');
  await expect(page.locator('[data-action=add]')).toBeVisible();
  await expect(page.locator('[data-action=trash]')).toBeHidden();
  await page.click('[data-action=manage]');
  await expect(page.locator('[data-action=trash]')).toBeVisible();
  await expect(page.locator('[data-action=members]')).toBeVisible();
  await page.click('[data-action=back]');
  await expect(page.locator('[data-action=add]')).toBeVisible();
  // Le menu se rouvre toujours sur sa page principale.
  await page.click('[data-action=manage]');
  await page.click('#menuBtn');
  await page.click('#menuBtn');
  await expect(page.locator('[data-action=add]')).toBeVisible();
});

test('fiche : 3 boutons, Waze par défaut, choix de l’appli mémorisé', async ({ page }) => {
  await seed(page, { clients: [client('a', 'Client Paris', 'Paris', 48.8566, 2.3522)] });
  await login(page);
  await page.click('#list li[data-id="a"]');
  await expect(page.locator('.d-actions .act')).toHaveCount(3);
  await expect(page.locator('[data-nav]')).toHaveAttribute('href', /waze\.com/);
  await page.click('[data-act=more]');
  await expect(page.locator('#moreList')).toContainText('Itinéraire avec Google Maps');
  await expect(page.locator('#moreList')).toContainText('contact@client.fr');
  await page.click('[data-more=nav-default]');
  await expect(page.locator('[data-nav]')).toHaveAttribute('href', /google\.com\/maps/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('carte-clients:settings')).nav)).toBe('gmaps'); // gardé pour la prochaine fois
  await page.click('#moreDialog [data-close]');
  await page.click('#backBtn');
  await expect(page.locator('#list li[data-id="a"] .quick a[target]')).toHaveAttribute('href', /google\.com\/maps/);
});

test('en se déplaçant, la fiche ouverte n’est pas redessinée : seule la distance change', async ({ page }) => {
  await seed(page, { clients: [client('a', 'Client Paris', 'Paris', 48.8566, 2.3522)] });
  await login(page);
  await page.click('#list li[data-id="a"]');
  await expect(page.locator('#dEta .big')).toHaveText(/\d/);
  const avant = await page.textContent('#dEta .big');
  await page.evaluate(() => { window.__titre = document.querySelector('#detail h2'); });
  await page.context().setGeolocation({ latitude: 48.95, longitude: 2.3522 });
  await expect(page.locator('#dEta .big')).not.toHaveText(avant);
  expect(await page.evaluate(() => window.__titre === document.querySelector('#detail h2'))).toBe(true);
});

test('adresses sans position : localisées automatiquement à l’ouverture', async ({ page }) => {
  await seed(page, { clients: [{ ...client('a', 'Sans position', 'Lyon', null, null), adresse: '1 rue de la République', code_postal: '69001' }] });
  await login(page);
  await expect.poll(() => page.evaluate(() => window.__db.clients[0].lat)).not.toBeNull();
  await expect(page.locator('#toast')).toContainText('localisée automatiquement');
});
