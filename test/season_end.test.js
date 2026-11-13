const test = require('node:test');
const assert = require('node:assert/strict');
const { Plateau, Joueur, sequelize } = require('../src/db/models');
const { endSeason } = require('../src/game/endgame');
const { handle17hTransition } = require('../src/game/cron');

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

    const res = await endSeason(mockClient);
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
        fetch: async (id) => mockChannel
      },
      guilds: {
        fetch: async () => null
      }
    };

    const res = await endSeason(mockClient);
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
});
