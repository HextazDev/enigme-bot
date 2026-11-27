import { marioVariant } from './variant';
import { formatLandingEvents, formatItemUse } from './format-events';
import { marioPending } from '../../domain/persisted';
import { ids, selectedValue, numericChoice } from '../../discord/custom-ids';
import { editGameReply } from '../../discord/game-view';
import { afterGameAction } from '../../game/transaction';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, StringSelectMenuBuilder } from 'discord.js';
import { Op } from 'sequelize';
import { Joueur, Plateau } from '../../db/models';
import { GameRuleError, Item } from '../../domain/types';
import { announce, announceWithBoard } from '../../discord/channels';
import { armPendingTimer, clearPendingTimer } from '../../discord/pending-timers';
import { GameComponent, ModeInteractions, Prompt } from '../mode-interface';
import { getActiveBoardCases } from '../registry';
import { ITEMS, itemByKey } from './items';
import { itemById } from './shop';
import { BOO_STAR_PRICE, KEY_ITEM_NAME, MarioStop, findCase } from './rules';
import * as turn from './turn';
import config = require('../../config');

const STOP_LABELS: Record<MarioStop, string> = { etoile: 'Étoile', boutique: 'Boutique', boo: 'Boo', intersection: 'Intersection' };
const button = (id: string, label: string, style: ButtonStyle, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const actorOf = (i: GameComponent): turn.Actor => ({ id: i.user.id, username: i.user.username });

function starPrompt(joueur: Joueur, plateau: Plateau): Prompt {
  const price = marioVariant(plateau.game_variant).settings.starPrice;
  const passing = joueur.cases_restantes > 0 ? 'passes devant' : 'atterris sur';
  return {
    content: `⭐ Tu ${passing} l'Étoile ! Veux-tu l'acheter pour ${price} pièces ? (Tu as ${joueur.pieces} pièces)`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('acheter_etoile', `Acheter l'Étoile (${price} pièces)`, ButtonStyle.Success, joueur.pieces < price),
      button('passer_etoile', 'Passer', ButtonStyle.Secondary))],
  };
}
function shopPrompt(joueur: Joueur, offer: Item[]): Prompt {
  const passing = joueur.cases_restantes > 0 ? 'passes devant une' : 'atterris sur une';
  const row = new ActionRowBuilder<ButtonBuilder>();
  let content = `🛒 **Tu ${passing} Boutique !** Voici ce que je te propose :\n\n`;
  offer.forEach((item, index) => {
    content += `${index + 1}. **${item.name}** - ${item.price} pièces\n*${item.description}*\n\n`;
    row.addComponents(button(ids.buy.encode(item.id), `Acheter ${item.name} (${item.price}p)`, ButtonStyle.Primary, joueur.pieces < item.price));
  });
  row.addComponents(button('buy_cancel', 'Quitter la boutique', ButtonStyle.Danger));
  return { content, components: [row] };
}
function booPrompt(joueur: Joueur): Prompt {
  const passing = joueur.cases_restantes > 0 ? 'passes devant moi' : 'atterris sur ma case';
  return {
    content: `👻 Boo ! Tu ${passing}. Voudrais-tu que je vole quelque chose pour toi ?\n- Voler des pièces (3 à 12) gratuitement\n- Voler une Étoile pour ${BOO_STAR_PRICE} pièces`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('boo_pieces', 'Voler des pièces (Gratuit)', ButtonStyle.Success),
      button('boo_etoile', `Voler une Étoile (${BOO_STAR_PRICE} pièces)`, ButtonStyle.Success, joueur.pieces < BOO_STAR_PRICE),
      button('boo_annuler', 'Passer', ButtonStyle.Secondary))],
  };
}
function crossroadsPrompt(joueur: Joueur, plateau: Plateau): Prompt {
  const cases = getActiveBoardCases(plateau);
  const here = findCase(cases, joueur.position);
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const path of here.next) {
    const next = findCase(cases, path);
    const dx = next.x - here.x;
    const dy = next.y - here.y;
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '➡️ Droite' : '⬅️ Gauche') : (dy > 0 ? '⬇️ Bas' : '⬆️ Haut');
    const label = `${direction} (Case ${path})`;
    if (findCase(cases, path).requiresKey) row.addComponents(button(ids.direction.encode(path), `🔑 Entrer ${label}`, ButtonStyle.Success, !joueur.inventaire.includes(KEY_ITEM_NAME)));
    else row.addComponents(button(ids.direction.encode(path), label, ButtonStyle.Primary));
  }
  return { content: '🔀 **Intersection !** Quelle direction veux-tu prendre ?', components: [row] };
}

