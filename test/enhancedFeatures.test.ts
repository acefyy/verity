import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import {
  buildResolvedActionContainer,
  buildThreadQAContainer,
  buildThreadQAProgressContainer,
  stripAgentMentions
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

  test('buildThreadQAProgressContainer and buildThreadQAContainer render properly and strip agent mentions', () => {
    const rawQuestion = '@report-investigator did anyone provoke them first?';
    const progress = buildThreadQAProgressContainer('report-investigator', 'mod-123', rawQuestion);
    assert.ok(progress.components);
    assert.equal(progress.components[0].type, 17);
    const progressText = progress.components[0].components[0].content;
    // Inquiry heading should mention the agent
    assert.ok(progressText.includes('### 💬 Moderator Inquiry: `@report-investigator`'));
    // Question text should NOT contain @report-investigator
    assert.ok(progressText.includes('> **Question from <@mod-123>:**\n> Did anyone provoke them first?'));
    assert.ok(!progressText.includes('> @report-investigator'));

    const answered = buildThreadQAContainer(
      'V-100',
      'report-investigator',
      rawQuestion,
      'No provocation was detected in message logs.',
      'mod-123'
    );
    assert.ok(answered.components);
    const textComp = answered.components[0].components[0];
    assert.equal(textComp.type, 10);
    // Inquiry heading should mention the agent and report code
    assert.ok(textComp.content.includes('### 💬 Moderator Inquiry: `@report-investigator` • Report `V-100`'));
    // Question text should NOT contain @report-investigator
    assert.ok(textComp.content.includes('> **Question from <@mod-123>:**\n> Did anyone provoke them first?'));
    assert.ok(!textComp.content.includes('> @report-investigator'));
    assert.ok(textComp.content.includes('No provocation was detected'));
  });

  test('stripAgentMentions removes agent mentions and cleans punctuation and capitalization', () => {
    // User exact example
    assert.equal(
      stripAgentMentions('@report-investigator did anyone provoke them first?'),
      'Did anyone provoke them first?'
    );

    // With colon / comma / hyphen after mention
    assert.equal(
      stripAgentMentions('@report-investigator: did anyone provoke them first?'),
      'Did anyone provoke them first?'
    );
    assert.equal(
      stripAgentMentions('@investigator, did anyone provoke them first?'),
      'Did anyone provoke them first?'
    );
    assert.equal(
      stripAgentMentions('@report-triage - what is the severity?'),
      'What is the severity?'
    );

    // Other agents
    assert.equal(
      stripAgentMentions('@moderation-advisor what do you recommend?'),
      'What do you recommend?'
    );
    assert.equal(
      stripAgentMentions('@advisor why was this flagged?'),
      'Why was this flagged?'
    );

    // Trailing mention
    assert.equal(
      stripAgentMentions('did anyone provoke them first, @report-investigator?'),
      'Did anyone provoke them first?'
    );
    assert.equal(
      stripAgentMentions('did anyone provoke them first @report-investigator?'),
      'Did anyone provoke them first?'
    );
  });

  test('stripAgentMentions preserves legitimate user mentions and normal words', () => {
    // Legitimate user mention preserved
    assert.equal(
      stripAgentMentions('@report-investigator did @ace provoke them first?'),
      'Did @ace provoke them first?'
    );
    assert.equal(
      stripAgentMentions('@advisor did <@1241770510321451165> violate rule 3?'),
      'Did <@1241770510321451165> violate rule 3?'
    );
    assert.equal(
      stripAgentMentions('did @bob or @charlie provoke them?'),
      'Did @bob or @charlie provoke them?'
    );

    // Normal usage of word "investigator" or "advisor" without @ prefix
    assert.equal(
      stripAgentMentions('Did the investigator review all message logs?'),
      'Did the investigator review all message logs?'
    );
    assert.equal(
      stripAgentMentions('What did the advisor recommend?'),
      'What did the advisor recommend?'
    );
  });

  test('stripAgentMentions handles bot id and bot username mentions', () => {
    assert.equal(
      stripAgentMentions('<@123456789> why was this user reported?', '123456789', 'Verity'),
      'Why was this user reported?'
    );
    assert.equal(
      stripAgentMentions('@Verity why was this user reported?', '123456789', 'Verity'),
      'Why was this user reported?'
    );
  });
});
