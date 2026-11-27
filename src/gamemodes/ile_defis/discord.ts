import { islandPending } from '../../domain/persisted';
import { ids } from '../../discord/custom-ids';
import { editGameReply } from '../../discord/game-view';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client } from 'discord.js';
import { Op } from 'sequelize';
import { Joueur } from '../../db/models';
import { GameRuleError } from '../../domain/types';
import { announce, announceWithBoard } from '../../discord/channels';
import { armPendingTimer, clearPendingTimer } from '../../discord/pending-timers';
import { GameComponent, ModeInteractions, Prompt } from '../mode-interface';
import * as turn from './turn';

const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
const button = (id: string, label: string, style: ButtonStyle) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

const PROMPTS: Record<turn.IleStop, Prompt> = {
  portail: { content: '🚪 **Tu es devant le Portail !** Pour le franchir et l\'ouvrir pour tout le serveur, tu dois faire **4 ou plus** sur ton jet de dé standard.',
    components: [row(button('ile_tenter_portail', "🚪 Tenter d'ouvrir le Portail (Jet 4+)", ButtonStyle.Primary))] },
  cascade: { content: '🌊 **Tu es sur le Pont de la Cascade !** Pour franchir ce piège et le désactiver définitivement pour tous, tu dois faire **3 ou plus**. Si tu échoues, tu tombes à l\'eau !',
    components: [row(button('ile_tenter_cascade', '🌊 Tenter la traversée (Jet 3+)', ButtonStyle.Primary))] },
  liane: { content: '🦧 **Tu es sur une case Saut Liane !** Clique sur le bouton pour t\'élancer : ta course repart avec un nouveau jet de 1d6, sans aucun risque !',
    components: [row(button('ile_tenter_liane', "🦧 S'élancer sur la liane", ButtonStyle.Success))] },
  intersection: { content: "🛤️ **Intersection !** Choisis ton chemin. Fais bien attention, l'un des deux côtés comporte une chute d'eau aléatoire qui termine immédiatement ton tour !",
    components: [row(button('ile_direction_0', '👈 Chemin de Gauche', ButtonStyle.Primary), button('ile_direction_1', '👉 Chemin de Droite', ButtonStyle.Secondary))] },
  dragon: { content: '🏆 **TU ES DEVANT LE DRAGON !** C\'est le combat final ! Lance tes dés : si ton score cumulé est de **6 ou plus**, tu terrasses le Dragon !',
    components: [row(button('ile_tenter_dragon', '🗡️ Affronter le Dragon ! (Jet 6+)', ButtonStyle.Danger))] },
};

async function present(client: Client, actor: turn.Actor, move: turn.MoveOutcome, target: GameComponent | null): Promise<void> {
  const mention = `<@${actor.id}>`;
  if (move.kind === 'stopped') {
    await announceWithBoard(client, `🎲 **${mention}** s'arrête en chemin sur la case **${move.joueur.position} (${move.stop.toUpperCase()})** !`, actor.id, turn.findCase(move.joueur.position).zone ?? null);
    await editGameReply(target, PROMPTS[move.stop]);
    await armPendingTimer(actor.id, () => expire(client, actor, move.pending.token, target));
    return;
  }
  clearPendingTimer(actor.id);
  const effects = move.effects.map(event => `\n${formatEffect(event)}`).join('');
  await announceWithBoard(client, `🏁 **${mention}** termine son déplacement sur la case **${move.caseArrivee.id} (${move.caseArrivee.name})** !${effects}`,
    actor.id, turn.findCase(move.joueur.position).zone ?? null);
  await editGameReply(target, { content: move.double
    ? `🚶 Déplacement terminé sur la case **${move.joueur.position}** ! Tu as obtenu un **DOUBLE** : utilise la commande \`/jouer\` immédiatement pour faire ton lancer gratuit standard !`
    : `🚶 Déplacement terminé sur la case **${move.joueur.position}** ! Rendez-vous demain après la prochaine énigme !` });
}

