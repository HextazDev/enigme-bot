const test = require('node:test');
const assert = require('node:assert/strict');
const { Plateau, Joueur, sequelize } = require('../src/db/models');
const { triggerEnigmaEnd } = require('../src/game/enigma');
const { startTurn } = require('../src/gamemodes/mario_party/turn');
const config = require('../src/config');

test('Ghost Security (SEC-01) & Plateau Defaults (DATA-01) Suite', async (t) => {
  await sequelize.sync({ force: true });

  await t.test('DATA-01: Plateau default values are tour=0 and enigme_status="season_ended"', () => {
    const p = Plateau.build();
    assert.equal(p.tour, 0, 'Plateau tour should default to 0');
    assert.equal(p.enigme_status, 'season_ended', 'Plateau enigme_status should default to season_ended');
  });

  await t.test('SEC-01: triggerEnigmaEnd unlocks ONLY non-ghost players', async () => {
    await Joueur.destroy({ where: {} });
    await Plateau.destroy({ where: {} });

    await Plateau.create({
      id: 1,
      tour: 1,
      enigme_status: 'active',
      enigme_reponse: 'TestReponse',
      enigme_gagnants: []
    });

    // Create normal player and ghost player, both initially cannot play
    const normalPlayer = await Joueur.create({
      discord_id: '111111111',
      pseudo: 'NormalPlayer',
      est_fantome: false,
      a_le_droit_de_jouer: false
    });

    const ghostPlayer = await Joueur.create({
      discord_id: '222222222',
      pseudo: 'GhostPlayer',
      est_fantome: true,
      a_le_droit_de_jouer: false
    });

    const sentMessages = [];
    const mockChannel = {
      send: async (msg) => { sentMessages.push(msg); }
    };
    const mockClient = {
      channels: {
        fetch: async (_id) => mockChannel
      }
    };

    const previousChannelId = config.enigmaChannelId;
    config.enigmaChannelId = 'fake_enigma_channel';
    try {
      await triggerEnigmaEnd(mockClient);
    } finally {
      config.enigmaChannelId = previousChannelId;
    }

    const refreshedNormal = await Joueur.findByPk(normalPlayer.discord_id);
    const refreshedGhost = await Joueur.findByPk(ghostPlayer.discord_id);

    assert.equal(refreshedNormal.a_le_droit_de_jouer, true, 'Normal player must be unlocked');
    assert.equal(refreshedGhost.a_le_droit_de_jouer, false, 'Ghost player must remain locked (est_fantome: true)');
  });

  await t.test('SEC-01: rolling blocks ghost players even if a_le_droit_de_jouer is true', async () => {
    await Joueur.destroy({ where: {} });
    await Plateau.destroy({ where: {} });

    await Plateau.create({
      id: 1,
      tour: 2,
      enigme_status: 'finished',
      game_mode: 'mario_party'
    });

    const ghostPlayer = await Joueur.create({
      discord_id: '333333333',
      pseudo: 'SneakyGhost',
      est_fantome: true,
      a_le_droit_de_jouer: true, // Suppose it got set or was not reset
      stat_cases_avancees: 0,
      a_joue_ce_tour: false
    });

    await assert.rejects(startTurn({ id: ghostPlayer.discord_id, username: 'ghost' }), error =>
      error.code === 'GHOST' && error.message.toLowerCase().includes('fantôme'));

    const refreshedGhost = await Joueur.findByPk(ghostPlayer.discord_id);
    assert.equal(refreshedGhost.a_joue_ce_tour, false, 'Ghost player must not have played');
    assert.equal(refreshedGhost.stat_cases_avancees, 0, 'Ghost player must not have advanced');
  });
});

test.after(() => sequelize.close());
