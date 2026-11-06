import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhaseProgressContainer,
  buildPhase1Container,
  buildPhase2Container,
  buildPhase3Container,
  buildResolvedActionContainer,
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

  test('Phase progress container shows active agent and description in neutral container', () => {
    const payload = buildPhaseProgressContainer(1, 'report-triage', 'Evaluating urgency and policy category...');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal((container as any).accent_color, undefined);

    const textComp = container.components[0];
    assert.equal(textComp.type, 10);
    assert.ok(textComp.content.includes('@report-triage is working...'));
    assert.ok(textComp.content.includes('Phase 1: Report Triage'));
  });

  test('Phase 1 container uses type 10 (TEXT_DISPLAY) and is neutral without decorative accent color', () => {
    const payload = buildPhase1Container(mockReport, 'Severity: Medium. Urgency: Normal.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    assert.equal(payload.components.length, 1);

    const container = payload.components[0];
    assert.equal(container.type, 17); // Container
    assert.equal((container as any).accent_color, undefined); // Neutral container: no decorative accent

    const textComp = container.components[0];
    assert.equal(textComp.type, 10); // ComponentType.TEXT_DISPLAY
    assert.ok(textComp.content.includes('Phase 1: Report Triage Assessment'));
    assert.ok(textComp.content.includes('report-triage'));
  });

  test('Phase 2 container uses type 10 (TEXT_DISPLAY) and is neutral without decorative accent color', () => {
    const payload = buildPhase2Container(mockReport, 'Verified: Message exists. Unverified: Alleged external context.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal((container as any).accent_color, undefined); // Neutral container

    const textComp = container.components[0];
    assert.equal(textComp.type, 10); // ComponentType.TEXT_DISPLAY
    assert.ok(textComp.content.includes('Phase 2: Evidence Forensics & Verification'));
    assert.ok(textComp.content.includes('report-investigator'));
  });

  test('Phase 3 container uses type 10 (TEXT_DISPLAY) and includes exactly 2 Action Row decision buttons', () => {
    const payload = buildPhase3Container(mockReport, 'Recommended action: Warn member.');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    assert.equal((container as any).accent_color, undefined);

    const textComp = container.components.find((c: any) => c.type === 10);
    assert.ok(textComp, 'Text display must be present with type 10');
    assert.ok(textComp.content.includes('Phase 3: Moderation Advisor Recommendation'));
    // Ensure clutter lines are removed
    assert.ok(!textComp.content.includes('Recommended by Switch Agent moderation-advisor'));
    assert.ok(!textComp.content.includes('Human Decision Required'));

    const actionRow = container.components.find((c: any) => c.type === 1);
    assert.ok(actionRow, 'Action row must be present');
    assert.equal(actionRow.components.length, 2); // Take Action, Dismiss Report

    const buttons = actionRow.components;
    assert.equal(buttons[0].label, 'Take Action');
    assert.equal(buttons[0].custom_id, `verity:act:take_action:${mockReport.id}`);
    assert.equal(buttons[0].style, 1); // Primary / Blurple

    assert.equal(buttons[1].label, 'Dismiss Report');
    assert.equal(buttons[1].custom_id, `verity:act:dismiss:${mockReport.id}`);
    assert.equal(buttons[1].style, 2); // Secondary / Gray
  });

  test('Resolved action container enforces Emerald Green accent (0x22C55E) and removes action buttons', () => {
    const payload = buildResolvedActionContainer({
      report: mockReport,
      advisorContent: 'Recommended action: Timeout 24h.',
      actionTaken: 'timeout',
      moderatorId: 'mod_999',
      officialReason: '24h timeout applied following confirmed spam pattern.',
      executedAt: Date.now()
    });

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    // Meaningful accent color for resolved outcome
    assert.equal(container.accent_color, 0x22C55E);

    // Verify Action Row is completely removed
    const actionRow = container.components.find((c: any) => c.type === 1);
    assert.equal(actionRow, undefined, 'Action buttons must be removed when resolved');

    // Verify resolution text display
    const resTextComp = container.components.find((c: any) => c.content?.includes('Status: Resolved'));
    assert.ok(resTextComp);
    assert.equal(resTextComp.type, 10);
    assert.ok(resTextComp.content.includes('TIMEOUT'));
    assert.ok(resTextComp.content.includes('target_456'));
    assert.ok(resTextComp.content.includes('mod_999'));
  });

  test('Error container enforces Crimson Red accent color (0xEF4444) and uses type 10 for text', () => {
    const payload = buildInvestigationErrorContainer('V-042', 'Switch connection timeout');

    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const container = payload.components[0];
    assert.equal(container.type, 17);
    // Meaningful accent color for error alert
    assert.equal(container.accent_color, 0xEF4444);

    const textComp = container.components[0];
    assert.equal(textComp.type, 10); // TEXT_DISPLAY
    assert.ok(textComp.content.includes('Investigation Alert'));
    assert.ok(textComp.content.includes('Switch connection timeout'));
  });
});
