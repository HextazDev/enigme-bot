const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, QueryTypes } = require('sequelize');
const { migrate } = require('../src/db/migrations');

test('migrations bootstrap once and preserve existing player data', async () => {
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  try {
    assert.deepEqual(await migrate(db), ['001-baseline', '002-persist-direction', '003-pending-action', '004-complete-snapshots']);
    await db.query("INSERT INTO joueurs (discord_id, pieces) VALUES ('test', 42)");
    assert.deepEqual(await migrate(db), []);
    const [row] = await db.query("SELECT pieces FROM joueurs WHERE discord_id = 'test'", { type: QueryTypes.SELECT });
    assert.equal(row.pieces, 42);
    const columns = await db.getQueryInterface().describeTable('joueurs');
    assert.ok(columns.temp_choix_direction);
    assert.ok(columns.action_en_attente);
    const snapCols = await db.getQueryInterface().describeTable('tour_snapshots');
    assert.ok(snapCols.mode_data);
    assert.ok(snapCols.plateau_mode_data);
    assert.ok(snapCols.stat_cases_avancees);
  } finally { await db.close(); }
});
test('a valid legacy v1 database is adopted without losing data and newer schema versions are rejected', async () => {
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  try {
    await migrate(db);
    await db.query("INSERT INTO joueurs (discord_id, pieces) VALUES ('legacy', 99)");
    await db.query('DROP TABLE schema_migrations');
    const applied = await migrate(db);
    assert.deepEqual(applied, ['001-baseline', '002-persist-direction', '003-pending-action', '004-complete-snapshots']);
    const [row] = await db.query("SELECT pieces FROM joueurs WHERE discord_id = 'legacy'", { type: QueryTypes.SELECT });
    assert.equal(row.pieces, 99);
    await db.query("INSERT INTO schema_migrations (name) VALUES ('999-future-schema')");
    await assert.rejects(migrate(db), /version plus récente/);
  } finally { await db.close(); }
});
test('an incompatible legacy database is rejected without altering its data', async () => {
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  try {
    await db.query('CREATE TABLE joueurs (discord_id TEXT, pieces INTEGER)');
    await db.query("INSERT INTO joueurs VALUES ('old', 17)");
    await assert.rejects(migrate(db), /colonnes manquantes/);
    const [row] = await db.query('SELECT pieces FROM joueurs', { type: QueryTypes.SELECT });
    assert.equal(row.pieces, 17);
    assert.equal((await db.getQueryInterface().showAllTables()).includes('schema_migrations'), false);
  } finally { await db.close(); }
});
