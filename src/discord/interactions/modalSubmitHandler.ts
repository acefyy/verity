import {
  ModalSubmitInteraction,
  TextChannel,
  ThreadAutoArchiveDuration,
  AttachmentBuilder
} from 'discord.js';
import { db } from '../../db/database.js';
import {
  AttachmentInput,
  ValidatedFile,
  validateAndFetchAttachments
} from '../../evidence/validator.js';
import {
  buildReportContainer,
  buildThreadInitialContainer
} from '../components/reportContainerBuilder.js';
import { config } from '../../config.js';

export async function handleReportModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const customId = interaction.customId;
  const prefix = 'verity:modal:report:';

  if (!customId.startsWith(prefix)) {
    return;
  }

  const sessionId = customId.slice(prefix.length);

  // Immediate ephemeral deferral to prevent 3-second timeout during attachment downloads
  await interaction.deferReply({ ephemeral: true });

  // 1. Atomically validate and consume the server-side intake session
  let session;
  try {
    session = db.consumeIntakeSession({
      sessionId,
      reporterId: interaction.user.id,
      guildId: interaction.guildId || ''
    });
  } catch (err: any) {
    await interaction.editReply({
      content: `❌ Submission rejected: ${err.message || 'Invalid or expired intake session.'}`
    });
    return;
  }

  // 2. Extract and validate Reason input
  let reason = '';
  try {
    reason = interaction.fields.getTextInputValue('verity:field:reason').trim();
  } catch {
    reason = '';
  }

  if (!reason || reason.length < 15 || reason.length > 1000) {
    await interaction.editReply({
      content: '❌ Report reason must be between 15 and 1000 characters.'
    });
    return;
  }

  // 3. Extract uploaded attachments from modal interaction payload
  const attachmentsToValidate: AttachmentInput[] = [];
  const rawData = (interaction as any).data;
  const resolvedAttachments = rawData?.resolved?.attachments;

  if (resolvedAttachments && typeof resolvedAttachments === 'object') {
    for (const [id, att] of Object.entries(resolvedAttachments) as [string, any][]) {
      if (att && att.url && att.filename) {
        attachmentsToValidate.push({
          url: att.url,
          filename: att.filename,
          size: att.size,
          contentType: att.content_type
        });
      }
    }
  }

  // 4. In-memory validation (magic bytes, size check, SHA-256)
  let validatedFiles: ValidatedFile[] = [];
  let evidenceError: string | null = null;

  if (attachmentsToValidate.length > 0) {
    try {
      validatedFiles = await validateAndFetchAttachments(attachmentsToValidate);
    } catch (err: any) {
      evidenceError = err.message || 'Evidence validation failed.';
      validatedFiles = [];
    }
  }

  // 5. Create Report record in database
  const messageLink = `https://discord.com/channels/${session.guildId}/${session.channelId}/${session.targetMessageId}`;
  const report = db.createReport({
    guildId: session.guildId,
    channelId: session.channelId,
    messageId: session.targetMessageId,
    messageLink,
    reportedUserId: session.reportedUserId, // strictly bound from intake session
    reporterId: session.reporterId,
    reason,
    status: 'submitted'
  });

  // 6. Find #reports channel
  let reportsChannel: TextChannel | null = null;
  try {
    const channel = await interaction.client.channels.fetch(config.reportsChannelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
      reportsChannel = channel as TextChannel;
    }
  } catch (err) {
    console.error(`[Verity] Failed to fetch reports channel (${config.reportsChannelId}):`, err);
  }

  if (!reportsChannel) {
    await interaction.editReply({
      content: `⚠️ Report \`${report.reportCode}\` created in database, but designated #reports channel is unconfigured or unreachable.`
    });
    return;
  }

  // 7. Prepare immediate re-upload file attachments (zero local disk persistence)
  const discordFileAttachments = validatedFiles.map(
    (file) =>
      new AttachmentBuilder(file.buffer, {
        name: file.sanitizedFilename
      })
  );

  // 8. Build neutral Components V2 Container and post to #reports
  const initialPayload = buildReportContainer({
    report,
    files: validatedFiles,
    evidenceError
  });

  let reportMessage;
  try {
    reportMessage = await reportsChannel.send({
      flags: initialPayload.flags,
      components: initialPayload.components,
      files: discordFileAttachments
    });
  } catch (err: any) {
    console.error('[Verity] Error sending report container to Discord:', err);
    await interaction.editReply({
      content: `❌ Failed to publish report to #reports channel: ${err.message}`
    });
    return;
  }

  // 9. Record evidence metadata from newly re-uploaded Discord message attachments
  if (reportMessage.attachments.size > 0 && validatedFiles.length > 0) {
    let index = 0;
    for (const [, sentAtt] of reportMessage.attachments) {
      const matchingFile = validatedFiles[index];
      if (matchingFile) {
        db.addEvidenceMetadata({
          reportId: report.id,
          filename: matchingFile.sanitizedFilename,
          detectedMimeType: matchingFile.detectedMimeType,
          sizeBytes: matchingFile.sizeBytes,
          sha256Hash: matchingFile.sha256Hash,
          discordCdnUrl: sentAtt.url,
          discordAttachmentId: sentAtt.id
        });
      }
      index++;
    }
  }

  // 10. Create dedicated investigation thread under the report message
  let thread;
  try {
    thread = await reportMessage.startThread({
      name: `Report ${report.reportCode} — Investigation`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Verity investigation thread for report ${report.reportCode}`
    });

    const threadInitialMsg = buildThreadInitialContainer(report);
    await thread.send({
      flags: threadInitialMsg.flags,
      components: threadInitialMsg.components
    });
  } catch (err) {
    console.error('[Verity] Failed to create thread under report message:', err);
  }

  // 11. Update report in DB with message and thread IDs
  const threadId = thread ? thread.id : null;
  db.updateReportDiscordIds(report.id, reportMessage.id, threadId || '');

  // 12. Update #reports container message to include "Open Investigation Thread" button
  if (thread) {
    try {
      const updatedPayload = buildReportContainer({
        report,
        files: validatedFiles,
        threadUrl: thread.url,
        evidenceError
      });

      await reportMessage.edit({
        flags: updatedPayload.flags,
        components: updatedPayload.components
      });
    } catch (err) {
      console.warn('[Verity] Notice: Could not update report container with thread link:', err);
    }
  }

  // 13. Confirm submission to the reporting member
  await interaction.editReply({
    content: `✅ Report \`${report.reportCode}\` submitted successfully. Our moderation team has been notified.`
  });
}
