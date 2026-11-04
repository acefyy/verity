import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { handleActionButton } from '../src/discord/interactions/actionButtonHandler.js';
import { PermissionFlagsBits } from 'discord.js';

describe('Interactive Action Button & Human Resolution Tests', () => {
  let dbInstance: Database;

  beforeEach(() => {
    dbInstance = new Database(':memory:');
  });

  afterEach(() => {
    dbInstance.close();
  });

  test('database records moderation resolution and transitions report status', () => {
    const report = dbInstance.createReport({
      reportCode: 'V-099',
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      messageLink: 'https://discord.com/...',
      reportedUserId: 'u_target',
      reporterId: 'u_reporter',
      reason: 'Harassment in public voice text channel.'
    });

    dbInstance.updateReportStatus(report.id, 'awaiting_human_action', 'switch-room-99');

    const resolution = dbInstance.recordModerationResolution({
      reportId: report.id,
      moderatorId: 'u_mod',
      actionTaken: 'timeout',
      officialReason: '24h timeout enforced following verification of harassment.',
      targetUserId: 'u_target'
    });

    dbInstance.updateReportStatus(report.id, 'resolved');

    assert.equal(resolution.reportId, report.id);
    assert.equal(resolution.actionTaken, 'timeout');
    assert.equal(resolution.moderatorId, 'u_mod');

    const fetched = dbInstance.getReportById(report.id);
    assert.equal(fetched?.status, 'resolved');

    const fetchedRes = dbInstance.getModerationResolution(report.id);
    assert.equal(fetchedRes?.actionTaken, 'timeout');
    assert.equal(fetchedRes?.targetUserId, 'u_target');
  });

  test('records investigation milestones chronologically', () => {
    const report = dbInstance.createReport({
      reportCode: 'V-100',
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      messageLink: 'https://discord.com/...',
      reportedUserId: 'u_target',
      reporterId: 'u_reporter',
      reason: 'Spam links.'
    });

    dbInstance.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 1: Triage',
      agentName: 'report-triage',
      content: 'Triage complete. Severity: Low.'
    });

    dbInstance.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 2: Forensics',
      agentName: 'report-investigator',
      content: 'Forensics complete. Link confirmed.'
    });

    dbInstance.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 3: Advisor',
      agentName: 'moderation-advisor',
      content: 'Recommendation: Issue warning.'
    });

    const milestones = dbInstance.getInvestigationMilestones(report.id);
    assert.equal(milestones.length, 3);
    assert.equal(milestones[0].agentName, 'report-triage');
    assert.equal(milestones[1].agentName, 'report-investigator');
    assert.equal(milestones[2].agentName, 'moderation-advisor');
  });
});
