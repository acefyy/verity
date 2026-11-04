import { REST, Routes } from 'discord.js';
import { reportCommandData } from './commands/reportCommand.js';
import { settingsCommandData } from './commands/settingsCommand.js';
import { config } from '../config.js';

export async function registerCommands(): Promise<void> {
  if (!config.discordToken || !config.discordClientId) {
    console.warn('[Verity] Cannot register slash/context commands: Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const commands = [reportCommandData, settingsCommandData];

  try {
    console.log('[Verity] Registering Discord application commands ("Report Message", "/settings")...');

    if (config.discordGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        { body: commands }
      );
      console.log(`[Verity] Successfully registered application commands to guild ${config.discordGuildId}.`);
    } else {
      await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: commands }
      );
      console.log('[Verity] Successfully registered global application commands.');
    }
  } catch (err) {
    console.error('[Verity] Failed to register application commands:', err);
  }
}
