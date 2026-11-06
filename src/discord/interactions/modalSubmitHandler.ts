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
import { getModalInputValue, getModalSelectValue } from './modalParsers.js';
import { executeModerationResolution } from './actionExecution.js';
import { setupGuildReportsChannel } from '../guildSetup.js';

export { getModalInputValue };

/**
 * Extracts uploaded attachments from modal interaction payload.
 */
export function getModalAttachments(
  interaction: ModalSubmitInteraction
): AttachmentInput[] {
  const attachments: AttachmentInput[] = [];

  // 1. Try discord.js interaction.fields.getUploadedFiles
  try {
    const files = interaction.fields?.getUploadedFiles?.('verity:field:proof_upload');
    if (files && typeof files.values === 'function') {
      for (const att of files.values()) {
        if (att && att.url) {
          attachments.push({
            url: att.url,
            filename: att.name || (att as any).filename || 'attachment',
            size: att.size,
            contentType: att.contentType || (att as any).content_type
          });
        }
      }
      if (attachments.length > 0) return attachments;
    }
  } catch {
    // Continue
  }

  // 2. Try inspecting interaction.fields.fields Collection
  try {
    const field: any = (interaction.fields as any)?.fields?.get?.('verity:field:proof_upload');
    if (field?.attachments && typeof field.attachments.values === 'function') {
      for (const att of field.attachments.values()) {
        if (att && att.url) {
          attachments.push({
            url: att.url,
            filename: att.name || (att as any).filename || 'attachment',
            size: att.size,
            contentType: att.contentType || (att as any).content_type
          });
        }
      }
      if (attachments.length > 0) return attachments;
    }
  } catch {
    // Continue
  }

  // 3. Fallback for raw gateway data or test mocks
  const rawData = (interaction as any).data;
  const resolved = rawData?.resolved?.attachments;

  if (resolved && typeof resolved === 'object') {
    for (const [, att] of Object.entries(resolved) as [string, any][]) {
      if (att && att.url && (att.filename || att.name)) {
        attachments.push({
          url: att.url,
          filename: att.filename || att.name,
          size: att.size,
          contentType: att.content_type || att.contentType
        });
      }
    }
  }

  return attachments;
}

/**
 * Parses user duration string into milliseconds and friendly label.
 */
