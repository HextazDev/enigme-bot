const test = require('node:test');
const assert = require('node:assert/strict');
const { Plateau, Joueur, sequelize } = require('../src/db/models');
const { endSeason } = require('../src/game/endgame');
const { handle17hTransition } = require('../src/game/cron');
const { getLockedUser } = require('../src/game/transaction');
const { BONUS_STARS, BONUS_REVEAL_DELAY_MS, bonusWinners } = require('../src/gamemodes/mario_party/endgame');

const noDelay = async () => {};

test('Season End & Empty Board Suite (TDD)', async (t) => {
  await sequelize.sync({ force: true });

  await t.test('endSeason: returns alreadyEnded=true if plateau is already season_ended', async () => {
    let plateau = await Plateau.findByPk(1);
    if (!plateau) {
      await Plateau.create({ id: 1, tour: 10, enigme_status: 'season_ended' });
    } else {
      await plateau.update({ tour: 10, enigme_status: 'season_ended' });
    }

    const mockClient = {
      channels: {
        fetch: async () => assert.fail('Should not fetch channel if already ended')
      }
    };

    const res = await endSeason(mockClient, Math.random, noDelay);
    assert.ok(res, 'endSeason must return an object');
    assert.equal(res.alreadyEnded, true, 'alreadyEnded should be true');
    assert.equal(res.success, true);
  });

  await t.test('endSeason: with 0 players, sends closing announcement to channel and returns playerCount=0', async () => {
    await Joueur.destroy({ where: {} });
    let plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 5, enigme_status: 'finished', game_mode: 'mario_party' });

    let sentMessages = [];
    const mockChannel = {
      send: async (msg) => { sentMessages.push(msg); }
    };
    const mockClient = {
      channels: {
        fetch: async (_id) => mockChannel
      },
      guilds: {
        fetch: async () => null
      }
    };

    const res = await endSeason(mockClient, Math.random, noDelay);
    assert.ok(res, 'endSeason must return an object');
    assert.equal(res.alreadyEnded, false);
    assert.equal(res.playerCount, 0);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.enigme_status, 'season_ended');
    assert.ok(sentMessages.length >= 1, 'Must send an announcement to the board channel even with 0 players');
    assert.ok(sentMessages[0].includes('Aucun joueur') || sentMessages[0].includes('clôturée'), 'Message should indicate season closed without players');
  });

  await t.test('handle17hTransition: does not ping or increment tour if no enigma AND 0 players active', async () => {
    await Joueur.destroy({ where: {} });
    let plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 5, enigme_status: 'finished', enigme_text: null });

    let sentMessages = [];
    const mockClient = {
      channels: {
        fetch: async () => ({ send: async (msg) => sentMessages.push(msg) }),
        cache: {
          get: () => ({ send: async (msg) => sentMessages.push(msg) })
        }
      }
    };

    await handle17hTransition(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.tour, 5, 'Tour must not increment when 0 players and no enigma');
    assert.equal(sentMessages.length, 0, 'No ping should be sent when 0 players and no enigma');
  });

  await t.test('SEC-01 / END-01: ghosts are excluded from bonus stars and final podium', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });

    await Joueur.bulkCreate([
      {
        discord_id: 'ghost_leader',
        est_fantome: true,
        etoiles: 10,
        pieces: 99,
        stat_cases_chance: 50,
        stat_cases_malchance: 50,
        stat_cases_avancees: 1,
      },
      {
        discord_id: 'active_player',
        est_fantome: false,
        etoiles: 2,
        pieces: 15,
        stat_cases_chance: 3,
        stat_cases_malchance: 0,
        stat_cases_avancees: 25,
      },
    ]);

    const sent = [];
    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
      guilds: { fetch: async () => null },
    };

    // random () => 0 picks Chance then Malchance
    await endSeason(mockClient, () => 0, noDelay);

    const ghost = await Joueur.findByPk('ghost_leader');
    const active = await Joueur.findByPk('active_player');
    const updatedBoard = await Plateau.findByPk(1);

    assert.equal(ghost.etoiles, 10, 'Ghost must never receive any bonus star');
    assert.equal(active.etoiles, 3, 'Active player must win Chance bonus star instead of ghost');
    assert.equal(updatedBoard.mode_data.last_winner_id, 'active_player', 'Ghost must not become season winner');
    const podiumMsg = sent.at(-1);
    assert.ok(podiumMsg.includes('<@active_player>'), 'Active player must appear on podium');
    assert.ok(!podiumMsg.includes('<@ghost_leader>'), 'Ghost must be excluded from final podium');
  });

  await t.test('END-01: Paresseux bonus star excludes ghosts and inert players with 0 steps', async () => {
    const paresseux = BONUS_STARS.find(s => s.lowest);
    assert.ok(paresseux, 'Paresseux bonus star definition must exist');

    const players = [
      Joueur.build({ discord_id: 'ghost_low', est_fantome: true, stat_cases_avancees: 1 }),
      Joueur.build({ discord_id: 'inert_zero', est_fantome: false, stat_cases_avancees: 0 }),
      Joueur.build({ discord_id: 'active_slow', est_fantome: false, stat_cases_avancees: 12 }),
      Joueur.build({ discord_id: 'active_fast', est_fantome: false, stat_cases_avancees: 45 }),
    ];

    assert.deepEqual(
      bonusWinners(players, paresseux).map(p => p.discord_id),
      ['active_slow'],
      'Only active player with stat_cases_avancees > 0 and minimal progress wins Paresseux'
    );

    const onlyInert = [
      Joueur.build({ discord_id: 'inert_1', est_fantome: false, stat_cases_avancees: 0 }),
    ];
    assert.deepEqual(bonusWinners(onlyInert, paresseux), [], 'Single inert player at 0 must not win Paresseux');

    const allZero = [
      Joueur.build({ discord_id: 'inert_1', est_fantome: false, stat_cases_avancees: 0 }),
      Joueur.build({ discord_id: 'inert_2', est_fantome: false, stat_cases_avancees: 0 }),
    ];
    assert.deepEqual(bonusWinners(allZero, paresseux), [], 'Tied inert players at 0 must not win Paresseux');
  });

  await t.test('END-01: active tied players with score > 0 all share the bonus star, ghosts excluded', () => {
    const chance = BONUS_STARS.find(s => s.stat === 'stat_cases_chance');
    const paresseux = BONUS_STARS.find(s => s.lowest);

    const players = [
      Joueur.build({ discord_id: 'a', est_fantome: false, stat_cases_chance: 4, stat_cases_avancees: 10 }),
      Joueur.build({ discord_id: 'b', est_fantome: false, stat_cases_chance: 4, stat_cases_avancees: 10 }),
      Joueur.build({ discord_id: 'c', est_fantome: false, stat_cases_chance: 4, stat_cases_avancees: 25 }),
      Joueur.build({ discord_id: 'g', est_fantome: true, stat_cases_chance: 4, stat_cases_avancees: 10 }),
    ];

    assert.deepEqual(
      bonusWinners(players, chance).map(p => p.discord_id),
      ['a', 'b', 'c'],
      'All active tied players share the max bonus star while ghost is excluded'
    );
    assert.deepEqual(
      bonusWinners(players, paresseux).map(p => p.discord_id),
      ['a', 'b'],
      'All active tied players with > 0 steps share Paresseux while ghost is excluded'
    );
  });

  await t.test('END-01: all-ghost season closes cleanly with 0 bonus stars and no podium winner', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });

    await Joueur.bulkCreate([
      { discord_id: 'ghost_1', est_fantome: true, etoiles: 4, stat_cases_chance: 8, stat_cases_avancees: 20 },
      { discord_id: 'ghost_2', est_fantome: true, etoiles: 1, stat_cases_chance: 2, stat_cases_avancees: 5 },
    ]);

    let roleFetched = false;
    const sent = [];
    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
      guilds: { fetch: async () => { roleFetched = true; return null; } },
    };

    await endSeason(mockClient, () => 0, noDelay);

    assert.equal((await Joueur.findByPk('ghost_1')).etoiles, 4);
    assert.equal((await Joueur.findByPk('ghost_2')).etoiles, 1);
    assert.equal(roleFetched, false, 'Winner role must not be awarded when no active player remains');
    assert.equal((await Plateau.findByPk(1)).mode_data.last_winner_id, undefined);
    assert.ok(sent.at(-1).includes('Aucun joueur actif'), 'Final message should note no active player finished');
  });

  await t.test('END-01: bonus stars are revealed sequentially with 2500ms suspense pauses outside the game lock', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });

    await Joueur.bulkCreate([
      { discord_id: 'p1', est_fantome: false, etoiles: 1, pieces: 20, stat_cases_chance: 5, stat_cases_malchance: 0, stat_cases_avancees: 18 },
      { discord_id: 'p2', est_fantome: false, etoiles: 1, pieces: 10, stat_cases_chance: 1, stat_cases_malchance: 3, stat_cases_avancees: 22 },
    ]);

    const events = [];
    const mockClient = {
      channels: {
        fetch: async () => ({
          send: async msg => {
            assert.equal(getLockedUser(), null, 'Announcements must run outside the global game lock');
            events.push({ kind: 'send', text: String(msg) });
          },
        }),
      },
      guilds: { fetch: async () => null },
    };
    const waitSpy = async ms => {
      assert.equal(getLockedUser(), null, 'Suspense pauses must run outside the global game lock');
      events.push({ kind: 'wait', ms });
    };

    assert.equal(BONUS_REVEAL_DELAY_MS, 2500);
    await endSeason(mockClient, () => 0, waitSpy);

    assert.deepEqual(
      events.map(e => e.kind === 'wait' ? `wait:${e.ms}` : 'send'),
      ['send', 'wait:2500', 'send', 'wait:2500', 'send', 'wait:2500', 'send'],
      'Intro -> 2500ms -> Star 1 -> 2500ms -> Star 2 -> 2500ms -> Podium'
    );
    assert.ok(events[0].text.includes('ÉTOILES BONUS'));
    assert.ok(events[2].text.includes('Étoile de la Chance') && events[2].text.includes('<@p1>'));
    assert.ok(events[4].text.includes('Étoile de la Malchance') && events[4].text.includes('<@p2>'));
    assert.ok(events[6].text.includes('podium'));
  });
});

test.after(() => sequelize.close());

