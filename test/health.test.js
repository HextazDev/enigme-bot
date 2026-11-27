const test = require('node:test');
const assert = require('node:assert/strict');
const { checkHealth, sendHeartbeatPing, startKumaHeartbeat, stopKumaHeartbeat } = require('../src/utils/health');

test('Health & Uptime Kuma Suite', async (t) => {
  await t.test('checkHealth: returns ok=true when Discord is ready and SQLite responds', async () => {
    const mockClient = {
      isReady: () => true,
      ws: { status: 0, ping: 35 }
    };
    const mockSequelize = {
      authenticate: async () => Promise.resolve()
    };

    const res = await checkHealth(mockClient, mockSequelize);
    assert.equal(res.ok, true);
    assert.equal(res.discord.up, true);
    assert.equal(res.discord.ping, 35);
    assert.equal(res.database.up, true);
  });

  await t.test('checkHealth: returns ok=false when Discord client is not ready', async () => {
    const mockClient = {
      isReady: () => false,
      ws: { status: 1, ping: -1 }
    };
    const mockSequelize = {
      authenticate: async () => Promise.resolve()
    };

    const res = await checkHealth(mockClient, mockSequelize);
    assert.equal(res.ok, false);
    assert.equal(res.discord.up, false);
    assert.equal(res.database.up, true);
  });

  await t.test('checkHealth: returns ok=false when SQLite authenticate fails', async () => {
    const mockClient = {
      isReady: () => true,
      ws: { status: 0, ping: 25 }
    };
    const mockSequelize = {
      authenticate: async () => Promise.reject(new Error('SQLITE_BUSY: database is locked'))
    };

    const res = await checkHealth(mockClient, mockSequelize);
    assert.equal(res.ok, false);
    assert.equal(res.discord.up, true);
    assert.equal(res.database.up, false);
    assert.match(res.database.error, /SQLITE_BUSY/);
  });

  await t.test('sendHeartbeatPing: calls push URL with status=up and ping when healthy', async () => {
    let calledUrl = null;
    const mockFetch = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200 };
    };

    const health = {
      ok: true,
      discord: { up: true, ping: 42 },
      database: { up: true }
    };

    const pushBaseUrl = 'https://status.example.test/api/push/testtoken';
    const sent = await sendHeartbeatPing(pushBaseUrl, health, { fetchFn: mockFetch });

    assert.equal(sent, true);
    assert.ok(calledUrl.startsWith(pushBaseUrl));
    assert.ok(calledUrl.includes('status=up'));
    assert.ok(calledUrl.includes('ping=42'));

    const rejected = await sendHeartbeatPing(pushBaseUrl, health, { fetchFn: async () => ({ ok: false, status: 404 }) });
    assert.equal(rejected, false);
  });

  await t.test('auto-healing: triggers onExit callback when consecutive failures reach maxFailures', async (sub) => {
    sub.mock.timers.enable({ apis: ['setInterval'] });
    const mockClient = {
      isReady: () => false, // Always failing
      ws: { status: 5, ping: -1 }
    };
    const mockSequelize = {
      authenticate: async () => Promise.resolve()
    };

    let exitCalled = false;
    let exitCode = null;
    const mockOnExit = (code) => {
      exitCalled = true;
      exitCode = code;
    };

    const timer = startKumaHeartbeat(mockClient, {
      sequelizeInstance: mockSequelize,
      pushUrl: 'https://status.example.test/api/push/testtoken',
      intervalMs: 1000,
      maxFailures: 2,
      onExit: mockOnExit,
      fetchFn: async () => ({ ok: true })
    });

    sub.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(exitCalled, false);
    sub.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    stopKumaHeartbeat(timer);

    assert.equal(exitCalled, true);
    assert.equal(exitCode, 1);
  });
});
