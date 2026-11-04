import {
  ButtonInteraction,
  GuildMember,
  PermissionFlagsBits,
  ThreadChannel
} from 'discord.js';
import { db } from '../../db/database.js';
import { switchClient } from '../../switch/switchClient.js';
import { buildResolutionContainer } from '../components/investigationContainerBuilder.js';

export async function handleActionButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const prefix = 'verity:act:';

  if (!customId.startsWith(prefix)) {
    return;
  }

  // customId format: verity:act:<action>:<reportId>
  const parts = customId.slice(prefix.length).split(':');
  if (parts.length < 2) {
    return;
  }

  const action = parts[0].toLowerCase();
  const reportId = parts[1];

  // Defer reply ephemerally to ensure fast interaction handling
  await interaction.deferReply({ ephemeral: true });

  const report = db.getReportById(reportId);
  if (!report) {
    await interaction.editReply({
      content: '❌ Report record not found in database.'
    });
    return;
  }

  // Check if report is already resolved
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
      content: '❌ This action can only be performed within a guild.'
    });
    return;
  }

  const moderatorMember = interaction.member as GuildMember;
  if (!moderatorMember) {
    await interaction.editReply({
      content: '❌ Could not verify your member profile in this guild.'
    });
    return;
  }

  // --- Tier 1: Moderator Permission Validation ---
  const isOwner = guild.ownerId === interaction.user.id;
  const hasAdmin = moderatorMember.permissions.has(PermissionFlagsBits.Administrator);
  const hasModerate = moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers);
  const hasBan = moderatorMember.permissions.has(PermissionFlagsBits.BanMembers);
  const hasManageMessages = moderatorMember.permissions.has(PermissionFlagsBits.ManageMessages);

  if (action === 'ban') {
    if (!isOwner && !hasAdmin && !hasBan) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack the `Ban Members` permission required to ban members.'
      });
      return;
    }
  } else if (action === 'timeout') {
    if (!isOwner && !hasAdmin && !hasModerate) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack the `Moderate Members` (Timeout) permission.'
      });
      return;
    }
  } else {
    // dismiss or warn
    if (!isOwner && !hasAdmin && !hasModerate && !hasManageMessages) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack moderation permissions in this server.'
      });
      return;
    }
  }

  // --- Tier 2: Role Hierarchy Validation ---
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await guild.members.fetch(report.reportedUserId);
  } catch {
    // Member may have left the guild
  }

  if (targetMember && (action === 'timeout' || action === 'ban')) {
    // Check if target is guild owner
    if (targetMember.id === guild.ownerId) {
      await interaction.editReply({
        content: '🚫 Hierarchy conflict: The guild owner cannot be moderated or banned.'
      });
      return;
    }

    // Check moderator hierarchy vs target
    if (!isOwner && moderatorMember.roles.highest.position <= targetMember.roles.highest.position) {
      await interaction.editReply({
        content: `🚫 Hierarchy conflict: Your highest role is equal to or lower than <@${targetMember.id}>'s role.`
      });
      return;
    }

    // Check bot's own hierarchy vs target
    const botMember = guild.members.me;
    if (botMember && botMember.roles.highest.position <= targetMember.roles.highest.position) {
      await interaction.editReply({
        content: `🚫 Bot hierarchy error: Verity's role is not high enough to moderate <@${targetMember.id}>.`
      });
      return;
    }
  }

  // --- Step 3: Execute Action ---
  let officialReason = '';
  try {
    if (action === 'dismiss') {
      officialReason = `Dismissed following multi-agent investigation. Reason cited: ${report.reason}`;
    } else if (action === 'warn') {
      officialReason = `Official warning issued: Violation of community guidelines regarding "${report.reason}".`;
      // Attempt to DM the target member with a warning notice
      if (targetMember) {
        await targetMember.send({
          content: `⚠️ **Verity Moderation Notice — ${guild.name}**\nAn official warning was issued to your account following an investigation of Report \`${report.reportCode}\`.\n> **Alleged Violation:** ${report.reason}\nPlease review server rules to prevent further moderation action.`
        }).catch(() => {
          // Member DMs might be closed
        });
      }
    } else if (action === 'timeout') {
      if (!targetMember) {
        throw new Error('Target member is not currently in the server and cannot be timed out.');
      }
      officialReason = `24-hour timeout applied for: ${report.reason}`;
      await targetMember.timeout(24 * 60 * 60 * 1000, `Verity [${report.reportCode}]: ${report.reason}`);
    } else if (action === 'ban') {
      officialReason = `Server ban enforced for: ${report.reason}`;
      await guild.members.ban(report.reportedUserId, {
        reason: `Verity [${report.reportCode}]: ${report.reason}`
      });
    } else {
      await interaction.editReply({
        content: `❌ Unknown action: \`${action}\`.`
      });
      return;
    }
  } catch (err: any) {
    console.error(`[Verity ActionButton] Error executing ${action}:`, err);
    await interaction.editReply({
      content: `❌ Failed to execute \`${action}\`: ${err.message}`
    });
    return;
  }

  // --- Step 4: Record Resolution in Database ---
  const executedAt = Date.now();
  const resolution = db.recordModerationResolution({
    reportId: report.id,
    moderatorId: interaction.user.id,
    actionTaken: action,
    officialReason,
    targetUserId: report.reportedUserId
  });

  db.updateReportStatus(report.id, 'resolved');

  // --- Step 5: Post Emerald Green Resolution Container into Thread ---
  const thread = interaction.channel;
  if (thread && thread.isThread()) {
    const resPayload = buildResolutionContainer({
      reportCode: report.reportCode,
      actionTaken: action,
      moderatorId: interaction.user.id,
      officialReason,
      targetUserId: report.reportedUserId,
      executedAt
    });

    try {
      await thread.send({
        flags: resPayload.flags,
        components: resPayload.components
      });
    } catch {
      await thread.send({
        content: `### 🛡️ Case Resolved: \`${action.toUpperCase()}\` • Report \`${report.reportCode}\`\n- **Target:** <@${report.reportedUserId}>\n- **Moderator:** <@${interaction.user.id}>\n- **Action:** \`${action.toUpperCase()}\`\n> **Official Reason:** ${officialReason}`
      });
    }
  }

  // --- Step 6: Disable Buttons on the Triggering Message ---
  try {
    await interaction.message.edit({
      components: []
    });
  } catch {
    // If edit fails, non-critical
  }

  // --- Step 7: Synchronize Resolution Back to Switch Room ---
  if (report.switchRoomId) {
    const switchNotice =
      `⚖️ **Case Officially Resolved by Human Moderator**\n\n` +
      `**Decision:** \`${action.toUpperCase()}\`\n` +
      `**Authorized Moderator:** <@${interaction.user.id}> (\`${interaction.user.tag || interaction.user.id}\`)\n` +
      `**Target Member:** <@${report.reportedUserId}>\n` +
      `**Official Reason:** ${officialReason}\n\n` +
      `The case investigation for **Report ${report.reportCode}** is now concluded and archived.`;

    switchClient.sendMessage(report.switchRoomId, switchNotice).catch((err) => {
      console.warn(`[Verity ActionButton] Failed to notify Switch room: ${err?.message}`);
    });
  }

  // --- Step 8: Ephemeral Success Response ---
  await interaction.editReply({
    content: `✅ Moderation action \`${action.toUpperCase()}\` successfully authorized and applied for Report \`${report.reportCode}\`.`
  });
}
