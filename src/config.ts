import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  reportsChannelId: string;
  databasePath: string;
}

export const config: Config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID,
  reportsChannelId: process.env.DISCORD_REPORTS_CHANNEL_ID || '',
  databasePath: process.env.DATABASE_PATH || './verity.db'
};

export function validateConfig(cfg: Config = config): void {
  const missing: string[] = [];
  if (!cfg.discordToken) missing.push('DISCORD_TOKEN');
  if (!cfg.discordClientId) missing.push('DISCORD_CLIENT_ID');
  if (!cfg.reportsChannelId) missing.push('DISCORD_REPORTS_CHANNEL_ID');

  if (missing.length > 0) {
    console.warn(`[Config] Notice: Missing environment variables: ${missing.join(', ')}. Set these in .env for live Discord bot operation.`);
  }
}
