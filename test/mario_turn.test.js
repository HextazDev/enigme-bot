const test = require('node:test');
const assert = require('node:assert/strict');
const { Joueur, Plateau, TourSnapshot, sequelize } = require('../src/db/models');
const turn = require('../src/gamemodes/mario_party/turn');

const WEDNESDAY = new Date('2026-10-07T12:00:00Z');
const SATURDAY = new Date('2026-10-10T12:00:00Z');
const actor = { id: 'p1', username: 'P1' };
/** Deterministic random: returns the listed values, then `rest`. */
const seq = (values, rest = 0) => () => (values.length ? values.shift() : rest);
const die = n => (n - 1) / 10 + 0.01; // value producing an n on the 1-10 die
const opts = (values, rest) => ({ random: seq(values, rest), now: WEDNESDAY });

async function setup({ player = {}, board = {} } = {}) {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished', position_etoile: 30, ...board });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: true, position: 1, ...player });
  await Joueur.create({ discord_id: 'p2', pieces: 30, etoiles: 1, position: 5 });
}
const reload = id => Joueur.findByPk(id);
const code = expected => error => error.code === expected;

test('a roll consumes modifiers, records a snapshot and resolves the landing case atomically', async () => {
  await setup({ player: { bonus_prochain_lancer: 3, pieces: 0 } });
  const { de, move } = await turn.startTurn(actor, opts([die(1)]));
  assert.equal(de, 4);
  assert.equal(move.kind, 'landed');
  const p1 = await reload('p1');
  assert.equal(p1.position, 5);
  assert.equal(p1.pieces, 0, 'case 5 is red and the balance cannot go negative');
  assert.equal(p1.bonus_prochain_lancer, 0);
  assert.equal(p1.a_le_droit_de_jouer, false);
  assert.equal(p1.stat_cases_avancees, 4);
  assert.equal(await TourSnapshot.count(), 1);
});

test('a failure during the landing rolls back the whole turn (roll, snapshot, movement)', async () => {
  await setup();
  Joueur.addHook('beforeUpdate', 'fail-landing', () => { throw new Error('Injected failure'); });
  try { await assert.rejects(turn.startTurn(actor, opts([die(2)])), /Injected/); }
  finally { Joueur.removeHook('beforeUpdate', 'fail-landing'); }
  const p1 = await reload('p1');
  assert.equal(p1.a_le_droit_de_jouer, true);
  assert.equal(p1.position, 1);
  assert.equal(await TourSnapshot.count(), 0);
});

test('rolling is refused for ghosts, players who already played, an ended season, an open enigma and on Saturday', async () => {
  await setup({ player: { est_fantome: true } });
  await assert.rejects(turn.startTurn(actor, opts([])), error => error.code === 'GHOST' && /fantôme/.test(error.message));
  await Joueur.update({ est_fantome: false, a_le_droit_de_jouer: false }, { where: { discord_id: 'p1' } });
  await assert.rejects(turn.startTurn(actor, opts([])), code('NOT_ALLOWED'));
  await Joueur.update({ a_le_droit_de_jouer: true }, { where: { discord_id: 'p1' } });
  await Plateau.update({ enigme_status: 'active' }, { where: { id: 1 } });
  await assert.rejects(turn.startTurn(actor, opts([])), code('LOCKED'));
  await Plateau.update({ enigme_status: 'season_ended' }, { where: { id: 1 } });
  await assert.rejects(turn.startTurn(actor, opts([])), code('CLOSED'));
  await Plateau.update({ enigme_status: 'finished' }, { where: { id: 1 } });
  await assert.rejects(turn.startTurn(actor, { random: seq([]), now: SATURDAY }), code('SATURDAY'));
  assert.equal(await TourSnapshot.count(), 0);
});

test('passing the star waits for a decision; buying moves the star and the walk resumes with the remaining steps', async () => {
  await setup({ player: { position: 8, pieces: 25 }, board: { position_etoile: 10 } });
  const { move } = await turn.startTurn(actor, opts([die(3)], 0));
  assert.equal(move.kind, 'stopped');
  assert.equal(move.stop, 'etoile');
  assert.deepEqual((await reload('p1')).action_en_attente.type, 'etoile');
  const result = await turn.resolveStar(actor, true, opts([], 0));
  assert.equal(result.bought, true);
  const p1 = await reload('p1');
  assert.equal(p1.etoiles, 1);
  assert.equal(p1.position, 11, 'one step left after the star');
  assert.equal(p1.action_en_attente, null);
  assert.notEqual((await Plateau.findByPk(1)).position_etoile, 10);
  await assert.rejects(turn.resolveStar(actor, true, opts([])), code('STALE'), 'the star button cannot be reused');
  assert.equal((await reload('p1')).pieces, 0, 'paid 20 once (25 - 20), then the Malchance case 11 took 5');
});

