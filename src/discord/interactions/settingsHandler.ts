import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { db } from '../../db/database.js';
import { buildSettingsModal } from '../components/settingsModalBuilder.js';
import {
  getModalSelectValue,
  getModalCheckboxValue
} from './modalParsers.js';
import { IS_COMPONENTS_V2 } from '../components/investigationContainerBuilder.js';

export async function handleSettingsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    await interaction.reply({
      content: '❌ The /settings command can only be executed within a Discord server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const isOwner = guild.ownerId === interaction.user.id;
  const hasManageGuild = member?.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasAdminRole = member?.roles?.cache?.some((r) => /admin|mod|staff|verity/i.test(r.name)) ?? false;

  if (!isOwner && !hasManageGuild && !hasAdmin && !hasAdminRole) {
    await interaction.reply({
      content: '🚫 Authorization failed: You need the "Manage Server" or "Administrator" permission to configure settings.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Load current guild settings (falls back to existing config defaults)
  const currentSettings = db.getGuildSettings(interaction.guildId);

  // Validate existing channels to avoid passing deleted channels as default values
  let validReportsChannelId: string | null = null;
  if (currentSettings.reportsChannelId) {
    const chan = guild.channels.cache.get(currentSettings.reportsChannelId) ||
      await guild.channels.fetch(currentSettings.reportsChannelId).catch(() => null);
    if (chan && chan.isTextBased()) {
      validReportsChannelId = chan.id;
    }
  }

  let validActionLogChannelId: string | null = null;
  if (currentSettings.actionLogChannelId) {
    const chan = guild.channels.cache.get(currentSettings.actionLogChannelId) ||
      await guild.channels.fetch(currentSettings.actionLogChannelId).catch(() => null);
    if (chan && chan.isTextBased()) {
      validActionLogChannelId = chan.id;
    }
  }

  // Build the 3-field modal (Report Channel, Action Log Channel, Require Evidence)
  const modalPayload = buildSettingsModal({
    currentReportsChannelId: validReportsChannelId,
    currentActionLogChannelId: validActionLogChannelId,
    requireEvidence: currentSettings.requireEvidence
  });

  await (interaction as any).showModal(modalPayload);
}

export async function handleSettingsModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: '❌ Settings can only be saved within a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Defer ephemerally while checking channels and permissions
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const member = interaction.member as GuildMember;
  const isOwner = guild.ownerId === interaction.user.id;
  const hasManageGuild = member?.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasAdminRole = member?.roles?.cache?.some((r) => /admin|mod|staff|verity/i.test(r.name)) ?? false;

  if (!isOwner && !hasManageGuild && !hasAdmin && !hasAdminRole) {
    await interaction.editReply({
      content: '🚫 Authorization failed: You lack permissions to update server settings.'
    });
    return;
  }

  // Extract values from modal submission
  const reportsChannelId = getModalSelectValue(interaction, 'verity:field:reports_channel');
  const actionLogChannelId = getModalSelectValue(interaction, 'verity:field:action_log_channel');
  const requireEvidence = getModalCheckboxValue(interaction, 'verity:field:require_evidence', false);

  if (!reportsChannelId) {
    await interaction.editReply({
      content: '❌ A valid Report Channel must be selected.'
    });
    return;
  }

  // Verify Report Channel
  const reportsChannel = await guild.channels.fetch(reportsChannelId).catch(() => null);
  if (!reportsChannel || !reportsChannel.isTextBased()) {
    await interaction.editReply({
      content: '❌ The selected Report Channel does not exist or is not a text channel.'
    });
    return;
  }

  // Verify bot permissions in Report Channel
  const botMember = guild.members.me;
  const permissionWarnings: string[] = [];

  if (botMember) {
    const reportPerms = reportsChannel.permissionsFor(botMember);
    const missingReports: string[] = [];
    if (!reportPerms?.has(PermissionFlagsBits.ViewChannel)) missingReports.push('View Channel');
    if (!reportPerms?.has(PermissionFlagsBits.SendMessages)) missingReports.push('Send Messages');
    if (!reportPerms?.has(PermissionFlagsBits.CreatePublicThreads)) missingReports.push('Create Public Threads');

    if (missingReports.length > 0) {
      permissionWarnings.push(`- **Report Channel (<#${reportsChannelId}>):** Missing permissions: ${missingReports.join(', ')}`);
    }
  }

  // Verify Action Log Channel if selected
  let validActionLogId: string | null = null;
  if (actionLogChannelId) {
    const logChannel = await guild.channels.fetch(actionLogChannelId).catch(() => null);
    if (!logChannel || !logChannel.isTextBased()) {
      await interaction.editReply({
        content: '❌ The selected Action Log Channel does not exist or is not a text channel.'
      });
      return;
    }
    validActionLogId = logChannel.id;

    if (botMember) {
      const logPerms = logChannel.permissionsFor(botMember);
      const missingLogs: string[] = [];
      if (!logPerms?.has(PermissionFlagsBits.ViewChannel)) missingLogs.push('View Channel');
      if (!logPerms?.has(PermissionFlagsBits.SendMessages)) missingLogs.push('Send Messages');

      if (missingLogs.length > 0) {
        permissionWarnings.push(`- **Action Log Channel (<#${validActionLogId}>):** Missing permissions: ${missingLogs.join(', ')}`);
      }
    }
  }

  // Persist updated settings to database
  db.upsertGuildSettings({
    guildId: interaction.guildId,
    reportsChannelId,
    actionLogChannelId: validActionLogId,
    requireEvidence
  });

  const warningSection = permissionWarnings.length > 0
    ? `\n\n⚠️ **Permission Notices:**\n${permissionWarnings.join('\n')}\n*Grant these permissions to ensure notifications are delivered.*`
    : '';

  const confirmationContent = [
    '### ⚙️ Report Module Settings Updated',
    '',
    `- **Report Channel:** <#${reportsChannelId}>`,
    `- **Action Log Channel:** ${validActionLogId ? `<#${validActionLogId}>` : '*Not configured (Disabled)*'}`,
    `- **Require Evidence for Reports:** \`${requireEvidence ? 'Enabled (Required)' : 'Disabled'}\``,
    warningSection
  ].join('\n');

  try {
    await interaction.editReply({
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: 17, // Container
          accent_color: 0x22C55E, // Emerald Green
          components: [
            {
              type: 10, // Text Display
              content: confirmationContent
            }
          ]
        }
      ]
    });
  } catch {
    await interaction.editReply({
      content: confirmationContent
    });
  }
}
