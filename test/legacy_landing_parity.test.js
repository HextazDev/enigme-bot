const test = require('node:test');
const assert = require('node:assert/strict');
const legacy = require('./fixtures/legacy-landing');
const legacyRules = require('./fixtures/legacy-rules');
const { ITEMS: LEGACY_ITEMS } = require('./fixtures/legacy-items');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const { applyLanding } = require('../src/gamemodes/mario_party/landing');
const { BOARD_CASES } = require('../src/gamemodes/mario_party/maps/night_sky/board');

const FIELDS = ['pieces', 'etoiles', 'position', 'inventaire', 'de_limite', 'stat_cases_chance', 'stat_cases_malchance'];
const CASE_TYPES = ['Bleue', 'Rouge', 'Chance', 'Malchance', 'Coup du Sort', 'Bowser', 'Boo'];
const clone = value => JSON.parse(JSON.stringify(value));

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sequelize semantics the legacy code relied on: fresh instances per query, save() writes changed fields only. */
function fakeJoueurModel(rows) {
  const instance = row => {
    const original = clone(row);
    const player = clone(row);
    player.save = async () => {
      for (const key of Object.keys(original)) {
        if (JSON.stringify(player[key]) !== JSON.stringify(original[key])) {
          row[key] = clone(player[key]);
          original[key] = clone(player[key]);
        }
      }
    };
    return player;
  };
  return {
    findAll: async (options = {}) => {
      const list = [...rows];
      if (options.order) list.sort((a, b) => a.etoiles - b.etoiles || a.pieces - b.pieces);
      return list.map(instance);
    },
    findByPk: async id => {
      const row = rows.find(r => r.discord_id === id);
      return row ? instance(row) : null;
    },
    instance,
  };
}

function scenario(seed) {
  const random = seeded(seed);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const count = int(1, 4);
  const used = new Set();
  const players = [];
  for (let index = 0; index < count; index++) {
    let etoiles, pieces;
    // Unique (etoiles, pieces) keeps the "last player" ordering independent of SQLite tie-breaking.
    // Empty purses are over-sampled: several rules filter or cap on them.
    do { etoiles = int(0, 3); pieces = random() < 0.2 ? 0 : int(0, 45); } while (used.has(`${etoiles}:${pieces}`));
    used.add(`${etoiles}:${pieces}`);
    players.push({
      discord_id: `p${index}`, etoiles, pieces, position: int(2, 45),
      inventaire: Object.values(LEGACY_ITEMS).slice(0, int(0, 3)).map(item => item.name),
      est_fantome: index > 0 && random() < 0.2, de_limite: false,
      stat_cases_chance: int(0, 2), stat_cases_malchance: int(0, 2),
    });
  }
  const active = players[0];
  const caseArrivee = { ...BOARD_CASES.find(c => c.id === active.position), type: CASE_TYPES[int(0, CASE_TYPES.length - 1)] };
  const blocs = random() < 0.3 ? { etoile: -1, pieces_20: -1, pieces_10: -1, pieces_5: -1, [['etoile', 'pieces_20', 'pieces_10', 'pieces_5'][int(0, 3)]]: active.position } : null;
  // Self-owned traps are covered separately (PARITY-01).
  const trapOwner = ['p1', 'p2', 'ghost-owner'][int(0, 2)];
  const trap = random() < 0.3 ? { position: active.position, type: random() < 0.5 ? 'pieces' : 'etoile', poseur: trapOwner } : null;
  return {
    players, caseArrivee, trap,
    plateau: { tour: [5, 25, 26, 27][int(0, 3)], position_etoile: int(2, 45), blocs_caches: blocs },
    draws: seeded(seed ^ 0x5EED),
  };
}

async function runLegacy(s) {
  const rows = clone(s.players);
  const Joueur = fakeJoueurModel(rows);
  const plateau = { ...clone(s.plateau), save: async () => {} };
  const joueur = Joueur.instance(rows[0]);
  const getRandomStarPosition = current => legacyRules.star(BOARD_CASES, rows, s.draws)(current);
  await legacy.landing({
    joueur, plateau, caseArrivee: s.caseArrivee, piegeDeclenche: s.trap ? clone(s.trap) : null,
    interaction: { user: { id: 'p0', username: 'P0' } }, Joueur, getRandomStarPosition, ITEMS: LEGACY_ITEMS, random: s.draws,
  });
  return { players: rows.map(r => pickFields(r)), plateau: { position_etoile: plateau.position_etoile, blocs_caches: plateau.blocs_caches } };
}

async function runCurrent(s) {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, ...clone(s.plateau), enigme_status: 'finished' });
  for (const player of s.players) await Joueur.create(clone(player));
  const joueur = await Joueur.findByPk('p0');
  const plateau = await Plateau.findByPk(1);
  const events = await sequelize.transaction(transaction => applyLanding({
    joueur, plateau, caseArrivee: s.caseArrivee, actor: { id: 'p0', username: 'P0' }, trap: s.trap ? clone(s.trap) : null, random: s.draws,
    chooseStar: async (current, t) => legacyRules.star(BOARD_CASES, await Joueur.findAll({ transaction: t }), s.draws)(current),
  }, transaction));
  const players = [];
  for (const player of s.players) players.push(pickFields((await Joueur.findByPk(player.discord_id)).get({ plain: true })));
  await plateau.reload();
  return { events, players, plateau: { position_etoile: plateau.position_etoile, blocs_caches: plateau.blocs_caches } };
}

