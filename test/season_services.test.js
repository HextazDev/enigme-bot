const test = require('node:test');
const assert = require('node:assert/strict');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const season = require('../src/services/season');
const { endSeason } = require('../src/game/endgame');

const code = expected => error => error.code === expected;
async function setup(board = {}) {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 5, enigme_status: 'finished', ...board });
}

test('bets survive a restart: the open state is persisted, a bet is debited once, payouts are proportional', async () => {
  await setup();
  await Joueur.bulkCreate([{ discord_id: 'a', pieces: 30 }, { discord_id: 'b', pieces: 30 }, { discord_id: 'c', pieces: 30 }]);
  assert.equal((await season.openBets()).opened, true);
  assert.equal(await season.betsOpen(), true, 'read back from the database, not from memory');
  await season.placeBet('a', 0, 10);
  await season.placeBet('b', 0, 30);
  await season.placeBet('c', 1, 3);
  await assert.rejects(season.placeBet('a', 0, 10), code('ALREADY'));
  await assert.rejects(season.placeBet('c', 0, 31), code('AMOUNT'));
  assert.equal((await Joueur.findByPk('a')).pieces, 23);
  const result = await season.settleBets(() => 0);
  assert.equal(result.winner, 'Yoshi Vert');
  assert.equal(result.pot, 43);
  assert.deepEqual(result.payouts.map(p => [p.discord_id, p.gain]), [['a', 10], ['b', 32]]);
  assert.equal(await season.betsOpen(), false);
  assert.equal(await season.settleBets(() => 0), null, 'settling twice pays nothing');
  assert.equal((await Joueur.findByPk('a')).pari_coureurId, null);
});

test('17h with a programmed enigma: forgotten players are reported, ghosts created, board locked, tour +1', async () => {
  await setup({ enigme_status: 'programmee', enigme_text: 'Énigme', tour: 5 });
  await Joueur.bulkCreate([
    { discord_id: 'lazy', a_le_droit_de_jouer: true, jours_inactifs: 2 },
    { discord_id: 'active', a_joue_ce_tour: true, boutique_du_jour: ['champignon'] },
  ]);
  const result = await season.dailyTransition(new Date('2026-10-07T15:00:00Z'));
  assert.equal(result.kind, 'enigma');
  assert.deepEqual(result.forgotten, ['lazy']);
  assert.deepEqual(result.ghosts, ['lazy']);
  const plateau = await Plateau.findByPk(1);
  assert.deepEqual([plateau.tour, plateau.enigme_status], [6, 'active']);
  assert.equal(Number(plateau.fin_enigme_timestamp), Date.parse('2026-10-07T19:00:00Z'), '21h in Paris');
  const active = await Joueur.findByPk('active');
  assert.deepEqual([active.a_le_droit_de_jouer, active.boutique_du_jour.length, active.jours_inactifs], [false, 0, 0]);
});

test('a dragon victory on the island closes the season at the next 17h', async () => {
  await setup({ game_mode: 'ile_defis', game_map: 'board_game_island', mode_data: { gagnants_dragon: ['hero'] } });
  assert.equal((await season.dailyTransition()).kind, 'end_season');
});

test('season end: bonus stars, final status and locked players are committed together, then announced once', async () => {
  await setup({ tour: 30 });
  await Joueur.bulkCreate([
    { discord_id: 'lucky', stat_cases_chance: 4, a_le_droit_de_jouer: true, action_en_attente: { type: 'boo', case: 52, token: 't' } },
    { discord_id: 'other', stat_cases_chance: 1, etoiles: 1 },
  ]);
  const sent = [];
  const client = { channels: { fetch: async () => ({ send: async msg => sent.push(msg) }) }, guilds: { fetch: async () => { throw new Error('no guild'); } } };
  // random 0 picks the "Chance" star then the "Malchance" star (nobody: all zero).
  const result = await endSeason(client, () => 0, { wait: async () => {} });
  assert.deepEqual([result.alreadyEnded, result.playerCount], [false, 2]);
  const lucky = await Joueur.findByPk('lucky');
  assert.deepEqual([lucky.etoiles, lucky.a_le_droit_de_jouer, lucky.action_en_attente], [1, false, null]);
  assert.equal((await Plateau.findByPk(1)).enigme_status, 'season_ended');
  assert.equal(sent.length, 4, 'intro, 2 bonus stars and podium');
  assert.equal((await endSeason(client)).alreadyEnded, true);
  assert.equal(sent.length, 4, 'no second announcement');
});

test('the black market opens once per Paris day for non-ghost players only (idempotent)', async () => {
  await setup();
  await Joueur.bulkCreate([{ discord_id: 'awake' }, { discord_id: 'ghost', est_fantome: true }]);
  const sunday = new Date('2026-10-11T09:00:00Z'); // Sunday 11h Paris
  const first = await season.openBlackMarket(sunday);
  assert.deepEqual([first.opened, first.tour], [true, 6]);
  assert.equal((await Joueur.findByPk('awake')).a_le_droit_de_jouer, true);
  assert.equal((await Joueur.findByPk('ghost')).a_le_droit_de_jouer, false);
  const second = await season.openBlackMarket(new Date('2026-10-11T10:00:00Z'));
  assert.deepEqual([second.opened, second.tour], [false, 6]);
});

test('BET-01: re-running openBets while already open never wipes existing bets', async () => {
  await setup();
  await Joueur.create({ discord_id: 'a', pieces: 20 });
  assert.equal((await season.openBets()).opened, true);
  await season.placeBet('a', 1, 10);
  assert.equal((await season.openBets()).opened, false);
  const a = await Joueur.findByPk('a');
  assert.deepEqual([a.pari_coureurId, a.pari_montant], [1, 10]);
});

test('GAME-01: isSaturdayClosed allows Saturday before 10h Paris and closes at 10h or when paris_ouverts is true', () => {
  const openBoard = { mode_data: {} };
  const sat0830Paris = new Date('2026-10-10T06:30:00Z'); // 08:30 CEST
  const sat1000Paris = new Date('2026-10-10T08:00:00Z'); // 10:00 CEST
  const wedNoon = new Date('2026-10-07T10:00:00Z');
  assert.equal(season.isSaturdayClosed(openBoard, sat0830Paris), false);
  assert.equal(season.isSaturdayClosed(openBoard, sat1000Paris), true);
  assert.equal(season.isSaturdayClosed({ mode_data: { paris_ouverts: true } }, wedNoon), true);
});

test.after(() => sequelize.close());

