const test = require('node:test');
const assert = require('node:assert/strict');
const { handleInteraction, isPublicReply, opensModal } = require('../src/discord/interaction');
const { PresentationError, getLockedUser } = require('../src/game/transaction');
const config = require('../src/config');

function command(overrides = {}) {
  const calls = [];
  return {
    calls, user: { id: 'one' }, commandName: 'deviner', deferred: false, replied: false,
    options: { getSubcommand: () => null },
    isRepliable: () => true, isMessageComponent: () => false, isChatInputCommand: () => true, isButton: () => false,
    deferReply: async function (opts) { calls.push(opts?.flags ? 'ack-ephemeral' : 'ack-public'); this.deferred = true; },
    deferUpdate: async function () { calls.push('ack-update'); this.deferred = true; },
    reply: async function () { calls.push('reply'); this.replied = true; },
    editReply: async function () { calls.push('edit'); this.replied = true; },
    followUp: async () => { calls.push('follow'); },
    ...overrides,
  };
}

test('acknowledgment precedes dispatch and handlers receive the original interaction', async () => {
  const i = command();
  await handleInteraction(i, async adapted => {
    assert.deepEqual(i.calls, ['ack-ephemeral']);
    assert.equal(getLockedUser(), 'one');
    assert.equal(adapted, i);
    await adapted.editReply({ content: 'ok' });
  });
  assert.deepEqual(i.calls, ['ack-ephemeral', 'edit']);
  assert.equal(getLockedUser(), null);
});

test('expired (10062) or already-acknowledged (40060) interactions never run the business handler', async () => {
  for (const code of [10062, 40060]) {
    const i = command();
    i.deferReply = async () => { throw Object.assign(new Error('discord'), { code }); };
    await handleInteraction(i, async () => assert.fail('must not mutate'));
    assert.equal(getLockedUser(), null);
  }
});

test('PresentationError wrapping a 10062 (directly or in AggregateError) is treated as a timeout without followUp', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const direct = command();
    await handleInteraction(direct, async () => {
      throw new PresentationError(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    });
    assert.deepEqual(direct.calls, ['ack-ephemeral']);

    const grouped = command();
    await handleInteraction(grouped, async () => {
      throw new PresentationError(new AggregateError([Object.assign(new Error('Unknown'), { code: 10062 })], 'all'));
    });
    assert.deepEqual(grouped.calls, ['ack-ephemeral']);
    assert.deepEqual(errors, []);
  } finally {
    console.error = originalError;
  }
});

test('a player cannot use another player’s component or a component with missing owner metadata (fail-closed)', async () => {
  const other = command({ isMessageComponent: () => true, isChatInputCommand: () => false, customId: 'buy_champignon#0',
    message: { interactionMetadata: { user: { id: 'someone-else' } } } });
  await handleInteraction(other, async () => assert.fail('unauthorized dispatch'));
  assert.deepEqual(other.calls, ['reply']);

  const missingMeta = command({ isMessageComponent: () => true, isChatInputCommand: () => false, customId: 'lancer_de', message: {} });
  await handleInteraction(missingMeta, async () => assert.fail('fail-closed must reject unknown owner'));
  assert.deepEqual(missingMeta.calls, ['reply']);
});

test('public components (pari_*, plateau_zone_*) allow any user and acknowledge appropriately', async () => {
  const zone = command({ isMessageComponent: () => true, isChatInputCommand: () => false, isButton: () => true,
    customId: 'plateau_zone_volcan', message: {} });
  let ran = false;
  await handleInteraction(zone, async () => { ran = true; });
  assert.equal(ran, true);
  assert.deepEqual(zone.calls, ['ack-update']);

  const pari = command({ isMessageComponent: () => true, isChatInputCommand: () => false, isButton: () => true,
    customId: 'pari_0', message: {} });
  assert.equal(opensModal(pari), true);
  let pariRan = false;
  await handleInteraction(pari, async () => { pariRan = true; });
  assert.equal(pariRan, true);
  assert.deepEqual(pari.calls, [], 'modal buttons must not defer before showModal');
});

test('MJ controls (/admin, admin_*, reponse_*, modal_programmer_enigme) are rejected for non-MJ users', async () => {
  const cases = [
    command({ commandName: 'admin', options: { getSubcommand: () => 'start' } }),
    command({ isMessageComponent: () => true, isChatInputCommand: () => false, customId: 'admin_start_confirm', message: {} }),
    command({ isMessageComponent: () => true, isChatInputCommand: () => false, customId: 'reponse_good_one_answer', message: {} }),
    command({ isChatInputCommand: () => false, customId: 'modal_programmer_enigme' }),
  ];
  for (const i of cases) {
    await handleInteraction(i, async () => assert.fail('unauthorized dispatch'));
    assert.deepEqual(i.calls, ['reply']);
  }

  const mjAdmin = command({ user: { id: config.mjUserId }, commandName: 'admin', options: { getSubcommand: () => 'start' } });
  assert.equal(isPublicReply(mjAdmin), true);
  let ran = false;
  await handleInteraction(mjAdmin, async () => { ran = true; });
  assert.equal(ran, true);
  assert.deepEqual(mjAdmin.calls, ['ack-public']);

  const mjModal = command({ user: { id: config.mjUserId }, commandName: 'admin', options: { getSubcommand: () => 'programmer_enigme' } });
  assert.equal(opensModal(mjModal), true);
  let modalRan = false;
  await handleInteraction(mjModal, async () => { modalRan = true; });
  assert.equal(modalRan, true);
  assert.deepEqual(mjModal.calls, []);
});

