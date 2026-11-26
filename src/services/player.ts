import { Joueur, Plateau, sequelize } from '../db/models';
import { GameRuleError } from '../domain/types';
import { withGameLock } from '../game/transaction';
import { getActiveMode } from '../gamemodes/registry';
import { isSaturdayClosed } from './season';

/** Load the menu state; registers the player only if a season is currently open. */
export async function loadGameMenu(userId: string) {
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau) throw new GameRuleError('CLOSED', "Aucune partie n'est configurée. Le Maître du Jeu doit lancer `/admin start`.");
    const mode = getActiveMode(plateau);
    let joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur && plateau.enigme_status !== 'season_ended') {
      const canPlayNow = plateau.enigme_status !== 'active' && (!mode.hasShop || !isSaturdayClosed(plateau));
      joueur = await Joueur.create({
        discord_id: userId,
        a_le_droit_de_jouer: canPlayNow,
        mode_data: mode.getInitialPlayerData(plateau.game_variant),
      }, { transaction });
    }
    const players = await Joueur.findAll({ transaction });
    return { plateau, mode, joueur, players };
  }));
}

export async function updateSettings(userId: string, options: { guess: boolean | null; turn: boolean | null }): Promise<Joueur> {
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    let joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur) {
      if (!plateau || plateau.enigme_status === 'season_ended') {
        throw new GameRuleError('CLOSED', "Aucune saison n'est en cours. Utilise `/jouer` dès qu'une nouvelle partie commence.");
      }
      const mode = getActiveMode(plateau);
      const canPlayNow = plateau.enigme_status !== 'active' && (!mode.hasShop || !isSaturdayClosed(plateau));
      joueur = await Joueur.create({
        discord_id: userId,
        a_le_droit_de_jouer: canPlayNow,
        mode_data: mode.getInitialPlayerData(plateau.game_variant),
      }, { transaction });
    }
    if (options.guess !== null) joueur.auto_remind_guess = options.guess;
    if (options.turn !== null) joueur.auto_remind_turn = options.turn;
    if (joueur.changed()) await joueur.save({ transaction });
    return joueur;
  }));
}

export async function getLeaderboard() {
  const plateau = await Plateau.findByPk(1);
  const mode = plateau ? getActiveMode(plateau) : null;
  const order: [string, 'DESC'][] = mode && !mode.hasStars ? [['position', 'DESC']] : [['etoiles', 'DESC'], ['pieces', 'DESC']];
  const players = await Joueur.findAll({ order });
  return { plateau, mode, players };
}
