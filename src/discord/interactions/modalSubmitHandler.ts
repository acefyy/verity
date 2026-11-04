import {
  ModalSubmitInteraction,
  TextChannel,
  ThreadAutoArchiveDuration,
  AttachmentBuilder,
  GuildMember,
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import { createHash } from 'node:crypto';
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
import { getModalInputValue } from './modalParsers.js';
import { executeModerationResolution } from './actionExecution.js';

export { getModalInputValue };

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

  // Immediate ephemeral deferral to prevent timeout during attachment processing
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

  // 2. Extract and validate Reason input
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
    reportedUserId: session.reportedUserId,
    reporterId: session.reporterId,
    reason,
    status: 'submitted'
  });

  // 6. Resolve #reports channel from per-guild settings or environment fallback
  const settings = db.getGuildSettings(session.guildId);
  const targetReportsChannelId = settings.reportsChannelId || config.reportsChannelId;

  let reportsChannel: TextChannel | null = null;
  if (targetReportsChannelId) {
    try {
      const channel = await interaction.client.channels.fetch(targetReportsChannelId).catch(() => null);
      if (channel && channel.isTextBased() && !channel.isDMBased()) {
        reportsChannel = channel as TextChannel;
      }
    } catch (err: any) {
      console.error(`[Verity] Failed to fetch reports channel (${targetReportsChannelId}):`, err?.message);
    }
  }

  if (!reportsChannel) {
    await interaction.editReply({
      content: `⚠️ Report \`${report.reportCode}\` recorded, but the designated #reports channel is missing or unconfigured. Please ask an administrator to run \`/settings\`.`
    });
    return;
  }

  // Check bot permissions in reports channel
  const botMember = interaction.guild?.members.me;
  if (botMember) {
    const perms = reportsChannel.permissionsFor(botMember);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.ViewChannel)) {
      await interaction.editReply({
        content: `❌ Verity lacks permission to send messages in the designated reports channel (<#${reportsChannel.id}>). Please contact a server administrator.`
      });
      return;
    }
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

/**
 * Handles submission of the Action Evidence & Confirmation modal
 * when evidence is required for moderation actions.
 */
export async function handleActionEvidenceModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const prefix = 'verity:modal:action_evidence:';
  if (!interaction.customId.startsWith(prefix)) {
    return;
  }

  const parts = interaction.customId.slice(prefix.length).split(':');
  if (parts.length < 2) {
    return;
  }

  const action = parts[0].toLowerCase();
  const reportId = parts[1];

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const report = db.getReportById(reportId);
  if (!report) {
    await interaction.editReply({
      content: '❌ Report record not found in database.'
    });
    return;
  }

  const existingResolution = db.getModerationResolution(report.id);
  if (existingResolution || report.status === 'resolved') {
    await interaction.editReply({
      content: `ℹ️ Report \`${report.reportCode}\` has already been resolved by <@${existingResolution?.moderatorId || 'a moderator'}>.`
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({
      content: '❌ Actions can only be performed within a server.'
    });
    return;
  }

  const moderatorMember = interaction.member as GuildMember;
  if (!moderatorMember) {
    await interaction.editReply({
      content: '❌ Could not verify your member profile.'
    });
    return;
  }

  const settings = db.getGuildSettings(guild.id);
  const evidenceList = db.getEvidenceByReportId(report.id);
  const hasReportEvidence = evidenceList.length > 0;

  const moderatorEvidence = getModalInputValue(interaction, 'verity:field:action_evidence');
  const customReason = getModalInputValue(interaction, 'verity:field:action_reason');

  // If evidence is required and report has no attached evidence, moderator MUST supply evidence
  if (settings.requireEvidence && action !== 'dismiss') {
    if (!hasReportEvidence && (!moderatorEvidence || moderatorEvidence.trim().length < 10)) {
      await interaction.editReply({
        content: '🚫 Action blocked: Server policy requires proof/evidence before executing moderation actions. Please provide evidence details or links (at least 10 characters).'
      });
      return;
    }
  }

  // If moderator provided evidence text or link, record it in database
  if (moderatorEvidence && moderatorEvidence.trim().length > 0) {
    const trimmedEvidence = moderatorEvidence.trim();
    db.addEvidenceMetadata({
      reportId: report.id,
      filename: 'moderator_proof_statement.txt',
      detectedMimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(trimmedEvidence, 'utf8'),
      sha256Hash: createHash('sha256').update(trimmedEvidence).digest('hex'),
      discordCdnUrl: trimmedEvidence.startsWith('http') ? trimmedEvidence : report.messageLink
    });
  }

  await executeModerationResolution({
    interaction,
    report,
    action,
    moderatorMember,
    guild,
    customReason: customReason || undefined,
    moderatorEvidence: moderatorEvidence || undefined
  });
}
