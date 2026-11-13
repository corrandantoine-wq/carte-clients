// Tests unitaires des fonctions utilitaires (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, num, haversine, fmtDist, fmtEta, fmtDuration, initials, norm, fullAddress, telUrl } from '../../js/utils.js';

test('esc neutralise le HTML', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(esc(null), '');
});

test('num lit les nombres français et ignore le vide', () => {
  assert.equal(num('48,8566'), 48.8566);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
});

test('haversine : Paris → Lyon ≈ 392 km', () => {
  const d = haversine({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 });
  assert.ok(Math.abs(d - 392) < 3, `distance ${d}`);
});

test('formats de distance et de durée', () => {
  assert.equal(fmtDist(null), '—');
  assert.equal(fmtDist(0.437), '440 m');
  assert.equal(fmtDist(1.43), '1,4 km');
  assert.equal(fmtDist(17.4), '17 km');
  assert.equal(fmtDuration(44.2), '44 min');
  assert.equal(fmtDuration(125), '2 h 05');
  assert.equal(fmtDuration(120), '2 h');
  assert.match(fmtEta(100), /^1 h \d\d$/);
});

test('initiales : mots vides et formes juridiques ignorés', () => {
  assert.equal(initials('Boulangerie Dupont'), 'BD');
  assert.equal(initials('SARL de la Gare'), 'G');
  assert.equal(initials('prenom.nom@societe.fr'), 'PN');
  assert.equal(initials(''), '?');
});

test('norm : sans accents ni ponctuation', () => {
  assert.equal(norm('N° compte tiers'), 'n compte tiers');
  assert.equal(norm('  Intitulé  '), 'intitule');
  assert.equal(norm('E-mail'), 'e mail');
});

test('adresse complète et lien d’appel', () => {
  assert.equal(fullAddress({ adresse: '12 rue de Rivoli', code_postal: '75004', ville: 'Paris' }), '12 rue de Rivoli, 75004 Paris');
  assert.equal(fullAddress({ ville: 'Lyon' }), 'Lyon');
  assert.equal(telUrl({ telephone: '04 72 00 00 02' }), 'tel:0472000002');
});
