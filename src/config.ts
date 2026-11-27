import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import { projectRoot } from './runtime/paths';
const envLocalPath = path.join(projectRoot, '.env.local');
const envPath = path.join(projectRoot, '.env');

if (process.env.NODE_ENV !== 'test' && fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
}
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: envPath });

const config = {
    validateConfig,
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
    guildId: process.env.GUILD_ID || process.env.DISCORD_GUILD_ID,
    enigmaChannelId: process.env.ENIGMA_CHANNEL_ID,
    boardChannelId: process.env.BOARD_CHANNEL_ID,
    mjUserId: process.env.MJ_USER_ID,
    roleEnigmeId: process.env.ROLE_ENIGME_ID,
    // Optional Discord role given to the season winner (configured per instance).
    winnerRoleId: process.env.WINNER_ROLE_ID || '',
    kumaPushUrl: process.env.KUMA_PUSH_URL || null,
    kumaPushIntervalSec: Number(process.env.KUMA_PUSH_INTERVAL_SEC || '60'),
    kumaMaxFailures: Number(process.env.KUMA_MAX_FAILURES || '3'),
    // Dev bot only: registers /dev (cron steps, virtual clock). Never set in production.
    devMode: process.env.DEV_MODE === '1',
};

function validateConfig(): void {
  for (const key of ['token', 'clientId', 'guildId', 'enigmaChannelId', 'boardChannelId', 'mjUserId'] as const) {
    if (!config[key]) throw new Error(`Configuration manquante : ${key}`);
  }
  if (!Number.isInteger(config.kumaPushIntervalSec) || config.kumaPushIntervalSec <= 0 || !Number.isInteger(config.kumaMaxFailures) || config.kumaMaxFailures <= 0) throw new Error('Configuration de surveillance invalide');
  if (config.kumaPushUrl) {
    try { new URL(config.kumaPushUrl); }
    catch { throw new Error('Configuration de surveillance invalide : KUMA_PUSH_URL'); }
  }
}
export = config;
