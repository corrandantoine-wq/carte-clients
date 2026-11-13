// Tests unitaires de la préparation d'import (correspondance des colonnes, nettoyage, dédoublonnage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessMapping, mappingKey, rowToClient, planImport, fixCp, fixTel } from '../../js/importer.js';

const fieldOf = (headers, m) => Object.fromEntries(Object.entries(m).map(([k, i]) => [k, headers[i]]));

test('colonnes reconnues : export de type Sage', () => {
  const h = ['N° compte tiers', 'Intitulé', 'Adresse', 'Complément', 'Code postal', 'Ville', 'Téléphone', 'E-mail', 'Qualité'];
  assert.deepEqual(fieldOf(h, guessMapping(h)), {
    code_client: 'N° compte tiers', nom: 'Intitulé', adresse: 'Adresse', adresse2: 'Complément',
    code_postal: 'Code postal', ville: 'Ville', telephone: 'Téléphone', email: 'E-mail',
  });
});

test('colonnes reconnues : export de type Odoo (anglais)', () => {
  const h = ['Internal Reference', 'Name', 'Street', 'Street2', 'Zip', 'City', 'Phone', 'Email'];
  const m = fieldOf(h, guessMapping(h));
  assert.equal(m.code_client, 'Internal Reference');
  assert.equal(m.adresse2, 'Street2');
  assert.equal(m.code_postal, 'Zip');
});

test('une correspondance mémorisée a priorité', () => {
  const h = ['Col A', 'Col B'];
  assert.deepEqual(guessMapping(h, { [mappingKey(h)]: { nom: 1 } }), { nom: 1 });
});

test('zéros perdus par Excel rétablis', () => {
  assert.equal(fixCp('1000'), '01000');
  assert.equal(fixCp('75004'), '75004');
  assert.equal(fixTel('612345678'), '0612345678');
  assert.equal(fixTel('0472000002'), '0472000002');
});

test('ligne → client : seuls les champs choisis sont remplis', () => {
  const m = { code_client: 0, nom: 1, adresse: 2, adresse2: 3, code_postal: 4 };
  const c = rowToClient(['C1', ' Dupont ', '12 rue X', 'Bât. B', '1000', 'ignoré'], m);
  assert.deepEqual(c, { nom: 'Dupont', code_client: 'C1', adresse: '12 rue X, Bât. B', code_postal: '01000' });
  assert.ok(!('notes' in c), 'les notes non choisies ne doivent pas écraser celles de l’appli');
});

test('préparation : nouveaux, mis à jour, sans code, doublons et lignes vides', () => {
  const m = { code_client: 0, nom: 1 };
  const data = [['C1', 'Déjà là (nouveau nom)'], ['C2', 'Nouveau'], ['C2', 'Doublon ignoré'], ['', 'Sans code'], ['C3', '']];
  const p = planImport(data, m, [{ id: 'x', code_client: 'C1', nom: 'Déjà là' }]);
  assert.deepEqual(p.updates.map(c => c.nom), ['Déjà là (nouveau nom)']);
  assert.deepEqual(p.creates.map(c => c.nom), ['Nouveau']); // la 1re ligne du doublon est gardée
  assert.deepEqual(p.noCode.map(c => c.nom), ['Sans code']);
  assert.equal(p.skipped, 1);
  assert.equal(p.dupInFile, 1);
});