test('a Boo steal is impossible without standing on a pending Boo choice (stale menu exploit)', async () => {
  await setup({ player: { position: 3 } });
  await assert.rejects(turn.booSteal(actor, 'p2', 'pieces', opts([])), code('STALE'));
  assert.equal((await reload('p1')).pieces, 0);
  assert.equal((await reload('p2')).pieces, 30);
});

test('Boo: landing on it offers a steal, the steal is atomic and the turn then ends', async () => {
  await setup({ player: { position: 51, pieces: 0 } });
  await turn.startTurn(actor, opts([die(1)]));
  const targets = await turn.booTargets(actor, 'pieces');
  assert.deepEqual(targets.map(t => t.discord_id), ['p2']);
  await assert.rejects(turn.booTargets(actor, 'etoile'), code('FUNDS'));
  const { amount } = await turn.booSteal(actor, 'p2', 'pieces', opts([0.99]));
  assert.equal(amount, 12);
  assert.equal((await reload('p1')).pieces, 12);
  assert.equal((await reload('p2')).pieces, 18);
  assert.equal((await reload('p1')).action_en_attente, null);
});

test('shop: the offer is kept, a full inventory asks for a replacement first, and old shop buttons expire once left', async () => {
  await setup({ player: { position: 22, pieces: 50, inventaire: ['A', 'B', 'C'] } });
  const { move } = await turn.startTurn(actor, opts([die(1)], 0));
  assert.equal(move.stop, 'boutique');
  assert.equal(move.shop.length, 3);
  const offered = move.shop[0].id;
  const full = await turn.buyFromShop(actor, offered, undefined, opts([]));
  assert.equal(full.purchase.kind, 'needs_replacement');
  assert.deepEqual((await reload('p1')).inventaire, ['A', 'B', 'C']);
  const bought = await turn.buyFromShop(actor, offered, 1, opts([]));
  assert.equal(bought.purchase.droppedItem, 'B');
  assert.equal(bought.move.kind, 'landed');
  await assert.rejects(turn.buyFromShop(actor, move.shop[1].id, 0, opts([])), code('STALE'));
});

test('crossroads: a bonus path needs a key, which is consumed; a wrong exit is rejected', async () => {
  await setup({ player: { position: 12, inventaire: [] } });
  const { move } = await turn.startTurn(actor, opts([die(5)]));
  assert.equal(move.stop, 'intersection');
  await assert.rejects(turn.chooseDirection(actor, 46, opts([])), code('NO_KEY'));
  await assert.rejects(turn.chooseDirection(actor, 3, opts([])), code('DIRECTION'));
  await Joueur.update({ inventaire: ['🔑 Clé', '🍄 Champignon'] }, { where: { discord_id: 'p1' } });
  await turn.chooseDirection(actor, 46, opts([], 0));
  const p1 = await reload('p1');
  assert.deepEqual(p1.inventaire, ['🍄 Champignon']);
  assert.equal(p1.position, 48);
});

test('an expired choice applies the default path only if it is still the same pending choice', async () => {
  await setup({ player: { position: 12 } });
  const { move } = await turn.startTurn(actor, opts([die(3)]));
  assert.equal(await turn.expirePending(actor, 'another-token', opts([])), null);
  const expired = await turn.expirePending(actor, move.pending.token, opts([], 0));
  assert.equal(expired.type, 'intersection');
  assert.equal((await reload('p1')).position, 15);
  assert.equal(await turn.expirePending(actor, move.pending.token, opts([])), null);
});

