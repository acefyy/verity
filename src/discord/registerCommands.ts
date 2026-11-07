import { REST, Routes } from 'discord.js';
import { reportCommandData } from './commands/reportCommand.js';
import { settingsCommandData } from './commands/settingsCommand.js';
import { config } from '../config.js';

/**
 * Registers Verity application commands ("Report Message", "/settings")
 * directly as server (guild) commands when the bot joins or initializes in a server.
 */
export async function registerGuildCommands(guildId: string): Promise<void> {
  if (!config.discordToken || !config.discordClientId) {
    console.warn('[Verity] Cannot register server commands: Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.');
    return;
  }

  if (!guildId) {
    console.warn('[Verity] Cannot register server commands: No guildId provided.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const commands = [reportCommandData, settingsCommandData];

  try {
    console.log(`[Verity] Registering server commands ("Report Message", "/settings") to guild ${guildId}...`);

    try {
      const existing = (await rest.get(
        Routes.applicationGuildCommands(config.discordClientId, guildId)
      )) as any[];

      const verityNames = new Set(commands.map((c) => c.name));
      const otherCommands = Array.isArray(existing)
        ? existing.filter((c) => !verityNames.has(c.name))
        : [];

      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, guildId),
        { body: [...otherCommands, ...commands] }
      );
      console.log(`[Verity] Successfully registered server commands to guild ${guildId}.`);
    } catch {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, guildId),
        { body: commands }
      );
      console.log(`[Verity] Successfully registered server commands to guild ${guildId}.`);
    }
  } catch (err: any) {
    console.error(`[Verity] Failed to register server commands to guild ${guildId}:`, err?.message || err);
  }
}

/**
 * Backward compatibility wrapper.
 */
export async function registerCommands(targetGuildId?: string): Promise<void> {
  const guildId = targetGuildId || config.discordGuildId;
  if (guildId) {
    await registerGuildCommands(guildId);
  }
}
