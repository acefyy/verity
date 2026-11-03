import { Client, GatewayIntentBits, Events } from 'discord.js';
import { handleReportContextMenu } from './interactions/contextMenuHandler.js';
import { handleReportModalSubmit } from './interactions/modalSubmitHandler.js';

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
      if (interaction.isMessageContextMenuCommand()) {
        if (interaction.commandName === 'Report Message') {
          await handleReportContextMenu(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('verity:modal:report:')) {
          await handleReportModalSubmit(interaction);
        }
      }
    } catch (err) {
      console.error('[Verity] Error handling interaction:', err);
      if (interaction.isRepliable()) {
        const errorMsg = {
          content: '❌ An unexpected error occurred while processing this report.',
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
