import {
  ButtonInteraction,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
  MessageFlags
} from 'discord.js';
import { db } from '../../db/database.js';
import { switchClient } from '../../switch/switchClient.js';
import {
  buildResolvedActionContainer
} from '../components/investigationContainerBuilder.js';
import {
  buildThreadInitialContainer,
  buildReportContainer
} from '../components/reportContainerBuilder.js';
import { config } from '../../config.js';

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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  const hasKick = moderatorMember.permissions.has(PermissionFlagsBits.KickMembers);
  const hasBan = moderatorMember.permissions.has(PermissionFlagsBits.BanMembers);
  const hasManageMessages = moderatorMember.permissions.has(PermissionFlagsBits.ManageMessages);

  if (action === 'ban') {
    if (!isOwner && !hasAdmin && !hasBan) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack the `Ban Members` permission required to ban members.'
      });
      return;
    }
  } else if (action === 'kick') {
    if (!isOwner && !hasAdmin && !hasKick) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack the `Kick Members` permission required to kick members.'
      });
      return;
    }
  } else if (action === 'timeout') {
    if (!isOwner && !hasAdmin && !hasModerate) {
      await interaction.editReply({
        content: '🚫 Authorization failed: You lack the `Moderate Members` (Timeout/Mute) permission.'
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

  if (targetMember && (action === 'timeout' || action === 'kick' || action === 'ban')) {
    // Check if target is guild owner
    if (targetMember.id === guild.ownerId) {
      await interaction.editReply({
        content: '🚫 Hierarchy conflict: The guild owner cannot be moderated, kicked, or banned.'
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
      officialReason = `Dismissed following multi-agent review. Reason cited: ${report.reason}`;
    } else if (action === 'warn') {
      officialReason = `Official warning issued: Violation regarding "${report.reason}".`;
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
      officialReason = `24-hour timeout (mute) applied for: ${report.reason}`;
      await targetMember.timeout(24 * 60 * 60 * 1000, `Verity [${report.reportCode}]: ${report.reason}`);
    } else if (action === 'kick') {
      if (!targetMember) {
        throw new Error('Target member is not currently in the server and cannot be kicked.');
      }
      officialReason = `Server kick enforced for: ${report.reason}`;
      await targetMember.kick(`Verity [${report.reportCode}]: ${report.reason}`);
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
  db.recordModerationResolution({
    reportId: report.id,
    moderatorId: interaction.user.id,
    actionTaken: action,
    officialReason,
    targetUserId: report.reportedUserId
  });

  db.updateReportStatus(report.id, 'resolved');

  // Fetch advisor recommendation text if available to preserve in resolved container
  const milestones = db.getInvestigationMilestones(report.id);
  const advisorMilestone = milestones.find((m) => m.phase.includes('Advisor'));

  // --- Step 5: Update the Existing Action Container in Place (No New Container Sent) ---
  const resolvedPayload = buildResolvedActionContainer({
    report,
    advisorContent: advisorMilestone?.content,
    actionTaken: action,
    moderatorId: interaction.user.id,
    officialReason,
    executedAt
  });

  try {
    await interaction.message.edit({
      flags: resolvedPayload.flags,
      components: resolvedPayload.components
    });
  } catch (editErr: any) {
    console.warn('[Verity ActionButton] Could not edit action container in place:', editErr?.message);
    // Fallback: edit with text content
    await interaction.message.edit({
      content: `### 🛡️ Status: Resolved • Action Taken: \`${action.toUpperCase()}\`\n**Target:** <@${report.reportedUserId}>\n**Authorized by:** <@${interaction.user.id}>\n> **Official Reason:** ${officialReason}`,
      components: []
    }).catch(() => {});
  }

  // --- Step 6: Update Initial Thread Container in Place to Reflect Resolved Status ---
  const thread = interaction.channel;
  if (thread && thread.isThread()) {
    try {
      let initialMsg = null;
      if (report.discordThreadInitialMsgId) {
        initialMsg = await thread.messages.fetch(report.discordThreadInitialMsgId).catch(() => null);
      }
      if (!initialMsg) {
        const messages = await thread.messages.fetch({ limit: 10 });
        initialMsg = [...messages.values()]
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .find((m) => m.components?.[0]?.type === 17);
      }
      if (initialMsg && initialMsg.id !== interaction.message.id) {
        const updatedInitial = buildThreadInitialContainer(report, `Resolved (${action.toUpperCase()})`);
        await initialMsg.edit({
          flags: updatedInitial.flags,
          components: updatedInitial.components
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[Verity ActionButton] Could not update thread initial container:', err?.message);
    }
  }

  // --- Step 7: Update #reports Container Message to Reflect Resolved Status ---
  try {
    if (report.discordReportsMsgId) {
      const reportsChannel = await interaction.client.channels.fetch(config.reportsChannelId);
      if (reportsChannel && reportsChannel.isTextBased()) {
        const repMsg = await (reportsChannel as TextChannel).messages.fetch(report.discordReportsMsgId).catch(() => null);
        if (repMsg) {
          const threadUrl = thread?.isThread() ? thread.url : undefined;
          const updatedReportsContainer = buildReportContainer({
            report,
            files: [],
            threadUrl,
            statusOverride: `RESOLVED (${action.toUpperCase()})`
          });
          await repMsg.edit({
            flags: updatedReportsContainer.flags,
            components: updatedReportsContainer.components
          }).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.warn('[Verity ActionButton] Could not update #reports message:', err?.message);
  }

  // --- Step 8: Synchronize Resolution Back to Switch Room ---
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

  // --- Step 9: Ephemeral Success Response ---
  await interaction.editReply({
    content: `✅ Moderation action \`${action.toUpperCase()}\` successfully authorized and applied for Report \`${report.reportCode}\`.`
  });
}
