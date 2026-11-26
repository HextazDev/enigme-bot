import { record, strings, validatePlayerModeData, parseIslandBoardData } from '../domain/persisted';
import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import sequelize = require('./database');
import { JsonObject, PendingAction } from '../domain/types';

export class Joueur extends Model<InferAttributes<Joueur>, InferCreationAttributes<Joueur>> {
  declare discord_id: string;
  declare etoiles: CreationOptional<number>;
  declare pieces: CreationOptional<number>;
  declare temp_choix_direction: CreationOptional<number | null>;
  declare position: CreationOptional<number>;
  declare inventaire: CreationOptional<string[]>;
  declare guess_du_jour: CreationOptional<number>;
  declare a_le_droit_de_jouer: CreationOptional<boolean>;
  declare bonus_prochain_lancer: CreationOptional<number>;
  declare de_limite: CreationOptional<boolean>;
  declare type_de: CreationOptional<string>;
  declare de_pipe_valeur: CreationOptional<number>;
  declare auto_remind_guess: CreationOptional<boolean>;
  declare auto_remind_turn: CreationOptional<boolean>;
  declare boutique_du_jour: CreationOptional<string[]>;
  declare jours_inactifs: CreationOptional<number>;
  declare est_fantome: CreationOptional<boolean>;
  declare fantome_unblock_used: CreationOptional<boolean>;
  declare a_joue_ce_tour: CreationOptional<boolean>;
  declare cases_restantes: CreationOptional<number>;
  declare last_deviner_time: CreationOptional<Date | null>;
  declare pari_coureurId: CreationOptional<number | null>;
  declare pari_montant: CreationOptional<number>;
  declare a_trouve_enigme: CreationOptional<boolean>;
  declare stat_cases_chance: CreationOptional<number>;
  declare stat_cases_malchance: CreationOptional<number>;
  declare stat_cases_avancees: CreationOptional<number>;
  declare stat_enigmes_trouvees: CreationOptional<number>;
  declare stat_objets_utilises: CreationOptional<number>;
  declare mode_data: CreationOptional<JsonObject>;
  declare action_en_attente: CreationOptional<PendingAction | null>;
}

export class Plateau extends Model<InferAttributes<Plateau>, InferCreationAttributes<Plateau>> {
  declare id: CreationOptional<number>;
  declare position_etoile: CreationOptional<number>;
  declare pieges_actifs: CreationOptional<JsonObject[]>;
  declare tour: CreationOptional<number>;
  declare enigme_resolue: CreationOptional<boolean>;
  declare enigme_status: CreationOptional<string>;
  declare enigme_reponse: CreationOptional<string | null>;
  declare enigme_text: CreationOptional<string | null>;
  declare enigme_indice1: CreationOptional<string | null>;
  declare enigme_indice2: CreationOptional<string | null>;
  declare enigme_indice3: CreationOptional<string | null>;
  declare enigme_publiee: CreationOptional<boolean>;
  declare indice1_publie: CreationOptional<boolean>;
  declare indice2_publie: CreationOptional<boolean>;
  declare indice3_publie: CreationOptional<boolean>;
  declare enigme_gagnants: CreationOptional<JsonObject[]>;
  declare enigme_channel_id: CreationOptional<string | null>;
  declare fin_enigme_timestamp: CreationOptional<number | null>;
  declare blocs_caches: CreationOptional<JsonObject>;
  declare game_mode: CreationOptional<string>;
  declare game_variant: CreationOptional<string>;
  declare game_map: CreationOptional<string>;
  declare mode_data: CreationOptional<JsonObject>;
}

export class TourSnapshot extends Model<InferAttributes<TourSnapshot>, InferCreationAttributes<TourSnapshot>> {
  declare id: CreationOptional<number>;
  declare discord_id: CreationOptional<string>;
  declare tour: CreationOptional<number>;
  declare timestamp: CreationOptional<Date>;
  declare temp_choix_direction: CreationOptional<number | null>;
  declare position: CreationOptional<number | null>;
  declare pieces: CreationOptional<number | null>;
  declare etoiles: CreationOptional<number | null>;
  declare inventaire: CreationOptional<string[] | null>;
  declare a_le_droit_de_jouer: CreationOptional<boolean | null>;
  declare a_joue_ce_tour: CreationOptional<boolean | null>;
  declare cases_restantes: CreationOptional<number | null>;
  declare jours_inactifs: CreationOptional<number | null>;
  declare est_fantome: CreationOptional<boolean | null>;
  declare fantome_unblock_used: CreationOptional<boolean | null>;
  declare bonus_prochain_lancer: CreationOptional<number | null>;
  declare de_limite: CreationOptional<boolean | null>;
  declare type_de: CreationOptional<string | null>;
  declare de_pipe_valeur: CreationOptional<number | null>;
  declare plateau_position_etoile: CreationOptional<number | null>;
  declare plateau_pieges_actifs: CreationOptional<JsonObject[] | null>;
  declare plateau_blocs_caches: CreationOptional<JsonObject | null>;
  declare plateau_mode_data: CreationOptional<JsonObject | null>;
  declare mode_data: CreationOptional<JsonObject | null>;
  declare boutique_du_jour: CreationOptional<string[] | null>;
  declare stat_cases_chance: CreationOptional<number | null>;
  declare stat_cases_malchance: CreationOptional<number | null>;
  declare stat_cases_avancees: CreationOptional<number | null>;
  declare stat_objets_utilises: CreationOptional<number | null>;
  declare autres_joueurs_snapshot: CreationOptional<JsonObject[] | null>;
}

