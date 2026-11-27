const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const files = fs.readdirSync('dist/test').filter(f => f.endsWith('.test.js')).map(f => `dist/test/${f}`);
const env = { ...process.env, NODE_ENV: 'test', ENIGMA_CHANNEL_ID: 'test-enigma', BOARD_CHANNEL_ID: 'test-board', MJ_USER_ID: 'test-mj', KUMA_PUSH_URL: '' };
// Some embedding hosts set NODE_TEST_CONTEXT. Child runners must not inherit it.
delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env });
process.exit(result.signal ? 1 : (result.status ?? 1));
