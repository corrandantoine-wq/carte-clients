// Tournées : préparation depuis les fiches, ordre optimisé, mode tournée, enregistrement et réutilisation.
const { test, expect, seed, login } = require('../support/fixtures');

const client = (id, nom, ville, lat, lng) => ({ id, nom, adresse: '1 rue Test', code_postal: '', ville, telephone: '0102030405', email: '', notes: '', lat, lng, hubspot_id: null, code_client: null, created_by: 'u-admin' });
const CLIENTS = [client('ly', 'Client Lyon', 'Lyon', 45.764, 4.8357), client('ve', 'Client Versailles', 'Versailles', 48.8049, 2.1204),
  client('na', 'Client Nantes', 'Nantes', 47.2184, -1.5536), client('re', 'Client Rennes', 'Rennes', 48.1173, -1.6778)];

async function addToTour(page, id) {
  await page.click(`#list li[data-id="${id}"]`);
  await page.click('[data-act=more]');
  await expect(page.locator('[data-more=tour]')).toContainText('Ajouter à ma tournée');
  await page.click('[data-more=tour]');
  await page.click('#backBtn');
}

test('préparer, optimiser, faire et terminer une tournée', async ({ page }) => {
  await seed(page, { clients: CLIENTS });
  await login(page, 'bob@soc.fr');
  await page.selectOption('#radiusSel', '0');
  for (const id of ['ly', 're', 've', 'na']) await addToTour(page, id);
  await page.click('#menuBtn');
  await expect(page.locator('#tourCount')).toHaveText('4');
  await page.click('[data-action=tour]');
  await expect(page.locator('.tour-list li')).toHaveCount(4);
  await expect(page.locator('.tour-sum')).toContainText('4 étapes');
  const avant = Number((await page.textContent('.tour-sum')).match(/([\d\s]+) km/)[1].replace(/\s/g, ''));
  await page.click('[data-tour=optim]');
  // Depuis Paris : Versailles, puis Rennes, Nantes, et Lyon en dernier.
  await expect(page.locator('.tour-list .t')).toHaveText(['Client Versailles', 'Client Rennes', 'Client Nantes', 'Client Lyon']);
  const apres = Number((await page.textContent('.tour-sum')).match(/([\d\s]+) km/)[1].replace(/\s/g, ''));
  expect(apres).toBeLessThan(avant);
  await expect(page.locator('.tour-pin')).toHaveCount(4);

  // Ordre modifié à la main.
  await page.click('.tour-list li:nth-child(2) [data-move="1"]');
  await expect(page.locator('.tour-list .t')).toHaveText(['Client Versailles', 'Client Nantes', 'Client Rennes', 'Client Lyon']);

  await page.click('[data-tour=start]');
  await expect(page.locator('.tour-now .tour-name')).toHaveText('Client Versailles');
  await expect(page.locator('.tour-now a.act.primary')).toHaveAttribute('href', /waze\.com/);
  await page.click('[data-tour=next]');
  await expect(page.locator('.tour-now .tour-name')).toHaveText('Client Nantes');
  await page.click('[data-tour=skip]');
  await expect(page.locator('.tour-now .tour-name')).toHaveText('Client Rennes');
  await page.click('[data-tour=next]');
  await page.click('[data-tour=next]'); // Lyon : dernière → terminer
  await expect(page.locator('#toast')).toContainText('3/4 étapes faites');
  const h = await page.evaluate(() => window.__db.tournees);
  expect(h).toHaveLength(1);
  expect(h[0]).toMatchObject({ genre: 'faite', etapes: ['ve', 'na', 're', 'ly'], faites: ['ve', 're', 'ly'] });
  await expect(page.locator('#tourBody')).toContainText('Votre tournée est vide');
});

test('enregistrer une tournée puis la réutiliser', async ({ page }) => {
  await seed(page, { clients: CLIENTS });
  await login(page, 'bob@soc.fr');
  await page.selectOption('#radiusSel', '0');
  await addToTour(page, 've');
  await addToTour(page, 'ly');
  await page.click('#menuBtn');
  await page.click('[data-action=tour]');
  await page.click('[data-tour=save]'); // nom proposé accepté (« Tournée du … »)
  await expect(page.locator('#toast')).toContainText('enregistrée');
  expect(await page.evaluate(() => window.__db.tournees[0].etapes)).toEqual(['ve', 'ly']);
  await page.click('[data-tour=clear]');
  await expect(page.locator('#tourBody')).toContainText('Votre tournée est vide');
  await page.click('#toursBtn');
  await page.click('#toursSaved li[data-t]');
  await expect(page.locator('.tour-list .t')).toHaveText(['Client Versailles', 'Client Lyon']);
  await expect(page.locator('[data-tour=save]')).toContainText('Mettre à jour');
});

test('depuis la tournée, ouvrir une fiche puis revenir à la tournée', async ({ page }) => {
  await seed(page, { clients: CLIENTS });
  await login(page, 'bob@soc.fr');
  await page.selectOption('#radiusSel', '0');
  await addToTour(page, 've');
  await page.click('#menuBtn');
  await page.click('[data-action=tour]');
  await page.click('.tour-list li .t');
  await expect(page.locator('#detail h2')).toHaveText('Client Versailles');
  await page.click('#backBtn');
  await expect(page.locator('#tourView')).toBeVisible();
});
