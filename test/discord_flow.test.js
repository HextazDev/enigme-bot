const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, MessageFlags } = require('discord.js');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const { createDispatcher } = require('../src/discord/router');
const { handleInteraction } = require('../src/discord/interaction');
const { clearAllPendingTimers } = require('../src/discord/pending-timers');
const jouer = require('../src/commands/jouer');

const sent = [];
// Users cannot be fetched: the board falls back to initials, without network access.
const client = {
  channels: { fetch: async () => ({ send: async payload => { sent.push(payload); } }) },
  users: { fetch: async () => { throw new Error('offline'); }, cache: new Map() },
};
const commands = new Collection([['jouer', jouer]]);
const dispatch = createDispatcher(commands);

function component(customId, values) {
  const calls = [];
  return {
    calls, customId, values, client, deferred: true, replied: false,
    user: { id: 'p1', username: 'P1' },
    isChatInputCommand: () => false, isModalSubmit: () => false,
    isButton: () => !values, isStringSelectMenu: () => !!values,
    editReply: async payload => { calls.push(['edit', payload]); },
    followUp: async payload => { calls.push(['follow', payload]); },
  };
}
function components(payload) {
  return payload.components?.flatMap(c => { const json = c.toJSON ? c.toJSON() : c; return json.type === 17 ? json.components : [json]; }) ?? [];
}
const content = payload => payload.content ?? components(payload).filter(c => c.type === 10).map(c => c.content).join('\n');
const contents = calls => calls.map(([, payload]) => content(payload));

test('a full star stop through the real router: prompt, public board update, purchase and resumed walk', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T12:00:00Z') }); // a Wednesday
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished', position_etoile: 10 });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: true, position: 8, pieces: 30 });
  const original = Math.random;
  Math.random = () => 0.25; // die = 3
  try {
    const roll = component('lancer_de');
    await dispatch(roll);
    const prompt = roll.calls.at(-1)[1];
    assert.ok(roll.calls.every(([kind]) => kind === 'edit'), 'gameplay must reuse one private message');
    assert.match(content(prompt), /l'Étoile/);
    assert.equal(prompt.flags, MessageFlags.IsComponentsV2);
    assert.equal(components(prompt).find(c => c.type === 1).components[0].custom_id, 'acheter_etoile');
    assert.match(sent.at(-1).content, /s'arrête en chemin sur la case \*\*10 \(Étoile\)\*\*/);
    assert.ok(sent.at(-1).files.length, 'the public message carries the board image');

    const buy = component('acheter_etoile');
    await dispatch(buy);
    assert.match(contents(buy.calls).join('\n'), /Tu as acheté une Étoile/);
    const p1 = await Joueur.findByPk('p1');
    // 30 - 20 for the star, then the Malchance case 11 takes 10 (random 0.25).
    assert.deepEqual([p1.etoiles, p1.pieces, p1.position, p1.action_en_attente], [1, 0, 11, null]);
    await assert.rejects(dispatch(component('acheter_etoile')), error => error.code === 'STALE');
  } finally {
    Math.random = original;
    clearAllPendingTimers();
  }
});

test('/jouer shows a pending choice again, so a restart or a lost message never blocks the player', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished' });
  await Joueur.create({ discord_id: 'p1', position: 52, action_en_attente: { type: 'boo', case: 52, token: 't' } });
  let reply;
  await jouer.execute({ user: { id: 'p1' }, client, editReply: async payload => { reply = payload; } });
  assert.match(content(reply), /Un choix t'attend/);
  const ids = components(reply).filter(c => c.type === 1).flatMap(row => row.components.map(c => c.custom_id));
  assert.ok(ids.includes('boo_pieces') && ids.includes('boo_annuler'));
  assert.ok(!ids.includes('lancer_de'));
});

test('the boundary turns a game rule refusal into a private message without logging an error', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished' });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: false });
  const calls = [];
  const interaction = {
    user: { id: 'p1' }, customId: 'lancer_de', deferred: false, replied: false, client,
    message: { interactionMetadata: { user: { id: 'p1' } } },
    isRepliable: () => true, isMessageComponent: () => true, isChatInputCommand: () => false, isButton: () => true,
    isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    followUp: async payload => { calls.push(payload); },
  };
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try { await handleInteraction(interaction, dispatch); }
  finally { console.error = originalError; }
  assert.equal(calls[0].content, "Tu n'as pas le droit de jouer.");
  assert.equal(calls[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(errors, []);
});

test('an unknown component id or unknown modal submit is refused instead of being silently ignored', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished' });
  await assert.rejects(dispatch(component('replace_chance_champignon', ['0'])), error => error.code === 'UNKNOWN');
  const unknownModal = {
    customId: 'modal_inexistant', client, deferred: true, replied: false, user: { id: 'p1', username: 'P1' },
    isChatInputCommand: () => false, isModalSubmit: () => true, isButton: () => false, isStringSelectMenu: () => false,
  };
  await assert.rejects(dispatch(unknownModal), error => error.code === 'UNKNOWN');
});

test('DISC-09: stateless plateau_zone_<zone> buttons render the requested island zone and reject Mario mode', async () => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished', game_mode: 'ile_defis', game_map: 'board_game_island' });
  await Joueur.create({ discord_id: 'p1', position: 42 });
  const click = component('plateau_zone_volcan');
  await dispatch(click);
  const payload = click.calls.at(-1)[1];
  assert.ok(payload.files.length === 1, 'zone board image attached');
  assert.match(payload.embeds[0].toJSON().description, /Volcan/i);

  await Plateau.update({ game_mode: 'mario_party', game_map: 'night_sky' }, { where: { id: 1 } });
  await assert.rejects(dispatch(component('plateau_zone_volcan')), error => error.code === 'MODE');
});

