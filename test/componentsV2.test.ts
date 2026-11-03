import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reportCommandData } from '../src/discord/commands/reportCommand.js';
import { buildReportModal } from '../src/discord/components/modalBuilder.js';
import {
  buildReportContainer,
  buildThreadInitialContainer
} from '../src/discord/components/reportContainerBuilder.js';
import { Report } from '../src/db/database.js';

describe('Discord Components V2 UI Payload Specifications', () => {
  test('context menu command is configured as Message Context Menu (type 3)', () => {
    assert.equal(reportCommandData.name, 'Report Message');
    assert.equal(reportCommandData.type, 3); // ApplicationCommandType.Message
  });

  test('modal payload contains exactly two fields wrapped in Label (type 18) and NO User Select menu', () => {
    const modal = buildReportModal('test_session_123', 'target_msg_456');

    assert.equal(modal.title, 'Report Message');
    assert.equal(modal.custom_id, 'verity:modal:report:test_session_123');
    assert.equal(modal.components.length, 2);

    // Field 1: Reason Text Input
    const field1 = modal.components[0];
    assert.equal(field1.type, 18); // ComponentType.LABEL
    assert.equal(field1.label, 'Reason for Report');
    assert.equal(field1.component.type, 4); // ComponentType.TEXT_INPUT
    assert.equal(field1.component.custom_id, 'verity:field:reason');
    assert.equal(field1.component.style, 2); // Paragraph
    assert.equal(field1.component.min_length, 15);
    assert.equal(field1.component.max_length, 1000);
    assert.equal(field1.component.required, true);

    // Field 2: File Upload (max 5 files, optional)
    const field2 = modal.components[1];
    assert.equal(field2.type, 18); // ComponentType.LABEL
    assert.equal(field2.label, 'Evidence & Screenshots (Optional)');
    assert.equal(field2.component.type, 19); // ComponentType.FILE_UPLOAD
    assert.equal(field2.component.custom_id, 'verity:field:proof_upload');
    assert.equal(field2.component.min_values, 0);
    assert.equal(field2.component.max_values, 5);
    assert.equal(field2.component.required, false);

    // Verify NO User Select menu exists in modal components
    const hasUserSelect = modal.components.some(
      (c) => c.component?.type === 5 || (c as any).type === 5
    );
    assert.equal(hasUserSelect, false);
  });

  test('report container uses IS_COMPONENTS_V2 flag and neutral Container without decorative accent color', () => {
    const mockReport: Report = {
      id: 'rep_uuid_1',
      reportCode: 'V-001',
      guildId: 'guild_100',
      channelId: 'chan_200',
      messageId: 'msg_300',
      messageLink: 'https://discord.com/channels/guild_100/chan_200/msg_300',
      reportedUserId: 'suspect_user_id',
      reporterId: 'reporter_user_id',
      reason: 'Violated server rules by spamming malicious scam links in the main channel.',
      status: 'submitted',
      createdAt: 1730678400000,
      updatedAt: 1730678400000
    };

    const validatedFile = {
      buffer: Buffer.from('dummy'),
      originalFilename: 'proof.png',
      sanitizedFilename: 'proof.png',
      detectedMimeType: 'image/png',
      sizeBytes: 1234,
      sha256Hash: 'abcd1234'
    };

    const payload = buildReportContainer({
      report: mockReport,
      files: [validatedFile],
      threadUrl: 'https://discord.com/channels/guild_100/thread_999'
    });

    assert.equal(payload.flags, 32768); // IS_COMPONENTS_V2
    assert.equal(payload.components.length, 1);

    const rootContainer = payload.components[0];
    assert.equal(rootContainer.type, 17); // Container
    // Must NOT have accent color (neutral styling for pending report)
    assert.equal((rootContainer as any).accent_color, undefined);

    // Check that reported member is prominently displayed
    const textDisplays = rootContainer.components.filter((c: any) => c.type === 10);
    assert.ok(textDisplays.length >= 3);
    assert.ok(textDisplays[1].content.includes('<@suspect_user_id>'));
    assert.ok(textDisplays[1].content.includes('<@reporter_user_id>'));

    // Check that File component is used for evidence (NOT Media Gallery)
    const fileComponents = rootContainer.components.filter((c: any) => c.type === 13);
    assert.equal(fileComponents.length, 1);
    assert.equal(fileComponents[0].file.url, 'attachment://proof.png');

    const mediaGalleries = rootContainer.components.filter((c: any) => c.type === 12);
    assert.equal(mediaGalleries.length, 0); // Media Gallery is prohibited for report evidence
  });

  test('thread initial container is created with neutral Container and structured info', () => {
    const mockReport: Report = {
      id: 'rep_uuid_2',
      reportCode: 'V-002',
      guildId: 'guild_100',
      channelId: 'chan_200',
      messageId: 'msg_301',
      messageLink: 'https://discord.com/channels/guild_100/chan_200/msg_301',
      reportedUserId: 'target_user_id',
      reporterId: 'reporter_user_id',
      reason: 'Harassment and personal attacks in chat.',
      status: 'submitted',
      createdAt: 1730678400000,
      updatedAt: 1730678400000
    };

    const threadPayload = buildThreadInitialContainer(mockReport);
    assert.equal(threadPayload.flags, 32768);
    assert.equal(threadPayload.components[0].type, 17);
    assert.ok(threadPayload.components[0].components[0].content.includes('V-002'));
  });
});
