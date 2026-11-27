import { DataTypes, QueryTypes, Sequelize, Transaction } from 'sequelize';
import schema from './schema-v1.json';

type Column = { type: string; primaryKey?: boolean; autoIncrement?: boolean; allowNull?: boolean; defaultValue?: unknown; defaultNow?: boolean };
const types = { STRING: DataTypes.STRING, TEXT: DataTypes.TEXT, INTEGER: DataTypes.INTEGER, BIGINT: DataTypes.BIGINT, BOOLEAN: DataTypes.BOOLEAN, JSON: DataTypes.JSON, DATE: DataTypes.DATE };

/** Frozen baseline: never derive historical migrations from the current models. */
async function baseline(db: Sequelize, transaction: Transaction): Promise<void> {
  const qi = db.getQueryInterface();
  const existing = await qi.showAllTables({ transaction });
  for (const [table, fields] of Object.entries(schema)) {
    if (existing.includes(table)) {
      const columns = await qi.describeTable(table, { transaction, logging: false } as Parameters<typeof qi.describeTable>[1]);
      const missing = Object.keys(fields).filter(name => !(name in columns));
      if (missing.length) throw new Error(`Schéma ${table} incompatible, colonnes manquantes : ${missing.join(', ')}`);
      continue;
    }
    const attributes = Object.fromEntries(Object.entries(fields).map(([name, raw]) => {
      const field = raw as Column;
      const { type, defaultNow, ...options } = field;
      const dataType = types[type as keyof typeof types];
      if (!dataType) throw new Error(`Type inconnu : ${type}`);
      return [name, { ...options, type: dataType, ...(defaultNow ? { defaultValue: DataTypes.NOW } : {}) }];
    }));
    await qi.createTable(table, attributes, { transaction });
  }
}
const migrations = [
  { name: '001-baseline', up: baseline },
  { name: '002-persist-direction', up: async (db: Sequelize, transaction: Transaction) => {
    const qi = db.getQueryInterface();
    for (const table of ['joueurs', 'tour_snapshots']) {
      const columns = await qi.describeTable(table, { transaction, logging: false } as Parameters<typeof qi.describeTable>[1]);
      if (!columns.temp_choix_direction) await qi.addColumn(table, 'temp_choix_direction', { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }, { transaction });
    }
    await db.query('CREATE INDEX IF NOT EXISTS snapshot_player_time ON tour_snapshots (discord_id, timestamp)', { transaction });
  } },
  { name: '003-pending-action', up: async (db: Sequelize, transaction: Transaction) => {
    // A pending choice (star, shop, Boo, crossroads, challenge) must survive restarts and reject stale buttons.
    const qi = db.getQueryInterface();
    const columns = await qi.describeTable('joueurs', { transaction, logging: false } as Parameters<typeof qi.describeTable>[1]);
    if (!columns.action_en_attente) {
      await qi.addColumn('joueurs', 'action_en_attente', { type: DataTypes.JSON, allowNull: true, defaultValue: null }, { transaction });
    }
  } },
  { name: '004-complete-snapshots', up: async (db: Sequelize, transaction: Transaction) => {
    const qi = db.getQueryInterface();
    const columns = await qi.describeTable('tour_snapshots', { transaction, logging: false } as Parameters<typeof qi.describeTable>[1]);
    const additions: Array<[string, Parameters<typeof qi.addColumn>[2]]> = [
      ['mode_data', { type: DataTypes.JSON, allowNull: true, defaultValue: null }],
      ['boutique_du_jour', { type: DataTypes.JSON, allowNull: true, defaultValue: null }],
      ['stat_cases_chance', { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }],
      ['stat_cases_malchance', { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }],
      ['stat_cases_avancees', { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }],
      ['stat_objets_utilises', { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }],
      ['plateau_mode_data', { type: DataTypes.JSON, allowNull: true, defaultValue: null }],
    ];
    for (const [name, spec] of additions) {
      if (!columns[name]) await qi.addColumn('tour_snapshots', name, spec, { transaction });
    }
  } },
];

export async function migrate(db: Sequelize): Promise<string[]> {
  const options = Reflect.get(db, 'options') as { storage?: string } | undefined;
  if (options?.storage && options.storage !== ':memory:') {
    await db.query('PRAGMA busy_timeout = 5000');
    await db.query('PRAGMA journal_mode = WAL');
  }
  const applied: string[] = [];
  await db.transaction({ type: Transaction.TYPES.IMMEDIATE }, async transaction => {
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL)', { transaction });
    const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations', { type: QueryTypes.SELECT, transaction });
    const unknown = rows.filter(row => !migrations.some(m => m.name === row.name));
    if (unknown.length) throw new Error('La base utilise une version plus récente du schéma.');
    for (const migration of migrations) {
      if (rows.some(row => row.name === migration.name)) continue;
      await migration.up(db, transaction);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($name)', { bind: { name: migration.name }, transaction });
      applied.push(migration.name);
    }
  });
  return applied;
}
