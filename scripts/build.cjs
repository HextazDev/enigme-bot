const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Only generated files live here; removing them prevents obsolete JS modules surviving a rename.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
function copyAssets(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) copyAssets(relative);
    else if (/\.(png|jpg|jpeg|webp|ttf)$/.test(entry.name)) {
      fs.mkdirSync(path.dirname(path.join(root, 'dist', relative)), { recursive: true });
      fs.copyFileSync(path.join(root, relative), path.join(root, 'dist', relative));
    }
  }
}
copyAssets('src');
