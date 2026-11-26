const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { Joueur, Plateau, sequelize } = require('../src/db/models');
const clock = require('../src/utils/clock');
const { parisClock, parisDayAt } = require('../src/utils/time');
const { handleInteraction } = require('../src/discord/interaction');
const { commandEnabled } = require('../src/discord/router');
const turn = require('../src/gamemodes/mario_party/turn');
const dev = require('../src/commands/dev');

const WEDNESDAY_NOON = new Date('2026-10-07T10:00:00Z'); // 12h in Paris
const code = expected => error => error.code === expected;

function withDevMode(t, enabled = true) {
  const previous = config.devMode;
  config.devMode = enabled;
  t.after(() => { config.devMode = previous; clock.resetDevClock(); });
}

function slash(subcommand, options = {}, userId = 'test-mj') {
  const calls = [];
  const sent = [];
  return {
    calls, sent, commandName: 'dev', user: { id: userId }, deferred: false, replied: false,
    client: {
      channels: { fetch: async () => ({ send: async payload => { sent.push(payload); } }) },
      users: { fetch: async () => { throw new Error('offline'); }, cache: new Map() },
    },
    options: {
      getSubcommand: () => subcommand,
      getString: name => options[name] ?? null,
      getInteger: name => options[name] ?? null,
    },
    isRepliable: () => true, isMessageComponent: () => false, isChatInputCommand: () => true, isButton: () => false,
    deferReply: async function () { calls.push('ack'); this.deferred = true; },
    reply: async function (payload) { calls.push(['reply', payload]); this.replied = true; },
    editReply: async function (payload) { calls.push(['edit', payload]); this.replied = true; },
    followUp: async payload => { calls.push(['follow', payload]); },
  };
}

test('DEV-02: parisDayAt targets the next occurrence of a weekday at a Paris hour', () => {
  assert.equal(parisDayAt(6, 10, 0, WEDNESDAY_NOON).toISOString(), '2026-10-10T08:00:00.000Z');
  assert.equal(parisDayAt(3, 17, 30, WEDNESDAY_NOON).toISOString(), '2026-10-07T15:30:00.000Z', 'same weekday stays today');
  assert.equal(parisDayAt(1, 9, 0, WEDNESDAY_NOON).toISOString(), '2026-10-12T07:00:00.000Z');
});

test('DEV-01: the virtual clock cannot be moved outside dev mode', t => {
  withDevMode(t, false);
  assert.throws(() => clock.setDevClock(new Date('2026-10-10T08:00:00Z')), /DEV_MODE/);
  assert.equal(clock.devClockOffset(), 0);
});

test('DEV-02: the virtual clock shifts game time, Paris weekday and submitted messages', t => {
  withDevMode(t);
  t.mock.timers.enable({ apis: ['Date'], now: WEDNESDAY_NOON });
  clock.setDevClock(new Date('2026-10-10T08:00:00Z'));
  assert.equal(clock.gameNow().toISOString(), '2026-10-10T08:00:00.000Z');
  assert.equal(parisClock().weekday, 6);
  assert.equal(clock.toGameTime(new Date('2026-10-07T10:30:00Z')).toISOString(), '2026-10-10T08:30:00.000Z');
  clock.resetDevClock();
  assert.equal(parisClock().weekday, 3);
});

test('DEV-02: a simulated Saturday forbids the dice like a real one', async t => {
  withDevMode(t);
  t.mock.timers.enable({ apis: ['Date'], now: WEDNESDAY_NOON });
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 3, enigme_status: 'finished' });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: true });
  clock.setDevClock(parisDayAt(6, 12, 0, new Date()));
  await assert.rejects(turn.startTurn({ id: 'p1', username: 'P1' }), code('SATURDAY'));
});

test('DEV-01: /dev is not loaded nor executable outside dev mode', async t => {
  withDevMode(t, false);
  assert.equal(commandEnabled(dev), false);
  assert.equal(commandEnabled(require('../src/commands/jouer')), true);
  await assert.rejects(dev.execute(slash('etat')), code('DEV_ONLY'));
});

test('DEV-01: /dev is reserved to the MJ at the boundary', async t => {
  withDevMode(t);
  const i = slash('etat', {}, 'not-the-mj');
  await handleInteraction(i, async () => assert.fail('unauthorized dispatch'));
  assert.equal(i.calls.length, 1);
  assert.equal(i.calls[0][0], 'reply');
});

test('DEV-03: /dev etape publication_17h runs the 17h transition and publishes the programmed enigma', async t => {
  withDevMode(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:00:00Z') }); // a real Saturday
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 2, enigme_status: 'programmee', enigme_text: 'Qui suis-je ?', enigme_reponse: 'Piano' });
  await Joueur.create({ discord_id: 'p1', a_le_droit_de_jouer: true });
  const i = slash('etape', { etape: 'publication_17h' });
  await dev.execute(i);
  const plateau = await Plateau.findByPk(1);
  assert.equal(plateau.enigme_status, 'active');
  assert.equal(plateau.tour, 3);
  assert.ok(i.sent.some(payload => /ÉNIGME DU JOUR/.test(String(payload.content ?? payload))));
  assert.match(JSON.stringify(i.calls.at(-1)), /publication_17h/);
});

test('DEV-03: an unknown step is refused without touching the board', async t => {
  withDevMode(t);
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1, tour: 2, enigme_status: 'programmee', enigme_text: 'x', enigme_reponse: 'y' });
  await assert.rejects(dev.execute(slash('etape', { etape: 'nope' })), code('STEP'));
  assert.equal((await Plateau.findByPk(1)).enigme_status, 'programmee');
});

test('DEV-02: /dev horloge sets the virtual clock and /dev horloge_reset restores it', async t => {
  withDevMode(t);
  t.mock.timers.enable({ apis: ['Date'], now: WEDNESDAY_NOON });
  await sequelize.sync({ force: true });
  await Plateau.create({ id: 1 });
  await dev.execute(slash('horloge', { jour: 6, heure: 10, minute: 15 }));
  assert.equal(clock.gameNow().toISOString(), '2026-10-10T08:15:00.000Z');
  await dev.execute(slash('horloge_reset'));
  assert.equal(clock.devClockOffset(), 0);
});

test('DST: parisTodayAt and parisDayAt stay exact across Europe/Paris spring-forward and fall-back', () => {
  const { parisTodayAt } = require('../src/utils/time');
  // 2026-03-29: Europe/Paris springs forward (UTC+1 -> UTC+2 at 02:00 local)
  const springEve = new Date('2026-03-28T11:00:00Z'); // Saturday 12:00 CET
  assert.equal(parisDayAt(0, 11, 0, springEve).toISOString(), '2026-03-29T09:00:00.000Z', 'Sunday 11:00 CEST is 09:00Z');
  assert.equal(new Date(parisTodayAt(21, new Date('2026-03-29T00:30:00Z'))).toISOString(), '2026-03-29T19:00:00.000Z', '21:00 CEST on spring-forward day');
  // 2026-10-25: Europe/Paris falls back (UTC+2 -> UTC+1 at 03:00 local)
  const fallEve = new Date('2026-10-24T10:00:00Z'); // Saturday 12:00 CEST
  assert.equal(parisDayAt(0, 11, 0, fallEve).toISOString(), '2026-10-25T10:00:00.000Z', 'Sunday 11:00 CET is 10:00Z');
  assert.equal(new Date(parisTodayAt(21, new Date('2026-10-25T00:30:00Z'))).toISOString(), '2026-10-25T20:00:00.000Z', '21:00 CET on fall-back day');
});

test.after(() => sequelize.close());

