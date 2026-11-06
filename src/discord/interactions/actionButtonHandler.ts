import {
  ButtonInteraction,
  GuildMember,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder
} from 'discord.js';
import { db } from '../../db/database.js';
import {
  buildTakeActionModal,
  buildActionEvidenceModal
} from '../components/settingsModalBuilder.js';
import { executeModerationResolution } from './actionExecution.js';
import { generateCaseAuditMarkdown } from '../../investigation/auditExporter.js';

export async function handleActionButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const prefix = 'verity:act:';

  if (!customId.startsWith(prefix)) {
    return;
  }

  // Format: verity:act:<action>:<reportId>
  const parts = customId.slice(prefix.length).split(':');
  if (parts.length < 2) {
    return;
  }

  const action = parts[0].toLowerCase();
  const reportId = parts[1];

  const report = db.getReportById(reportId);
  if (!report) {
    await interaction.reply({
      content: '❌ Report record not found in database.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Export Case Audit Action
  if (action === 'export') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const auditText = generateCaseAuditMarkdown(report.id);
      const file = new AttachmentBuilder(Buffer.from(auditText, 'utf8'), {
        name: `verity_audit_${report.reportCode.toLowerCase()}.md`
      });
      await interaction.editReply({
        content: `📋 **Case Audit Transcript: Report \`${report.reportCode}\`**\nDownload the complete multi-agent investigation transcript, evidence hashes, and human authorization record below:`,
        files: [file]
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `❌ Failed to generate case audit transcript: ${err.message}`
      });
    }
    return;
  }

  // Check if report is already resolved
  const existingResolution = db.getModerationResolution(report.id);
  if (existingResolution || report.status === 'resolved') {
    await interaction.reply({
      content: `ℹ️ Report \`${report.reportCode}\` has already been resolved by <@${existingResolution?.moderatorId || 'a moderator'}>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ This action can only be performed within a guild.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const moderatorMember = interaction.member as GuildMember;
  if (!moderatorMember) {
    await interaction.reply({
      content: '❌ Could not verify your member profile in this guild.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Permission validation before showing modal or deferring
  const isOwner = guild.ownerId === interaction.user.id;
  const hasAdmin = moderatorMember.permissions.has(PermissionFlagsBits.Administrator);
  const hasModerate = moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers);
  const hasKick = moderatorMember.permissions.has(PermissionFlagsBits.KickMembers);
  const hasBan = moderatorMember.permissions.has(PermissionFlagsBits.BanMembers);
  const hasManageMessages = moderatorMember.permissions.has(PermissionFlagsBits.ManageMessages);

  // Take Action button opens comprehensive action modal
  if (action === 'take_action') {
    if (!isOwner && !hasAdmin && !hasModerate && !hasKick && !hasBan && !hasManageMessages) {
      await interaction.reply({
        content: '🚫 Authorization failed: You lack moderation permissions in this server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const settings = db.getGuildSettings(guild.id);
    const modalPayload = buildTakeActionModal({
      report,
      requireEvidence: settings.requireEvidence
    });
    await (interaction as any).showModal(modalPayload);
    return;
  }

  // Dismiss report follows existing dismissal workflow
  if (action === 'dismiss') {
    if (!isOwner && !hasAdmin && !hasModerate && !hasManageMessages) {
      await interaction.reply({
        content: '🚫 Authorization failed: You lack moderation permissions in this server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await executeModerationResolution({
      interaction,
      report,
      action: 'dismiss',
      moderatorMember,
      guild
    });
    return;
  }

  // Fallback for legacy direct action buttons (warn, timeout, kick, ban)
  if (action === 'ban' && !isOwner && !hasAdmin && !hasBan) {
    await interaction.reply({
      content: '🚫 Authorization failed: You lack the `Ban Members` permission required to ban members.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === 'kick' && !isOwner && !hasAdmin && !hasKick) {
    await interaction.reply({
      content: '🚫 Authorization failed: You lack the `Kick Members` permission required to kick members.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === 'timeout' && !isOwner && !hasAdmin && !hasModerate) {
    await interaction.reply({
      content: '🚫 Authorization failed: You lack the `Moderate Members` (Timeout/Mute) permission.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === 'warn' && !isOwner && !hasAdmin && !hasModerate && !hasManageMessages) {
    await interaction.reply({
      content: '🚫 Authorization failed: You lack moderation permissions in this server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Check guild settings for requireEvidence
  const settings = db.getGuildSettings(guild.id);
  const evidenceList = db.getEvidenceByReportId(report.id);
  const hasReportEvidence = evidenceList.length > 0;

  if (settings.requireEvidence) {
    const modalPayload = buildActionEvidenceModal(report, action, hasReportEvidence);
    await (interaction as any).showModal(modalPayload);
    return;
  }

  // Otherwise, fast-path direct execution
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await executeModerationResolution({
    interaction,
    report,
    action,
    moderatorMember,
    guild
  });
}
