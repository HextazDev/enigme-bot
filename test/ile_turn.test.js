const test = require('node:test');
const assert = require('node:assert/strict');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const ile = require('../src/gamemodes/ile_defis/turn');

const actor = { id: 'p1', username: 'P1' };
const seq = (values, rest = 0) => () => (values.length ? values.shift() : rest);
const d6 = n => (n - 1) / 6 + 0.01;
const code = expected => error => error.code === expected;
const noData = { portails_ouverts: [], cascade_desactivee: false, gagnants_dragon: [] };

async function setup(player = {}, modeData = {}) {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 4, enigme_status: 'finished', game_mode: 'ile_defis', game_map: 'board_game_island', mode_data: modeData });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: true, position: 1, ...player });
}
const reload = () => Joueur.findByPk('p1');
const board = async () => (await Plateau.findByPk(1)).mode_data;

test('walk: crossroads, closed gate after the chosen path, vine, cascade and dragon stops', () => {
  assert.deepEqual(ile.walk({ position: 13, remaining: 3, resume: null, direction: null, data: noData }), { position: 14, remaining: 2, stop: 'intersection' });
  assert.deepEqual(ile.walk({ position: 14, remaining: 2, resume: 'intersection', direction: 20, data: noData }), { position: 14, remaining: 2, stop: 'portail', target: 20 });
  assert.deepEqual(ile.walk({ position: 14, remaining: 2, resume: 'portail', direction: 20, data: noData }), { position: 21, remaining: 0, stop: null }, 'the gate keeps the chosen direction');
  assert.deepEqual(ile.walk({ position: 14, remaining: 2, resume: 'intersection', direction: 20, data: { ...noData, portails_ouverts: [20] } }).position, 21);
  assert.deepEqual(ile.walk({ position: 10, remaining: 4, resume: null, direction: null, data: noData }), { position: 12, remaining: 2, stop: 'liane' });
  assert.deepEqual(ile.walk({ position: 36, remaining: 5, resume: null, direction: null, data: noData }), { position: 38, remaining: 3, stop: 'cascade' });
  assert.equal(ile.walk({ position: 36, remaining: 5, resume: null, direction: null, data: { ...noData, cascade_desactivee: true } }).position, 41);
  assert.deepEqual(ile.walk({ position: 71, remaining: 6, resume: null, direction: null, data: noData }), { position: 73, remaining: 0, stop: 'dragon' });
});

test('rolling on the dragon case waits for a new attack instead of corrupting the position', async () => {
  await setup({ position: 73 });
  const { move } = await ile.startTurn(actor, { random: seq([d6(4)]) });
  assert.equal(move.kind, 'stopped');
  assert.equal(move.stop, 'dragon');
  assert.equal((await reload()).position, 73);
});

test('a dragon attack is consumed: the same button cannot be replayed until the win', async () => {
  await setup({ position: 72 });
  await ile.startTurn(actor, { random: seq([d6(1)]) });
  const fail = await ile.resolveChallenge(actor, 'dragon', null, { random: seq([d6(2)]) });
  assert.equal(fail.success, false);
  await assert.rejects(ile.resolveChallenge(actor, 'dragon', null, { random: seq([d6(6)]) }), code('STALE'));
  assert.deepEqual((await board()).gagnants_dragon ?? [], []);
});

test('a dragon victory, an opened gate and a disabled cascade are persisted for everyone', async () => {
  await setup({ position: 72 });
  await ile.startTurn(actor, { random: seq([d6(1)]) });
  assert.equal((await ile.resolveChallenge(actor, 'dragon', null, { random: seq([d6(6)]) })).success, true);
  assert.deepEqual((await board()).gagnants_dragon, ['p1']);

  await setup({ position: 18 });
  await ile.startTurn(actor, { random: seq([d6(3)]) });
  const gate = await ile.resolveChallenge(actor, 'portail', null, { random: seq([d6(4)]) });
  assert.equal(gate.success, true);
  assert.deepEqual((await board()).portails_ouverts, [20]);
  assert.equal((await reload()).position, 21 - 2, 'reaches the slide on 21 and slides back');

  await setup({ position: 37 });
  await ile.startTurn(actor, { random: seq([d6(2)]) });
  assert.equal((await ile.resolveChallenge(actor, 'cascade', null, { random: seq([d6(3)]) })).success, true);
  assert.equal((await board()).cascade_desactivee, true);
});

test('the gate reached from the right path of a crossroads can be attempted (target kept in the pending choice)', async () => {
  await setup({ position: 13 });
  await ile.startTurn(actor, { random: seq([d6(3)]) });
  const choice = await ile.resolveChallenge(actor, 'intersection', 1, { random: seq([0.9]) });
  assert.equal(choice.move.stop, 'portail');
  assert.equal((await reload()).action_en_attente.target, 20);
  const gate = await ile.resolveChallenge(actor, 'portail', null, { random: seq([d6(5)]) });
  assert.equal(gate.target, 20);
  assert.deepEqual((await board()).portails_ouverts, [20]);
});

test('a failed crossroads drops the player in the water and ends the turn', async () => {
  await setup({ position: 13 });
  await ile.startTurn(actor, { random: seq([d6(5)]) });
  const fall = await ile.resolveChallenge(actor, 'intersection', 0, { random: seq([0.1]) });
  assert.equal(fall.fellTo, 10);
  const p1 = await reload();
  assert.deepEqual([p1.position, p1.cases_restantes, p1.action_en_attente], [10, 0, null]);
});

