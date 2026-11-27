import { editReply } from '../discord/replies';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('documentation')
  .setDescription('Affiche les règles complètes et le fonctionnement du jeu.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embedRegles = new EmbedBuilder()
    .setTitle('📖 Concept & Règles de base')
    .setColor('#3498db')
    .setDescription(`Le but du jeu est de récolter le plus d'**Étoiles ⭐** (les pièces 🪙 servent à départager en cas d'égalité).\n\n` +
    `**1. L'Énigme du jour (17h-21h)**\n` +
    `En semaine, l'énigme est publiée à **17h** et reste ouverte jusqu'à **21h**. Des indices sont publiés automatiquement à **18h**, **19h** et **20h**. Utilise \`/deviner [mot]\` pour proposer une réponse au MJ. Chaque participation rapporte **1 pièce** (max 3/jour), toutes les 30 minutes. Les récompenses sont dégressives : **10 pièces** (17h-18h), **7 pièces** (18h-19h), **4 pièces** (19h-20h), **2 pièces** (20h-21h). Le plateau est verrouillé pendant l'énigme et rouvre à 21h jusqu'à 17h le lendemain. Un joueur qui a trouvé ne peut plus deviner.\n\n` +
    `**2. Jouer sur le plateau**\n` +
    `Tu as le droit à **1 lancer de dé par jour**. Le plateau est ouvert de **21h à 16h59** le lendemain. Tu pourras lancer un dé (1 à 10) et avancer sur le plateau. Garde l'œil ouvert, certaines intersections demandent de choisir son chemin !\n\n` +
    `**3. L'Étoile, la Boutique et Boo (Passer devant)**\n` +
    `L'Étoile se trouve sur une case du plateau. Si tu **passes devant** ou t'arrêtes dessus, ton déplacement se met en pause. Tu peux l'acheter pour **20 pièces**. Ensuite, tu continues d'avancer. Même chose pour la Boutique ou le fantôme Boo ! Mieux encore : Certaines Zones Bonus sont verrouillées derrière un portail doré (case 46, 55), il te faudra posséder la Clé !
    **4. Mode Fantôme 👻**
    Si tu es inactif pendant 3 tours, tu passes en *Mode Fantôme*. Tu deviens immunisé aux interactions aléatoires et tu es bloqué sur ta case. Tu as un unique Joker pour te réveiller lors de ta prochaine connexion, mais au sommeil suivant, c'est l'élimination définitive !\n\n` +
    `**5. Étoiles Bonus 🌟**\n` +
    `À la fin de la partie (tour 30), juste avant l'annonce du podium, **2 étoiles bonus** sont décernées aléatoirement et révélées une par une parmi 6 catégories : Chance, Malchance, Avancée Max, Avancée Min, Énigmes résolues et Objets utilisés. Seuls les joueurs actifs (non fantômes) ayant un score > 0 sont éligibles aux étoiles bonus et au podium ; en cas d'égalité, les ex-æquo actifs partagent l'étoile (+1 ⭐ chacun) !\n\n` +
    `**6. Les Blocs Cachés 🤫**\n` +
    `Dès le début de la partie, **4 Blocs Cachés** sont répartis furtivement et aléatoirement sur le plateau. Ils sont invisibles ! Si vous atterrissez par chance sur l'une de ces cases, vous révélerez son contenu ! Il y a un bloc avec **1 Étoile**, un bloc avec **20 pièces**, un avec **10 pièces**, et un avec **5 pièces**.`);

    const embedCases = new EmbedBuilder()
    .setTitle('🗺️ Les Cases du Plateau')
    .setColor('#2ecc71')
    .setDescription(
    `🟩 **Verte / Départ** : Case neutre.\n` +
    `🟦 **Bleue** : +3 pièces (passe à **+6 pièces** dans les 5 derniers tours).\n` +
    `🟥 **Rouge** : -3 pièces (passe à **-6 pièces** dans les 5 derniers tours).\n` +
    `🍀 **Chance** : Bonus aléatoire (pièces, objet, vol, sac plein).\n` +
    `🌩️ **Malchance** : Malus aléatoire (perte de pièces, objet, dé limité, TP Bowser).\n` +
    `👻 **Boo** : Permet de voler des pièces (gratuit) ou une Étoile (coûte 50 pièces) à un autre joueur. *(Il suffit de passer devant)*\n` +
    `🔥 **Bowser** : Événement catastrophique (perte de moitié des pièces, perte d'étoile, révolution communiste, etc.). *(Il faut atterrir pile dessus)*\n` +
    `🎭 **Coup du Sort** : Événement global aléatoire (échange de places, loterie, duel de dés, etc.).\n` +
    `🛒 **Boutique** : Permet d'acheter des objets avec tes pièces. *(Fermée lors du dernier tour)*`);

    const embedObjets = new EmbedBuilder()
    .setTitle('🎒 Les Objets')
    .setColor('#e67e22')
    .setDescription(
    `Tu peux avoir maximum **3 objets** dans ton inventaire. Tu peux en utiliser un avant de lancer ton dé.\n\n` +
    `🍄 **Champignon** (5p) : +3 au prochain lancer.\n` +
    `💰 **Piège à pièces** (5p) : Vole 10 pièces au prochain marcheur.\n` +
    `🧪 **Tuyau** (8p) : Téléportation aléatoire.\n` +
    `🎯 **Dé Pipé** (10p) : Choisis le résultat de ton dé (1 à 10).\n` +
    `🎲 **Double Dé** (12p) : Lance 2 dés (2 à 20).\n` +
    `🔑 **Clé** (5p) : Déverrouille les accès aux Zones Bonus dorées.\n` +
    `🪞 **Miroir** (15p) : Échange ta position avec un joueur aléatoire.\n` +
    `🎺 **Sifflet** (15p) : Déplace l'Étoile sur une autre case.\n\n` +
    `*Objets exclusifs du Marché Noir (Dimanche) :*\n` +
    `🎲 **Dé Triple** (20p) : Lance 3 dés (3 à 30).\n` +
    `🏆 **Tuyau Doré** (25p) : Téléportation juste devant l'Étoile.\n` +
    `🌟 **Piège à Étoile** (30p) : Vole 1 Étoile au prochain marcheur.\n` +
    `🎁 **Packs Promo** (15p/25p) : Contient 2 objets.`);

    const embedEvents = new EmbedBuilder()
    .setTitle('📅 Événements Spéciaux')
    .setColor('#9b59b6')
    .setDescription(
    `🧩 **En semaine (Lun-Ven) — Énigme**\n` +
    `L'énigme est publiée à **17h** avec des indices à **18h**, **19h** et **20h**. Le plateau est verrouillé de 17h à 21h. À **21h**, l'énigme se clôture et le plateau rouvre jusqu'à 17h le lendemain. Les récompenses dépendent de l'heure de la bonne réponse (10/7/4/2 pièces).\n\n` +
    `🎰 **Samedi (Les Paris)**\n` +
    `Le samedi, il n'y a pas d'énigme ni de lancer de dé. À la place, tu peux parier tes pièces sur une course de Yoshis ! Le système fonctionne comme les prédictions Twitch : tu mises sur un Yoshi, et si ton Yoshi gagne, tu remportes une part du pot total proportionnelle à ta mise. (Mise max : 30 pièces. Un ticket gratuit de 3 pièces est offert à tous !)\n\n` +
    `🏴‍☠️ **Dimanche (Marché Noir)**\n` +
    `Le dimanche, il n'y a pas d'énigme. La boutique classique est remplacée par le Marché Noir. Tu y trouveras des objets exclusifs et surpuissants (Tuyau Doré, Dé Triple, Piège à Étoile, Packs de 2 objets).`);

    const embedCommands = new EmbedBuilder()
    .setTitle('💻 Commandes Utilisateurs')
    .setColor('#f1c40f')
    .setDescription(
    `Voici la liste des commandes que tu peux utiliser pour jouer !\n\n` +
    `**\`/jouer\`**\n` +
    `Ouvre ton menu privé (éphémère). C'est depuis ce menu que tu peux lancer ton dé, voir ton inventaire, utiliser un objet, voir le plateau de près et ton classement ! C'est la commande principale du jeu.\n\n` +
    `**\`/deviner [réponse]\`**\n` +
    `Sers-toi de cette commande pour répondre à l'énigme du jour ! Chaque tentative te rapporte 1 pièce de participation (max **3 / jour**). Tu peux proposer un mot toutes les 30 minutes. Les récompenses diminuent au fil de la soirée (10/7/4/2 pièces selon la tranche horaire).\n\n` +
    `**\`/stats\`**\n` +
    `Affiche le classement de la saison : pièces, étoiles, position sur le plateau et inventaire de chaque joueur.\n\n` +
    `**\`/plateau\`**\n` +
    `Affiche la carte complète du plateau (navigation par zone sur l'Île aux défis).\n\n` +
    `**\`/settings\`**\n` +
    `Active ou désactive tes rappels automatiques en MP.\n\n` +
    `**\`/documentation\`**\n` +
    `Affiche ce message avec toutes les règles du jeu !`);

    await editReply(interaction, { embeds: [embedRegles, embedCases, embedObjets, embedEvents, embedCommands] });
}
