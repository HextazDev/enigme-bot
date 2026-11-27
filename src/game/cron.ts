import { editReply } from '../discord/replies';
import { ids } from '../discord/custom-ids';
import cron from 'node-cron';
type ScheduledTask = ReturnType<typeof cron.schedule>;
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Joueur, Plateau } from '../db/models';
import { ChannelHost, announce, boardChannel, enigmaChannel, getChannel } from '../discord/channels';
import * as season from '../services/season';
import { GameRuleError } from '../domain/types';
import { getActiveMode } from '../gamemodes/registry';
import { endSeason } from './endgame';
import { triggerEnigmaEnd } from './enigma';
import { afterGameAction, withScheduledLock } from './transaction';
import config = require('../config');

export { getChannel };
export const isSeasonActive = season.isSeasonActive;
type CronClient = ChannelHost & Client;

const scheduledJobs: ScheduledTask[] = [];
const activeCommentaryTimers = new Set<NodeJS.Timeout>();
function schedule(expression: string, callback: () => Promise<unknown>): void {
  scheduledJobs.push(cron.schedule(expression, () => withScheduledLock(`cron:${expression}`, callback)
    .catch(error => console.error('[ERROR] Tâche planifiée :', error)), { timezone: 'Europe/Paris', noOverlap: true }));
}
export function stopCronJobs(): void {
  for (const job of scheduledJobs.splice(0)) void job.destroy();
  for (const timer of activeCommentaryTimers) clearTimeout(timer);
  activeCommentaryTimers.clear();
}

const rolePing = () => (config.roleEnigmeId ? `<@&${config.roleEnigmeId}> ` : '');
async function announceGhosts(client: ChannelHost, ghosts: string[]): Promise<void> {
  for (const id of ghosts) {
    await announce(client, `👻 **<@${id}>** ne donne plus de nouvelles depuis 3 tours et s'est transformé(e) en fantôme ! Son personnage est maintenant bloqué jusqu'à son possible réveil.`);
  }
}
async function username(client: ChannelHost, id: string): Promise<string> {
  if (!client.users) return `Joueur inconnu (ID: ${id})`;
  try { return (await client.users.fetch(id)).username; }
  catch (error) {
    console.warn(`[WARN] Utilisateur ${id} introuvable :`, error);
    return `Joueur inconnu (ID: ${id})`;
  }
}

async function remindPlayers(client: ChannelHost, text: string): Promise<number> {
  const players = await Joueur.findAll({ where: { a_le_droit_de_jouer: true, auto_remind_turn: true } });
  await afterGameAction(async () => {
    let delivered = 0;
    for (const j of players) {
      try {
        const user = await client.users?.fetch(j.discord_id);
        await user?.send?.(text);
        delivered += 1;
      } catch (error) { console.warn(`[WARN] Rappel impossible pour ${j.discord_id} (MP fermés ?) :`, error); }
    }
    console.log(`[CRON] Rappel de fin de tour délivré à ${delivered}/${players.length} joueur(s).`);
  });
  return players.length;
}

/** 15h (Mon-Fri): two hours before the end of the turn. */
export async function handle15hReminder(client: ChannelHost): Promise<void> {
  if (!season.isSeasonActive(await Plateau.findByPk(1))) return;
  await remindPlayers(client, "⏰ **Rappel automatique** : Le tour en cours sur le plateau se termine dans 2 heures ! N'oublie pas de faire `/jouer` !");
}

/** Saturday 8h: two hours before the bets close the board. */
export async function handleSaturday8hReminder(client: ChannelHost): Promise<void> {
  const plateau = await Plateau.findByPk(1);
  if (!season.isSeasonActive(plateau) || plateau?.game_mode === 'ile_defis') return;
  await remindPlayers(client, "⏰ **Rappel automatique** : Le tour en cours sur le plateau se termine dans 2 heures ! N'oublie pas de faire `/jouer` ! (Les paris commencent à 10h00)");
}