test('PEND-07: rearmTimers schedules expiry for persisted pending choices and resolves player usernames', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { interactions: marioInteractions } = require('../src/gamemodes/mario_party/discord');
  const { drainGameQueue } = require('../src/game/transaction');
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished', position_etoile: 10 });
  await Joueur.create({
    discord_id: 'p1', position: 14, cases_restantes: 1,
    action_en_attente: { type: 'intersection', case: 14, token: 'rearm-tok' },
  });
  const timerSent = [];
  const fetchedUsers = [];
  const fakeClient = {
    channels: { fetch: async () => ({ send: async payload => { timerSent.push(payload); } }) },
    users: { fetch: async id => { fetchedUsers.push(id); return { username: 'Alice' }; }, cache: new Map() },
  };
  try {
    await marioInteractions.rearmTimers(fakeClient);
    t.mock.timers.tick(5 * 60_000 + 100);
    // Wait for the async timer callback to commit the DB update, then drain queued Discord publications.
    for (let k = 0; k < 200 && (await Joueur.findByPk('p1')).action_en_attente !== null; k++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await drainGameQueue();
    const p1 = await Joueur.findByPk('p1');
    assert.equal(p1.action_en_attente, null);
    assert.equal(p1.position, 15);
    assert.ok(fetchedUsers.includes('p1'), 'rearmTimers resolves username from Discord client');
    assert.ok(timerSent.some(msg => /<@p1>/.test(String(msg.content ?? msg))));
  } finally {
    clearAllPendingTimers();
  }
});

test('/jouer does not register new players after season_ended, and /settings + /stats support ile_defis & uncached names', async () => {
  const settingsCmd = require('../src/commands/settings');
  const statsCmd = require('../src/commands/stats');
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 30, enigme_status: 'season_ended', game_mode: 'mario_party', game_map: 'night_sky' });
  let closedReply;
  await jouer.execute({ user: { id: 'latecomer' }, client, editReply: async payload => { closedReply = payload; } });
  assert.match(content(closedReply), /saison est terminée/i);
  assert.equal(await Joueur.findByPk('latecomer'), null, 'no ghost row created on ended season');

  await Plateau.update({ tour: 4, enigme_status: 'finished', game_mode: 'ile_defis', game_map: 'board_game_island' }, { where: { id: 1 } });
  let settingsReply;
  await settingsCmd.execute({
    user: { id: 'island_new' },
    options: { getBoolean: name => (name === 'rappel_enigme' ? true : false) },
    editReply: async payload => { settingsReply = payload; },
  });
  const created = await Joueur.findByPk('island_new');
  assert.deepEqual([created.auto_remind_guess, created.auto_remind_turn], [true, false]);
  assert.equal(created.mode_data.bonus_de, 'none');
  assert.ok(settingsReply.embeds.length === 1);

  await Joueur.update({ position: 10 }, { where: { discord_id: 'island_new' } });
  await Joueur.create({ discord_id: 'island_leader', position: 65, mode_data: { bonus_de: 'gold', double_lancer: false } });
  let statsReply;
  const statsClient = {
    users: {
      cache: new Map(),
      fetch: async id => ({ username: id === 'island_leader' ? 'Capitaine' : 'Matelot' }),
    },
  };
  await statsCmd.execute({ client: statsClient, editReply: async payload => { statsReply = payload; } });
  const fields = statsReply.embeds[0].toJSON().fields;
  assert.equal(fields[0].name, '#1 - Capitaine');
  assert.match(fields[0].value, /Case 65/);
  assert.doesNotMatch(fields[0].value, /Étoiles/);
  assert.equal(fields[1].name, '#2 - Matelot');
});

test('CRON-16: modal_programmer_enigme announces the real next publication date on weekend and weekdays', async t => {
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 2, enigme_status: 'finished' });
  const makeModal = () => {
    const calls = [];
    const fields = { enigme_text: 'Mon titre\nTexte', reponse: 'soleil', indice_1: 'i1', indice_2: '', indice_3: '' };
    return {
      calls, customId: 'modal_programmer_enigme', client, deferred: true, replied: false,
      user: { id: 'test-mj', username: 'MJ' },
      fields: { getTextInputValue: id => fields[id] ?? '' },
      isChatInputCommand: () => false, isModalSubmit: () => true, isButton: () => false, isStringSelectMenu: () => false,
      editReply: async payload => { calls.push(['edit', payload]); },
      followUp: async payload => { calls.push(['follow', payload]); },
    };
  };

  // Saturday 10/10/2026 12:28 Paris -> lundi 12/10 à 17h
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:28:00Z') });
  const satModal = makeModal();
  await dispatch(satModal);
  assert.match(contents(satModal.calls).join('\n'), /\*\*lundi 12\/10 à 17h\*\*/);

  // Wednesday 07/10/2026 14:00 Paris -> aujourd'hui à 17h
  t.mock.timers.setTime(new Date('2026-10-07T12:00:00Z').getTime());
  const wedModal = makeModal();
  await dispatch(wedModal);
  assert.match(contents(wedModal.calls).join('\n'), /\*\*aujourd'hui à 17h\*\*/);

  // Friday 09/10/2026 18:00 Paris -> lundi 12/10 à 17h
  t.mock.timers.setTime(new Date('2026-10-09T16:00:00Z').getTime());
  const friModal = makeModal();
  await dispatch(friModal);
  assert.match(contents(friModal.calls).join('\n'), /\*\*lundi 12\/10 à 17h\*\*/);
});

test.after(() => sequelize.close());


