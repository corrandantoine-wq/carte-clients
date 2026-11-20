// Démonstration (données fictives, sans la vraie base) et espaces des entreprises clientes.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('../support/fixtures');

test('démo : connexion automatique, clients fictifs, position simulée, jamais la vraie base', async ({ page }) => {
  const real = [];
  page.on('request', r => { if (/supabase\.co/.test(r.url())) real.push(r.url()); });
  await page.goto('/demo/');
  await expect(page.locator('#auth')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.demo-badge')).toHaveText('Démo · données fictives');
  await expect(page.locator('#subtitle')).toContainText('42 au total');
  await page.click('#menuBtn');
  await page.click('[data-action=tour]');
  await page.click('#toursBtn');
  await expect(page.locator('#toursSaved')).toContainText('Tournée du mardi');
  expect(real).toEqual([]);
});

test('espace d’une entreprise cliente : sa base, son nom, son icône d’appli', async ({ page }) => {
  const modele = fs.readFileSync(path.join(__dirname, '../../entreprises/modele/index.html'), 'utf8')
    .replace('__ESPACE_JSON__', JSON.stringify({ entreprise: 'Boulangeries Martin', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabaseAnonKey: 'cle-publique' }))
    .replace('__ENTREPRISE__', 'Boulangeries Martin');
  await page.route('**/entreprises/essai/index.html', r => r.fulfill({ body: modele, contentType: 'text/html' }));
  await page.goto('/entreprises/essai/index.html');
  await expect(page.locator('#authCompany')).toHaveText('Boulangeries Martin');
  await expect(page).toHaveTitle('Carte Clients · Boulangeries Martin');
  expect(await page.evaluate(() => window.CARTE_CLIENTS_CONFIG.supabaseUrl)).toBe('https://abcdefghijklmnopqrst.supabase.co');
  expect(await page.evaluate(() => document.querySelector('link[rel=manifest]').getAttribute('href'))).toBe('/entreprises/essai/manifest.webmanifest');
});