/** 17h (Mon-Fri): publish the enigma and lock the board, or keep it open without enigma. */
export async function handle17hTransition(client: CronClient): Promise<void> {
  const result = await season.dailyTransition();
  if (result.kind === 'skip') {
    console.log('[CRON] 17h : aucune transition (saison en attente, terminée ou sans joueur).');
    return;
  }
  if (result.kind === 'end_season') {
    await endSeason(client);
    return;
  }
  const plateau = await Plateau.findByPk(1);
  const maxTours = getActiveMode(plateau).maxTours;
  await announceGhosts(client, result.ghosts);
  if (result.kind === 'enigma') {
    await afterGameAction(async () => {
      const channel = await enigmaChannel(client);
      if (channel) {
        await channel.send(`${rolePing()}🧩 **ÉNIGME DU JOUR — Tour ${result.tour}/${maxTours}**\n\n${result.text}`
          + '\n\n💡 *Des indices seront publiés à 18h, 19h et 20h.*'
          + '\n🎲 Utilisez `/deviner [votre réponse]` pour proposer une réponse au Maître du Jeu.'
          + '\n🪙 Chaque proposition rapporte **1 pièce** de participation (max 3/jour).'
          + '\n⏰ **Récompenses :** 17h-18h → 10 pièces | 18h-19h → 7 pièces | 19h-20h → 4 pièces | 20h-21h → 2 pièces');
      } else console.warn('[WARN] Salon énigme indisponible : énigme publiée en base uniquement.');
      let lock = "⏰ **Fin du tour de jeu !** Le plateau est maintenant verrouillé jusqu'à 21h (résolution de l'énigme).\n";
      if (result.forgotten.length) {
        lock += "\n⚠️ **Ils ont oublié de jouer aujourd'hui :**\n";
        for (const id of result.forgotten) lock += `- **${await username(client, id)}**\n`;
        lock += "\n*Tant pis pour eux ! N'hésitez pas à activer un rappel avec la commande `/settings` pour ne plus oublier votre tour.*";
      }
      await announce(client, lock);
      console.log(`[CRON] Énigme du Tour ${result.tour} publiée à 17h.`);
    });
    return;
  }
  if (result.seasonOver) {
    await endSeason(client);
    return;
  }
  console.warn("[WARN] Aucune énigme programmée aujourd'hui : le plateau reste ouvert.");
  await announce(client, `${rolePing()}⚠️ **Aucune énigme n'a été programmée aujourd'hui !** Le plateau reste ouvert. N'oubliez pas d'utiliser \`/admin programmer_enigme\` demain.`);
}

/** Saturday 10h: the board closes, bets on the Yoshi race open. */
export async function handleSaturday10hBets(client: ChannelHost): Promise<void> {
  const { opened, ghosts } = await season.openBets();
  if (!opened) return;
  await announceGhosts(client, ghosts);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(season.BET_RUNNERS.map((name, index) =>
    new ButtonBuilder().setCustomId(ids.bet.encode(index)).setLabel(`Parier sur ${name}`).setStyle(ButtonStyle.Primary)));
  await announce(client, {
    content: `${rolePing()}🏇 **LES PARIS DU SAMEDI SONT OUVERTS !** 🏇\n\nMisez sur votre Yoshi favori ! Le système fonctionne comme les prédictions Twitch : le pot total sera partagé entre les gagnants proportionnellement à leur mise.\n\n*Vous avez jusqu'à 21h00 pour parier (Max 30 pièces). Un ticket gratuit de 3 pièces est offert à tous !*`,
    components: [row],
  });
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { activeCommentaryTimers.delete(timer); resolve(); }, ms);
    timer.unref();
    activeCommentaryTimers.add(timer);
  });
}
/** Saturday 21h: payouts are committed first; the race commentary only follows. */
export async function handleSaturday21hBetsResult(client: ChannelHost): Promise<void> {
  const result = await season.settleBets();
  if (!result) return;
  await afterGameAction(async () => {
    const channel = await boardChannel(client);
    if (!channel) { console.warn('[WARN] Paris réglés, salon indisponible pour la course.'); return; }
    let message = `🏆 **${result.winner.toUpperCase()} REMPORTE LA COURSE !** 🏆\n\n`;
    for (const p of result.payouts) message += `<@${p.discord_id}> gagne **${p.gain} pièces** (Mise: ${p.stake}) ! *(Total: ${p.balance} 🪙)*\n`;
    message += result.payouts.length
      ? `\n*Pot total de ${result.pot} pièces partagé entre les gagnants !*`
      : `*Personne n'a parié sur ${result.winner}... Le pot de ${result.pot} pièces est perdu ! 🤖💰*`;
    // Commentary runs outside the game lock: timers are tracked and cleared on shutdown.
    void (async () => {
      await channel.send('🏁 **LA COURSE DE YOSHIS COMMENCE !** 🏁');
      await pause(3000);
      await channel.send('Les Yoshis sont dans le dernier virage...');
      await pause(3000);
      await channel.send("C'est très serré !");
      await pause(3000);
      await channel.send(message);
    })().catch(error => console.error('[ERROR] Annonce de la course :', error));
  });
}

