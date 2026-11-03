import { config, validateConfig } from './config.js';
import { createDiscordClient } from './discord/client.js';
import { registerCommands } from './discord/registerCommands.js';

async function bootstrap() {
  console.log('--- Starting Verity (Discord Report Intake Milestone) ---');
  validateConfig();

  if (!config.discordToken) {
    console.log('[Verity] No DISCORD_TOKEN found. Standalone mode ready for tests.');
    return;
  }

  // Register Context Menu command
  await registerCommands();

  // Initialize and connect Discord Bot
  const client = createDiscordClient();
  await client.login(config.discordToken);
}

bootstrap().catch((err) => {
  console.error('[Verity] Fatal bootstrap error:', err);
  process.exit(1);
});
