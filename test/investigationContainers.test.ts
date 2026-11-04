import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhase1Container,
  buildPhase2Container,
  buildPhase3Container,
  buildResolutionContainer,
  buildInvestigationErrorContainer,
  IS_COMPONENTS_V2
} from '../src/discord/components/investigationContainerBuilder.js';
import { Report } from '../src/db/database.js';

describe('Investigation Components V2 Container Specifications', () => {
  const mockReport: Report = {
    id: 'rep_123',
    reportCode: 'V-042',
    guildId: 'guild_100',
    channelId: 'chan_200',
    messageId: 'msg_300',
    messageLink: 'https://discord.com/channels/guild_100/chan_200/msg_300',
    reportedUserId: 'target_456',
    reporterId: 'reporter_789',
    reason: 'Alleged harassment and policy violation in general chat.',
    status: 'in_investigation',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  test('Phase 1 container is neutral (no accent color) with IS_COMPONENTS_V2 flag', () => {
    const payload = buildPhase1Container(mockReport, 'Severity: Medium. Urgency: Normal.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    assert.equal(payload.components.length, 1);

    const container = payload.components[0];
    assert.equal(container.type, 17); // Container
    assert.equal(container.accent_color, undefined); // Neutral container: no decorative accent

    const textComp = container.components[0];
    assert.equal(textComp.type, 14); // Text Display
    assert.ok(textComp.content.includes('Phase 1: Report Triage Assessment'));
    assert.ok(textComp.content.includes('report-triage'));
  });

  test('Phase 2 container is neutral (no accent color) with IS_COMPONENTS_V2 flag', () => {
    const payload = buildPhase2Container(mockReport, 'Verified: Message exists. Unverified: Alleged external context.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal(container.accent_color, undefined); // Neutral container

    const textComp = container.components[0];
    assert.equal(textComp.type, 14);
    assert.ok(textComp.content.includes('Phase 2: Evidence Forensics & Verification'));
    assert.ok(textComp.content.includes('report-investigator'));
  });

  test('Phase 3 container includes 4 Action Row decision buttons', () => {
    const payload = buildPhase3Container(mockReport, 'Recommended action: Warn member.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal(container.accent_color, undefined);

    const actionRow = container.components.find((c: any) => c.type === 1);
    assert.ok(actionRow, 'Action row must be present');
    assert.equal(actionRow.components.length, 4);

    const buttons = actionRow.components;
    assert.equal(buttons[0].custom_id, `verity:act:dismiss:${mockReport.id}`);
    assert.equal(buttons[0].style, 2); // Secondary / Gray

    assert.equal(buttons[1].custom_id, `verity:act:warn:${mockReport.id}`);
    assert.equal(buttons[1].style, 1); // Primary

    assert.equal(buttons[2].custom_id, `verity:act:timeout:${mockReport.id}`);
    assert.equal(buttons[2].style, 1); // Primary

    assert.equal(buttons[3].custom_id, `verity:act:ban:${mockReport.id}`);
    assert.equal(buttons[3].style, 4); // Danger / Red
  });

  test('Resolution container enforces Emerald Green accent color (0x22C55E)', () => {
    const payload = buildResolutionContainer({
      reportCode: 'V-042',
      actionTaken: 'timeout',
      moderatorId: 'mod_999',
      officialReason: '24h timeout applied following confirmed spam pattern.',
      targetUserId: 'target_456',
      executedAt: Date.now()
    });

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    // Meaningful accent color for resolved outcome
    assert.equal(container.accent_color, 0x22C55E);

    const textComp = container.components[0];
    assert.equal(textComp.type, 14);
    assert.ok(textComp.content.includes('Case Resolved: TIMEOUT'));
    assert.ok(textComp.content.includes('target_456'));
    assert.ok(textComp.content.includes('mod_999'));
  });

  test('Error container enforces Crimson Red accent color (0xEF4444)', () => {
    const payload = buildInvestigationErrorContainer('V-042', 'Switch connection timeout');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    // Meaningful accent color for error alert
    assert.equal(container.accent_color, 0xEF4444);

    const textComp = container.components[0];
    assert.equal(textComp.type, 14);
    assert.ok(textComp.content.includes('Investigation Alert'));
    assert.ok(textComp.content.includes('Switch connection timeout'));
  });
});
