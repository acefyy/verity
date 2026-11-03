import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';

export const reportMessageCommand = new ContextMenuCommandBuilder()
  .setName('Report Message')
  .setType(ApplicationCommandType.Message);

export const reportCommandData = reportMessageCommand.toJSON();
