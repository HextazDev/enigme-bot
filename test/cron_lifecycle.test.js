const test = require('node:test');
const assert = require('node:assert/strict');
const { isSeasonActive, handle17hTransition, handle15hReminder, handleSaturday8hReminder, handleSaturday10hBets, handleSunday11hBlackMarket, getChannel } = require('../src/game/cron');
const { Plateau, Joueur, sequelize } = require('../src/db/models');

test('Lifecycle & Crons Suite', async (t) => {
  // Sync in-memory or test DB
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 0, enigme_status: 'finished' });

  await t.test('isSeasonActive: returns false if plateau is null or undefined', () => {
    assert.equal(isSeasonActive(null), false);
    assert.equal(isSeasonActive(undefined), false);
  });

  await t.test('isSeasonActive: returns false if season_ended', () => {
    assert.equal(isSeasonActive({ tour: 10, enigme_status: 'season_ended' }), false);
    assert.equal(isSeasonActive({ tour: 30, enigme_status: 'season_ended' }), false);
  });

  await t.test('isSeasonActive: returns false if tour === 0 (waiting to start)', () => {
    assert.equal(isSeasonActive({ tour: 0, enigme_status: 'finished' }), false);
    assert.equal(isSeasonActive({ tour: 0, enigme_status: 'programmee' }), false);
  });

  await t.test('isSeasonActive: returns false if tour >= 30', () => {
    assert.equal(isSeasonActive({ tour: 30, enigme_status: 'active' }), false);
    assert.equal(isSeasonActive({ tour: 31, enigme_status: 'finished' }), false);
  });

  await t.test('isSeasonActive: returns true during an active season (1 <= tour < 30)', () => {
    assert.equal(isSeasonActive({ tour: 1, enigme_status: 'active' }), true);
    assert.equal(isSeasonActive({ tour: 15, enigme_status: 'finished' }), true);
    assert.equal(isSeasonActive({ tour: 29, enigme_status: 'programmee' }), true);
  });

  await t.test('handle17hTransition: does nothing if plateau is null or season_ended (no tour increment, no messages)', async () => {
    let sentMessages = [];
    const mockClient = {
      channels: {
        cache: {
          get: (id) => ({
            send: async (msg) => { sentMessages.push(msg); }
          })
        }
      },
      users: {
        fetch: async () => ({ username: 'TestUser' })
      }
    };

    // Create a plateau with season_ended at tour 12 (early stop)
    let plateau = await Plateau.findByPk(1);
    if (!plateau) {
      await Plateau.create({ id: 1, tour: 12, enigme_status: 'season_ended' });
    } else {
      await plateau.update({ tour: 12, enigme_status: 'season_ended' });
    }

    await handle17hTransition(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.tour, 12, 'Tour must not be incremented when season is ended');
    assert.equal(refreshed.enigme_status, 'season_ended', 'Status must not be overwritten to finished');
    assert.equal(sentMessages.length, 0, 'No message should be sent to channel when season is ended');
  });

  await t.test('handle17hTransition: does nothing if tour === 0 and no enigme is programmed', async () => {
    let sentMessages = [];
    const mockClient = {
      channels: {
        cache: {
          get: () => ({
            send: async (msg) => { sentMessages.push(msg); }
          })
        }
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 0, enigme_status: 'finished', enigme_text: null });

    await handle17hTransition(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.tour, 0, 'Tour must stay at 0 before first enigme is launched');
    assert.equal(sentMessages.length, 0, 'No spam messages should be sent before season start');
  });

  await t.test('handle17hTransition: starts tour 1 when tour === 0 and enigme is programmee', async () => {
    let sentMessages = [];
    const mockClient = {
      channels: {
        cache: {
          get: (id) => ({
            send: async (msg) => { sentMessages.push({ id, msg }); }
          })
        }
      },
      users: {
        fetch: async () => ({ username: 'TestUser' })
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({
      tour: 0,
      enigme_status: 'programmee',
      enigme_text: 'Quelle est la couleur du cheval blanc ?',
      enigme_reponse: 'blanc'
    });

    await handle17hTransition(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.tour, 1, 'Tour must advance from 0 to 1 on first enigma');
    assert.equal(refreshed.enigme_status, 'active');
    assert.ok(sentMessages.length > 0, 'Should send enigma and lock messages');
  });

  await t.test('handle15hReminder: does not send DMs if season is not active', async () => {
    let dmSent = false;
    const mockClient = {
      users: {
        fetch: async () => ({
          send: async () => { dmSent = true; }
        })
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 0, enigme_status: 'season_ended' });

    await Joueur.create({
      discord_id: '123456789',
      a_le_droit_de_jouer: true,
      auto_remind_turn: true
    });

    await handle15hReminder(mockClient);
    assert.equal(dmSent, false, 'Should not send 15h reminder DMs when season is ended');
  });

  await t.test('handleSaturday10hBets: does not open bets if season is ended or mode is ile_defis', async () => {
    let betsOpened = false;
    const mockClient = {
      channels: {
        cache: {
          get: () => ({
            send: async () => { betsOpened = true; }
          })
        }
      }
    };

    const plateau = await Plateau.findByPk(1);
    // Case 1: season_ended
    await plateau.update({ tour: 5, enigme_status: 'season_ended', game_mode: 'mario_party' });
    await handleSaturday10hBets(mockClient);
    assert.equal(betsOpened, false, 'Should not open bets if season_ended');

    // Case 2: ile_defis (no bets in this mode)
    await plateau.update({ tour: 5, enigme_status: 'finished', game_mode: 'ile_defis' });
    await handleSaturday10hBets(mockClient);
    assert.equal(betsOpened, false, 'Should not open bets in ile_defis');
  });

  await t.test('handleSunday11hBlackMarket: does not open black market if season is ended or mode is ile_defis', async () => {
    let bmOpened = false;
    const mockClient = {
      channels: {
        cache: {
          get: () => ({
            send: async () => { bmOpened = true; }
          })
        }
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 5, enigme_status: 'season_ended', game_mode: 'mario_party' });
    const { handleSunday11hBlackMarket } = require('../src/game/cron');
    await handleSunday11hBlackMarket(mockClient);
    assert.equal(bmOpened, false, 'Should not open black market if season_ended');

    await plateau.update({ tour: 5, enigme_status: 'finished', game_mode: 'ile_defis' });
    await handleSunday11hBlackMarket(mockClient);
    assert.equal(bmOpened, false, 'Should not open black market in ile_defis');
  });

  await t.test('handle17hTransition: in active season without enigma, leaves plateau open and sends no lock message', async () => {
    let messages = [];
    const mockClient = {
      channels: {
        cache: {
          get: () => ({
            send: async (msg) => { messages.push(msg); }
          })
        }
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 5, enigme_status: 'finished', enigme_text: null });
    let p = await Joueur.findByPk('player_active_1');
    if (!p) {
      await Joueur.create({ discord_id: 'player_active_1', a_le_droit_de_jouer: true });
    }

    await handle17hTransition(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.tour, 6, 'Tour increments by 1');
    assert.equal(refreshed.enigme_status, 'finished', 'Plateau remains open');
    assert.equal(messages.length, 1, 'Only one warning message is sent, no locking message');
    assert.ok(messages[0].includes('reste ouvert'), 'Message says board remains open');
    assert.ok(!messages[0].includes('verrouillé jusqu\'à 21h'), 'No lock mention');
  });

  await t.test('endSeason: centralizes season_ended status and locks players', async () => {
    const { endSeason } = require('../src/game/endgame');
    const mockClient = {
      channels: {
        cache: {
          get: () => ({
            send: async () => {}
          })
        }
      },
      guilds: {
        fetch: async () => null
      }
    };

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 29, enigme_status: 'finished' });

    let player = await Joueur.findByPk('123456789');
    if (!player) {
      await Joueur.create({ discord_id: '123456789', a_le_droit_de_jouer: true });
    } else {
      await player.update({ a_le_droit_de_jouer: true });
    }

    await endSeason(mockClient);

    const refreshed = await Plateau.findByPk(1);
    assert.equal(refreshed.enigme_status, 'season_ended');

    const refreshedPlayer = await Joueur.findByPk('123456789');
    assert.equal(refreshedPlayer.a_le_droit_de_jouer, false, 'Players must be locked on season end');
  });

  await t.test('handle17hTransition: resets a_le_droit_de_jouer for non-ghost players and preserves false for ghost players (GAME-01)', async () => {
    await Joueur.destroy({ where: {} });
    await Joueur.create({
      discord_id: 'active_player',
      a_le_droit_de_jouer: false,
      est_fantome: false,
      a_joue_ce_tour: true
    });
    await Joueur.create({
      discord_id: 'ghost_player',
      a_le_droit_de_jouer: false,
      est_fantome: true,
      a_joue_ce_tour: false
    });

    const plateau = await Plateau.findByPk(1);
    await plateau.update({ tour: 5, enigme_status: 'finished', enigme_text: null });

    const mockClient = {
      channels: {
        cache: {
          get: () => ({ send: async () => {} })
        }
      }
    };

    await handle17hTransition(mockClient);

    const refreshedActive = await Joueur.findByPk('active_player');
    const refreshedGhost = await Joueur.findByPk('ghost_player');

    assert.equal(refreshedActive.a_le_droit_de_jouer, true, 'Non-ghost active player must regain right to play');
    assert.equal(refreshedGhost.a_le_droit_de_jouer, false, 'Ghost player must not regain right to play');
  });

  await t.test('getChannel: fetches channel via client.channels.fetch or falls back to cache (DISC-01)', async () => {
    let fetchCalledWith = null;
    const fetchedChannel = { id: 'chan_fetch', send: async () => {} };
    const cachedChannel = { id: 'chan_cache', send: async () => {} };

    // Case 1: channels.fetch succeeds
    const clientWithFetch = {
      channels: {
        fetch: async (id) => {
          fetchCalledWith = id;
          return fetchedChannel;
        },
        cache: {
          get: () => cachedChannel
        }
      }
    };
    const res1 = await getChannel(clientWithFetch, 'chan_123');
    assert.equal(fetchCalledWith, 'chan_123');
    assert.equal(res1, fetchedChannel, 'Should prioritize fetch over cache');

    // Case 2: channels.fetch rejects/fails, fallback to cache
    const clientWithFetchError = {
      channels: {
        fetch: async () => {
          throw new Error('DiscordAPIError: Unknown Channel');
        },
        cache: {
          get: (id) => (id === 'chan_cached' ? cachedChannel : null)
        }
      }
    };
    const res2 = await getChannel(clientWithFetchError, 'chan_cached');
    assert.equal(res2, cachedChannel, 'Should fallback to cache if fetch fails');

    // Case 3: only cache exists (no channels.fetch)
    const clientOnlyCache = {
      channels: {
        cache: {
          get: (id) => (id === 'chan_cached' ? cachedChannel : null)
        }
      }
    };
    const res3 = await getChannel(clientOnlyCache, 'chan_cached');
    assert.equal(res3, cachedChannel, 'Should use cache when fetch is not a function');

    // Case 4: client or channels is null/undefined
    assert.equal(await getChannel(null, 'chan_id'), null);
    assert.equal(await getChannel({}, 'chan_id'), null);
  });
});