function promptFor(stop: MarioStop, joueur: Joueur, plateau: Plateau): Prompt {
  if (stop === 'etoile') return starPrompt(joueur, plateau);
  if (stop === 'boo') return booPrompt(joueur);
  if (stop === 'intersection') return crossroadsPrompt(joueur, plateau);
  return shopPrompt(joueur, joueur.boutique_du_jour.map(id => itemById(id)).filter((item): item is Item => !!item));
}

/** Publish the result of a movement, then show the private prompt (or the end of turn) and arm the expiry. */
async function present(client: Client, actor: turn.Actor, move: turn.MoveOutcome, header: string, target: GameComponent | null): Promise<void> {
  if (move.kind === 'stopped') {
    const where = `${move.joueur.cases_restantes > 0 ? 'en chemin ' : ''}sur la case **${move.caseId} (${STOP_LABELS[move.stop]})**`;
    await announceWithBoard(client, `${header} et s'arrête ${where} !\n*(🤫 Un menu secret s'est ouvert en dessous de sa commande pour interagir avec la case !)*`, actor.id);
    const prompt = move.stop === 'boutique' ? shopPrompt(move.joueur, move.shop) : promptFor(move.stop, move.joueur, move.plateau);
    await editGameReply(target, prompt);
    await armPendingTimer(actor.id, () => expire(client, actor, move.pending.token, target));
    return;
  }
  clearPendingTimer(actor.id);
  await announceWithBoard(client, `${header} et atterrit sur la case **${move.caseArrivee.id} (${move.caseArrivee.type})** !${formatLandingEvents(move.effects)}`, actor.id);
  let text = `Tu as atterri sur la case ${move.caseArrivee.id} ! Regarde le salon <#${config.boardChannelId}> pour voir le résultat.`;
  if (move.joueur.a_le_droit_de_jouer) text += "\n\n🎯 **Ton déplacement précédent est terminé !** Tu peux maintenant relancer la commande `/jouer` pour effectuer ton action d'aujourd'hui !";
  await editGameReply(target, { content: text });
}
const continuing = (actor: turn.Actor, move: turn.MoveOutcome) =>
  move.walked > 0 ? `🚶 **<@${actor.id}>** continue de ${move.walked} case(s)` : `📍 **<@${actor.id}>** reprend sur sa case`;

/** The interaction token stays usable 15 minutes; past that, the prompt is reachable through /jouer. */
async function followUpSafely(target: GameComponent | null, content: string): Promise<void> {
  if (!target) return;
  try { await editGameReply(target, { content }); }
  catch (error) { console.warn('[WARN] Message privé d’expiration non distribué :', error); }
}

async function expire(client: Client, actor: turn.Actor, token: string, target: GameComponent | null): Promise<void> {
  const expired = await turn.expirePending(actor, token);
  if (!expired) return;
  const messages: Record<MarioStop, string> = {
    etoile: `⏰ **<@${actor.id}>** a hésité trop longtemps devant l'Étoile ! Son tour continue automatiquement.`,
    boutique: `⏰ **<@${actor.id}>** a hésité trop longtemps devant la Boutique ! Son tour continue automatiquement.`,
    boo: `👻 **<@${actor.id}>** a mis trop de temps à réfléchir... Boo est reparti les mains vides !`,
    intersection: `⏰ **<@${actor.id}>** a bêtement foncé tout droit à l'intersection !`,
  };
  await announce(client, messages[expired.type]);
  await followUpSafely(target, '⏰ Temps écoulé : le choix par défaut a été appliqué.');
  await present(client, actor, expired.move, continuing(actor, expired.move), target);
}

