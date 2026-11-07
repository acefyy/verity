import { config, validateConfig } from './config.js';
import { createDiscordClient } from './discord/client.js';
import { db } from './db/database.js';
import { runInvestigation } from './investigation/orchestrator.js';

async function bootstrap() {
  console.log('--- Starting Verity (Discord & Switch Multi-Agent Moderation) ---');
  validateConfig();

  if (!config.discordToken) {
    console.log('[Verity] No DISCORD_TOKEN found. Standalone mode ready for tests.');
    return;
  }

  // Initialize and connect Discord Bot
  const client = createDiscordClient();
  await client.login(config.discordToken);

  // Resume any reports submitted previously that are awaiting investigation
  try {
    const pendingReports = db.getPendingReports();
    if (pendingReports.length > 0) {
      console.log(`[Verity] Found ${pendingReports.length} pending report(s). Launching investigations...`);
      for (const report of pendingReports) {
        if (report.discordThreadId) {
          try {
            const channel = await client.channels.fetch(report.discordThreadId);
            if (channel && channel.isThread()) {
              console.log(`[Verity] Resuming multi-agent investigation for ${report.reportCode}...`);
              runInvestigation({ report, thread: channel, client }).catch((err) => {
                console.error(`[Verity] Error resuming investigation for ${report.reportCode}:`, err);
              });
            }
          } catch (threadErr: any) {
            console.warn(`[Verity] Could not fetch thread ${report.discordThreadId} for report ${report.reportCode}: ${threadErr?.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[Verity] Error checking pending reports on startup:`, err);
  }
}

bootstrap().catch((err) => {
  console.error('[Verity] Fatal bootstrap error:', err);
  process.exit(1);
});
