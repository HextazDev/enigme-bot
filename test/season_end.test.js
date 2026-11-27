const test = require('node:test');
const assert = require('node:assert/strict');
const { Plateau, Joueur, sequelize } = require('../src/db/models');
const { endSeason, flushEndgameDelays, resetEndgameDelays } = require('../src/game/endgame');
const { handle17hTransition } = require('../src/game/cron');
const { afterGameAction, getLockedUser, withGameLock } = require('../src/game/transaction');
const { BONUS_STARS, BONUS_REVEAL_DELAY_MS, bonusWinners, endgame: marioEndgame } = require('../src/gamemodes/mario_party/endgame');
const config = require('../src/config');

const noDelay = async () => {};

function mockGuildWithRole(awardedTo) {
  const role = { id: 'role_winner', members: new Map() };
  return {
    roles: { fetch: async () => role },
    members: {
      fetch: async id => ({
        id,
        roles: {
          cache: { has: () => false },
          add: async r => { awardedTo.push({ id, roleId: r.id }); },
          remove: async () => {},
        },
      }),
    },
  };
}

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

    const res = await endSeason(mockClient, Math.random, { wait: noDelay });
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

    const res = await endSeason(mockClient, Math.random, { wait: noDelay });
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

  await t.test('SEC-01 / END-01: ghosts are excluded from bonus stars, final podium and winner role', async () => {
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

    const prevGuild = config.guildId;
    const prevRole = config.winnerRoleId;
    config.guildId = 'guild_test';
    config.winnerRoleId = 'role_winner';
    try {
      const sent = [];
      const awardedTo = [];
      const mockClient = {
        channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
        guilds: { fetch: async () => mockGuildWithRole(awardedTo) },
      };

      // random () => 0 picks Chance then Malchance
      await endSeason(mockClient, () => 0, { wait: noDelay });

      const ghost = await Joueur.findByPk('ghost_leader');
      const active = await Joueur.findByPk('active_player');
      const updatedBoard = await Plateau.findByPk(1);

      assert.equal(ghost.etoiles, 10, 'Ghost must never receive any bonus star');
      assert.equal(active.etoiles, 3, 'Active player must win Chance bonus star instead of ghost');
      assert.equal(updatedBoard.mode_data.last_winner_id, 'active_player', 'Ghost must not become season winner');
      assert.deepEqual(awardedTo, [{ id: 'active_player', roleId: 'role_winner' }], 'Winner role must go to active winner, never ghost');
      const podiumMsg = sent.at(-1);
      assert.ok(podiumMsg.includes('<@active_player>'), 'Active player must appear on podium');
      assert.ok(!podiumMsg.includes('<@ghost_leader>'), 'Ghost must be excluded from final podium');
    } finally {
      config.guildId = prevGuild;
      config.winnerRoleId = prevRole;
    }
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

  await t.test('END-01: active tied players with score > 0 share the bonus star and mentions render properly for 2 and 3+ winners', async () => {
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

    const sent = [];
    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
      guilds: { fetch: async () => null },
    };
    await marioEndgame.announce(mockClient, {
      bonus: [
        { name: 'Star A', desc: 'desc A', winners: ['a', 'b'] },
        { name: 'Star B', desc: 'desc B', winners: ['a', 'b', 'c'] },
      ],
      podium: [{ discord_id: 'a', etoiles: 2, pieces: 10 }],
    }, 3, { wait: noDelay });
    assert.ok(sent[1].includes('<@a> et <@b>'), 'Two tied winners must be formatted as "<@a> et <@b>"');
    assert.ok(sent[2].includes('<@a>, <@b> et <@c>'), 'Three+ tied winners must be formatted with comma and "et"');

    // Singular intro wording when a variant awards 1 bonus star
    const singularSent = [];
    const singularClient = {
      channels: { fetch: async () => ({ send: async msg => singularSent.push(String(msg)) }) },
      guilds: { fetch: async () => null },
    };
    await marioEndgame.announce(singularClient, {
      bonus: [{ name: 'Star A', desc: 'desc A', winners: ['a'] }],
      podium: [{ discord_id: 'a', etoiles: 1, pieces: 10 }],
    }, 1, { wait: noDelay });
    assert.ok(singularSent[0].includes('1 étoile aléatoire va être distribuée'), 'Single bonus star must use singular French wording');
  });

  await t.test('END-01: all-ghost season closes cleanly in a single message with 0 bonus stars, 0 pauses and no winner role', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });

    await Joueur.bulkCreate([
      { discord_id: 'ghost_1', est_fantome: true, etoiles: 4, stat_cases_chance: 8, stat_cases_avancees: 20 },
      { discord_id: 'ghost_2', est_fantome: true, etoiles: 1, stat_cases_chance: 2, stat_cases_avancees: 5 },
    ]);

    let roleFetched = false;
    let waitCalls = 0;
    const sent = [];
    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
      guilds: { fetch: async () => { roleFetched = true; return null; } },
    };

    await endSeason(mockClient, () => 0, { wait: async () => { waitCalls += 1; } });

    assert.equal((await Joueur.findByPk('ghost_1')).etoiles, 4);
    assert.equal((await Joueur.findByPk('ghost_2')).etoiles, 1);
    assert.equal(roleFetched, false, 'Winner role must not be awarded when no active player remains');
    assert.equal((await Plateau.findByPk(1)).mode_data.last_winner_id, undefined);
    assert.equal(waitCalls, 0, 'All-ghost season must not waste suspense pauses on empty bonus ceremony');
    assert.equal(sent.length, 1, 'All-ghost season must send a single closing message');
    assert.ok(sent[0].includes('Aucun joueur actif'), 'Final message should note no active player finished');
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
    await endSeason(mockClient, () => 0, { wait: waitSpy });

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

  await t.test('END-01: a Discord error on intro or bonus star does not prevent winner role or final podium', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });
    await Joueur.create({ discord_id: 'champ', est_fantome: false, etoiles: 3, pieces: 10, stat_cases_chance: 4, stat_cases_malchance: 2 });

    const prevGuild = config.guildId;
    const prevRole = config.winnerRoleId;
    config.guildId = 'guild_test';
    config.winnerRoleId = 'role_winner';
    try {
      let attempt = 0;
      const delivered = [];
      const awardedTo = [];
      const mockClient = {
        channels: {
          fetch: async () => ({
            send: async msg => {
              attempt += 1;
              if (attempt <= 2) throw new Error(`transient discord 502 #${attempt}`);
              delivered.push(String(msg));
            },
          }),
        },
        guilds: { fetch: async () => mockGuildWithRole(awardedTo) },
      };

      await endSeason(mockClient, () => 0, { wait: noDelay });

      assert.equal(delivered.length, 2, 'Star 2 and final podium must still be sent after intro & Star 1 fail');
      assert.ok(delivered[0].includes('Étoile de la Malchance'));
      assert.ok(delivered[1].includes('podium') && delivered[1].includes('<@champ>'));
      assert.deepEqual(awardedTo, [{ id: 'champ', roleId: 'role_winner' }], 'Winner role must still be granted');
    } finally {
      config.guildId = prevGuild;
      config.winnerRoleId = prevRole;
    }
  });

  await t.test('END-01: under a parent lock (/admin stop), suspense reveal does not block editReply or concurrent ordered publications, and flushes on shutdown', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} });
    await Joueur.create({ discord_id: 'winner', est_fantome: false, etoiles: 2, stat_cases_chance: 3 });

    const order = [];
    let releaseReveal;
    const firstPauseReached = new Promise(resolve => {
      releaseReveal = resolve;
    });
    let resumePause;
    const gatedWait = async () => {
      releaseReveal();
      await new Promise(resolve => { resumePause = resolve; });
    };

    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => order.push(`announce:${String(msg).slice(0, 12)}`) }) },
      guilds: { fetch: async () => null },
    };

    const adminOp = withGameLock('mj', async () => {
      await endSeason(mockClient, () => 0, { wait: gatedWait });
      await afterGameAction(async () => { order.push('admin:editReply'); });
    });

    await firstPauseReached;
    // The global lock must already be released AND /admin stop editReply + concurrent ordered actions must complete while reveal is paused.
    assert.equal(getLockedUser(), null, 'Global game lock must be released before reveal pauses');
    await withGameLock('other_player', async () => {
      await afterGameAction(async () => { order.push('other:editReply'); });
    });
    assert.ok(order.includes('admin:editReply'), '/admin stop reply must not be stalled by the suspense reveal');
    assert.ok(order.includes('other:editReply'), 'Concurrent ordered replies must not be blocked behind the reveal');

    // Release remaining pauses so adminOp settles cleanly.
    while (resumePause) {
      const next = resumePause;
      resumePause = null;
      next();
      await new Promise(resolve => setImmediate(resolve));
    }
    await adminOp;

    // Also verify real managedWait is flushed immediately by flushEndgameDelays() (shutdown path).
    await Plateau.update({ tour: 30, enigme_status: 'finished', game_mode: 'mario_party', mode_data: {} }, { where: { id: 1 } });
    const shutdownSent = [];
    const shutdownClient = {
      channels: {
        fetch: async () => ({
          send: async msg => {
            shutdownSent.push(String(msg));
            if (shutdownSent.length === 1) setImmediate(() => flushEndgameDelays());
          },
        }),
      },
      guilds: { fetch: async () => null },
    };
    const started = Date.now();
    try {
      await endSeason(shutdownClient, () => 0);
    } finally {
      resetEndgameDelays();
    }
    assert.equal(shutdownSent.length, 4, 'Flushing delays on shutdown must complete all reveal messages including podium');
    assert.ok(Date.now() - started < 1000, 'Flushed shutdown reveal must finish well under drainGameQueue timeout');
  });

  await t.test('SEC-01: ile_defis endgame also excludes ghost players from final leaders', async () => {
    await Joueur.destroy({ where: {} });
    const plateau = await Plateau.findByPk(1);
    await plateau.update({
      tour: 30,
      enigme_status: 'finished',
      game_mode: 'ile_defis',
      game_map: 'board_game_island',
      mode_data: { portails_ouverts: [], cascade_desactivee: false, gagnants_dragon: [] },
    });
    await Joueur.bulkCreate([
      { discord_id: 'ghost_front', est_fantome: true, position: 70 },
      { discord_id: 'active_runner', est_fantome: false, position: 42 },
    ]);

    const sent = [];
    const mockClient = {
      channels: { fetch: async () => ({ send: async msg => sent.push(String(msg)) }) },
    };

    await endSeason(mockClient);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes('<@active_runner>'));
    assert.ok(!sent[0].includes('<@ghost_front>'), 'Ghost must be excluded from ile_defis race ranking');
  });
});

test.after(() => sequelize.close());

