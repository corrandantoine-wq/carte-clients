// Outils communs aux tests de bout en bout : tous les services externes sont simulés
// (Supabase, géocodage, itinéraires, fonds de carte, bibliothèques CDN).
const { test: base, expect } = require('@playwright/test');
const path = require('path');
const Papa = require('papaparse');

const ROOT = path.join(__dirname, '..', '..');
const NM = path.join(ROOT, 'node_modules');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

// Géocodeur simulé : coordonnées connues par ville.
const CITIES = {
  paris: [48.8566, 2.3522], lyon: [45.764, 4.8357], marseille: [43.2965, 5.3698], toulouse: [43.6045, 1.444],
  bordeaux: [44.8378, -0.5792], nantes: [47.2184, -1.5536], lille: [50.6292, 3.0573], strasbourg: [48.5734, 7.7521],
  versailles: [48.8049, 2.1204], rennes: [48.1173, -1.6778], 'bourg-en-bresse': [46.205, 5.2255],
};
const cityOf = text => Object.keys(CITIES).find(c => String(text).toLowerCase().includes(c));

function fakeBatchGeocode(body) {
  const csv = body.match(/filename="adresses\.csv"\r\nContent-Type: text\/csv\r\n\r\n([\s\S]*?)\r\n--/)[1];
  const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map(r => {
    const c = cityOf(r.ville) || cityOf(r.adresse); // la ville d'abord (« avenue de Paris, Versailles »)
    return { ...r, latitude: c ? CITIES[c][0] : '', longitude: c ? CITIES[c][1] : '', result_score: c ? 0.9 : '', result_postcode: c ? r.code_postal : '' };
  });
  return Papa.unparse(rows);
}

const rad = d => d * Math.PI / 180;
function km(a, b) {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const test = base.extend({
  page: async ({ page }, use) => {
    const libs = { leaflet: 'leaflet', 'leaflet.markercluster': 'leaflet.markercluster', papaparse: 'papaparse' };
    await page.route(/unpkg\.com\/([^@]+)@[^/]+\/(.*)/, r => {
      const [, lib, file] = r.request().url().match(/unpkg\.com\/([^@]+)@[^/]+\/(.*)/);
      r.fulfill({ path: path.join(NM, libs[lib], file) });
    });
    await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/, r => r.fulfill({ path: path.join(NM, 'xlsx/dist/xlsx.full.min.js'), contentType: 'application/javascript' }));
    await page.route(/supabase-js/, r => r.fulfill({ path: path.join(__dirname, 'mock-supabase.js'), contentType: 'application/javascript' }));
    await page.route(/\/config\.js$/, r => r.fulfill({ contentType: 'application/javascript', body: "window.CARTE_CLIENTS_CONFIG={supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'anon'}" }));
    await page.route(/fonts\.(googleapis|gstatic)|nominatim/, r => r.fulfill({ status: 404, body: '' }));
    await page.route(/data\.geopf\.fr\/wmts/, r => r.fulfill({ body: PNG_1PX, contentType: 'image/png' }));
    await page.route(/data\.geopf\.fr\/geocodage\/search\/csv/, r => r.fulfill({ contentType: 'text/csv', body: fakeBatchGeocode(r.request().postDataBuffer().toString('utf8')) }));
    await page.route(/data\.geopf\.fr\/geocodage\/search\?/, r => {
      const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || ''), c = cityOf(q);
      r.fulfill({ json: { features: c ? [{ geometry: { coordinates: [CITIES[c][1], CITIES[c][0]] }, properties: { score: 0.9, postcode: (q.match(/\b\d{5}\b/) || [''])[0] } }] : [] } });
    });
    await page.route(/data\.geopf\.fr\/navigation\/itineraire/, r => {
      const u = new URL(r.request().url());
      const a = u.searchParams.get('start').split(',').map(Number), b = u.searchParams.get('end').split(',').map(Number);
      const d = km(a, b) * 1.3;
      r.fulfill({ json: { start: a.join(','), end: b.join(','), distance: d, duration: d / 50 * 60, geometry: { type: 'LineString', coordinates: [a, b] } } });
    });
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'SUPPRIMER' : undefined));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await use(page);
    expect(errors, 'erreurs JavaScript dans la page').toEqual([]);
  },
});

// Pré-remplit la base simulée (à appeler avant page.goto).
async function seed(page, data) { await page.addInitScript(d => { window.__SEED__ = d; }, data); }

// Se connecte ; par défaut, attend que l'appli soit ouverte (expectApp: false pour les cas d'échec).
async function login(page, email = 'admin@soc.fr', password = 'motdepasse1', { expectApp = true } = {}) {
  await page.goto('/index.html');
  await page.fill('#authForm [name=email]', email);
  await page.fill('#authForm [name=password]', password);
  await page.click('#authSubmit');
  if (expectApp) await expect(page.locator('#auth')).toBeHidden();
}

async function importFile(page, file) {
  await page.setInputFiles('#csvInput', file);
  await expect(page.locator('#importDialog')).toBeVisible();
  await page.click('#impGo');
  await expect(page.locator('#impSteps li').last()).toHaveClass('done');
  const result = await page.textContent('#impResult');
  await page.click('#impCancel');
  return result;
}

const SAMPLE = path.join(ROOT, 'exemple-clients.csv');
module.exports = { test, expect, seed, login, importFile, SAMPLE };