test('items: a stale slot cannot trigger another item, passive keys are kept, and the loaded die needs a value', async () => {
  await setup({ player: { inventaire: ['🎺 Sifflet', '🔑 Clé', '🎲 Dé pipé'] } });
  await assert.rejects(turn.useItem(actor, 'CHAMPIGNON', 0, null, opts([])), code('STALE'));
  await assert.rejects(turn.useItem(actor, 'CLE', 1, null, opts([])), code('PASSIVE'));
  await assert.rejects(turn.useItem(actor, 'DE_PIPE', 2, 11, opts([])), code('PIPE_VALUE'));
  let p1 = await reload('p1');
  assert.deepEqual(p1.inventaire, ['🎺 Sifflet', '🔑 Clé', '🎲 Dé pipé']);
  assert.equal(p1.bonus_prochain_lancer, 0);
  await turn.useItem(actor, 'DE_PIPE', 2, 7, opts([]));
  p1 = await reload('p1');
  assert.deepEqual([p1.type_de, p1.de_pipe_valeur, p1.inventaire.length, p1.stat_objets_utilises], ['pipe', 7, 2, 1]);
});

test('the mirror swaps positions atomically with a non-ghost player', async () => {
  await setup({ player: { position: 2, inventaire: ['🪞 Miroir'] } });
  await Joueur.create({ discord_id: 'ghost', position: 40, est_fantome: true });
  const used = await turn.useItem(actor, 'MIROIR', 0, null, opts([0]));
  assert.deepEqual(used.effect, { kind: 'mirror', targetId: 'p2' });
  assert.equal((await reload('p1')).position, 5);
  assert.equal((await reload('p2')).position, 2);
  assert.equal((await reload('ghost')).position, 40);
});

test('PARITY-03: on the last turn, stopping exactly on the closed shop resolves the case (legacy skipped hidden blocks and traps)', async () => {
  await setup({ player: { position: 20, type_de: 'pipe', de_pipe_valeur: 3, pieces: 0 }, board: { tour: 30, blocs_caches: { pieces_20: 23 } } });
  const { move } = await turn.startTurn(actor, opts([]));
  assert.equal(move.kind, 'landed');
  const p1 = await reload('p1');
  assert.equal(p1.position, 23);
  assert.equal(p1.pieces, 20);
  assert.equal(p1.action_en_attente, null);
});

test('GAME-01 & TURN-01: Saturday before 10h Paris is still playable, 10h or paris_ouverts closes it, and in-progress moves block a new roll', async () => {
  const sat0830Paris = new Date('2026-10-10T06:30:00Z'); // 08:30 CEST
  const sat1000Paris = new Date('2026-10-10T08:00:00Z'); // 10:00 CEST
  await setup({ player: { position: 1 } });
  const { move } = await turn.startTurn(actor, { random: seq([die(2)]), now: sat0830Paris });
  assert.equal(move.kind, 'landed');

  await setup({ player: { position: 1 } });
  await assert.rejects(turn.startTurn(actor, { random: seq([die(2)]), now: sat1000Paris }), code('SATURDAY'));

  await setup({ player: { position: 1 }, board: { mode_data: { paris_ouverts: true } } });
  await assert.rejects(turn.startTurn(actor, opts([die(2)])), code('SATURDAY'));

  await setup({ player: { position: 8, cases_restantes: 2, action_en_attente: { type: 'etoile', case: 8, token: 't' } } });
  await assert.rejects(turn.startTurn(actor, opts([die(2)])), code('IN_PROGRESS'));
});

test('PEND-09: an active enigma locks pending choices (star, shop, Boo, continueTurn)', async () => {
  await setup({ player: { position: 10, pieces: 30, cases_restantes: 1, action_en_attente: { type: 'etoile', case: 10, token: 't' } },
    board: { enigme_status: 'active', position_etoile: 10 } });
  await assert.rejects(turn.resolveStar(actor, true, opts([])), code('LOCKED'));

  await setup({ player: { position: 23, pieces: 30, cases_restantes: 1, boutique_du_jour: ['champignon'], action_en_attente: { type: 'boutique', case: 23, token: 't' } },
    board: { enigme_status: 'active' } });
  await assert.rejects(turn.buyFromShop(actor, 'champignon', undefined, opts([])), code('LOCKED'));

  await setup({ player: { position: 52, pieces: 30, cases_restantes: 1, action_en_attente: { type: 'boo', case: 52, token: 't' } },
    board: { enigme_status: 'active' } });
  await assert.rejects(turn.booTargets(actor, 'pieces', opts([])), code('LOCKED'));
  await assert.rejects(turn.booSteal(actor, 'p2', 'pieces', opts([])), code('LOCKED'));

  await setup({ player: { position: 23, cases_restantes: 2, action_en_attente: null }, board: { enigme_status: 'active' } });
  await assert.rejects(turn.continueTurn(actor, opts([])), code('LOCKED'));
});

