const test = require('node:test');
const assert = require('node:assert/strict');
const { walk, rollDice, starCandidates, teleportCandidates, caseBefore } = require('../src/gamemodes/mario_party/rules');
const { BOARD_CASES } = require('../src/gamemodes/mario_party/maps/night_sky/board');

const base = { cases: BOARD_CASES, star: 30, resume: null, direction: null, shopOpen: true };

test('walking stops before moving at a crossroads (case 6 branches to 7 or 41)', () => {
  assert.deepEqual(walk({ ...base, position: 4, remaining: 5 }), { position: 6, remaining: 3, stop: 'intersection' });
});

test('a chosen direction is taken once the crossroads is resumed', () => {
  assert.deepEqual(walk({ ...base, position: 6, remaining: 2, resume: 'intersection', direction: 41 }), { position: 41, remaining: 1, stop: 'boutique' });
});

test('a direction that does not leave the crossroads is rejected', () => {
  assert.throws(() => walk({ ...base, position: 6, remaining: 2, resume: 'intersection', direction: 12 }), /direction/i);
});

test('passing the star pauses the movement with the remaining steps', () => {
  assert.deepEqual(walk({ ...base, position: 8, remaining: 4, star: 10 }), { position: 10, remaining: 2, stop: 'etoile' });
});

test('resuming from the star does not stop again on the same case and finishes the walk', () => {
  assert.deepEqual(walk({ ...base, position: 10, remaining: 1, star: 10, resume: 'etoile' }), { position: 11, remaining: 0, stop: null });
});

test('landing exactly on Boo stops with no remaining step', () => {
  assert.deepEqual(walk({ ...base, position: 51, remaining: 1 }), { position: 52, remaining: 0, stop: 'boo' });
});

test('a closed shop (last turn) is not a stop', () => {
  assert.deepEqual(walk({ ...base, position: 22, remaining: 2, shopOpen: false }), { position: 24, remaining: 0, stop: null });
});

test('dice: normal 1-10, double 2-20, triple 3-30, loaded die exact; one-shot modifiers are consumed', () => {
  const normal = { type_de: 'normal', de_pipe_valeur: 0, de_limite: false, bonus_prochain_lancer: 0 };
  assert.equal(rollDice(normal, () => 0).value, 1);
  assert.equal(rollDice(normal, () => 0.999).value, 10);
  assert.deepEqual(rollDice({ ...normal, type_de: 'double' }, () => 0.999), { value: 20, state: { ...normal, type_de: 'normal' } });
  assert.equal(rollDice({ ...normal, type_de: 'triple' }, () => 0).value, 3);
  assert.equal(rollDice({ ...normal, type_de: 'pipe', de_pipe_valeur: 7 }, () => 0.5).value, 7);
  const limited = rollDice({ ...normal, de_limite: true, bonus_prochain_lancer: 3 }, () => 0.999);
  assert.equal(limited.value, 6, 'limit to 3 is applied before the mushroom bonus');
  assert.deepEqual(limited.state, normal);
});

test('star candidates exclude start, shops, Boo, the bonus zone, the current star and occupied cases', () => {
  const ids = starCandidates(BOARD_CASES, 10, [12, 13]);
  for (const forbidden of [1, 10, 12, 13, 23, 37, 41, 46, 52]) assert.ok(!ids.includes(forbidden), `case ${forbidden}`);
  assert.ok(ids.includes(2));
  assert.deepEqual(starCandidates(BOARD_CASES, 2, BOARD_CASES.map(c => c.id)).includes(3), true, 'falls back when every case is occupied');
});

test('teleport targets stay in the main loop and the golden pipe lands right before the star', () => {
  assert.ok(teleportCandidates(BOARD_CASES).every(id => id <= 45 && id !== 1));
  assert.equal(caseBefore(BOARD_CASES, 8), 7);
  assert.equal(caseBefore(BOARD_CASES, 999), 1);
});
