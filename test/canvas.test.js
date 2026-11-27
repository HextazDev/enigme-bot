const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('canvas');
const { generateBoardImage, generateZoomedBoardImage, zoomedCaseWindow, BOARD_IMAGE_EXTENSION } = require('../src/utils/canvas');
const { loadRemoteImage } = require('../src/utils/remote-image');
const nightSky = require('../src/gamemodes/mario_party/maps/night_sky/board');

const players = Array.from({ length: 12 }, (_, i) => ({ discord_id: `p${i}`, position: 1 + (i * 4) % 45, etoiles: i % 4, pieces: i * 3, inventaire: [] }));
const mario = { game_mode: 'mario_party', game_map: 'night_sky', game_variant: 'standard', tour: 12, position_etoile: 20, pieges_actifs: [{ position: 7 }] };
const isJpeg = buffer => buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

test('the Mario board renders a full-size JPEG small enough for fast uploads', async () => {
  const buffer = await generateBoardImage(players, mario, null);
  assert.equal(BOARD_IMAGE_EXTENSION, 'jpg');
  assert.ok(isJpeg(buffer));
  const image = await loadImage(buffer);
  assert.deepEqual([image.width, image.height], [1920, 1080]);
  assert.ok(buffer.length < 1024 * 1024, `${buffer.length} bytes`);
});

test('island zones and the zoomed view render without Discord access', async () => {
  const island = { game_mode: 'ile_defis', game_map: 'board_game_island', game_variant: 'standard', tour: 3, position_etoile: 0 };
  const islanders = [{ discord_id: 'a', position: 40, etoiles: 0, pieces: 0, inventaire: [] }, { discord_id: 'b', position: 2, etoiles: 0, pieces: 0, inventaire: [] }];
  assert.ok(isJpeg(await generateBoardImage(islanders, island, null, 'volcan')));
  assert.ok(isJpeg(await generateZoomedBoardImage(players[0], players, mario, null)));
});

test('CANV-01: zoomedCaseWindow follows the board graph across wrap-around (40 -> 1) instead of arithmetic IDs', () => {
  const { cases, aheadIds } = zoomedCaseWindow(nightSky.BOARD_CASES, 40);
  assert.deepEqual(cases.map(c => c.id), [38, 39, 40, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...aheadIds], [1, 2, 3, 4, 5, 6]);
});

test('CANV-01: island board prefetches off-zone leaderboard players in addition to visible zone players', async () => {
  const island = { game_mode: 'ile_defis', game_map: 'board_game_island', game_variant: 'standard', tour: 3, position_etoile: 0 };
  const islanders = [
    { discord_id: 'leader_volcan', position: 60, etoiles: 0, pieces: 0, inventaire: [] },
    { discord_id: 'plage_player', position: 3, etoiles: 0, pieces: 0, inventaire: [] },
  ];
  const fetched = [];
  const fakeClient = {
    users: {
      cache: new Map(),
      fetch: async id => {
        fetched.push(id);
        return { id, username: `User_${id}`, displayName: `User_${id}`, avatar: null, displayAvatarURL: () => '' };
      },
    },
  };
  await generateBoardImage(islanders, island, fakeClient, 'plage');
  assert.ok(fetched.includes('plage_player'), 'visible zone player fetched');
  assert.ok(fetched.includes('leader_volcan'), 'off-zone leader fetched for sidebar');
});

test('CANV-02: loadRemoteImage enforces HTTPS Discord CDN allowlist, image Content-Type, and max byte size', async () => {
  const tinyCanvas = createCanvas(4, 4);
  const pngBuffer = tinyCanvas.toBuffer('image/png');
  const makeResponse = (body, headers = {}, ok = true, status = 200) => ({
    ok, status,
    headers: new Headers(headers),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });

  await assert.rejects(loadRemoteImage('http://cdn.discordapp.com/avatars/1/a.png', { fetchFn: async () => assert.fail('must not fetch') }), /non autorisé/);
  await assert.rejects(loadRemoteImage('https://evil.example.com/a.png', { fetchFn: async () => assert.fail('must not fetch') }), /non autorisé/);
  await assert.rejects(
    loadRemoteImage('https://cdn.discordapp.com/avatars/1/a.png', {
      fetchFn: async () => makeResponse(pngBuffer, { 'content-type': 'text/html' }),
    }),
    /Type de contenu image invalide/
  );
  await assert.rejects(
    loadRemoteImage('https://cdn.discordapp.com/avatars/1/a.png', {
      maxBytes: 16,
      fetchFn: async () => makeResponse(pngBuffer, { 'content-type': 'image/png', 'content-length': '999' }),
    }),
    /trop volumineuse/
  );
  await assert.rejects(
    loadRemoteImage('https://cdn.discordapp.com/avatars/1/a.png', {
      maxBytes: 16,
      fetchFn: async () => makeResponse(pngBuffer, { 'content-type': 'image/png' }),
    }),
    /trop volumineuse/
  );

  const img = await loadRemoteImage('https://cdn.discordapp.com/avatars/1/a.png', {
    fetchFn: async () => makeResponse(pngBuffer, { 'content-type': 'image/png' }),
  });
  assert.deepEqual([img.width, img.height], [4, 4]);
});

