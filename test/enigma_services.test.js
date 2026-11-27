const test = require('node:test');
const assert = require('node:assert/strict');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const enigma = require('../src/services/enigma');

// 17h30 and 21h30 in Paris (UTC+2 in October).
const AT_17H30 = new Date('2026-10-07T15:30:00Z');
const AT_20H30 = new Date('2026-10-07T18:30:00Z');
const code = expected => error => error.code === expected;

async function setup(board = {}, player = {}) {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'active', ...board });
  await Joueur.create({ discord_id: 'p1', pieces: 5, ...player });
}

test('reward brackets follow the Paris hour of the proposal', () => {
  assert.deepEqual(enigma.rewardBracket(AT_17H30), { tranche: '17h-18h', pieces: 10 });
  assert.deepEqual(enigma.rewardBracket(AT_20H30), { tranche: '20h-21h', pieces: 2 });
});

test('a second validation of the same answer never pays twice (double click)', async () => {
  await setup();
  const first = await enigma.validateAnswer('p1', AT_17H30);
  assert.equal(first.pieces, 10);
  await assert.rejects(enigma.validateAnswer('p1', AT_17H30), code('ALREADY'));
  const p1 = await Joueur.findByPk('p1');
  assert.equal(p1.pieces, 15);
  assert.equal(p1.stat_enigmes_trouvees, 1);
  assert.equal((await Plateau.findByPk(1)).enigme_gagnants.length, 1);
});

test('a late validation (after 21h) rewards without granting an extra turn to a player who already played', async () => {
  await setup({ enigme_status: 'finished' }, { a_le_droit_de_jouer: false, a_joue_ce_tour: true });
  const result = await enigma.validateAnswer('p1', AT_20H30);
  assert.equal(result.late, true);
  const p1 = await Joueur.findByPk('p1');
  assert.equal(p1.pieces, 7);
  assert.equal(p1.a_le_droit_de_jouer, false);
});

test('on the island a correct answer grants a bonus die instead of coins', async () => {
  await setup({ game_mode: 'ile_defis', game_map: 'board_game_island' });
  const result = await enigma.validateAnswer('p1', AT_17H30);
  assert.equal(result.ileDice, 'gold');
  const p1 = await Joueur.findByPk('p1');
  assert.equal(p1.pieces, 5);
  assert.equal(p1.mode_data.bonus_de, 'gold');
});

test('programming is refused while an enigma runs or when no season is open', async () => {
  const input = { text: 'Qui suis-je ?', answer: 'moi', hints: ['a', null, 'c'] };
  await setup();
  await assert.rejects(enigma.programEnigma(input), code('ACTIVE'));
  await Plateau.update({ enigme_status: 'season_ended' }, { where: { id: 1 } });
  await assert.rejects(enigma.programEnigma(input), code('CLOSED'));
  await Plateau.update({ enigme_status: 'finished' }, { where: { id: 1 } });
  await Joueur.update({ a_trouve_enigme: true }, { where: {} });
  await enigma.programEnigma(input);
  const plateau = await Plateau.findByPk(1);
  assert.deepEqual([plateau.enigme_status, plateau.enigme_reponse, plateau.enigme_indice2], ['programmee', 'moi', null]);
  assert.equal((await Joueur.findByPk('p1')).a_trouve_enigme, false);
});

test('guesses: one coin per proposal up to 3 a day, then a 30 minute cooldown', async () => {
  await setup({}, { pieces: 0 });
  const now = new Date('2026-10-07T15:00:00Z');
  assert.equal((await enigma.recordGuess('p1', now)).coinGranted, true);
  const blocked = await enigma.recordGuess('p1', new Date(now.getTime() + 10 * 60_000));
  assert.equal(blocked.remainingMinutes, 20);
  await Joueur.update({ guess_du_jour: 3, last_deviner_time: null }, { where: { discord_id: 'p1' } });
  assert.equal((await enigma.recordGuess('p1', now)).coinGranted, false);
  assert.equal((await Joueur.findByPk('p1')).pieces, 1);
  await Joueur.update({ est_fantome: true }, { where: { discord_id: 'p1' } });
  await assert.rejects(enigma.recordGuess('p1', now), code('GHOST'));
});

test('ENIG-05: rejecting or penalizing a proposal is idempotent per DM proposalId', async () => {
  await setup({}, { pieces: 5 });
  await enigma.penalizeProposal('p1', 'dm-msg-42');
  assert.equal((await Joueur.findByPk('p1')).pieces, 4);
  await assert.rejects(enigma.penalizeProposal('p1', 'dm-msg-42'), code('ALREADY'));
  await assert.rejects(enigma.rejectProposal('p1', false, 'dm-msg-42'), code('ALREADY'));
  await assert.rejects(enigma.validateAnswer('p1', AT_17H30, 'dm-msg-42'), code('ALREADY'));
  assert.equal((await Joueur.findByPk('p1')).pieces, 4);
});

test('ENIG-05: rollbackFailedGuess restores cooldown and participation coin when DM delivery fails', async () => {
  await setup({}, { pieces: 2 });
  const now = new Date('2026-10-07T15:00:00Z');
  const guess = await enigma.recordGuess('p1', now);
  assert.equal(guess.coinGranted, true);
  assert.equal((await Joueur.findByPk('p1')).pieces, 3);
  await enigma.rollbackFailedGuess('p1', guess.coinGranted, guess.previousLastGuess);
  const p1 = await Joueur.findByPk('p1');
  assert.deepEqual([p1.pieces, p1.guess_du_jour, p1.last_deviner_time], [2, 0, null]);
});

test.after(() => sequelize.close());

