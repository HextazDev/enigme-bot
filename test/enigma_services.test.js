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

test('CRON-16: nextEnigmaPublication and formatEnigmaPublication compute the real next Paris publication', () => {
  const { nextEnigmaPublication, formatEnigmaPublication } = require('../src/utils/time');

  // Mon-Thu before 17h -> today 17h
  const wedBefore = new Date('2026-10-07T14:59:00Z'); // Wed 07/10 16:59 CEST
  const wedNext = nextEnigmaPublication(wedBefore);
  assert.equal(wedNext.toISOString(), '2026-10-07T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(wedNext, wedBefore), "aujourd'hui à 17h");

  // Mon-Thu at exact 17h00 and after 17h -> tomorrow 17h
  const wedAt17 = new Date('2026-10-07T15:00:00Z'); // Wed 07/10 17:00 CEST
  const thuNext = nextEnigmaPublication(wedAt17);
  assert.equal(thuNext.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(thuNext, wedAt17), 'jeudi 08/10 à 17h');

  const thuAfter = new Date('2026-10-08T16:30:00Z'); // Thu 08/10 18:30 CEST
  const friNext = nextEnigmaPublication(thuAfter);
  assert.equal(friNext.toISOString(), '2026-10-09T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(friNext, thuAfter), 'vendredi 09/10 à 17h');

  // Friday before 17h -> today 17h
  const friBefore = new Date('2026-10-09T10:00:00Z'); // Fri 09/10 12:00 CEST
  const friSame = nextEnigmaPublication(friBefore);
  assert.equal(friSame.toISOString(), '2026-10-09T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(friSame, friBefore), "aujourd'hui à 17h");

  // Friday at/after 17h, Saturday, Sunday -> Monday 12/10 17h
  for (const moment of [
    new Date('2026-10-09T15:00:00Z'), // Fri 09/10 17:00 CEST
    new Date('2026-10-09T16:00:00Z'), // Fri 09/10 18:00 CEST
    new Date('2026-10-10T10:28:00Z'), // Sat 10/10 12:28 CEST (issue #17 repro)
    new Date('2026-10-11T18:00:00Z'), // Sun 11/10 20:00 CEST
  ]) {
    const monNext = nextEnigmaPublication(moment);
    assert.equal(monNext.toISOString(), '2026-10-12T15:00:00.000Z');
    assert.equal(formatEnigmaPublication(monNext, moment), 'lundi 12/10 à 17h');
  }

  // Year rollover: Friday 31/12/2027 18:00 CET -> Monday 03/01/2028 17:00 CET
  const newYearsEve = new Date('2027-12-31T17:00:00Z');
  const nextYear = nextEnigmaPublication(newYearsEve);
  assert.equal(nextYear.toISOString(), '2028-01-03T16:00:00.000Z');
  assert.equal(formatEnigmaPublication(nextYear, newYearsEve), 'lundi 03/01 à 17h');

  // DST transitions in Europe/Paris
  const springSat = new Date('2026-03-28T11:00:00Z'); // Sat 28/03 12:00 CET
  const springMon = nextEnigmaPublication(springSat);
  assert.equal(springMon.toISOString(), '2026-03-30T15:00:00.000Z', 'Monday 17:00 CEST is 15:00Z');
  assert.equal(formatEnigmaPublication(springMon, springSat), 'lundi 30/03 à 17h');

  const fallSat = new Date('2026-10-24T10:00:00Z'); // Sat 24/10 12:00 CEST
  const fallMon = nextEnigmaPublication(fallSat);
  assert.equal(fallMon.toISOString(), '2026-10-26T16:00:00.000Z', 'Monday 17:00 CET is 16:00Z');
  assert.equal(formatEnigmaPublication(fallMon, fallSat), 'lundi 26/10 à 17h');

  // UTC vs Paris midnight boundary (summer UTC+2)
  const parisJustAfterMidnight = new Date('2026-10-07T22:30:00Z'); // Thu 08/10 00:30 CEST (Wed in UTC)
  const thuSameDay = nextEnigmaPublication(parisJustAfterMidnight);
  assert.equal(thuSameDay.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(thuSameDay, parisJustAfterMidnight), "aujourd'hui à 17h");
  const parisBeforeMidnight = new Date('2026-10-07T21:30:00Z'); // Wed 07/10 23:30 CEST
  const thuNextDay = nextEnigmaPublication(parisBeforeMidnight);
  assert.equal(thuNextDay.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(thuNextDay, parisBeforeMidnight), 'jeudi 08/10 à 17h');

  // Custom schedule (reusable for configurable planning #19) + single-day offset === 7
  const custom = { days: [2, 4], hour: 18, minute: 30 };
  const customNext = nextEnigmaPublication(wedBefore, custom);
  assert.equal(customNext.toISOString(), '2026-10-08T16:30:00.000Z');
  assert.equal(formatEnigmaPublication(customNext, wedBefore), 'jeudi 08/10 à 18h30');
  const thuMorning = new Date('2026-10-08T08:00:00Z');
  assert.equal(formatEnigmaPublication(nextEnigmaPublication(thuMorning, custom), thuMorning), "aujourd'hui à 18h30");

  const weeklyWed = { days: [3], hour: 17 };
  const nextWeekWed = nextEnigmaPublication(wedAt17, weeklyWed);
  assert.equal(nextWeekWed.toISOString(), '2026-10-14T15:00:00.000Z');
  assert.equal(formatEnigmaPublication(nextWeekWed, wedAt17), 'mercredi 14/10 à 17h');

  // Default schedule is frozen and drives the cron expression
  const { DEFAULT_ENIGMA_SCHEDULE, publicationCronExpression } = require('../src/utils/time');
  assert.equal(Object.isFrozen(DEFAULT_ENIGMA_SCHEDULE), true);
  assert.equal(Object.isFrozen(DEFAULT_ENIGMA_SCHEDULE.days), true);
  assert.equal(publicationCronExpression(DEFAULT_ENIGMA_SCHEDULE), '0 17 * * 1,2,3,4,5');
  assert.equal(publicationCronExpression({ days: [4, 2, 4], hour: 18, minute: 30 }), '30 18 * * 2,4');

  // Invalid schedules rejected explicitly (days, hour, minute)
  for (const invalid of [
    { days: [], hour: 17 },
    { days: [-1], hour: 17 },
    { days: [7], hour: 17 },
    { days: [1.5], hour: 17 },
    { days: [1], hour: -1 },
    { days: [1], hour: 24 },
    { days: [1], hour: 17.5 },
    { days: [1], hour: 17, minute: -1 },
    { days: [1], hour: 17, minute: 60 },
    { days: [1], hour: 17, minute: 0.5 },
  ]) {
    assert.throws(() => nextEnigmaPublication(wedBefore, invalid), /planning/i);
    assert.throws(() => publicationCronExpression(invalid), /planning/i);
  }
});

test('CRON-16: programEnigma returns next publication and recordGuess NOT_YET announces it', async () => {
  await setup({ enigme_status: 'finished' });
  const saturday = new Date('2026-10-10T10:28:00Z'); // Sat 10/10 12:28 CEST
  const programmed = await enigma.programEnigma({ text: 'Titre\nCorps', answer: 'soleil', hints: [null, null, null] }, saturday);
  assert.equal(programmed.nextPublication.toISOString(), '2026-10-12T15:00:00.000Z');
  assert.equal(programmed.nextPublicationLabel, 'lundi 12/10 à 17h');

  await assert.rejects(
    enigma.recordGuess('p1', saturday),
    err => err.code === 'NOT_YET' && err.message.includes('**lundi 12/10 à 17h**'),
  );
  const wednesdayMorning = new Date('2026-10-07T12:00:00Z'); // Wed 07/10 14:00 CEST
  await assert.rejects(
    enigma.recordGuess('p1', wednesdayMorning),
    err => err.code === 'NOT_YET' && err.message.includes("**aujourd'hui à 17h**"),
  );
});

test.after(() => sequelize.close());
