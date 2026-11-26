const test = require('node:test');
const assert = require('node:assert/strict');
const { Joueur, Plateau, TourSnapshot, sequelize } = require('../src/db/models');
const admin = require('../src/services/admin');
const turn = require('../src/gamemodes/mario_party/turn');

const code = expected => error => error.code === expected;

test('starting a season resets every player and every per-season board field, including the island data', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 22, enigme_status: 'season_ended', enigme_reponse: 'old', enigme_gagnants: [{ discord_id: 'x' }],
    game_mode: 'ile_defis', game_map: 'board_game_island', mode_data: { portails_ouverts: [20], gagnants_dragon: ['x'], paris_ouverts: true } });
  await Joueur.create({ discord_id: 'x', etoiles: 4 });
  await TourSnapshot.create({ discord_id: 'x', tour: 22 });
  const { star } = await admin.startSeason('mario_party', 'standard', 'night_sky', () => 0);
  const plateau = await Plateau.findByPk(1);
  assert.deepEqual(plateau.mode_data, {});
  assert.deepEqual([plateau.tour, plateau.enigme_status, plateau.enigme_reponse, plateau.game_mode], [0, 'finished', null, 'mario_party']);
  assert.deepEqual(plateau.enigme_gagnants, []);
  assert.equal(plateau.position_etoile, star);
  const hidden = Object.values(plateau.blocs_caches);
  assert.equal(new Set([star, ...hidden]).size, 5, 'star and hidden blocks never share a case');
  assert.equal(await Joueur.count(), 0);
  assert.equal(await TourSnapshot.count(), 0);
});

test('a season start that fails half-way changes nothing', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 12, enigme_status: 'finished' });
  await Joueur.create({ discord_id: 'keep', etoiles: 3 });
  Plateau.addHook('beforeUpdate', 'fail-start', () => { throw new Error('Injected start failure'); });
  try { await assert.rejects(admin.startSeason('mario_party', 'standard', 'night_sky'), /Injected/); }
  finally { Plateau.removeHook('beforeUpdate', 'fail-start'); }
  assert.equal((await Joueur.findByPk('keep')).etoiles, 3);
  assert.equal((await Plateau.findByPk(1)).tour, 12);
  await assert.rejects(admin.startSeason('mario_party', 'standard', 'unknown_map'), code('PARAMS'));
});

test('teleporting validates the case against the active map and cancels a pending choice', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 2, enigme_status: 'finished' });
  await Joueur.create({ discord_id: 'p', position: 3, cases_restantes: 2, action_en_attente: { type: 'boo', case: 3, token: 't' } });
  await assert.rejects(admin.setPosition('p', 60), code('CASE'), 'Night Sky has 58 cases');
  await admin.setPosition('p', 58);
  const p = await Joueur.findByPk('p');
  assert.deepEqual([p.position, p.cases_restantes, p.action_en_attente], [58, 0, null]);
  await assert.rejects(admin.setTour(31), code('TOUR'));
  await assert.rejects(admin.adjustResource('ghost-user', 'pieces', -3), code('PLAYER_MISSING'));
  assert.equal(await admin.adjustResource('p', 'pieces', -3), 0, 'never below zero');
});

test('undoing a turn restores the player, the board and the other players from the pre-roll snapshot', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 4, enigme_status: 'finished', position_etoile: 30 });
  await Joueur.create({ discord_id: 'p', position: 15, a_le_droit_de_jouer: true, pieces: 10 });
  await Joueur.create({ discord_id: 'q', position: 5, pieces: 30 });
  await turn.startTurn({ id: 'p', username: 'p' }, { random: () => 0.05, now: new Date('2026-10-07T12:00:00Z') });
  assert.notEqual((await Joueur.findByPk('p')).position, 15);
  await admin.undoTurn('p');
  const p = await Joueur.findByPk('p');
  assert.deepEqual([p.position, p.pieces, p.a_le_droit_de_jouer, p.action_en_attente], [15, 10, true, null]);
  assert.equal(await TourSnapshot.count(), 0);
  await assert.rejects(admin.undoTurn('p'), code('NO_SNAPSHOT'));
});