async function expire(client: Client, actor: turn.Actor, token: string, target: GameComponent | null): Promise<void> {
  const expired = await turn.expirePending(actor, token);
  if (!expired) return;
  const mention = `<@${actor.id}>`;
  const messages: Record<turn.IleStop, string> = {
    portail: `⏰ **${mention}** a tremblé devant l'obstacle et a échoué automatiquement par manque de temps !`,
    cascade: `⏰ **${mention}** a tremblé devant l'obstacle et a échoué automatiquement par manque de temps !`,
    liane: `⏰ **${mention}** a trop tardé à s'élancer sur la liane. Le bot l'a poussé : **+${expired.roll} cases** !`,
    intersection: expired.fellTo !== undefined
      ? `⏰ **${mention}** a hésité trop longtemps à l'intersection et est tombé(e) à l'eau ! Retour case **${expired.fellTo}**.`
      : `⏰ **${mention}** a hésité trop longtemps... Il a foncé tout droit par défaut !`,
    dragon: `⏰ **${mention}** n'a pas osé affronter le Dragon aujourd'hui. Il pourra retenter demain.`,
  };
  await announce(client, messages[expired.type]);
  if (expired.move) await present(client, actor, expired.move, target);
}

async function handle(i: GameComponent): Promise<boolean> {
  const id = i.customId;
  const actor = { id: i.user.id, username: i.user.username };
  const mention = `<@${actor.id}>`;
  if (id === 'lancer_de') {
    const roll = await turn.startTurn(actor);
    let text = `🎲 Tu lances ton dé standard et obtiens **${roll.standard}** !`;
    if (roll.bonus > 0) text += `\n✨ Ton dé bonus (**${roll.bonusType.toUpperCase()}**) s'ajoute et fait **${roll.bonus}** ! (Total : **${roll.standard + roll.bonus}** cases)`;
    if (roll.double) text += '\n🎉 **DOUBLE !** Tu obtiendras un lancer de dé standard gratuit supplémentaire immédiatement après la fin de ce déplacement !';
    await editGameReply(i, { components: [] });
    await editGameReply(i, { content: text });
    await present(i.client, actor, roll.move, i);
  } else if (id.startsWith('ile_tenter_') || id.startsWith('ile_direction_')) {
    const stop = id.startsWith('ile_direction_') ? 'intersection' : ids.islandChallenge.decode(id);
    const choice = stop === 'intersection' ? ids.islandDirection.decode(id) : null;
    const result = await turn.resolveChallenge(actor, stop, choice);
    const { publicText, privateText } = describe(mention, result);
    await editGameReply(i, { content: privateText, components: [] });
    await announce(i.client, publicText);
    if (result.move) await present(i.client, actor, result.move, i);
    else clearPendingTimer(actor.id);
  } else if (id === 'unblock_fantome') {
    const unblocked = await turn.unblockGhost(actor.id);
    await editGameReply(i, { components: [], content: unblocked ? "🔓 Te voilà débloqué ! Tu peux rejouer dès aujourd'hui !" : 'Tu ne peux pas te débloquer.' });
    if (unblocked) await announce(i.client, `🔓 **${mention}** utilise son déblocage unique et revient dans l'aventure !`);
  } else if (id === 'continuer_deplacement') {
    throw new GameRuleError('NO_MOVE', "Tu n'as pas de déplacement en cours.");
  } else if (id === 'utiliser_objet' || id.startsWith('use_')) {
    throw new GameRuleError('NO_ITEMS', "Les objets ne sont pas activés dans le mode course de l'Île aux défis.");
  } else return false;
  return true;
}

