import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { buildReportModal } from '../src/discord/components/modalBuilder.js';
import { buildReportContainer } from '../src/discord/components/reportContainerBuilder.js';
import { ValidatedFile } from '../src/evidence/validator.js';

describe('End-to-End Report Intake Flow Simulation', () => {
  const db = new Database(':memory:');

  test('executes complete intake flow from context menu to persistent report & thread', () => {
    // === Step 1: User right clicks message -> Apps -> "Report Message" ===
    const mockContextMenuInteraction = {
      guildId: '111222333444',
      channelId: '555666777888',
      targetMessage: {
        id: '999888777666',
        author: {
          id: 'bad_actor_snowflake',
          username: 'TrollUser'
        }
      },
      user: {
        id: 'vigilant_member_snowflake',
        username: 'GoodUser'
      }
    };

    // Backend creates server-side intake session bound to target author
    const intakeSession = db.createIntakeSession({
      reporterId: mockContextMenuInteraction.user.id,
      guildId: mockContextMenuInteraction.guildId,
      channelId: mockContextMenuInteraction.channelId,
      targetMessageId: mockContextMenuInteraction.targetMessage.id,
      reportedUserId: mockContextMenuInteraction.targetMessage.author.id,
      ttlMinutes: 15
    });

    assert.ok(intakeSession.sessionId);
    assert.equal(intakeSession.reportedUserId, 'bad_actor_snowflake');

    // Build modal returned to the user
    const modalPayload = buildReportModal(
      intakeSession.sessionId,
      mockContextMenuInteraction.targetMessage.id
    );
    assert.equal(modalPayload.custom_id, `verity:modal:report:${intakeSession.sessionId}`);

    // === Step 2: User submits modal ===
    const mockModalSubmit = {
      sessionId: intakeSession.sessionId,
      reporterId: mockContextMenuInteraction.user.id,
      guildId: mockContextMenuInteraction.guildId,
      submittedReason: 'This member posted explicit targeted harassment and slurs towards another user.'
    };

    // Backend validates and consumes intake session
    const consumedSession = db.consumeIntakeSession({
      sessionId: mockModalSubmit.sessionId,
      reporterId: mockModalSubmit.reporterId,
      guildId: mockModalSubmit.guildId
    });

    assert.equal(consumedSession.used, true);
    assert.equal(consumedSession.reportedUserId, 'bad_actor_snowflake');

    // Backend generates unique report record
    const messageLink = `https://discord.com/channels/${consumedSession.guildId}/${consumedSession.channelId}/${consumedSession.targetMessageId}`;
    const report = db.createReport({
      guildId: consumedSession.guildId,
      channelId: consumedSession.channelId,
      messageId: consumedSession.targetMessageId,
      messageLink,
      reportedUserId: consumedSession.reportedUserId, // strictly bound from intake session
      reporterId: consumedSession.reporterId,
      reason: mockModalSubmit.submittedReason
    });

    assert.equal(report.reportCode, 'V-001');
    assert.equal(report.reportedUserId, 'bad_actor_snowflake');
    assert.equal(report.reporterId, 'vigilant_member_snowflake');
    assert.equal(report.status, 'submitted');

    // Simulate in-memory validated evidence file (zero local disk persistence)
    const mockFile: ValidatedFile = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      originalFilename: 'harassment_proof.png',
      sanitizedFilename: 'harassment_proof.png',
      detectedMimeType: 'image/png',
      sizeBytes: 8,
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    };

    // Store evidence metadata in DB with simulated Discord CDN URL
    const meta = db.addEvidenceMetadata({
      reportId: report.id,
      filename: mockFile.sanitizedFilename,
      detectedMimeType: mockFile.detectedMimeType,
      sizeBytes: mockFile.sizeBytes,
      sha256Hash: mockFile.sha256Hash,
      discordCdnUrl: 'https://cdn.discordapp.com/attachments/111/222/harassment_proof.png',
      discordAttachmentId: 'att_777888'
    });

    assert.ok(meta.id);
    assert.equal(meta.filename, 'harassment_proof.png');
    assert.equal(meta.detectedMimeType, 'image/png');

    // Simulate Discord message & thread creation
    const mockReportsMsgId = 'msg_discord_rep_001';
    const mockThreadId = 'thread_discord_rep_001';
    db.updateReportDiscordIds(report.id, mockReportsMsgId, mockThreadId);

    // Verify final state
    const retrievedReport = db.getReportById(report.id);
    assert.ok(retrievedReport);
    assert.equal(retrievedReport.discordReportsMsgId, mockReportsMsgId);
    assert.equal(retrievedReport.discordThreadId, mockThreadId);

    const evidenceList = db.getEvidenceByReportId(report.id);
    assert.equal(evidenceList.length, 1);
    assert.equal(evidenceList[0].sha256Hash, mockFile.sha256Hash);

    // Verify next report code increments cleanly
    const report2 = db.createReport({
      guildId: consumedSession.guildId,
      channelId: consumedSession.channelId,
      messageId: 'msg_999999',
      messageLink: 'https://discord.com/...',
      reportedUserId: 'another_user',
      reporterId: 'reporter_2',
      reason: 'Another violation reason that satisfies minimum length requirement.'
    });
    assert.equal(report2.reportCode, 'V-002');
  });
});
