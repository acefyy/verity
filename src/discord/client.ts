import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { handleReportContextMenu } from './interactions/contextMenuHandler.js';
import {
  handleReportModalSubmit,
  handleActionEvidenceModalSubmit
} from './interactions/modalSubmitHandler.js';
import { handleActionButton } from './interactions/actionButtonHandler.js';
import {
  handleSettingsCommand,
  handleSettingsModalSubmit
} from './interactions/settingsHandler.js';

export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
    ]
  });

  client.on(Events.ClientReady, (readyClient) => {
    console.log(`[Verity] Discord bot online as ${readyClient.user.tag}`);
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
        } else if (interaction.customId.startsWith('verity:modal:action_evidence:')) {
          await handleActionEvidenceModalSubmit(interaction);
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
          flags: MessageFlags.Ephemeral
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