export function parseDuration(input?: string): { ms: number; label: string } | null {
  if (!input || !input.trim()) {
    return { ms: 24 * 60 * 60 * 1000, label: '24 hours' };
  }

  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!match) {
    return null;
  }

  const num = parseInt(match[1], 10);
  if (isNaN(num) || num <= 0) {
    return null;
  }

  const unit = match[2];
  let ms = 0;
  let label = '';

  if (unit.startsWith('m')) {
    ms = num * 60 * 1000;
    label = `${num} minute${num === 1 ? '' : 's'}`;
  } else if (unit.startsWith('h')) {
    ms = num * 60 * 60 * 1000;
    label = `${num} hour${num === 1 ? '' : 's'}`;
  } else if (unit.startsWith('d')) {
    ms = num * 24 * 60 * 60 * 1000;
    label = `${num} day${num === 1 ? '' : 's'}`;
  }

  const maxMs = 28 * 24 * 60 * 60 * 1000;
  if (ms > maxMs) {
    return null;
  }

  return { ms, label };
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

  // 3. Check guild settings for requireEvidence
  const settings = db.getGuildSettings(session.guildId);

  // Extract uploaded attachments from modal interaction payload
  const attachmentsToValidate = getModalAttachments(interaction);

  // If server requires evidence, reject reports submitted without proof
  if (settings.requireEvidence && attachmentsToValidate.length === 0) {
    await interaction.editReply({
      content: '❌ Submission rejected: Server policy requires at least one proof or evidence file (screenshot or document) when submitting a report.'
    });
    return;
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

  // If server requires evidence and validation failed completely, reject submission
  if (settings.requireEvidence && (evidenceError || validatedFiles.length === 0)) {
    await interaction.editReply({
      content: `❌ Submission rejected: Evidence validation failed (${evidenceError || 'No valid evidence files provided'}). Server policy requires valid evidence.`
    });
    return;
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

  // 6. Resolve #reports channel from per-guild settings or auto-provisioning
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

  // If reports channel is missing or not configured, auto-create it with correct permissions
  if (!reportsChannel && interaction.guild) {
    reportsChannel = await setupGuildReportsChannel(interaction.guild);
  }

  if (!reportsChannel) {
    await interaction.editReply({
      content: `⚠️ Report \`${report.reportCode}\` recorded, but could not access or create the #reports channel. Please verify Verity has "Manage Channels" permission.`
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
 * Handles submission of the Take Action modal
 * presenting punishment selection, duration, editable reason, and evidence.
 */
export async function handleTakeActionModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const prefix = 'verity:modal:take_action:';
  if (!interaction.customId.startsWith(prefix)) {
    return;
  }

  const reportId = interaction.customId.slice(prefix.length);

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

  const isOwner = guild.ownerId === interaction.user.id;
  const hasAdmin = moderatorMember.permissions.has(PermissionFlagsBits.Administrator);
  const hasModerate = moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers);
  const hasKick = moderatorMember.permissions.has(PermissionFlagsBits.KickMembers);
  const hasBan = moderatorMember.permissions.has(PermissionFlagsBits.BanMembers);
  const hasManageMessages = moderatorMember.permissions.has(PermissionFlagsBits.ManageMessages);

  // Extract values from modal submission
  const rawAction =
    getModalSelectValue(interaction, 'verity:field:action_type') ||
    getModalInputValue(interaction, 'verity:field:action_type') ||
    'warn';
  const action = rawAction.toLowerCase();

  const rawDuration = getModalInputValue(interaction, 'verity:field:action_duration') || '24h';
  const customReason = getModalInputValue(interaction, 'verity:field:action_reason') || report.reason;
  const moderatorEvidence = getModalInputValue(interaction, 'verity:field:action_evidence');

  // Validate action
  const validActions = ['warn', 'timeout', 'kick', 'ban'];
  if (!validActions.includes(action)) {
    await interaction.editReply({
      content: `❌ Unknown moderation action: \`${rawAction}\`. Supported actions: Warn, Timeout/Mute, Kick, Ban.`
    });
    return;
  }

  // Permission validation for selected action
  if (action === 'ban' && !isOwner && !hasAdmin && !hasBan) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack the `Ban Members` permission required to ban members.'
    });
    return;
  }
  if (action === 'kick' && !isOwner && !hasAdmin && !hasKick) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack the `Kick Members` permission required to kick members.'
    });
    return;
  }
  if (action === 'timeout' && !isOwner && !hasAdmin && !hasModerate) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack the `Moderate Members` (Timeout/Mute) permission.'
    });
    return;
  }
  if (action === 'warn' && !isOwner && !hasAdmin && !hasModerate && !hasManageMessages) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack moderation permissions in this server.'
    });
    return;
  }

  // Parse and validate duration for timeout
  let parsedDuration: { ms: number; label: string } | null = null;
  if (action === 'timeout') {
    parsedDuration = parseDuration(rawDuration);
    if (!parsedDuration) {
      await interaction.editReply({
        content: '❌ Invalid duration. Please provide a valid duration such as 10m, 1h, 24h, 7d (max 28d).'
      });
      return;
    }
  }

  // Save moderator evidence statement if provided
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

  // Execute moderation resolution
  await executeModerationResolution({
    interaction,
    report,
    action,
    moderatorMember,
    guild,
    customReason: customReason || undefined,
    moderatorEvidence: moderatorEvidence || undefined,
    durationMs: parsedDuration?.ms,
    durationLabel: parsedDuration?.label
  });
}
