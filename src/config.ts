import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  reportsChannelId: string;
  databasePath: string;

  // Switch Platform Integration
  switchApiUrl: string;
  switchAdminEmail: string;
  switchAdminPassword: string;
  switchAgentTriageId: string;
  switchAgentInvestigatorId: string;
  switchAgentAdvisorId: string;
}

export const config: Config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID,
  reportsChannelId: process.env.DISCORD_REPORTS_CHANNEL_ID || '',
  databasePath: process.env.DATABASE_PATH || './verity.db',

  // Switch Gateway & Configured Agent IDs
  switchApiUrl: process.env.SWITCH_API_URL || 'http://localhost:58014/gateway',
  switchAdminEmail: process.env.SWITCH_ADMIN_EMAIL || 'admin@switch.local',
  switchAdminPassword: process.env.SWITCH_ADMIN_PASSWORD || 'Rpj9Wf2ozBA0cyg2XHLwBIxhLGkBICL3',
  switchAgentTriageId: process.env.SWITCH_AGENT_TRIAGE_ID || '7839ce54-ba74-4ccf-89d3-dd56412ff843',
  switchAgentInvestigatorId: process.env.SWITCH_AGENT_INVESTIGATOR_ID || '9f7e0e8f-c00b-4734-b25d-473b06513c10',
  switchAgentAdvisorId: process.env.SWITCH_AGENT_ADVISOR_ID || '9646eee2-cea5-436e-9aba-8a3a2040b1d7'
};

export function validateConfig(cfg: Config = config): void {
  const missing: string[] = [];
  if (!cfg.discordToken) missing.push('DISCORD_TOKEN');
  if (!cfg.discordClientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    console.warn(`[Config] Notice: Missing environment variables: ${missing.join(', ')}. Set these in .env for live Discord bot operation.`);
  }
}