test('items given by the MJ must exist in the active catalog and respect the inventory limit', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 2, enigme_status: 'finished' });
  await assert.rejects(admin.giveItem('p', 'Objet inventé'), code('ITEM'));
  for (let n = 0; n < 3; n++) await admin.giveItem('p', '🍄 Champignon');
  await assert.rejects(admin.giveItem('p', '🍄 Champignon'), code('FULL'));
  await admin.removeItem('p', '🍄 Champignon');
  assert.equal((await Joueur.findByPk('p')).inventaire.length, 2);
});

test('ADM-05: startSeason never spawns the star or hidden blocks in Night Sky key-locked bonus zones (46..58)', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 0, enigme_status: 'season_ended' });
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const { star } = await admin.startSeason('mario_party', 'standard', 'night_sky', () => r);
    const plateau = await Plateau.findByPk(1);
    const all = [star, ...Object.values(plateau.blocs_caches)];
    assert.ok(all.every(id => id < 46), `bonus zone case spawned for r=${r}: ${all.join(', ')}`);
  }
});

test('ADM-03: undoTurn restores stats, boutique_du_jour, mode_data and plateau_mode_data (including island gates) atomically', async () => {
  const ile = require('../src/gamemodes/ile_defis/turn');
  await sequelize.sync({ force: true });
  await Plateau.create({
    id: 1, tour: 4, enigme_status: 'finished',
    game_mode: 'ile_defis', game_map: 'board_game_island',
    mode_data: { portails_ouverts: [], cascade_desactivee: false, gagnants_dragon: [] },
  });
  await Joueur.create({
    discord_id: 'p', position: 18, a_le_droit_de_jouer: true,
    boutique_du_jour: ['champignon'], stat_cases_avancees: 7, stat_cases_chance: 2, stat_cases_malchance: 1, stat_objets_utilises: 3,
    mode_data: { bonus_de: 'gold', double_lancer: false },
  });
  await Joueur.create({ discord_id: 'q', position: 12, mode_data: { bonus_de: 'silver', double_lancer: false } });

  const d6 = n => (n - 1) / 6 + 0.01;
  const seq = (vals, rest = 0) => () => (vals.length ? vals.shift() : rest);
  await ile.startTurn({ id: 'p', username: 'p' }, { random: seq([d6(3), d6(1)]) });
  await ile.resolveChallenge({ id: 'p', username: 'p' }, 'portail', null, { random: seq([d6(6)]) });
  assert.deepEqual((await Plateau.findByPk(1)).mode_data.portails_ouverts, [20]);
  assert.equal((await Joueur.findByPk('p')).mode_data.bonus_de, 'none');

  // Verify rollback on failure keeps state untouched
  Plateau.addHook('beforeUpdate', 'fail-undo', () => { throw new Error('Injected undo failure'); });
  try { await assert.rejects(admin.undoTurn('p'), /Injected/); }
  finally { Plateau.removeHook('beforeUpdate', 'fail-undo'); }
  assert.deepEqual((await Plateau.findByPk(1)).mode_data.portails_ouverts, [20]);

  await admin.undoTurn('p');
  const p = await Joueur.findByPk('p');
  const plateau = await Plateau.findByPk(1);
  assert.deepEqual(plateau.mode_data.portails_ouverts, []);
  assert.deepEqual(p.mode_data, { bonus_de: 'gold', double_lancer: false });
  assert.deepEqual(p.boutique_du_jour, ['champignon']);
  assert.deepEqual([p.stat_cases_avancees, p.stat_cases_chance, p.stat_cases_malchance, p.stat_objets_utilises], [7, 2, 1, 3]);
  assert.deepEqual((await Joueur.findByPk('q')).mode_data, { bonus_de: 'silver', double_lancer: false });
});

test.after(() => sequelize.close());

