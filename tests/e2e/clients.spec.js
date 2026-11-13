// Base clients : import, liste triée par distance, rayon, favoris, fiche, droits de suppression.
const { test, expect, seed, login, importFile, SAMPLE } = require('../support/fixtures');

const client = (id, nom, ville, lat, lng, created_by = 'u-admin') =>
  ({ id, nom, adresse: '', code_postal: '', ville, telephone: '0102030405', email: '', notes: '', lat, lng, hubspot_id: null, code_client: null, created_by });

test('import du fichier d’exemple : 10 clients localisés et triés par distance', async ({ page }) => {
  await login(page);
  const result = await importFile(page, SAMPLE);
  expect(result).toContain('10 clients ajoutés');
  expect(await page.evaluate(() => window.__db.clients.filter(c => c.lat != null).length)).toBe(10);
  await page.click('.chip[data-r="0"]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(10);
  await expect(page.locator('#list li[data-id]').first()).toContainText('Boulangerie Dupont'); // le plus proche de Paris
});

test('le rayon filtre la liste', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Proche', 'Paris', 48.861, 2.341), client('c2', 'Lointain', 'Lyon', 45.76, 4.83)] });
  await login(page);
  await page.click('.chip[data-r="5"]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  await expect(page.locator('#subtitle')).toContainText('1 client à moins de 5 km');
  await page.click('.chip[data-r="0"]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(2);
});

test('favoris : ajout, filtre et retrait', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Alpha', 'Paris', 48.861, 2.341), client('c2', 'Beta', 'Paris', 48.87, 2.35)] });
  await login(page);
  await page.click('#list li[data-id="c2"]');
  await page.click('#favBtn');
  await expect(page.locator('#favBtn')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__db.favorites.map(f => f.client_id))).toEqual(['c2']);
  await page.click('#backBtn');
  await page.click('.chip.fav');
  await expect(page.locator('#title')).toHaveText('Mes favoris');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  await page.click('#list li[data-id="c2"]');
  await page.click('#favBtn');
  await expect.poll(() => page.evaluate(() => window.__db.favorites.length)).toBe(0);
});

test('ajout puis modification d’un client par le formulaire', async ({ page }) => {
  await login(page);
  await page.click('#menuBtn');
  await page.click('[data-action=add]');
  await page.fill('#clientForm [name=nom]', 'Nouveau Client');
  await page.fill('#clientForm [name=code_client]', 'C-42');
  await page.fill('#clientForm [name=adresse]', '1 place Bellecour');
  await page.fill('#clientForm [name=code_postal]', '69002');
  await page.fill('#clientForm [name=ville]', 'Lyon');
  await page.click('#clientForm [value=save]');
  await expect(page.locator('#detail h2')).toHaveText('Nouveau Client');
  const saved = await page.evaluate(() => window.__db.clients[0]);
  expect(saved).toMatchObject({ code_client: 'C-42', ville: 'Lyon', lat: 45.764, created_by: 'u-admin' });
  await page.click('[data-act=edit]');
  await page.fill('#clientForm [name=telephone]', '0472000000');
  await page.click('#clientForm [value=save]');
  await expect(page.locator('#detail')).toContainText('0472000000');
});

test('un collaborateur ne peut supprimer que les clients qu’il a créés', async ({ page }) => {
  await seed(page, { clients: [client('c1', 'Client de l’admin', 'Paris', 48.861, 2.341, 'u-admin'), client('c2', 'Client de Bob', 'Paris', 48.87, 2.35, 'u-bob')] });
  await login(page, 'bob@soc.fr');
  await page.click('#list li[data-id="c1"]');
  await expect(page.locator('[data-act=delete]')).toHaveCount(0);
  await page.click('#backBtn');
  await page.click('#list li[data-id="c2"]');
  await page.click('[data-act=delete]');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__db.clients.find(c => c.id === 'c2').deleted_at)).toBeTruthy(); // à la corbeille, pas effacé
});

test('recherche par nom, ville ou code client', async ({ page }) => {
  await seed(page, { clients: [{ ...client('c1', 'Garage Martin', 'Lyon', 45.76, 4.83), code_client: 'CLI-007' }, client('c2', 'Pharmacie', 'Paris', 48.87, 2.35)] });
  await login(page);
  await page.fill('#search', 'cli-007');
  await expect(page.locator('#list li[data-id]')).toHaveCount(1);
  await expect(page.locator('#list li[data-id]')).toContainText('Garage Martin');
});
