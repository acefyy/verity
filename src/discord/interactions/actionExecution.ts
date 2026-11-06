import {
  ButtonInteraction,
  ModalSubmitInteraction,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
  MessageFlags
} from 'discord.js';
import { db, Report } from '../../db/database.js';
import { switchClient } from '../../switch/switchClient.js';
import {
  buildResolvedActionContainer
} from '../components/investigationContainerBuilder.js';
import {
  buildThreadInitialContainer,
  buildReportContainer
} from '../components/reportContainerBuilder.js';
import { buildActionLogContainer } from '../components/actionLogContainerBuilder.js';
import { config } from '../../config.js';

export interface ExecuteActionParams {
  interaction: ButtonInteraction | ModalSubmitInteraction;
  report: Report;
  action: string;
  moderatorMember: GuildMember;
  guild: Guild;
  customReason?: string;
  moderatorEvidence?: string;
  durationMs?: number;
  durationLabel?: string;
}

export async function executeModerationResolution(
  params: ExecuteActionParams
): Promise<void> {
  const {
    interaction,
    report,
    action,
    moderatorMember,
    guild,
    customReason,
    moderatorEvidence,
    durationMs,
    durationLabel
  } = params;

  const isOwner = guild.ownerId === interaction.user.id;
  const hasAdmin = moderatorMember.permissions.has(PermissionFlagsBits.Administrator);
  const hasModerate = moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers);
  const hasKick = moderatorMember.permissions.has(PermissionFlagsBits.KickMembers);
  const hasBan = moderatorMember.permissions.has(PermissionFlagsBits.BanMembers);
  const hasManageMessages = moderatorMember.permissions.has(PermissionFlagsBits.ManageMessages);

  // Validate server permissions
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
  if ((action === 'warn' || action === 'dismiss') && !isOwner && !hasAdmin && !hasModerate && !hasManageMessages) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack moderation permissions in this server.'
    });
    return;
  }

  // Validate role hierarchy
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await guild.members.fetch(report.reportedUserId);
  } catch {
    // Target member may have left the guild
  }

  if (targetMember && (action === 'timeout' || action === 'kick' || action === 'ban')) {
    if (targetMember.id === guild.ownerId) {
      await interaction.editReply({
        content: '🚫 Hierarchy conflict: The guild owner cannot be moderated, kicked, or banned.'
      });
      return;
    }

    if (!isOwner && moderatorMember.roles.highest.position <= targetMember.roles.highest.position) {
      await interaction.editReply({
        content: `🚫 Hierarchy conflict: Your highest role is equal to or lower than <@${targetMember.id}>'s role.`
      });
      return;
    }

    const botMember = guild.members.me;
    if (botMember && botMember.roles.highest.position <= targetMember.roles.highest.position) {
      await interaction.editReply({
        content: `🚫 Bot hierarchy error: Verity's role is not high enough to moderate <@${targetMember.id}>.`
      });
      return;
    }
  }

  // Determine official reason
  const baseReason = customReason || report.reason;
  let officialReason = '';

  try {
    if (action === 'dismiss') {
      officialReason = `Dismissed following multi-agent review. Reason: ${baseReason}`;
    } else if (action === 'warn') {
      officialReason = `Official warning issued: Violation regarding "${baseReason}".`;
      if (targetMember) {
        await targetMember.send({
          content: `⚠️ **Verity Moderation Notice: ${guild.name}**\nAn official warning was issued to your account following an investigation of Report \`${report.reportCode}\`.\n> **Alleged Violation:** ${baseReason}\nPlease review server rules to prevent further moderation action.`
        }).catch(() => {
          // Member DMs might be closed
        });
      }
    } else if (action === 'timeout') {
      if (!targetMember) {
        throw new Error('Target member is not currently in the server and cannot be timed out.');
      }
      const appliedMs = durationMs || 24 * 60 * 60 * 1000;
      const appliedLabel = durationLabel || '24-hour';
      officialReason = `${appliedLabel} timeout (mute) applied for: ${baseReason}`;
      if (targetMember) {
        await targetMember.send({
          content: `⏳ **Verity Moderation Notice: ${guild.name}**\nA ${appliedLabel} timeout (mute) has been applied to your account following an investigation of Report \`${report.reportCode}\`.\n> **Reason:** ${baseReason}\nPlease review server rules during your timeout period.`
        }).catch(() => {
          // Member DMs might be closed
        });
      }
      await targetMember.timeout(appliedMs, `Verity [${report.reportCode}]: ${baseReason}`);
    } else if (action === 'kick') {
      if (!targetMember) {
        throw new Error('Target member is not currently in the server and cannot be kicked.');
      }
      officialReason = `Server kick enforced for: ${baseReason}`;
      // Send DM before kick while user still shares server
      if (targetMember) {
        await targetMember.send({
          content: `🚪 **Verity Moderation Notice: ${guild.name}**\nYou have been removed (kicked) from **${guild.name}** following an investigation of Report \`${report.reportCode}\`.\n> **Reason:** ${baseReason}`
        }).catch(() => {
          // Member DMs might be closed
        });
      }
      await targetMember.kick(`Verity [${report.reportCode}]: ${baseReason}`);
    } else if (action === 'ban') {
      officialReason = `Server ban enforced for: ${baseReason}`;
      // Send DM before ban while user still shares server
      if (targetMember) {
        await targetMember.send({
          content: `⛔ **Verity Moderation Notice: ${guild.name}**\nYou have been permanently banned from **${guild.name}** following an investigation of Report \`${report.reportCode}\`.\n> **Reason:** ${baseReason}`
        }).catch(() => {
          // Member DMs might be closed
        });
      }
      await guild.members.ban(report.reportedUserId, {
        reason: `Verity [${report.reportCode}]: ${baseReason}`
      });
    } else {
      await interaction.editReply({
        content: `❌ Unknown action: \`${action}\`.`
      });
      return;
    }
  } catch (err: any) {
    console.error(`[Verity ActionExecution] Error executing ${action}:`, err);
    await interaction.editReply({
      content: `❌ Failed to execute \`${action}\`: ${err.message}`
    });
    return;
  }

  // Record resolution in database
  const executedAt = Date.now();
  db.recordModerationResolution({
    reportId: report.id,
    moderatorId: interaction.user.id,
    actionTaken: action,
    officialReason,
    targetUserId: report.reportedUserId
  });

  db.updateReportStatus(report.id, 'resolved');

  // Load guild settings for channels
  const settings = db.getGuildSettings(report.guildId);

  // Fetch advisor recommendation text if available to preserve in resolved container
  const milestones = db.getInvestigationMilestones(report.id);
  const advisorMilestone = milestones.find((m) => m.phase.includes('Advisor'));

  // Update Action Container in place with Export Case Audit button
  const resolvedPayload = buildResolvedActionContainer({
    report,
    advisorContent: advisorMilestone?.content,
    actionTaken: action,
    moderatorId: interaction.user.id,
    officialReason,
    executedAt,
    includeExportButton: true
  });

  try {
    let messageToEdit = (interaction as any).message;
    if (!messageToEdit && interaction.channel && interaction.channel.isThread()) {
      const msgs = await interaction.channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (msgs) {
        const hasActBtn = (comps: any[]): boolean => {
          for (const c of comps) {
            const id = c.customId || c.custom_id;
            if (id && (id.startsWith('verity:act:') || id.startsWith('verity:modal:'))) return true;
            if (Array.isArray(c.components) && hasActBtn(c.components)) return true;
          }
          return false;
        };
        messageToEdit = [...msgs.values()].find((m) =>
          Array.isArray(m.components) && hasActBtn(m.components)
        );
      }
    }
    if (messageToEdit) {
      await messageToEdit.edit({
        flags: resolvedPayload.flags,
        components: resolvedPayload.components
      });
    }
  } catch (editErr: any) {
    console.warn('[Verity ActionExecution] Could not edit action container in place:', editErr?.message);
  }

  // Update Initial Thread Container in place
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
      if (initialMsg && initialMsg.id !== (interaction as any).message?.id) {
        const updatedInitial = buildThreadInitialContainer(report, `Resolved (${action.toUpperCase()})`);
        await initialMsg.edit({
          flags: updatedInitial.flags,
          components: updatedInitial.components
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[Verity ActionExecution] Could not update thread initial container:', err?.message);
    }
  }

  // Update #reports container message in designated reports channel
  try {
    const targetReportsChannelId = settings.reportsChannelId || config.reportsChannelId;
    if (targetReportsChannelId && report.discordReportsMsgId) {
      const reportsChannel = await interaction.client.channels.fetch(targetReportsChannelId).catch(() => null);
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
    console.warn('[Verity ActionExecution] Could not update #reports message:', err?.message);
  }

  // Send action log if action log channel is configured
  if (settings.actionLogChannelId) {
    try {
      const logChannel = await guild.channels.fetch(settings.actionLogChannelId).catch(() => null);
      if (logChannel && logChannel.isTextBased()) {
        const botMember = guild.members.me;
        const perms = botMember ? logChannel.permissionsFor(botMember) : null;
        if (perms?.has(PermissionFlagsBits.SendMessages) && perms?.has(PermissionFlagsBits.ViewChannel)) {
          const evidenceItems = db.getEvidenceByReportId(report.id);
          let evidenceSummaryText = 'None attached';
          if (evidenceItems.length > 0) {
            evidenceSummaryText = `${evidenceItems.length} file(s) attached ([${evidenceItems[0].filename}](${evidenceItems[0].discordCdnUrl}))`;
          } else if (moderatorEvidence) {
            evidenceSummaryText = moderatorEvidence;
          }

          const threadUrl = thread && thread.isThread() ? thread.url : undefined;
          const logPayload = buildActionLogContainer({
            report,
            actionTaken: action,
            moderatorId: interaction.user.id,
            targetUserId: report.reportedUserId,
            officialReason,
            executedAt,
            threadUrl,
            evidenceSummary: evidenceSummaryText
          });

          await (logChannel as TextChannel).send({
            flags: logPayload.flags,
            components: logPayload.components
          }).catch(async () => {
            // Text fallback
            await (logChannel as TextChannel).send({
              content: `### 🛡️ Moderation Action Log: \`${action.toUpperCase()}\` • Report \`${report.reportCode}\`\n- **Target:** <@${report.reportedUserId}>\n- **Moderator:** <@${interaction.user.id}>\n- **Action:** \`${action.toUpperCase()}\`\n> **Reason:** ${officialReason}\n**Evidence:** ${evidenceSummaryText}`
            }).catch(() => {});
          });
        } else {
          console.warn(`[Verity ActionExecution] Bot lacks permission in action log channel ${settings.actionLogChannelId}.`);
        }
      } else {
        console.warn(`[Verity ActionExecution] Action log channel ${settings.actionLogChannelId} missing or not text-based.`);
      }
    } catch (logErr: any) {
      console.warn(`[Verity ActionExecution] Could not send action log: ${logErr?.message}`);
    }
  }

  // Synchronize resolution back to Switch room
  if (report.switchRoomId) {
    const switchNotice =
      `⚖️ **Case Officially Resolved by Human Moderator**\n\n` +
      `**Decision:** \`${action.toUpperCase()}\`\n` +
      `**Authorized Moderator:** <@${interaction.user.id}> (\`${interaction.user.tag || interaction.user.id}\`)\n` +
      `**Target Member:** <@${report.reportedUserId}>\n` +
      `**Official Reason:** ${officialReason}\n\n` +
      `The case investigation for **Report ${report.reportCode}** is now concluded and archived.`;

    switchClient.sendMessage(report.switchRoomId, switchNotice).catch((err) => {
      console.warn(`[Verity ActionExecution] Failed to notify Switch room: ${err?.message}`);
    });
  }

  // Ephemeral response
  const successNotice = action === 'dismiss'
    ? `✅ Report \`${report.reportCode}\` successfully dismissed.`
    : `✅ Moderation action \`${action.toUpperCase()}\` successfully authorized and applied for Report \`${report.reportCode}\`.`;

  await interaction.editReply({
    content: successNotice
  });
}