async function showInventory(i: GameComponent): Promise<void> {
  const joueur = await Joueur.findByPk(i.user.id);
  const plateau = await Plateau.findByPk(1);
  if (!joueur || !joueur.inventaire.length) throw new GameRuleError('EMPTY', 'Ton inventaire est vide.');
  if (!plateau) throw new GameRuleError('CLOSED', 'Aucune partie en cours.');
  const row = new ActionRowBuilder<ButtonBuilder>();
  joueur.inventaire.forEach((name, index) => {
    const key = Object.keys(ITEMS).find(k => itemByKey(k).name === name);
    if (key && !itemByKey(key).passive) row.addComponents(button(ids.use.encode({ key, index }), name, ButtonStyle.Primary));
  });
  if (!row.components.length) throw new GameRuleError('PASSIVE', "Aucun de tes objets ne s'utilise manuellement.");
  await editGameReply(i, { content: `**Ton inventaire :**\nTu es sur la case **${joueur.position}**. L'Étoile est sur la case **${plateau.position_etoile}**.\nQuel objet veux-tu utiliser ?`, components: [row] });
}

async function handle(i: GameComponent): Promise<boolean> {
  const id = i.customId;
  const actor = actorOf(i);
  if (id === 'lancer_de') {
    const { de, move } = await turn.startTurn(actor);
    await editGameReply(i, { components: [] });
    await present(i.client, actor, move, `🎲 **<@${actor.id}>** a fait un **${de}**`, i);
  } else if (id === 'continuer_deplacement') {
    const move = await turn.continueTurn(actor);
    await editGameReply(i, { components: [] });
    await present(i.client, actor, move, continuing(actor, move), i);
  } else if (id === 'acheter_etoile' || id === 'passer_etoile') {
    const result = await turn.resolveStar(actor, id === 'acheter_etoile');
    await editGameReply(i, { content: result.bought ? '⭐ **Bravo !** Tu as acheté une Étoile !' : "Tu as passé ton tour pour l'Étoile.", components: [] });
    if (result.bought) await announce(i.client, `⭐ **Bravo !** <@${actor.id}> a acheté une Étoile ! 🌟 L'Étoile s'envole vers la case ${result.newStar} !`);
    await present(i.client, actor, result.move, continuing(actor, result.move), i);
  } else if (id === 'buy_cancel') {
    const { move } = await turn.leaveShop(actor);
    await editGameReply(i, { content: `Tu as quitté la boutique${move.walked > 0 ? ', en route !' : '.'}`, components: [] });
    await present(i.client, actor, move, continuing(actor, move), i);
  } else if (id.startsWith('buy_') || (i.isStringSelectMenu() && id.startsWith('replace_buy_'))) {
    const replacing = id.startsWith('replace_buy_');
    const itemId = replacing ? ids.replaceBuy.decode(id) : ids.buy.decode(id);
    const index = replacing && i.isStringSelectMenu() ? numericChoice(selectedValue(i.values)) : undefined;
    const { purchase, move } = await turn.buyFromShop(actor, itemId, index);
    if (purchase.kind === 'needs_replacement') {
      const joueur = await Joueur.findByPk(actor.id);
      const options = (joueur?.inventaire ?? []).map((name, slot) => ({ label: `Jeter l'objet ${slot + 1}: ${name}`, value: String(slot) }));
      await editGameReply(i, {
        content: `Ton inventaire est plein ! Quel objet veux-tu jeter pour acheter **${purchase.item.name}** (${purchase.item.price} pièces) ?`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(ids.replaceBuy.encode(purchase.item.id)).setPlaceholder('Choisir un objet à jeter').addOptions(options)),
          new ActionRowBuilder<ButtonBuilder>().addComponents(button('buy_cancel', "Annuler l'achat", ButtonStyle.Danger)),
        ],
      });
      return true;
    }
    if (!move) throw new Error('Achat validé sans reprise du déplacement');
    const dropped = purchase.droppedItem ? `jeté **${purchase.droppedItem}** et ` : '';
    await editGameReply(i, { content: `🛒 Tu as ${dropped}acheté **${purchase.item.name}** ! Il te reste **${move.joueur.pieces} pièces**.`, components: [] });
    await present(i.client, actor, move, continuing(actor, move), i);
  } else if (id === 'boo_pieces' || id === 'boo_etoile') {
    const type = id === 'boo_pieces' ? 'pieces' : 'etoile';
    const targets = await turn.booTargets(actor, type);
    if (!targets.length) throw new GameRuleError('NO_TARGET', `Personne n'a de ${type} à voler !`);
    // Discord limits StringSelectMenu to 25 options; prioritize the richest targets.
    const topTargets = [...targets].sort((a, b) => (type === 'pieces' ? b.pieces - a.pieces : b.etoiles - a.etoiles)).slice(0, 25);
    await afterGameAction(async () => {
      const options = await Promise.all(topTargets.map(async t => {
        let name = `Joueur ${t.discord_id.substring(0, 5)}`;
        try { name = (await i.client.users.fetch(t.discord_id)).username; }
        catch (error) { console.warn(`[WARN] Nom indisponible pour ${t.discord_id} :`, error); }
        return { label: `${name} (${type === 'pieces' ? `${t.pieces} pièces` : `${t.etoiles} étoiles`})`.slice(0, 100), value: t.discord_id };
      }));
      await editGameReply(i, { content: 'Qui veux-tu voler ?',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`boo_target_${type}`).setPlaceholder('Choisis ta cible').addOptions(options))] });
    });
  } else if (id === 'boo_annuler') {
    const { move } = await turn.booPass(actor);
    await editGameReply(i, { content: 'Boo s\'en est allé.', components: [] });
    await announce(i.client, `👻 <@${actor.id}> a ignoré l'invitation de Boo... le fantôme s'en va, déçu.`);
    await present(i.client, actor, move, continuing(actor, move), i);
  } else if (i.isStringSelectMenu() && id.startsWith('boo_target_')) {
    const type = id.slice('boo_target_'.length);
    const result = await turn.booSteal(actor, selectedValue(i.values), type);
    await editGameReply(i, { content: 'Vol effectué !', components: [] });
    await announce(i.client, type === 'pieces'
      ? `👻 **Boo !** <@${actor.id}> a volé ${result.amount} pièces à <@${result.cible.discord_id}> !`
      : `👻 **Boo !** <@${actor.id}> a payé ${BOO_STAR_PRICE} pièces pour voler une Étoile à <@${result.cible.discord_id}> !`);
    await present(i.client, actor, result.move, continuing(actor, result.move), i);
  } else if (id.startsWith('choix_direction_')) {
    const path = ids.direction.decode(id);
    const { move } = await turn.chooseDirection(actor, path);
    await editGameReply(i, { content: `✅ Tu as choisi le chemin ${path} !`, components: [] });
    await present(i.client, actor, move, continuing(actor, move), i);
  } else if (id === 'utiliser_objet') {
    await showInventory(i);
  } else if (id.startsWith('use_')) {
    const { key, index } = ids.use.decode(id);
    if (key === 'DE_PIPE') {
      const select = new StringSelectMenuBuilder().setCustomId(ids.pipe.encode(index)).setPlaceholder('Choisis la valeur de ton dé')
        .addOptions(Array.from({ length: 10 }, (_, n) => ({ label: String(n + 1), value: String(n + 1) })));
      await editGameReply(i, { content: 'Tu vas utiliser le **Dé pipé** ! Quelle valeur veux-tu ?', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
      return true;
    }
    await useItem(i, actor, key, index, null);
  } else if (i.isStringSelectMenu() && id.startsWith('de_pipe_choix_')) {
    await useItem(i, actor, 'DE_PIPE', ids.pipe.decode(id), numericChoice(selectedValue(i.values)));
  } else if (id === 'unblock_fantome') {
    const unblocked = await turn.unblockGhost(actor.id);
    await editGameReply(i, { components: [], content: unblocked
      ? "🔓 Tu as utilisé ton déblocage unique pour cette partie de 30 tours ! Tu n'es plus en mode fantôme. Utilise à nouveau /jouer pour jouer."
      : 'Tu ne peux pas te débloquer.' });
  } else return false;
  return true;
}

async function useItem(i: GameComponent, actor: turn.Actor, key: string, index: number, pipeValue: number | null): Promise<void> {
  const used = await turn.useItem(actor, key, index, pipeValue);
  await editGameReply(i, { components: [] });
  const text = formatItemUse(used);
  await editGameReply(i, { content: text.privateText });
  if (text.publicText) await announce(i.client, text.publicText);
}

async function resolveUsername(client: Client, userId: string): Promise<string> {
  try { return (await client.users?.fetch(userId))?.username ?? `<@${userId}>`; }
  catch { return `<@${userId}>`; }
}

export const interactions: ModeInteractions = {
  handle,
  renderPending(joueur, plateau) {
    const pending = marioPending(joueur.action_en_attente);
    if (!pending || pending.case !== joueur.position) return null;
    return promptFor(pending.type, joueur, plateau);
  },
  async rearmTimers(client) {
    for (const joueur of await Joueur.findAll({ where: { action_en_attente: { [Op.ne]: null } } })) {
      const pending = marioPending(joueur.action_en_attente);
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
