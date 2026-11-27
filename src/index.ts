import fs from 'node:fs';
import path from 'node:path';
import { Client, Collection, Events, GatewayIntentBits, Options } from 'discord.js';
import { Plateau, sequelize } from './db/models';
import { migrate } from './db/migrations';
import { handleInteraction } from './discord/interaction';
import { Command, CommandRegistry, commandEnabled, createDispatcher } from './discord/router';
import { clearAllPendingTimers } from './discord/pending-timers';
import { initCronJobs, publishHint, stopCronJobs } from './game/cron';
import { triggerEnigmaEnd } from './game/enigma';
import { drainGameQueue, withScheduledLock } from './game/transaction';
import { getActiveInteractions } from './gamemodes/registry';
import { gameNow } from './utils/clock';
import { startKumaHeartbeat, stopKumaHeartbeat } from './utils/health';
import { parisClock } from './utils/time';
import config = require('./config');

declare module 'discord.js' {
  interface Client { commands: CommandRegistry }
}

const MAX_TIMEOUT_MS = 2_147_483_647;
let restartEnigmaTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

process.on('unhandledRejection', error => console.error('[ERROR] Promesse rejetée non interceptée :', error));
process.on('uncaughtException', error => {
  console.error('[ERROR] Exception fatale :', error);
  process.exit(1);
});

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 20, ThreadManager: 10, PresenceManager: 0, VoiceStateManager: 0, ReactionManager: 10, GuildMemberManager: 50, UserManager: 50,
  }),
  rest: { timeout: 60000 },
});

client.commands = new Collection<string, Command>();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(name => name.endsWith('.js'))) {
  const command: Partial<Command> = require(path.join(commandsPath, file));
  if (!command.data || !command.execute) throw new Error(`Commande invalide : ${file}`);
  if (!commandEnabled(command)) continue;
  client.commands.set(command.data.name, command as Command);
}

client.on(Events.Error, error => console.error('[ERROR] Client Discord :', error));
client.on(Events.ShardError, error => console.error('[ERROR] Shard Discord :', error));
client.on(Events.ShardDisconnect, () => console.warn('[WARN] Déconnecté de Discord, reconnexion en cours...'));
client.on(Events.ShardReconnecting, () => console.warn('[WARN] Reconnexion à Discord...'));
client.on(Events.ShardResume, () => console.log('[HEALTH] Connexion Discord reprise.'));

/** After a restart: close an overdue enigma, publish missed hints and re-arm the timers of pending choices. */
async function resumeAfterRestart(): Promise<void> {
  const plateau = await withScheduledLock('restart', async () => {
    let board = await Plateau.findByPk(1);
    if (!board) board = await Plateau.create({ id: 1, position_etoile: 1, pieges_actifs: [] });
    await getActiveInteractions(board).rearmTimers(client);
    return board;
  });
  if (plateau.enigme_status !== 'active' || !plateau.fin_enigme_timestamp) return;
  const remaining = Number(plateau.fin_enigme_timestamp) - gameNow().getTime();
  if (remaining <= 0) {
    console.log("[CRON] Redémarrage : l'énigme aurait dû se clôturer, clôture immédiate.");
    await withScheduledLock('restart', () => triggerEnigmaEnd(client));
    return;
  }
  console.log(`[CRON] Redémarrage : fin de l'énigme dans ${Math.floor(remaining / 60000)} minutes.`);
  if (restartEnigmaTimer) clearTimeout(restartEnigmaTimer);
  restartEnigmaTimer = setTimeout(() => {
    restartEnigmaTimer = null;
    withScheduledLock('restart', () => triggerEnigmaEnd(client)).catch(error => console.error("[ERROR] Clôture de l'énigme :", error));
  }, Math.min(remaining, MAX_TIMEOUT_MS));
  restartEnigmaTimer.unref();
  const { hour } = parisClock();
  for (const index of [1, 2, 3] as const) {
    if (hour >= 17 + index) await withScheduledLock('restart', () => publishHint(client, index));
  }
}

const dispatch = createDispatcher(client.commands);
let interactionsBound = false;
function bindInteractions(): void {
  if (interactionsBound) return;
  interactionsBound = true;
  client.on(Events.InteractionCreate, interaction => {
    const name = interaction.isCommand() ? interaction.commandName : 'customId' in interaction ? interaction.customId : String(interaction.type);
    console.log(`[INTERACTION] ${interaction.user.id} - ${name}`);
    handleInteraction(interaction, dispatch).catch(error => console.error('[ERROR] Routage Discord :', error));
  });
}

client.once(Events.ClientReady, async ready => {
  console.log(`[HEALTH] Prêt ! Connecté en tant que ${ready.user.tag}`);
  try {
    await resumeAfterRestart();
    initCronJobs(client);
    startKumaHeartbeat(client);
    bindInteractions();
  } catch (error) {
    console.error('[ERROR] Initialisation après connexion :', error);
  }
});

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[HEALTH] ${signal} reçu, arrêt propre...`);
  stopKumaHeartbeat();
  stopCronJobs();
  clearAllPendingTimers();
  if (restartEnigmaTimer) { clearTimeout(restartEnigmaTimer); restartEnigmaTimer = null; }
  drainGameQueue()
    .then(() => client.destroy())
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[ERROR] Arrêt :', error);
      process.exit(1);
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export async function start(): Promise<void> {
  config.validateConfig();
  await migrate(sequelize);
  await client.login(config.token);
}
if (require.main === module) start().catch(error => {
  console.error('[ERROR] Démarrage impossible :', error);
  process.exitCode = 1;
  void client.destroy();
  void sequelize.close();
});
