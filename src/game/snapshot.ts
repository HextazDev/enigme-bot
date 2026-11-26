import { Transaction } from 'sequelize';
import { Joueur, Plateau, TourSnapshot } from '../db/models';

/** Capture the full undo scope before the turn, inside its transaction. */
export async function saveTurnSnapshot(joueur: Joueur, plateau: Plateau, transaction: Transaction): Promise<void> {
    const others = await Joueur.findAll({ transaction });
    await TourSnapshot.create({
      discord_id: joueur.discord_id, tour: plateau.tour, temp_choix_direction: joueur.temp_choix_direction,
      position: joueur.position, pieces: joueur.pieces, etoiles: joueur.etoiles, inventaire: structuredClone(joueur.inventaire),
      a_le_droit_de_jouer: joueur.a_le_droit_de_jouer, a_joue_ce_tour: joueur.a_joue_ce_tour, cases_restantes: joueur.cases_restantes,
      jours_inactifs: joueur.jours_inactifs, est_fantome: joueur.est_fantome, fantome_unblock_used: joueur.fantome_unblock_used,
      bonus_prochain_lancer: joueur.bonus_prochain_lancer, de_limite: joueur.de_limite, type_de: joueur.type_de, de_pipe_valeur: joueur.de_pipe_valeur,
      mode_data: structuredClone(joueur.mode_data), boutique_du_jour: structuredClone(joueur.boutique_du_jour),
      stat_cases_chance: joueur.stat_cases_chance, stat_cases_malchance: joueur.stat_cases_malchance,
      stat_cases_avancees: joueur.stat_cases_avancees, stat_objets_utilises: joueur.stat_objets_utilises,
      plateau_position_etoile: plateau.position_etoile, plateau_pieges_actifs: structuredClone(plateau.pieges_actifs),
      plateau_blocs_caches: structuredClone(plateau.blocs_caches), plateau_mode_data: structuredClone(plateau.mode_data),
      autres_joueurs_snapshot: others.filter(j => j.discord_id !== joueur.discord_id)
        .map(j => ({ discord_id: j.discord_id, pieces: j.pieces, etoiles: j.etoiles, inventaire: structuredClone(j.inventaire), position: j.position, mode_data: structuredClone(j.mode_data) })),
    }, { transaction });
}
