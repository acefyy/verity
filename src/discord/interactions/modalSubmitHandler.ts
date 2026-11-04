import {
  ModalSubmitInteraction,
  TextChannel,
  ThreadAutoArchiveDuration,
  AttachmentBuilder,
  MessageFlags
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
import { runInvestigation } from '../../investigation/orchestrator.js';
import { config } from '../../config.js';

/**
 * Robust helper to extract a text input value from a modal submission,
 * checking both discord.js helpers and recursively inspecting raw components
 * (handling inputs wrapped inside ComponentType.LABEL 18).
 */
export function getModalInputValue(
  interaction: ModalSubmitInteraction,
  customId: string
): string {
  // 1. Try discord.js fields helper
  try {
    const val = interaction.fields.getTextInputValue(customId);
    if (val) return val.trim();
  } catch {
    // Continue to raw inspection
  }

  // 2. Direct recursive search in raw interaction data
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const findValue = (comps: any[]): string | undefined => {
      for (const item of comps) {
        if (item.custom_id === customId && typeof item.value === 'string') {
          return item.value.trim();
        }
        if (item.component) {
          const nested = findValue([item.component]);
          if (nested !== undefined) return nested;
        }
        if (Array.isArray(item.components)) {
          const nested = findValue(item.components);
          if (nested !== undefined) return nested;
        }
      }
      return undefined;
    };

    const found = findValue(rawComponents);
    if (found !== undefined) {
      return found;
    }
  }

  return '';
}

/**
 * Extracts uploaded attachments from modal interaction payload.
 */
export function getModalAttachments(
  interaction: ModalSubmitInteraction
): AttachmentInput[] {
  const attachments: AttachmentInput[] = [];
  const rawData = (interaction as any).data;
  const resolved = rawData?.resolved?.attachments;

  if (resolved && typeof resolved === 'object') {
    for (const [, att] of Object.entries(resolved) as [string, any][]) {
      if (att && att.url && att.filename) {
        attachments.push({
          url: att.url,
          filename: att.filename,
          size: att.size,
          contentType: att.content_type
        });
      }
    }
  }

  return attachments;
}

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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

  // 2. Extract and validate Reason input (handles Label wrapping)
  const reason = getModalInputValue(interaction, 'verity:field:reason');

  if (!reason || reason.length < 15 || reason.length > 1000) {
    await interaction.editReply({
      content: '❌ Report reason must be between 15 and 1000 characters.'
    });
    return;
  }

  // 3. Extract uploaded attachments from modal interaction payload
  const attachmentsToValidate = getModalAttachments(interaction);

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
      content: `⚠️ Report \`${report.reportCode}\` recorded in database, but designated #reports channel is unconfigured or unreachable.`
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
    console.warn('[Verity] Notice: Components V2 send failed, attempting clean fallback:', err?.message);
    try {
      // Fallback if guild lacks Components V2 rendering flags
      reportMessage = await reportsChannel.send({
        content: `### 🛡️ Report \`${report.reportCode}\` • Pending Investigation\n**Reported Member:** <@${report.reportedUserId}> (\`${report.reportedUserId}\`)\n**Reporter:** <@${report.reporterId}>\n**Channel:** <#${report.channelId}>\n**Message Link:** [Jump to Message](${report.messageLink})\n> **Alleged Reason:**\n> ${report.reason}${evidenceError ? `\n⚠️ **Evidence Notice:** ${evidenceError}` : ''}`,
        files: discordFileAttachments
      });
    } catch (fallbackErr: any) {
      console.error('[Verity] Error sending report to Discord:', fallbackErr);
      await interaction.editReply({
        content: `❌ Failed to publish report to #reports channel: ${fallbackErr.message}`
      });
      return;
    }
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
  let thread: any = null;
  let initialMsg: any = null;

  try {
    thread = await reportMessage.startThread({
      name: `Report ${report.reportCode}: Investigation`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Verity investigation thread for report ${report.reportCode}`
    });

    const threadInitialMsg = buildThreadInitialContainer(report);
    try {
      initialMsg = await thread.send({
        flags: threadInitialMsg.flags,
        components: threadInitialMsg.components
      });
    } catch {
      // Fallback text if Components V2 flag rejected in thread
      initialMsg = await thread.send({
        content: `### 📋 Investigation Thread: Report \`${report.reportCode}\`\n- **Target Member:** <@${report.reportedUserId}>\n- **Origin Message:** [Jump to Message](${report.messageLink})\n- **Status:** \`Awaiting Agent Triage & Analysis\``
      });
    }
  } catch (err) {
    console.error('[Verity] Failed to create thread under report message:', err);
  }

  // 11. Update report in DB with message and thread IDs
  const threadId = thread ? thread.id : null;
  db.updateReportDiscordIds(report.id, reportMessage.id, threadId || '', initialMsg?.id || null);

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
    } catch {
      // Ignore if edit fails
    }
  }

  // 13. Confirm submission to the reporting member
  await interaction.editReply({
    content: `✅ Report \`${report.reportCode}\` submitted successfully. Our moderation team has been notified.`
  });

  // 14. Trigger multi-agent investigation workflow in the background
  if (thread) {
    runInvestigation({
      report,
      thread,
      client: interaction.client
    }).catch((err) => {
      console.error(`[Verity] Uncaught error during investigation of report ${report.reportCode}:`, err);
    });
  }
}