function describe(mention: string, r: turn.ChallengeResult): { publicText: string; privateText: string } {
  switch (r.stop) {
    case 'intersection':
      return r.success
        ? { publicText: `🛤️ **${mention}** a pris le chemin vers la case ${r.target} et poursuit sa route en toute sécurité !`, privateText: '🛤️ Chemin sûr ! Ton déplacement continue.' }
        : { publicText: `🌊💦 **PLOUF !** **${mention}** s'est fait surprendre par une cascade à l'intersection ! Il est ramené à la case **${r.fellTo}**. Son tour s'arrête là.`,
          privateText: `🌊💦 **Plouf !** Mauvais choix, tu es tombé dans l'eau ! Tu es ramené à la case **${r.fellTo}** et ton tour est fini.` };
    case 'liane':
      return { publicText: `🦧✨ **SAUT LIANE !** **${mention}** s'élance à la liane et repart pour **${r.roll} cases** ! 🚀🌴`, privateText: `🦧✨ **Saut Liane !** Tu t'élances et repars pour **${r.roll} cases** !` };
    case 'portail':
      return r.success
        ? { publicText: `🚪✨ **OUVERTURE DE PORTAIL !** **${mention}** a obtenu un **${r.roll}** et ouvert le Portail à la case **${r.target}** pour tout le monde ! 🥳🎉`, privateText: `🚪✨ **Succès !** Tu as fait un **${r.roll}** et déverrouillé le portail ! Ton déplacement continue.` }
        : { publicText: `🚪🔒 **ÉCHEC PORTAIL !** **${mention}** a fait un **${r.roll}** et reste coincé devant le Portail case **${r.target}** pour ce tour !`, privateText: `🚪🔒 **Échec...** Tu as fait un **${r.roll}** (il fallait 4+). Ton tour s'arrête net devant le portail !` };
    case 'cascade':
      return r.success
        ? { publicText: `🌊✨ **EXPLOIT DE LA CASCADE !** **${mention}** a obtenu un **${r.roll}** et a désactivé le piège de la Cascade pour tout le monde ! 🛡️👏`, privateText: `🌊✨ **Succès !** Tu as fait un **${r.roll}** et traversé la cascade ! Ton déplacement continue.` }
        : { publicText: `🌊💦 **PLOUF !** **${mention}** a fait un **${r.roll}** (il fallait 3+) et s'est fait emporter par la Cascade ! Il est ramené à la case **${r.fellTo}** et son tour prend fin !`, privateText: `🌊💦 **Plouf !** Tu as fait un **${r.roll}**. Tu tombes dans l'eau et es ramené à la case **${r.fellTo}** ! Ton tour est terminé.` };
    case 'dragon':
      return r.success
        ? { publicText: `🏆🐉 **LE DRAGON EST TERRASSÉ !** **${mention}** a battu le Dragon avec un score héroïque de **${r.roll}** ! La saison sera clôturée à 17h ! 🐉👑`, privateText: `🏆🐉 **FÉLICITATIONS !** Tu as terrassé le Dragon avec un score de ${r.roll} ! La victoire finale sera annoncée officiellement à 17h !` }
        : { publicText: `😢 **ÉCHEC !** **${mention}** a attaqué le Dragon mais son score de **${r.roll}** était insuffisant. Il retentera demain !`, privateText: `😢 **Échec...** Ton score de ${r.roll} n'a pas suffi à battre le Dragon. Tu pourras retenter demain !` };
  }
}

async function resolveUsername(client: Client, userId: string): Promise<string> {
  try { return (await client.users?.fetch(userId))?.username ?? `<@${userId}>`; }
  catch { return `<@${userId}>`; }
}

export const interactions: ModeInteractions = {
  handle,
  renderPending(joueur) {
    const pending = islandPending(joueur.action_en_attente);
    if (!pending || pending.case !== joueur.position) return null;
    return PROMPTS[pending.type] ?? null;
  },
  async rearmTimers(client) {
    for (const joueur of await Joueur.findAll({ where: { action_en_attente: { [Op.ne]: null } } })) {
      const pending = islandPending(joueur.action_en_attente);
      if (!pending) continue;
      const userId = joueur.discord_id;
      await armPendingTimer(userId, async () => {
        const actor = { id: userId, username: await resolveUsername(client, userId) };
        await expire(client, actor, pending.token, null);
      });
    }
    // After the timers on purpose: a choice lost by an older version waits for the player's next /jouer.
    const recovered = await turn.recoverLegacyPending();
    if (recovered.length) console.log(`[GAME] Choix en attente restaurés après mise à jour : ${recovered.join(', ')}`);
  },
};

function formatEffect(event: turn.IslandEffect): string {
  switch (event.kind) {
    case 'boost': return `🏃 **SUPER ÉLAN !** Il bondit immédiatement de **+${event.amount} cases** et s'arrête sur la case **${event.position}** !`;
    case 'slide': return `📉 **GLISSADE !** Il glisse et recule de **-${event.amount} cases** jusqu'à la case **${event.position}** !`;
    case 'rock': return `🪨💥 **ALERTE ROCHER !** Un rocher dévale la pente ! Tous les joueurs de la zone **${event.zone.toUpperCase()}** (${event.players.map(id => `<@${id}>`).join(', ')}) reculent de 5 cases !`;
    case 'exchange_empty': return `🔀 **CASE ÉCHANGE (Jet : ${event.roll}) !** Aucune cible valide trouvée, rien ne se passe.`;
    case 'exchange': {
      const descriptions = { ahead: 'le joueur juste devant', behind: 'le joueur juste derrière', first: 'le premier de la course (LE BRAQUAGE !)', last: 'le dernier de la course (LA LOOSE...)' };
      return `🔀 **CASE ÉCHANGE (Jet : ${event.roll}) !** <@${event.actorId}> échange sa position avec **<@${event.targetId}>** (${descriptions[event.targetKind]}) !`;
    }
  }
}