test('the double flag is reset at each roll and grants exactly one extra roll', async () => {
  await setup({ position: 1, mode_data: { bonus_de: 'silver' } });
  const first = await ile.startTurn(actor, { random: seq([d6(2), 0.4, 0.99]) });
  assert.equal(first.double, true);
  assert.equal((await reload()).a_le_droit_de_jouer, true);
  const second = await ile.startTurn(actor, { random: seq([d6(1)], 0.99) });
  assert.equal(second.double, false);
  const p1 = await reload();
  assert.equal(p1.a_le_droit_de_jouer, false);
  assert.equal(p1.mode_data.double_lancer, false);
  assert.equal(p1.mode_data.bonus_de, 'none');
});

test('expired obstacles: a gate fails, a vine jumps automatically', async () => {
  await setup({ position: 18 });
  const { move } = await ile.startTurn(actor, { random: seq([d6(3)]) });
  const expired = await ile.expirePending(actor, move.pending.token);
  assert.equal(expired.type, 'portail');
  assert.equal((await reload()).cases_restantes, 0);
  assert.equal(await ile.expirePending(actor, move.pending.token), null);
});

test('a rock pushes back every player of the zone, including the one who triggered it', async () => {
  await setup({ position: 26 });
  await Joueur.create({ discord_id: 'p2', position: 12 });
  await Joueur.create({ discord_id: 'p3', position: 40 });
  await ile.startTurn(actor, { random: seq([d6(2)]) });
  assert.equal((await reload()).position, 23);
  assert.equal((await Joueur.findByPk('p2')).position, 7);
  assert.equal((await Joueur.findByPk('p3')).position, 40);
});

test('ILE-08: expired intersection applies the same 50% fall risk; expired vine jumps automatically', async () => {
  await setup({ position: 13 });
  const fallRun = await ile.startTurn(actor, { random: seq([d6(4)]) });
  const fell = await ile.expirePending(actor, fallRun.move.pending.token, { random: seq([0.1]) });
  assert.equal(fell.type, 'intersection');
  assert.equal(fell.fellTo, 10);
  assert.equal(fell.move, null);
  assert.equal((await reload()).position, 10);

  await setup({ position: 13 });
  const safeRun = await ile.startTurn(actor, { random: seq([d6(3)]) });
  const safe = await ile.expirePending(actor, safeRun.move.pending.token, { random: seq([0.9, 0.1]) });
  assert.equal(safe.type, 'intersection');
  assert.equal(safe.fellTo, undefined);
  assert.equal(safe.move.kind, 'landed');

  await setup({ position: 10 });
  const vineRun = await ile.startTurn(actor, { random: seq([d6(3)]) });
  assert.equal(vineRun.move.stop, 'liane');
  const jumped = await ile.expirePending(actor, vineRun.move.pending.token, { random: seq([d6(1)]) });
  assert.equal(jumped.type, 'liane');
  assert.equal(jumped.roll, 1);
  assert.equal((await reload()).position, 13);
});

test('PEND-09: resolveChallenge is locked during an active enigma', async () => {
  await setup({ position: 73, action_en_attente: { type: 'dragon', case: 73, token: 't' } });
  await Plateau.update({ enigme_status: 'active' }, { where: { id: 1 } });
  await assert.rejects(ile.resolveChallenge(actor, 'dragon', null, { random: seq([d6(6)]) }), code('LOCKED'));
});

test('ILE-08: unblockGhost on the island checks season_ended and active enigma consistently', async () => {
  await setup({ est_fantome: true, a_le_droit_de_jouer: false, a_joue_ce_tour: false });
  assert.equal(await ile.unblockGhost('p1'), true);
  const p1 = await reload();
  assert.deepEqual([p1.est_fantome, p1.fantome_unblock_used, p1.a_le_droit_de_jouer], [false, true, true]);

  await setup({ est_fantome: true, a_le_droit_de_jouer: false });
  await Plateau.update({ enigme_status: 'season_ended' }, { where: { id: 1 } });
  assert.equal(await ile.unblockGhost('p1'), false);
});

test('Elan boost, Echange swap, and full transaction rollback on DB write failure', async () => {
  await setup({ position: 5 });
  const boost = await ile.startTurn(actor, { random: seq([d6(1), 0.9]) }); // lands on 6 (Elan), +3 -> 9
  assert.equal(boost.move.effects[0].kind, 'boost');
  assert.equal((await reload()).position, 9);

  await setup({ position: 7 });
  await Joueur.create({ discord_id: 'leader', position: 50 });
  const swap = await ile.startTurn(actor, { random: seq([d6(1), d6(5)]) }); // lands on 8 (Echange), roll 5 -> swap with first
  assert.equal(swap.move.effects[0].kind, 'exchange');
  assert.equal((await reload()).position, 50);
  assert.equal((await Joueur.findByPk('leader')).position, 8);

  await setup({ position: 5 });
  Joueur.addHook('beforeUpdate', 'fail-ile', () => { throw new Error('Injected island failure'); });
  try { await assert.rejects(ile.startTurn(actor, { random: seq([d6(1)]) }), /Injected/); }
  finally { Joueur.removeHook('beforeUpdate', 'fail-ile'); }
  assert.equal((await reload()).position, 5);
  assert.equal((await reload()).a_le_droit_de_jouer, true);
});

test.after(() => sequelize.close());

