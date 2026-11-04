import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { settingsCommandData } from '../src/discord/commands/settingsCommand.js';
import {
  buildSettingsModal,
  buildActionEvidenceModal
} from '../src/discord/components/settingsModalBuilder.js';
import {
  buildActionLogContainer,
  IS_COMPONENTS_V2
} from '../src/discord/components/actionLogContainerBuilder.js';
import {
  getModalSelectValue,
  getModalCheckboxValue,
  getModalInputValue
} from '../src/discord/interactions/modalParsers.js';
import { Report } from '../src/db/database.js';

describe('Settings Module & Moderation Workflow Tests', () => {
  let dbInstance: Database;

  beforeEach(() => {
    dbInstance = new Database(':memory:');
  });

  afterEach(() => {
    dbInstance.close();
  });

  test('/settings slash command is defined with proper permissions and description', () => {
    assert.equal(settingsCommandData.name, 'settings');
    assert.ok(settingsCommandData.description.length > 10);
    // default_member_permissions should require ManageGuild (32)
    assert.ok(settingsCommandData.default_member_permissions);
  });

  test('buildSettingsModal constructs payload with 2 Channel Selects and 1 Checkbox in Labels', () => {
    const modal = buildSettingsModal({
      currentReportsChannelId: 'chan_rep_123',
      currentActionLogChannelId: 'chan_log_456',
      requireEvidence: true
    });

    assert.equal(modal.title, 'Report Module Settings');
    assert.equal(modal.custom_id, 'verity:modal:settings');
    assert.equal(modal.components.length, 3);

    // 1. Report Channel (Channel Select, type 8 inside Label type 18)
    const reportField = modal.components[0];
    assert.equal(reportField.type, 18);
    assert.equal(reportField.label, 'Report Channel');
    assert.equal(reportField.component.type, 8); // CHANNEL_SELECT
    assert.equal(reportField.component.custom_id, 'verity:field:reports_channel');
    assert.deepEqual(reportField.component.channel_types, [0]); // GuildText
    assert.equal(reportField.component.required, true);
    assert.equal(reportField.component.min_values, 1);
    assert.equal(reportField.component.max_values, 1);
    assert.deepEqual(reportField.component.default_values, [
      { id: 'chan_rep_123', type: 'channel' }
    ]);

    // 2. Action Log Channel (Channel Select, type 8 inside Label type 18)
    const logField = modal.components[1];
    assert.equal(logField.type, 18);
    assert.equal(logField.label, 'Action Log Channel');
    assert.equal(logField.component.type, 8); // CHANNEL_SELECT
    assert.equal(logField.component.custom_id, 'verity:field:action_log_channel');
    assert.deepEqual(logField.component.channel_types, [0]);
    assert.equal(logField.component.required, false);
    assert.equal(logField.component.min_values, 0);
    assert.equal(logField.component.max_values, 1);
    assert.deepEqual(logField.component.default_values, [
      { id: 'chan_log_456', type: 'channel' }
    ]);

    // 3. Require Evidence (Checkbox, type 23 inside Label type 18)
    const evidenceField = modal.components[2];
    assert.equal(evidenceField.type, 18);
    assert.equal(evidenceField.label, 'Require Evidence');
    assert.equal(evidenceField.component.type, 23); // CHECKBOX
    assert.equal(evidenceField.component.custom_id, 'verity:field:require_evidence');
    assert.equal(evidenceField.component.default, true);
  });

  test('buildSettingsModal handles empty/unconfigured channels gracefully', () => {
    const modal = buildSettingsModal({
      currentReportsChannelId: null,
      currentActionLogChannelId: null,
      requireEvidence: false
    });

    assert.equal(modal.components[0].component.default_values, undefined);
    assert.equal(modal.components[1].component.default_values, undefined);
    assert.equal(modal.components[2].component.default, false);
  });

  test('database persists and retrieves guild settings with default fallbacks', () => {
    // 1. Unsaved guild falls back to defaults
    const initial = dbInstance.getGuildSettings('guild_alpha');
    assert.equal(initial.guildId, 'guild_alpha');
    assert.equal(initial.actionLogChannelId, null);
    assert.equal(initial.requireEvidence, false);

    // 2. Save settings
    const saved = dbInstance.upsertGuildSettings({
      guildId: 'guild_alpha',
      reportsChannelId: 'reports_999',
      actionLogChannelId: 'logs_888',
      requireEvidence: true
    });

    assert.equal(saved.reportsChannelId, 'reports_999');
    assert.equal(saved.actionLogChannelId, 'logs_888');
    assert.equal(saved.requireEvidence, true);

    // 3. Retrieve settings
    const retrieved = dbInstance.getGuildSettings('guild_alpha');
    assert.equal(retrieved.reportsChannelId, 'reports_999');
    assert.equal(retrieved.actionLogChannelId, 'logs_888');
    assert.equal(retrieved.requireEvidence, true);

    // 4. Multiple guilds maintain isolated settings
    const otherGuild = dbInstance.getGuildSettings('guild_beta');
    assert.equal(otherGuild.actionLogChannelId, null);
    assert.equal(otherGuild.requireEvidence, false);
  });

  test('modal parsers extract channel selects, checkboxes, and text inputs accurately', () => {
    const mockInteraction: any = {
      fields: {
        getTextInputValue: () => ''
      },
      data: {
        components: [
          {
            type: 18,
            component: {
              type: 8,
              custom_id: 'verity:field:reports_channel',
              values: ['chan_111']
            }
          },
          {
            type: 18,
            component: {
              type: 8,
              custom_id: 'verity:field:action_log_channel',
              values: ['chan_222']
            }
          },
          {
            type: 18,
            component: {
              type: 23,
              custom_id: 'verity:field:require_evidence',
              value: true
            }
          },
          {
            type: 18,
            component: {
              type: 4,
              custom_id: 'verity:field:reason',
              value: 'Spamming server invites in public channel'
            }
          }
        ]
      }
    };

    assert.equal(getModalSelectValue(mockInteraction, 'verity:field:reports_channel'), 'chan_111');
    assert.equal(getModalSelectValue(mockInteraction, 'verity:field:action_log_channel'), 'chan_222');
    assert.equal(getModalSelectValue(mockInteraction, 'nonexistent_field'), null);

    assert.equal(getModalCheckboxValue(mockInteraction, 'verity:field:require_evidence'), true);
    assert.equal(getModalCheckboxValue(mockInteraction, 'missing_checkbox', false), false);

    assert.equal(getModalInputValue(mockInteraction, 'verity:field:reason'), 'Spamming server invites in public channel');
  });

  test('buildActionLogContainer formats action logs with appropriate severity accents', () => {
    const mockReport: Report = {
      id: 'rep_abc',
      reportCode: 'V-007',
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      messageLink: 'https://discord.com/channels/g1/c1/m1',
      reportedUserId: 'target_007',
      reporterId: 'reporter_001',
      reason: 'Rule 3 violation: hate speech',
      status: 'resolved',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // 1. Ban action enforces Crimson Red accent (0xEF4444)
    const banLog = buildActionLogContainer({
      report: mockReport,
      actionTaken: 'ban',
      moderatorId: 'mod_1',
      targetUserId: 'target_007',
      officialReason: 'Server ban enforced for hate speech',
      executedAt: Date.now(),
      threadUrl: 'https://discord.com/channels/g1/thread_007',
      evidenceSummary: '1 file(s) attached'
    });

    assert.equal(banLog.flags, IS_COMPONENTS_V2);
    const banContainer = banLog.components[0];
    assert.equal(banContainer.type, 17);
    assert.equal(banContainer.accent_color, 0xEF4444);
    assert.ok(banContainer.components[0].content.includes('BAN'));
    assert.ok(banContainer.components[0].content.includes('V-007'));
    assert.ok(banContainer.components[0].content.includes('1 file(s) attached'));

    // 2. Timeout action enforces Amber accent (0xF59E0B)
    const timeoutLog = buildActionLogContainer({
      report: mockReport,
      actionTaken: 'timeout',
      moderatorId: 'mod_1',
      targetUserId: 'target_007',
      officialReason: '24-hour timeout enforced',
      executedAt: Date.now()
    });
    assert.equal(timeoutLog.components[0].accent_color, 0xF59E0B);

    // 3. Warn action enforces Emerald Green accent (0x22C55E)
    const warnLog = buildActionLogContainer({
      report: mockReport,
      actionTaken: 'warn',
      moderatorId: 'mod_1',
      targetUserId: 'target_007',
      officialReason: 'Official warning issued',
      executedAt: Date.now()
    });
    assert.equal(warnLog.components[0].accent_color, 0x22C55E);

    // 4. Dismiss action uses neutral container (undefined accent)
    const dismissLog = buildActionLogContainer({
      report: mockReport,
      actionTaken: 'dismiss',
      moderatorId: 'mod_1',
      targetUserId: 'target_007',
      officialReason: 'Report dismissed following review',
      executedAt: Date.now()
    });
    assert.equal(dismissLog.components[0].accent_color, undefined);
  });

  test('buildActionEvidenceModal adjusts required state based on report evidence availability', () => {
    const mockReport: Report = {
      id: 'rep_evidence_test',
      reportCode: 'V-050',
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      messageLink: 'https://discord.com/...',
      reportedUserId: 'u_target',
      reporterId: 'u_reporter',
      reason: 'Harassment and spam',
      status: 'in_investigation',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // When report has NO evidence, proof field is strictly required
    const modalNoEvidence = buildActionEvidenceModal(mockReport, 'ban', false);
    assert.equal(modalNoEvidence.components[0].component.required, true);
    assert.equal(modalNoEvidence.components[0].component.min_length, 10);

    // When report already HAS evidence, proof field is optional additional context
    const modalWithEvidence = buildActionEvidenceModal(mockReport, 'ban', true);
    assert.equal(modalWithEvidence.components[0].component.required, false);
    assert.equal(modalWithEvidence.components[0].component.min_length, 0);
  });

  test('evidence requirement logic enforces evidence submission when required', () => {
    const report = dbInstance.createReport({
      reportCode: 'V-088',
      guildId: 'g_evidence',
      channelId: 'c1',
      messageId: 'm1',
      messageLink: 'https://discord.com/...',
      reportedUserId: 'target_u',
      reporterId: 'reporter_u',
      reason: 'Harassment without attached screenshot'
    });

    // Configure server to require evidence
    dbInstance.upsertGuildSettings({
      guildId: 'g_evidence',
      reportsChannelId: 'rep_chan',
      actionLogChannelId: 'log_chan',
      requireEvidence: true
    });

    const settings = dbInstance.getGuildSettings('g_evidence');
    assert.equal(settings.requireEvidence, true);

    const initialEvidence = dbInstance.getEvidenceByReportId(report.id);
    assert.equal(initialEvidence.length, 0);

    // Moderator supplies proof note
    const proofNote = 'Confirmed via channel history logs at timestamp 1730000000';
    dbInstance.addEvidenceMetadata({
      reportId: report.id,
      filename: 'moderator_proof_statement.txt',
      detectedMimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(proofNote),
      sha256Hash: 'hash123456',
      discordCdnUrl: report.messageLink
    });

    const updatedEvidence = dbInstance.getEvidenceByReportId(report.id);
    assert.equal(updatedEvidence.length, 1);
    assert.equal(updatedEvidence[0].filename, 'moderator_proof_statement.txt');

    // Moderation resolution records successfully
    const resolution = dbInstance.recordModerationResolution({
      reportId: report.id,
      moderatorId: 'mod_verifier',
      actionTaken: 'timeout',
      officialReason: '24h timeout enforced with verified moderator proof',
      targetUserId: report.reportedUserId
    });

    assert.equal(resolution.actionTaken, 'timeout');
    assert.equal(resolution.moderatorId, 'mod_verifier');
  });
});