function pickFields(row) {
  return Object.fromEntries([['discord_id', row.discord_id], ...FIELDS.map(key => [key, row[key]])]);
}

/**
 * PARITY-02: legacy code read a stale database copy of the active player for server-wide effects,
 * then its final save overwrote that copy. Only differs when the player's coins already changed
 * on this landing (hidden block, coin trap) before a redistribution or a lottery won by themself.
 */
function isStaleCopyException(events) {
  const balanceChangedEarly = events.some(e => ['hidden_star', 'hidden_twenty', 'hidden_ten', 'hidden_five'].includes(e.kind)
    || (['coin_trap_transfer', 'coin_trap_loss'].includes(e.kind) && e.amount > 0)
    || ['star_trap_transfer', 'star_trap_loss'].includes(e.kind));
  const readsAllPlayers = events.some(e => e.kind === 'bowser_redistribute' || e.kind === 'bowser_gift' || e.kind === 'bowser_last'
    || (e.kind === 'fate_lottery' && e.targetId === 'p0'));
  return balanceChangedEarly && readsAllPlayers;
}

test('every Mario landing effect matches the frozen legacy implementation for identical state and draws', async () => {
  const kinds = new Set();
  let exceptions = 0;
  const SCENARIOS = 2500;
  for (let seed = 1; seed <= SCENARIOS; seed++) {
    const s = scenario(seed);
    const current = await runCurrent(s);
    const old = await runLegacy(scenario(seed));
    current.events.forEach(e => kinds.add(e.kind));
    if (isStaleCopyException(current.events)) { exceptions++; continue; }
    assert.deepEqual({ players: current.players, plateau: current.plateau }, old, `seed ${seed} (${s.caseArrivee.type})`);
  }
  // The generator must actually reach every branch, otherwise the comparison proves little.
  for (const kind of ['hidden_star', 'hidden_twenty', 'coin_trap_transfer', 'coin_trap_loss', 'star_trap_transfer', 'star_trap_empty',
    'blue_coins', 'red_coins', 'chance_coins', 'chance_item', 'chance_full', 'chance_steal', 'chance_fill',
    'unlucky_coins', 'unlucky_item', 'unlucky_empty', 'unlucky_die', 'unlucky_bowser',
    'bowser_half', 'bowser_star', 'bowser_redistribute', 'bowser_inventory', 'bowser_gift', 'bowser_last',
    'fate_positions', 'fate_no_positions', 'fate_lottery', 'fate_star', 'fate_steal', 'fate_duel', 'duel_win', 'duel_loss', 'duel_tie',
    'fate_gift', 'fate_coins', 'fate_stars']) {
    assert.ok(kinds.has(kind), `branch never reached: ${kind}`);
  }
  assert.ok(exceptions < SCENARIOS * 0.05, `too many documented exceptions skipped: ${exceptions}`);
});

test('PARITY-01: landing on your own trap is neutral (legacy silently destroyed the coins or star)', async () => {
  for (const type of ['pieces', 'etoile']) {
    const s = { players: [{ discord_id: 'p0', pieces: 25, etoiles: 2, position: 10, inventaire: [], est_fantome: false, de_limite: false, stat_cases_chance: 0, stat_cases_malchance: 0 }],
      caseArrivee: { ...BOARD_CASES.find(c => c.id === 10), type: 'Boo' }, trap: { position: 10, type, poseur: 'p0' },
      plateau: { tour: 5, position_etoile: 20, blocs_caches: null }, draws: () => 0 };
    const current = await runCurrent(s);
    const old = await runLegacy(s);
    assert.deepEqual([current.players[0].pieces, current.players[0].etoiles], [25, 2]);
    assert.deepEqual([old.players[0].pieces, old.players[0].etoiles], type === 'pieces' ? [15, 2] : [25, 1]);
  }
});

test('PARITY-02: a redistribution counts coins the active player earned earlier on the same landing', async () => {
  const s = { players: [
    { discord_id: 'p0', pieces: 10, etoiles: 0, position: 10, inventaire: [], est_fantome: false, de_limite: false, stat_cases_chance: 0, stat_cases_malchance: 0 },
    { discord_id: 'p1', pieces: 30, etoiles: 1, position: 12, inventaire: [], est_fantome: false, de_limite: false, stat_cases_chance: 0, stat_cases_malchance: 0 }],
  caseArrivee: { ...BOARD_CASES.find(c => c.id === 10), type: 'Bowser' }, trap: null,
  plateau: { tour: 5, position_etoile: 20, blocs_caches: { etoile: -1, pieces_20: 10, pieces_10: -1, pieces_5: -1 } }, draws: () => 0.5 };
  const current = await runCurrent(s);
  const old = await runLegacy(s);
  // (10 + 20 + 30) / 2 for everyone; legacy shared only the stored 10 + 30, then kept the player's own 30.
  assert.deepEqual(current.players.map(p => p.pieces), [30, 30]);
  assert.deepEqual(old.players.map(p => p.pieces), [30, 20]);
});

test.after(() => sequelize.close());
