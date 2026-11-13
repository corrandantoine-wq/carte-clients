// Import depuis un ERP : encodage Windows, colonnes françaises, mise à jour par code client, Excel.
const { test, expect, login, importFile } = require('../support/fixtures');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Fichiers de test dans un dossier au nom simple (un chemin avec « » empêche l'envoi du fichier).
const tmp = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carte-clients-')), name);

const ERP_HEADER = 'N° compte tiers;Intitulé;Adresse;Complément;Code postal;Ville;Téléphone;Commentaire';
const erpFile = (info, name, lines) => {
  const file = tmp(name);
  fs.writeFileSync(file, Buffer.from([ERP_HEADER, ...lines].join('\r\n') + '\r\n', 'latin1')); // encodage « Windows »
  return file;
};

test('extraction ERP : colonnes reconnues, accents, doublons ignorés, ré-import sans doublon', async ({ page }, info) => {
  await login(page);
  const v1 = erpFile(info, 'erp.csv', [
    'CLI001;Société Générale de Négoce;12 rue de Rivoli;Bâtiment B;75004;Paris;0142000001;Créé en 2024',
    'CLI002;Crèmerie Lyonnaise;3 place Bellecour;;69002;Lyon;472000002;',
    'CLI003;Hôtel du Port;3 quai du Port;;13002;Marseille;;',
    'CLI001;Ligne en double;1 rue X;;75001;Paris;;',
  ]);
  await page.setInputFiles('#csvInput', v1);
  await expect(page.locator('#impFileInfo')).toContainText('Windows');
  await expect(page.locator('select[data-field=nom]')).toHaveValue('1');         // « Intitulé »
  await expect(page.locator('select[data-field=code_client]')).toHaveValue('0'); // « N° compte tiers »
  await expect(page.locator('select[data-field=adresse2]')).toHaveValue('3');    // « Complément »
  await expect(page.locator('#impSummary')).toContainText('3 nouveaux clients');
  await expect(page.locator('#impSummary')).toContainText('1 ligne en double');
  await page.click('#impGo');
  await expect(page.locator('#impSteps li').last()).toHaveClass('done');
  await page.click('#impCancel');
  const c1 = await page.evaluate(() => window.__db.clients.find(c => c.code_client === 'CLI001'));
  expect(c1).toMatchObject({ nom: 'Société Générale de Négoce', adresse: '12 rue de Rivoli, Bâtiment B', notes: 'Créé en 2024' });
  expect(c1.lat).not.toBeNull();
  const c2 = await page.evaluate(() => window.__db.clients.find(c => c.code_client === 'CLI002'));
  expect(c2.telephone).toBe('0472000002'); // zéro de tête rétabli

  // Le commercial ajoute une note et un lien HubSpot, puis l'ERP est ré-importé le mois suivant.
  await page.evaluate(() => { const c = window.__db.clients.find(x => x.code_client === 'CLI001'); c.notes = 'Note du commercial'; c.hubspot_id = '777'; });
  const v2 = erpFile(info, 'erp-mois2.csv', [
    'CLI001;Société Générale de Négoce SAS;12 rue de Rivoli;Bâtiment B;75004;Paris;0142000001;Commentaire ERP',
    'CLI002;Crèmerie Lyonnaise;3 place Bellecour;;69002;Lyon;472000002;',
    'CLI003;Hôtel du Port;3 quai du Port;;13002;Marseille;;',
    'CLI004;Nouveau client;10 rue Crébillon;;44000;Nantes;;',
  ]);
  await page.setInputFiles('#csvInput', v2);
  await expect(page.locator('#impSummary')).toContainText('1 nouveau client');
  await expect(page.locator('#impSummary')).toContainText('3 clients déjà présents mis à jour');
  await page.click('#impGo');
  await expect(page.locator('#impSteps li').last()).toHaveClass('done');
  const after = await page.evaluate(() => ({ n: window.__db.clients.length, c1: window.__db.clients.find(c => c.code_client === 'CLI001') }));
  expect(after.n).toBe(4);
  expect(after.c1).toMatchObject({ nom: 'Société Générale de Négoce SAS', notes: 'Note du commercial', hubspot_id: '777' });
});

test('fichier Excel : zéros des codes postaux et téléphones rétablis', async ({ page }, info) => {
  const XLSX = require('xlsx');
  const file = tmp('clients.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([['Code', 'Raison sociale', 'Adresse 1', 'CP', 'Ville', 'Tél'], ['X1', 'Garage de l’Ain', '2 avenue Alsace Lorraine', 1000, 'Bourg-en-Bresse', 612345678]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Clients'); XLSX.writeFile(wb, file);
  await login(page);
  const result = await importFile(page, file);
  expect(result).toContain('1 client ajouté');
  const c = await page.evaluate(() => window.__db.clients[0]);
  expect(c).toMatchObject({ code_client: 'X1', code_postal: '01000', telephone: '0612345678' });
  expect(c.lat).not.toBeNull();
});

test('sans colonne « code client », l’appli prévient du risque de doublons', async ({ page }, info) => {
  const file = tmp('simple.csv');
  fs.writeFileSync(file, 'nom;ville\nA;Paris\n');
  await login(page);
  await page.setInputFiles('#csvInput', file);
  await expect(page.locator('#impSummary')).toContainText('créera des doublons');
});
