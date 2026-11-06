import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database, Report } from '../src/db/database.js';
import {
  buildTakeActionModal,
  buildSettingsModal
} from '../src/discord/components/settingsModalBuilder.js';
import { buildReportModal } from '../src/discord/components/modalBuilder.js';
import {
  getModalInputValue,
  getModalSelectValue,
  getModalCheckboxValue
} from '../src/discord/interactions/modalParsers.js';
import { parseDuration } from '../src/discord/interactions/modalSubmitHandler.js';

describe('Take Action Modal, Evidence Settings & Duration Parsing Tests', () => {
  let dbInstance: Database;

  beforeEach(() => {
    dbInstance = new Database(':memory:');
  });

  afterEach(() => {
    dbInstance.close();
  });

  const mockReport: Report = {
    id: 'rep_take_act_1',
    reportCode: 'V-099',
    guildId: 'guild_test',
    channelId: 'chan_test',
    messageId: 'msg_test',
    messageLink: 'https://discord.com/channels/guild_test/chan_test/msg_test',
    reportedUserId: 'user_target_99',
    reporterId: 'user_reporter_88',
    reason: 'Target is posting unauthorized affiliate links in violation of server rule 4.',
    status: 'in_investigation',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  test('buildTakeActionModal generates 4 components wrapped in Labels with correct defaults', () => {
    const modal = buildTakeActionModal({
      report: mockReport
    });

    assert.equal(modal.title, 'Take Action: V-099');
    assert.equal(modal.custom_id, `verity:modal:take_action:${mockReport.id}`);
    assert.equal(modal.components.length, 4);

    // 1. Punishment Action select menu
    const actionField = modal.components[0];
    assert.equal(actionField.type, 18); // Label
    assert.equal(actionField.label, 'Punishment Action');
    assert.equal(actionField.component.type, 3); // STRING_SELECT
    assert.equal(actionField.component.custom_id, 'verity:field:action_type');
    assert.equal(actionField.component.required, true);
    assert.equal((actionField.component as any).options.length, 4);
    const actionValues = (actionField.component as any).options.map((o: any) => o.value);
    assert.deepEqual(actionValues, ['warn', 'timeout', 'kick', 'ban']);

    // 2. Duration text input
    const durationField = modal.components[1];
    assert.equal(durationField.type, 18);
    assert.equal(durationField.label, 'Duration (Mute / Timeout only)');
    assert.equal(durationField.component.type, 4); // TEXT_INPUT
    assert.equal(durationField.component.custom_id, 'verity:field:action_duration');
    assert.equal(durationField.component.value, '24h');
    assert.equal(durationField.component.required, false);

    // 3. Reason text input pre-filled with report reason
    const reasonField = modal.components[2];
    assert.equal(reasonField.type, 18);
    assert.equal(reasonField.label, 'Moderation Reason');
    assert.equal(reasonField.component.type, 4);
    assert.equal(reasonField.component.custom_id, 'verity:field:action_reason');
    assert.equal(reasonField.component.value, mockReport.reason);
    assert.equal(reasonField.component.required, true);

    // 4. Evidence text input is always optional for moderators
    const evidenceField = modal.components[3];
    assert.equal(evidenceField.type, 18);
    assert.equal(evidenceField.label, 'Evidence & Notes (Optional)');
    assert.equal(evidenceField.component.type, 4);
    assert.equal(evidenceField.component.custom_id, 'verity:field:action_evidence');
    assert.equal(evidenceField.component.required, false);
    assert.equal(evidenceField.component.min_length, 0);
  });

  test('buildTakeActionModal never requires evidence from moderators', () => {
    const modal = buildTakeActionModal({
      report: mockReport
    });

    const evidenceField = modal.components[3];
    assert.equal(evidenceField.label, 'Evidence & Notes (Optional)');
    assert.equal(evidenceField.component.required, false);
    assert.equal(evidenceField.component.min_length, 0);
  });

  test('buildReportModal honors requireEvidence boolean setting', () => {
    // When disabled (default)
    const modalDisabled = buildReportModal('sess_1', 'msg_1', false);
    const uploadDisabled = modalDisabled.components[1];
    assert.equal(uploadDisabled.label, 'Evidence & Screenshots (Optional)');
    assert.equal(uploadDisabled.component.required, false);
    assert.equal(uploadDisabled.component.min_values, 0);

    // When enabled
    const modalEnabled = buildReportModal('sess_2', 'msg_2', true);
    const uploadEnabled = modalEnabled.components[1];
    assert.equal(uploadEnabled.label, 'Evidence & Screenshots (Required)');
    assert.equal(uploadEnabled.component.required, true);
    assert.equal(uploadEnabled.component.min_values, 1);
  });

  test('parseDuration accurately parses minutes, hours, days and enforces limits', () => {
    // Empty input defaults to 24 hours
    assert.deepEqual(parseDuration(''), { ms: 24 * 3600 * 1000, label: '24 hours' });
    assert.deepEqual(parseDuration(undefined), { ms: 24 * 3600 * 1000, label: '24 hours' });

    // Valid inputs
    assert.deepEqual(parseDuration('10m'), { ms: 10 * 60 * 1000, label: '10 minutes' });
    assert.deepEqual(parseDuration('1m'), { ms: 1 * 60 * 1000, label: '1 minute' });
    assert.deepEqual(parseDuration('1h'), { ms: 1 * 3600 * 1000, label: '1 hour' });
    assert.deepEqual(parseDuration('6h'), { ms: 6 * 3600 * 1000, label: '6 hours' });
    assert.deepEqual(parseDuration('24h'), { ms: 24 * 3600 * 1000, label: '24 hours' });
    assert.deepEqual(parseDuration('1d'), { ms: 24 * 3600 * 1000, label: '1 day' });
    assert.deepEqual(parseDuration('7d'), { ms: 7 * 24 * 3600 * 1000, label: '7 days' });
    assert.deepEqual(parseDuration('28d'), { ms: 28 * 24 * 3600 * 1000, label: '28 days' });

    // Exceeding 28-day Discord limit
    assert.equal(parseDuration('29d'), null);
    assert.equal(parseDuration('60d'), null);

    // Invalid format
    assert.equal(parseDuration('invalid'), null);
    assert.equal(parseDuration('-5h'), null);
    assert.equal(parseDuration('0m'), null);
  });

  test('modalParsers extract select menus, checkboxes, and inputs from discord.js transformed components', () => {
    // Simulating discord.js transformed interaction.components structure
    const transformedComponents = [
      {
        type: 18,
        component: {
          type: 8,
          customId: 'verity:field:reports_channel',
          values: ['chan_selected_999']
        }
      },
      {
        type: 18,
        component: {
          type: 23,
          customId: 'verity:field:require_evidence',
          value: true
        }
      },
      {
        type: 18,
        component: {
          type: 3,
          customId: 'verity:field:action_type',
          values: ['timeout']
        }
      },
      {
        type: 18,
        component: {
          type: 4,
          customId: 'verity:field:action_reason',
          value: 'Spamming server invites repeatedly'
        }
      }
    ];

    const mockInteraction: any = {
      components: transformedComponents,
      fields: {
        getTextInputValue: (id: string) => (id === 'verity:field:action_reason' ? 'Spamming server invites repeatedly' : ''),
        getCheckbox: (id: string) => (id === 'verity:field:require_evidence' ? true : false),
        getField: (id: string) => {
          if (id === 'verity:field:reports_channel') {
            return { type: 8, customId: id, values: ['chan_selected_999'] };
          }
          if (id === 'verity:field:action_type') {
            return { type: 3, customId: id, values: ['timeout'] };
          }
          throw new Error('Not found');
        }
      }
    };

    // Test channel select
    assert.equal(getModalSelectValue(mockInteraction, 'verity:field:reports_channel'), 'chan_selected_999');

    // Test action type string select
    assert.equal(getModalSelectValue(mockInteraction, 'verity:field:action_type'), 'timeout');

    // Test checkbox
    assert.equal(getModalCheckboxValue(mockInteraction, 'verity:field:require_evidence'), true);

    // Test text input
    assert.equal(getModalInputValue(mockInteraction, 'verity:field:action_reason'), 'Spamming server invites repeatedly');
  });

  test('modalParsers handle both checkbox states (true and false) properly', () => {
    const trueInteraction: any = {
      fields: {
        getCheckbox: (id: string) => (id === 'verity:field:require_evidence' ? true : false)
      }
    };
    assert.equal(getModalCheckboxValue(trueInteraction, 'verity:field:require_evidence'), true);

    const falseInteraction: any = {
      fields: {
        getCheckbox: (id: string) => false
      }
    };
    assert.equal(getModalCheckboxValue(falseInteraction, 'verity:field:require_evidence'), false);
  });
});
