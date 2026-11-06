import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import {
  buildResolvedActionContainer,
  buildThreadQAContainer,
  buildThreadQAProgressContainer
} from '../src/discord/components/investigationContainerBuilder.js';

describe('Enhanced Features: Thread QA, In-Place Resolution, and User History', () => {
  let testDb: Database;

  beforeEach(() => {
    testDb = new Database(':memory:');
  });

  afterEach(() => {
    testDb.close();
  });

  test('getReportByThreadId retrieves report correctly', () => {
    const report = testDb.createReport({
      guildId: 'g-100',
      channelId: 'c-200',
      messageId: 'm-300',
      messageLink: 'https://discord.com/channels/g-100/c-200/m-300',
      reportedUserId: 'u-target',
      reporterId: 'u-reporter',
      reason: 'Harassment and threats'
    });

    testDb.updateReportDiscordIds(report.id, 'msg-reports-1', 'thread-12345');

    const fetched = testDb.getReportByThreadId('thread-12345');
    assert.ok(fetched);
    assert.equal(fetched.id, report.id);
    assert.equal(fetched.reportedUserId, 'u-target');

    const missing = testDb.getReportByThreadId('thread-nonexistent');
    assert.equal(missing, null);
  });

  test('getResolutionsForUser retrieves user disciplinary history chronologically', () => {
    const report1 = testDb.createReport({
      guildId: 'g-100',
      channelId: 'c-200',
      messageId: 'm-1',
      messageLink: 'https://discord.com/1',
      reportedUserId: 'u-recidivist',
      reporterId: 'u-rep',
      reason: 'Spam'
    });

    const report2 = testDb.createReport({
      guildId: 'g-100',
      channelId: 'c-200',
      messageId: 'm-2',
      messageLink: 'https://discord.com/2',
      reportedUserId: 'u-recidivist',
      reporterId: 'u-rep',
      reason: 'Phishing'
    });

    testDb.recordModerationResolution({
      reportId: report1.id,
      moderatorId: 'mod-99',
      actionTaken: 'warn',
      officialReason: 'First warning for spamming',
      targetUserId: 'u-recidivist'
    });

    testDb.recordModerationResolution({
      reportId: report2.id,
      moderatorId: 'mod-99',
      actionTaken: 'timeout',
      officialReason: '24h timeout for link spam',
      targetUserId: 'u-recidivist'
    });

    const history = testDb.getResolutionsForUser('u-recidivist');
    assert.equal(history.length, 2);
    assert.equal(history[0].actionTaken, 'timeout');
    assert.equal(history[1].actionTaken, 'warn');

    const cleanUser = testDb.getResolutionsForUser('u-innocent');
    assert.equal(cleanUser.length, 0);
  });

  test('buildResolvedActionContainer renders clean Emerald Green status without export button', () => {
    const report = testDb.createReport({
      guildId: 'g-100',
      channelId: 'c-200',
      messageId: 'm-300',
      messageLink: 'https://discord.com/1',
      reportedUserId: 'u-target-42',
      reporterId: 'u-rep',
      reason: 'Severe malicious behavior'
    });

    const resolvedPayload = buildResolvedActionContainer({
      report,
      actionTaken: 'ban',
      moderatorId: 'mod-admin',
      officialReason: 'Severe malicious behavior',
      executedAt: Date.now()
    });

    assert.ok(resolvedPayload.components);
    const container = resolvedPayload.components[0];
    assert.equal(container.type, 17); // Container
    assert.equal(container.accent_color, 0x22C55E); // Emerald Green

    // Ensure Action Row is completely omitted (no export button)
    const actionRow = container.components.find((c: any) => c.type === 1);
    assert.equal(actionRow, undefined);

    const textComp = container.components.find((c: any) => c.type === 10);
    assert.ok(textComp);
    assert.ok(textComp.content.includes('Status: Resolved'));
    assert.ok(textComp.content.includes('BAN'));
    assert.ok(textComp.content.includes('mod-admin'));
  });

  test('buildThreadQAProgressContainer and buildThreadQAContainer render properly', () => {
    const progress = buildThreadQAProgressContainer('investigator', 'mod-123', 'Is the user an alt account?');
    assert.ok(progress.components);
    assert.equal(progress.components[0].type, 17);

    const answered = buildThreadQAContainer(
      'V-100',
      'investigator',
      'Is the user an alt account?',
      'Analysis indicates 98% correlation with known sockpuppet cluster.',
      'mod-123'
    );
    assert.ok(answered.components);
    const textComp = answered.components[0].components[0];
    assert.equal(textComp.type, 10);
    assert.ok(textComp.content.includes('Is the user an alt account?'));
    assert.ok(textComp.content.includes('sockpuppet cluster'));
  });
});