test('PEND-08: passing Boo with remaining steps resumes walking after steal, pass, or expiration', async () => {
  // Case 51 -> 52 (Boo) -> 53 -> 54
  await setup({ player: { position: 51, pieces: 10 } });
  const { move } = await turn.startTurn(actor, opts([die(3)]));
  assert.equal(move.stop, 'boo');
  assert.equal((await reload('p1')).cases_restantes, 2);
  const pass = await turn.booPass(actor, opts([], 0));
  assert.equal(pass.move.kind, 'landed');
  assert.equal((await reload('p1')).position, 54);

  await setup({ player: { position: 51, pieces: 10 } });
  const second = await turn.startTurn(actor, opts([die(3)]));
  const expired = await turn.expirePending(actor, second.move.pending.token, opts([], 0));
  assert.equal(expired.type, 'boo');
  assert.equal((await reload('p1')).position, 54);
});

test('unblockGhost restores play right only when the board is open and never during an ended season', async () => {
  await setup({ player: { est_fantome: true, a_le_droit_de_jouer: false, a_joue_ce_tour: false }, board: { enigme_status: 'finished' } });
  assert.equal(await turn.unblockGhost('p1', { now: WEDNESDAY }), true);
  let p1 = await reload('p1');
  assert.deepEqual([p1.est_fantome, p1.fantome_unblock_used, p1.a_le_droit_de_jouer], [false, true, true]);
  assert.equal(await turn.unblockGhost('p1', { now: WEDNESDAY }), false, 'one-shot per season');

  await setup({ player: { est_fantome: true, a_le_droit_de_jouer: false }, board: { enigme_status: 'active' } });
  assert.equal(await turn.unblockGhost('p1', { now: WEDNESDAY }), true);
  assert.equal((await reload('p1')).a_le_droit_de_jouer, false, 'board locked during active enigma');

  await setup({ player: { est_fantome: true, a_le_droit_de_jouer: false }, board: { enigme_status: 'season_ended' } });
  assert.equal(await turn.unblockGhost('p1', { now: WEDNESDAY }), false);
});

test('all active Mario items apply their effects and update inventory/board atomically', async () => {
  const { ITEMS } = require('../src/gamemodes/mario_party/items');
  await setup({
    player: { position: 5, inventaire: [ITEMS.CHAMPIGNON.name, ITEMS.DOUBLE_DE.name, ITEMS.DE_TRIPLE.name] },
    board: { position_etoile: 20 },
  });
  await turn.useItem(actor, 'CHAMPIGNON', 0, null, opts([]));
  assert.equal((await reload('p1')).bonus_prochain_lancer, 3);
  await turn.useItem(actor, 'DOUBLE_DE', 0, null, opts([]));
  assert.equal((await reload('p1')).type_de, 'double');
  await turn.useItem(actor, 'DE_TRIPLE', 0, null, opts([]));
  assert.equal((await reload('p1')).type_de, 'triple');

  await setup({
    player: { position: 5, inventaire: [ITEMS.PIEGE_PIECES.name, ITEMS.PIEGE_ETOILE.name, ITEMS.SIFFLET.name] },
    board: { position_etoile: 20 },
  });
  await turn.useItem(actor, 'PIEGE_PIECES', 0, null, opts([]));
  await turn.useItem(actor, 'PIEGE_ETOILE', 0, null, opts([]));
  const sifflet = await turn.useItem(actor, 'SIFFLET', 0, null, opts([0]));
  assert.equal(sifflet.effect.kind, 'star_moved');
  const plateau = await Plateau.findByPk(1);
  assert.equal(plateau.pieges_actifs.length, 2);
  assert.notEqual(plateau.position_etoile, 20);

  await setup({
    player: { position: 5, inventaire: [ITEMS.TUYAU.name, ITEMS.TUYAU_DORE.name] },
    board: { position_etoile: 20 },
  });
  const pipe = await turn.useItem(actor, 'TUYAU', 0, null, opts([0]));
  assert.equal(pipe.effect.kind, 'teleport');
  assert.equal(pipe.effect.golden, false);
  const gold = await turn.useItem(actor, 'TUYAU_DORE', 0, null, opts([]));
  assert.equal(gold.effect.kind, 'teleport');
  assert.equal(gold.effect.golden, true);
  assert.equal((await reload('p1')).position, 19);
});

test.after(() => sequelize.close());

