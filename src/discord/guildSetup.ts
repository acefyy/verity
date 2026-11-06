import {
  Guild,
  TextChannel,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { db } from '../db/database.js';
import { config } from '../config.js';

/**
 * Ensures an appropriate reports channel exists for the guild with correct permissions.
 *
 * 1. Checks existing guild settings in SQLite.
 * 2. If channel doesn't exist, searches for an existing channel named "reports".
 * 3. If neither exists, automatically creates a private "#reports" text channel:
 *    - @everyone: ViewChannel denied (keeps incident reports private from regular members)
 *    - Verity bot: Full view, send, thread management, embed, and attach permissions
 * 4. Saves the channel ID to guild_settings in database.
 */
export async function setupGuildReportsChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = db.getGuildSettings(guild.id);
  const targetChannelId = settings.reportsChannelId || config.reportsChannelId;

  // 1. Verify if configured channel already exists and is accessible
  if (targetChannelId) {
    try {
      const existing = await guild.channels.fetch(targetChannelId).catch(() => null);
      if (existing && existing.isTextBased() && !existing.isDMBased()) {
        const textChan = existing as TextChannel;
        const botMember = guild.members.me;
        if (!botMember || textChan.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)) {
          return textChan;
        }
      }
    } catch {
      // Continue to search or creation
    }
  }

  // 2. Search guild cache for an existing text channel named "reports"
  try {
    const channels = await guild.channels.fetch().catch(() => null);
    if (channels) {
      const channelArray = typeof (channels as any).values === 'function'
        ? [...(channels as any).values()]
        : Array.isArray(channels)
        ? channels
        : [];
      const existingReportsChan = channelArray.find(
        (c: any) => Boolean(
          c &&
          typeof c.isTextBased === 'function' &&
          c.isTextBased() &&
          (typeof c.isDMBased !== 'function' || !c.isDMBased()) &&
          (c.name === 'reports' || c.name === 'verity-reports')
        )
      );
      if (existingReportsChan) {
        const textChan = existingReportsChan as TextChannel;
        db.upsertGuildSettings({
          guildId: guild.id,
          reportsChannelId: textChan.id
        });
        console.log(`[Verity] Bound existing #${textChan.name} (${textChan.id}) for guild ${guild.id}.`);
        return textChan;
      }
    }
  } catch {
    // Continue to creation
  }

  // 3. Auto-create a secure, private "#reports" channel
  try {
    const botId = guild.members.me?.id || guild.client.user?.id;
    const permissionOverwrites: any[] = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel] // Private to staff: hide from regular members
      }
    ];

    if (botId) {
      permissionOverwrites.push({
        id: botId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    const newChannel = await guild.channels.create({
      name: 'reports',
      type: ChannelType.GuildText,
      topic: 'Verity incident reports and automated multi-agent investigation threads',
      permissionOverwrites
    });

    // Save to database
    db.upsertGuildSettings({
      guildId: guild.id,
      reportsChannelId: newChannel.id
    });

    console.log(`[Verity] Auto-created private #${newChannel.name} channel (${newChannel.id}) for guild ${guild.id}.`);

    // Post initial greeting notice
    await newChannel.send({
      content: '🛡️ **Verity Reports Intake Channel Created**\n' +
        'This channel has been automatically configured to receive incident reports and multi-agent investigation threads.\n' +
        'Regular members cannot view this channel. Server administrators can customize routing anytime via `/settings`.'
    }).catch(() => {});

    return newChannel;
  } catch (err: any) {
    console.error(`[Verity] Could not auto-create #reports channel in ${guild.name} (${guild.id}): ${err?.message}`);
    return null;
  }
}
