import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { setupGuildReportsChannel } from '../src/discord/guildSetup.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

describe('Automatic Reports Channel Provisioning Tests', () => {
  let dbInstance: Database;

  beforeEach(() => {
    dbInstance = new Database(':memory:');
  });

  afterEach(() => {
    dbInstance.close();
  });

  test('setupGuildReportsChannel auto-creates private #reports channel when none exists', async () => {
    let createdChannelData: any = null;
    let sentGreeting: any = null;

    const mockGuild: any = {
      id: 'guild_auto_1',
      name: 'Test Server',
      roles: {
        everyone: { id: 'role_everyone_1' }
      },
      members: {
        me: { id: 'bot_verity_1' }
      },
      client: {
        user: { id: 'bot_verity_1' }
      },
      channels: {
        fetch: async () => new Map(),
        create: async (data: any) => {
          createdChannelData = data;
          return {
            id: 'chan_auto_reports_999',
            name: data.name,
            isTextBased: () => true,
            isDMBased: () => false,
            send: async (msg: any) => {
              sentGreeting = msg;
              return msg;
            }
          };
        }
      }
    };

    const channel = await setupGuildReportsChannel(mockGuild);

    assert.ok(channel);
    assert.equal(channel.id, 'chan_auto_reports_999');
    assert.equal(createdChannelData.name, 'reports');
    assert.equal(createdChannelData.type, ChannelType.GuildText);

    // Verify permission overwrites: @everyone is denied ViewChannel
    const everyoneOverwrite = createdChannelData.permissionOverwrites.find(
      (po: any) => po.id === 'role_everyone_1'
    );
    assert.ok(everyoneOverwrite);
    assert.deepEqual(everyoneOverwrite.deny, [PermissionFlagsBits.ViewChannel]);

    // Verify bot has full management and thread permissions
    const botOverwrite = createdChannelData.permissionOverwrites.find(
      (po: any) => po.id === 'bot_verity_1'
    );
    assert.ok(botOverwrite);
    assert.ok(botOverwrite.allow.includes(PermissionFlagsBits.ViewChannel));
    assert.ok(botOverwrite.allow.includes(PermissionFlagsBits.SendMessages));
    assert.ok(botOverwrite.allow.includes(PermissionFlagsBits.CreatePublicThreads));

    // Verify initial notice message was sent
    assert.ok(sentGreeting);
    assert.ok(sentGreeting.content.includes('Verity Reports Intake Channel Created'));
  });

  test('setupGuildReportsChannel reuses existing reports channel if already present in guild', async () => {
    let createCalled = false;

    const existingReportsChannel = {
      id: 'existing_reports_123',
      name: 'reports',
      isTextBased: () => true,
      isDMBased: () => false
    };

    const channelMap = new Map();
    channelMap.set('existing_reports_123', existingReportsChannel);

    const mockGuild: any = {
      id: 'guild_auto_2',
      name: 'Existing Server',
      roles: {
        everyone: { id: 'role_everyone_2' }
      },
      members: {
        me: { id: 'bot_verity_2' }
      },
      client: {
        user: { id: 'bot_verity_2' }
      },
      channels: {
        fetch: async (id?: string) => {
          if (id === 'existing_reports_123') return existingReportsChannel;
          return channelMap;
        },
        create: async () => {
          createCalled = true;
          throw new Error('Should not create new channel');
        }
      }
    };

    const channel = await setupGuildReportsChannel(mockGuild);

    assert.ok(channel);
    assert.equal(channel.id, 'existing_reports_123');
    assert.equal(createCalled, false);
  });
});
