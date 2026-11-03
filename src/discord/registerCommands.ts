import { REST, Routes } from 'discord.js';
import { reportCommandData } from './commands/reportCommand.js';
import { config } from '../config.js';

export async function registerCommands(): Promise<void> {
  if (!config.discordToken || !config.discordClientId) {
    console.warn('[Verity] Cannot register slash/context commands: Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  try {
    console.log('[Verity] Registering Discord context menu command ("Report Message")...');

    if (config.discordGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        { body: [reportCommandData] }
      );
      console.log(`[Verity] Successfully registered context menu command to guild ${config.discordGuildId}.`);
    } else {
      await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: [reportCommandData] }
      );
      console.log('[Verity] Successfully registered global context menu command.');
    }
  } catch (err) {
    console.error('[Verity] Failed to register context menu command:', err);
  }
}
