// Tests de l'optimisation de tournée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimiser, longueur, troncons } from '../../js/tournee.js';

const P = { id: 'paris', lat: 48.8566, lng: 2.3522 }, V = { id: 'versailles', lat: 48.8049, lng: 2.1204 },
  L = { id: 'lyon', lat: 45.764, lng: 4.8357 }, D = { id: 'dijon', lat: 47.322, lng: 5.0415 }, O = { id: 'orleans', lat: 47.9029, lng: 1.9093 };

test('depuis Paris : l’ordre le plus court passe par les villes dans l’ordre logique', () => {
  const ordre = optimiser([L, V, D, O], P).map(p => p.id);
  assert.deepEqual(ordre, ['versailles', 'orleans', 'dijon', 'lyon']);
});

test('l’ordre optimisé n’est jamais plus long que l’ordre saisi', () => {
  const saisi = [L, O, D, V, P];
  assert.ok(longueur(null, optimiser(saisi)) <= longueur(null, saisi));
  assert.equal(optimiser(saisi)[0].id, 'lyon'); // sans position, le premier arrêt reste le départ
});

test('tronçons : durées de l’IGN si disponibles, sinon réparties selon les distances', () => {
  assert.deepEqual(troncons([P, V, O], { portions: [{ distance: 20, duration: 25 }, { distance: 110, duration: 80 }] }), [{ km: 20, min: 25 }, { km: 110, min: 80 }]);
  const t = troncons([P, V, O], { distance: 130, duration: 100 });
  assert.equal(Math.round(t[0].km + t[1].km), 130);
  assert.ok(t[0].min < t[1].min);
});
