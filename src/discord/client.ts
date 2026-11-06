import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { handleReportContextMenu } from './interactions/contextMenuHandler.js';
import {
  handleReportModalSubmit,
  handleTakeActionModalSubmit
} from './interactions/modalSubmitHandler.js';
import { handleActionButton } from './interactions/actionButtonHandler.js';
import {
  handleSettingsCommand,
  handleSettingsModalSubmit
} from './interactions/settingsHandler.js';
import { handleThreadMessage } from './interactions/threadQAHandler.js';
import { setupGuildReportsChannel } from './guildSetup.js';

export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.on(Events.ClientReady, async (readyClient) => {
    console.log(`[Verity] Discord bot online as ${readyClient.user.tag}`);
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await setupGuildReportsChannel(guild);
      } catch (err) {
        console.error(`[Verity] Failed to initialize report channel for guild ${guild.id}:`, err);
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    console.log(`[Verity] Joined new guild: ${guild.name} (${guild.id}). Auto-provisioning report channel...`);
    try {
      await setupGuildReportsChannel(guild);
    } catch (err) {
      console.error(`[Verity] Failed to auto-create report channel on guild join for ${guild.id}:`, err);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleThreadMessage(message);
    } catch (err) {
      console.error('[Verity] Error handling thread message:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'settings') {
          await handleSettingsCommand(interaction);
        }
      } else if (interaction.isMessageContextMenuCommand()) {
        if (interaction.commandName === 'Report Message') {
          await handleReportContextMenu(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('verity:modal:report:')) {
          await handleReportModalSubmit(interaction);
        } else if (interaction.customId === 'verity:modal:settings') {
          await handleSettingsModalSubmit(interaction);
        } else if (interaction.customId.startsWith('verity:modal:take_action:')) {
          await handleTakeActionModalSubmit(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('verity:act:')) {
          await handleActionButton(interaction);
        }
      }
    } catch (err) {
      console.error('[Verity] Error handling interaction:', err);
      if (interaction.isRepliable()) {
        const errorMsg = {
          content: '❌ An unexpected error occurred while processing this interaction.',
          ephemeral: true
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMsg).catch(() => {});
        } else {
          await interaction.reply(errorMsg).catch(() => {});
        }
      }
    }
  });

  return client;
}
