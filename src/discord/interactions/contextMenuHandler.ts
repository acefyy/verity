import { MessageContextMenuCommandInteraction } from 'discord.js';
import { db } from '../../db/database.js';
import { buildReportModal } from '../components/modalBuilder.js';

export async function handleReportContextMenu(
  interaction: MessageContextMenuCommandInteraction
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const targetMessage = interaction.targetMessage;

  if (!guildId || !channelId || !targetMessage) {
    await interaction.reply({
      content: '❌ Reports can only be submitted for messages within a server channel.',
      ephemeral: true
    });
    return;
  }

  // Authoritatively capture reported member ID from target message
  const reportedUserId = targetMessage.author.id;
  const reporterId = interaction.user.id;

  // Prevent users from reporting their own messages if desired, or allow for testing
  if (reporterId === reportedUserId) {
    // We allow it or warn, but let's inform them in production
    // (keeping it permissible for sandbox demo testing if needed)
  }

  // Create server-side, one-time intake session (15-minute expiry)
  const session = db.createIntakeSession({
    reporterId,
    guildId,
    channelId,
    targetMessageId: targetMessage.id,
    reportedUserId,
    ttlMinutes: 15
  });

  // Build the 2-field modal (Reason + File Upload) wrapped in Labels (Type 18)
  const modalPayload = buildReportModal(session.sessionId, targetMessage.id);

  // Show the modal to the user
  await (interaction as any).showModal(modalPayload);
}
