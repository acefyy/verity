import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const settingsCommand = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Configure Verity report intake, action logs, and moderation evidence settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const settingsCommandData = settingsCommand.toJSON();