Joueur.init({
  discord_id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  etoiles: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  pieces: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  temp_choix_direction: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  position: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  inventaire: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  guess_du_jour: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  a_le_droit_de_jouer: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  bonus_prochain_lancer: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  de_limite: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  type_de: {
    type: DataTypes.STRING,
    defaultValue: 'normal',
  },
  de_pipe_valeur: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  auto_remind_guess: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  auto_remind_turn: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  boutique_du_jour: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  jours_inactifs: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  est_fantome: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  fantome_unblock_used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  a_joue_ce_tour: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  cases_restantes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  last_deviner_time: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  pari_coureurId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
  },
  pari_montant: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  a_trouve_enigme: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  stat_cases_chance: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  stat_cases_malchance: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  stat_cases_avancees: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  stat_enigmes_trouvees: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  stat_objets_utilises: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  mode_data: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
  action_en_attente: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
}, {
  sequelize,
  modelName: 'Joueur',
  tableName: 'joueurs',
  timestamps: false
});

Plateau.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  position_etoile: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  pieges_actifs: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  tour: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  enigme_resolue: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  enigme_status: {
    type: DataTypes.STRING,
    defaultValue: 'season_ended',
  },
  enigme_reponse: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  enigme_text: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  enigme_indice1: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  enigme_indice2: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  enigme_indice3: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  enigme_publiee: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  indice1_publie: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  indice2_publie: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  indice3_publie: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  enigme_gagnants: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  enigme_channel_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  fin_enigme_timestamp: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  blocs_caches: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
  game_mode: {
    type: DataTypes.STRING,
    defaultValue: 'mario_party',
  },
  game_variant: {
    type: DataTypes.STRING,
    defaultValue: 'standard',
  },
  game_map: {
    type: DataTypes.STRING,
    defaultValue: 'night_sky',
  },
  mode_data: {
    type: DataTypes.JSON,
    defaultValue: {},
  }
}, {
  sequelize,
  modelName: 'Plateau',
  tableName: 'plateau',
  timestamps: false
});

TourSnapshot.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  discord_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tour: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  // État du joueur
  temp_choix_direction: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  position: DataTypes.INTEGER,
  pieces: DataTypes.INTEGER,
  etoiles: DataTypes.INTEGER,
  inventaire: DataTypes.JSON,
  a_le_droit_de_jouer: DataTypes.BOOLEAN,
  a_joue_ce_tour: DataTypes.BOOLEAN,
  cases_restantes: DataTypes.INTEGER,
  jours_inactifs: DataTypes.INTEGER,
  est_fantome: DataTypes.BOOLEAN,
  fantome_unblock_used: DataTypes.BOOLEAN,
  bonus_prochain_lancer: DataTypes.INTEGER,
  de_limite: DataTypes.BOOLEAN,
  type_de: DataTypes.STRING,
  de_pipe_valeur: DataTypes.INTEGER,
  // État global affecté
  plateau_position_etoile: DataTypes.INTEGER,
  plateau_pieges_actifs: DataTypes.JSON,
  plateau_blocs_caches: DataTypes.JSON,
  plateau_mode_data: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  mode_data: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  boutique_du_jour: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  stat_cases_chance: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  stat_cases_malchance: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  stat_cases_avancees: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  stat_objets_utilises: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  // Snapshot des autres joueurs (pour les vols/échanges)
  autres_joueurs_snapshot: DataTypes.JSON
}, {
  sequelize,
  modelName: 'TourSnapshot',
  tableName: 'tour_snapshots',
  timestamps: false
});

export { sequelize };

/** SQLite JSON is untrusted even when the TypeScript model has a precise type. */
Joueur.addHook('afterFind', result => {
  for (const joueur of Array.isArray(result) ? result : [result]) {
    if (!(joueur instanceof Joueur)) continue;
    if (Object.hasOwn(joueur.dataValues, 'inventaire')) strings(joueur.inventaire, 'inventaire');
    if (Object.hasOwn(joueur.dataValues, 'boutique_du_jour')) strings(joueur.boutique_du_jour, 'boutique');
    if (Object.hasOwn(joueur.dataValues, 'mode_data')) validatePlayerModeData(joueur.mode_data);
  }
});
Plateau.addHook('afterFind', result => {
  for (const plateau of Array.isArray(result) ? result : [result]) {
    if (!(plateau instanceof Plateau) || !Object.hasOwn(plateau.dataValues, 'mode_data')) continue;
    const data = record(plateau.mode_data, 'données plateau');
    if (plateau.game_mode === 'ile_defis') parseIslandBoardData(data);
    else if (data.paris_ouverts !== undefined && typeof data.paris_ouverts !== 'boolean') throw new TypeError('État des paris invalide');
    if (data.marche_noir_date !== undefined && typeof data.marche_noir_date !== 'string') throw new TypeError('Date Marché Noir invalide');
    if (data.propositions_jugees !== undefined) strings(data.propositions_jugees, 'propositions jugées');
    if (data.last_winner_id !== undefined && data.last_winner_id !== null && typeof data.last_winner_id !== 'string') throw new TypeError('Vainqueur précédent invalide');
  }
});