/** Sunday 11h (or MJ): no enigma, the board opens with the black market. */
export async function handleSunday11hBlackMarket(client: CronClient, manual = false): Promise<boolean> {
  const result = await season.openBlackMarket();
  if (!result.opened) return false;
  if (result.seasonOver) {
    await endSeason(client);
    return true;
  }
  await announce(client, `${rolePing()}🛍️ **LE MARCHÉ NOIR EST OUVERT !${manual ? ' (Action manuelle du MJ)' : ''}** 🛍️\nLe plateau est déverrouillé, aucune énigme aujourd'hui. Les boutiques proposent des objets dévastateurs exclusifs ! Utilisez \`/jouer\` pour en profiter !`);
  return true;
}

/** Publish a hint once: claimed atomically under lock, sent outside the lock, and unclaimed if Discord delivery fails. */
export async function publishHint(client: ChannelHost, index: 1 | 2 | 3): Promise<void> {
  const text = await season.claimHint(index);
  if (!text) return;
  await afterGameAction(async () => {
    try {
      const channel = await enigmaChannel(client);
      if (!channel) throw new Error(`Salon énigme indisponible pour l'indice ${index}`);
      await channel.send(`${rolePing()}💡 **Indice ${index} (${17 + index}h) :** ${text}`);
      console.log(`[CRON] Indice ${index} publié.`);
    } catch (error) {
      console.warn(`[WARN] Indice ${index} non publié, remise en attente :`, error);
      await withScheduledLock('hint-rollback', () => season.unclaimHint(index))
        .catch(rollbackError => console.error(`[ERROR] Échec remise en attente indice ${index} :`, rollbackError));
    }
  });
}

export async function handlePari(interaction: ButtonInteraction): Promise<void> {
  if (!await season.betsOpen()) throw new GameRuleError('CLOSED', 'Les paris sont fermés !');
  const runner = ids.bet.decode(interaction.customId);
  const name = season.BET_RUNNERS[runner];
  if (!name) throw new GameRuleError('RUNNER', 'Coureur introuvable.');
  const amount = new TextInputBuilder().setCustomId('montant').setLabel('Montant du pari (Max 30, 3 offerts)').setStyle(TextInputStyle.Short).setRequired(true).setValue('3');
  await interaction.showModal(new ModalBuilder().setCustomId(ids.betModal.encode(runner)).setTitle(`Pari sur ${name}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amount)));
}

export async function handleModalPari(interaction: ModalSubmitInteraction): Promise<void> {
  const runner = ids.betModal.decode(interaction.customId);
  const amount = Number(interaction.fields.getTextInputValue('montant'));
  const { balance } = await season.placeBet(interaction.user.id, runner, amount);
  await editReply(interaction, { content: `Tu as parié **${amount} pièces** sur **${season.BET_RUNNERS[runner]}** ! *(Il te reste ${balance} 🪙)*` });
}

export function initCronJobs(client: CronClient): void {
  stopCronJobs();
  schedule('0 15 * * 1-5', () => handle15hReminder(client));
  schedule('0 8 * * 6', () => handleSaturday8hReminder(client));
  schedule('0 17 * * 1-5', () => handle17hTransition(client));
  schedule('0 18 * * 1-5', () => publishHint(client, 1));
  schedule('0 19 * * 1-5', () => publishHint(client, 2));
  schedule('0 20 * * 1-5', () => publishHint(client, 3));
  schedule('0 21 * * 1-5', () => triggerEnigmaEnd(client));
  schedule('0 11 * * 0', () => handleSunday11hBlackMarket(client));
  schedule('0 10 * * 6', () => handleSaturday10hBets(client));
  schedule('0 21 * * 6', () => handleSaturday21hBetsResult(client));
  schedule('0 0 * * *', async () => {
    const deleted = await season.purgeOldSnapshots();
    if (deleted) console.log(`[CRON] ${deleted} anciens snapshots de tours supprimés.`);
  });
}
