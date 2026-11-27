import fs from 'node:fs';
import path from 'node:path';
import { REST, Routes } from 'discord.js';
import config = require('./src/config');
import { Command, commandEnabled } from './src/discord/router';

async function deploy(): Promise<void> {
  if (!config.token || !config.clientId || !config.guildId) throw new Error('DISCORD_TOKEN, CLIENT_ID et GUILD_ID sont requis.');
  const commandsPath = path.join(__dirname, 'src', 'commands');
  const commands = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))
    .map(file => {
      const command = require(path.join(commandsPath, file)) as Partial<Command>;
      if (!command.data || !command.execute) throw new Error(`Commande invalide : ${file}`);
      return command as Command;
    })
    .filter(commandEnabled)
    .map(command => command.data.toJSON());
  console.log(`[ADMIN] Rafraîchissement de ${commands.length} commandes (/).`);
  const data = await new REST({ version: '10' }).setToken(config.token)
    .put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands }) as unknown[];
  console.log(`[ADMIN] ${data.length} commandes (/) enregistrées.`);
}
deploy().catch(error => {
  console.error('[ERROR] Enregistrement des commandes impossible :', error);
  process.exitCode = 1;
});
