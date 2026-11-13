// Tests unitaires des contrôles de géocodage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameDept } from '../../js/geo.js';

test('un résultat dans un autre département est écarté', () => {
  assert.equal(sameDept('25000', '25000'), true);
  assert.equal(sameDept('25000', '83000'), false); // « Grande Rue, Besançon » trouvée à Toulon : rejetée
  assert.equal(sameDept('', '83000'), true);        // sans code postal fourni, pas de contrôle possible
});
