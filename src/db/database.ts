import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from './schema.js';
import { config } from '../config.js';

export interface IntakeSession {
  id: string;
  sessionId: string;
  reporterId: string;
  guildId: string;
  channelId: string;
  targetMessageId: string;
  reportedUserId: string;
  used: boolean;
  expiresAt: number;
  createdAt: number;
}

export interface Report {
  id: string;
  reportCode: string;
  guildId: string;
  channelId: string;
  messageId: string;
  messageLink: string;
  reportedUserId: string;
  reporterId: string;
  reason: string;
  status: string;
  discordReportsMsgId?: string | null;
  discordThreadId?: string | null;
  discordThreadInitialMsgId?: string | null;
  switchRoomId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InvestigationMilestone {
  id: string;
  reportId: string;
  phase: string;
  agentName: string;
  content: string;
  completedAt: number;
}

export interface ModerationResolution {
  id: string;
  reportId: string;
  moderatorId: string;
  actionTaken: string;
  officialReason: string;
  targetUserId: string;
  executedAt: number;
}

export interface EvidenceMetadata {
  id: string;
  reportId: string;
  filename: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  discordCdnUrl: string;
  discordAttachmentId?: string | null;
  createdAt: number;
}

export interface GuildSettings {
  guildId: string;
  reportsChannelId: string;
  actionLogChannelId: string | null;
  requireEvidence: boolean;
  updatedAt: number;
}

export class Database {
  private db: DatabaseSync;

  constructor(dbPath: string = config.databasePath) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    // Enable WAL mode and busy timeout for concurrent safety
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      // Ignore if in-memory or unsupported
    }
    this.db.exec(SCHEMA_SQL);

    // Ensure backwards compatibility with any existing DB files missing columns
    try {
      this.db.exec('ALTER TABLE reports ADD COLUMN switch_room_id TEXT;');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE reports ADD COLUMN discord_thread_initial_msg_id TEXT;');
    } catch {
      // Column already exists
    }
  }

  public close(): void {
    this.db.close();
  }

  // --- Guild Settings ---

  public getGuildSettings(guildId: string): GuildSettings {
    const stmt = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
    const row = stmt.get(guildId) as any;
    if (!row) {
      return {
        guildId,
        reportsChannelId: config.reportsChannelId,
        actionLogChannelId: null,
        requireEvidence: false,
        updatedAt: Date.now()
      };
    }
    return {
      guildId: row.guild_id,
      reportsChannelId: row.reports_channel_id || config.reportsChannelId,
      actionLogChannelId: row.action_log_channel_id || null,
      requireEvidence: row.require_evidence === 1,
      updatedAt: row.updated_at
    };
  }

  public upsertGuildSettings(params: {
    guildId: string;
    reportsChannelId: string;
    actionLogChannelId?: string | null;
    requireEvidence: boolean;
  }): GuildSettings {
    const now = Date.now();
    const actionLogChannelId = params.actionLogChannelId ?? null;
    const requireEvidenceInt = params.requireEvidence ? 1 : 0;

    const stmt = this.db.prepare(`
      INSERT INTO guild_settings (guild_id, reports_channel_id, action_log_channel_id, require_evidence, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        reports_channel_id = excluded.reports_channel_id,
        action_log_channel_id = excluded.action_log_channel_id,
        require_evidence = excluded.require_evidence,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      params.guildId,
      params.reportsChannelId,
      actionLogChannelId,
      requireEvidenceInt,
      now
    );

    return {
      guildId: params.guildId,
      reportsChannelId: params.reportsChannelId,
      actionLogChannelId,
      requireEvidence: params.requireEvidence,
      updatedAt: now
    };
  }

  // --- Intake Sessions ---

  public createIntakeSession(params: {
    reporterId: string;
    guildId: string;
    channelId: string;
    targetMessageId: string;
    reportedUserId: string;
    ttlMinutes?: number;
  }): IntakeSession {
    const id = randomUUID();
    const sessionId = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + (params.ttlMinutes ?? 15) * 60 * 1000;

    const stmt = this.db.prepare(`
      INSERT INTO intake_sessions (
        id, session_id, reporter_id, guild_id, channel_id,
        target_message_id, reported_user_id, used, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run(
      id,
      sessionId,
      params.reporterId,
      params.guildId,
      params.channelId,
      params.targetMessageId,
      params.reportedUserId,
      expiresAt,
      createdAt
    );

    return {
      id,
      sessionId,
      reporterId: params.reporterId,
      guildId: params.guildId,
      channelId: params.channelId,
      targetMessageId: params.targetMessageId,
      reportedUserId: params.reportedUserId,
      used: false,
      expiresAt,
      createdAt
    };
  }

  public consumeIntakeSession(params: {
    sessionId: string;
    reporterId: string;
    guildId: string;
  }): IntakeSession {
    const now = Date.now();

    // Query session
    const selectStmt = this.db.prepare(`
      SELECT * FROM intake_sessions WHERE session_id = ?
    `);
    const row = selectStmt.get(params.sessionId) as any;

    if (!row) {
      throw new Error('Intake session not found or invalid.');
    }

    if (row.used === 1) {
      throw new Error('Intake session has already been used (replay prevented).');
    }

    if (row.expires_at < now) {
      throw new Error('Intake session has expired.');
    }

    if (row.reporter_id !== params.reporterId) {
      throw new Error('Intake session reporter mismatch (unauthorized submission origin).');
    }

    if (row.guild_id !== params.guildId) {
      throw new Error('Intake session guild mismatch.');
    }

    // Mark as used atomically
    const updateStmt = this.db.prepare(`
      UPDATE intake_sessions SET used = 1 WHERE session_id = ? AND used = 0
    `);
    const result = updateStmt.run(params.sessionId);

    if (result.changes === 0) {
      throw new Error('Concurrent session consumption conflict.');
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      reporterId: row.reporter_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      targetMessageId: row.target_message_id,
      reportedUserId: row.reported_user_id,
      used: true,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    };
  }

  // --- Reports ---

  public getNextReportCode(): string {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM reports');
    const result = stmt.get() as any;
    const nextNum = (result?.count ?? 0) + 1;
    return `V-${String(nextNum).padStart(3, '0')}`;
  }

  public createReport(params: {
    reportCode?: string;
    guildId: string;
    channelId: string;
    messageId: string;
    messageLink: string;
    reportedUserId: string;
    reporterId: string;
    reason: string;
    status?: string;
  }): Report {
    const id = randomUUID();
    const reportCode = params.reportCode ?? this.getNextReportCode();
    const now = Date.now();
    const status = params.status ?? 'submitted';

    const stmt = this.db.prepare(`
      INSERT INTO reports (
        id, report_code, guild_id, channel_id, message_id,
        message_link, reported_user_id, reporter_id, reason,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      reportCode,
      params.guildId,
      params.channelId,
      params.messageId,
      params.messageLink,
      params.reportedUserId,
      params.reporterId,
      params.reason,
      status,
      now,
      now
    );

    return {
      id,
      reportCode,
      guildId: params.guildId,
      channelId: params.channelId,
      messageId: params.messageId,
      messageLink: params.messageLink,
      reportedUserId: params.reportedUserId,
      reporterId: params.reporterId,
      reason: params.reason,
      status,
      createdAt: now,
      updatedAt: now
    };
  }

  public updateReportDiscordIds(
    reportId: string,
    discordReportsMsgId: string,
    discordThreadId: string,
    discordThreadInitialMsgId?: string | null
  ): void {
    const now = Date.now();
    if (discordThreadInitialMsgId !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE reports
        SET discord_reports_msg_id = ?, discord_thread_id = ?, discord_thread_initial_msg_id = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(discordReportsMsgId, discordThreadId, discordThreadInitialMsgId, now, reportId);
    } else {
      const stmt = this.db.prepare(`
        UPDATE reports
        SET discord_reports_msg_id = ?, discord_thread_id = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(discordReportsMsgId, discordThreadId, now, reportId);
    }
  }

  public updateReportStatus(
    reportId: string,
    status: string,
    switchRoomId?: string | null
  ): void {
    const now = Date.now();
    if (switchRoomId !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE reports
        SET status = ?, switch_room_id = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, switchRoomId, now, reportId);
    } else {
      const stmt = this.db.prepare(`
        UPDATE reports
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, now, reportId);
    }
  }

  public getReportById(reportId: string): Report | null {
    const stmt = this.db.prepare('SELECT * FROM reports WHERE id = ?');
    const row = stmt.get(reportId) as any;
    if (!row) return null;
    return this.mapReportRow(row);
  }

  public getReportByCode(reportCode: string): Report | null {
    const stmt = this.db.prepare('SELECT * FROM reports WHERE report_code = ?');
    const row = stmt.get(reportCode) as any;
    if (!row) return null;
    return this.mapReportRow(row);
  }

  public getPendingReports(): Report[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reports
      WHERE status = 'submitted' AND discord_thread_id IS NOT NULL AND discord_thread_id != ''
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map((r) => this.mapReportRow(r));
  }

  // --- Evidence Metadata ---

  public addEvidenceMetadata(params: {
    reportId: string;
    filename: string;
    detectedMimeType: string;
    sizeBytes: number;
    sha256Hash: string;
    discordCdnUrl: string;
    discordAttachmentId?: string | null;
  }): EvidenceMetadata {
    const id = randomUUID();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO report_evidence_metadata (
        id, report_id, filename, detected_mime_type,
        size_bytes, sha256_hash, discord_cdn_url,
        discord_attachment_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.reportId,
      params.filename,
      params.detectedMimeType,
      params.sizeBytes,
      params.sha256Hash,
      params.discordCdnUrl,
      params.discordAttachmentId ?? null,
      now
    );

    return {
      id,
      reportId: params.reportId,
      filename: params.filename,
      detectedMimeType: params.detectedMimeType,
      sizeBytes: params.sizeBytes,
      sha256Hash: params.sha256Hash,
      discordCdnUrl: params.discordCdnUrl,
      discordAttachmentId: params.discordAttachmentId ?? null,
      createdAt: now
    };
  }

  public getEvidenceByReportId(reportId: string): EvidenceMetadata[] {
    const stmt = this.db.prepare(`
      SELECT * FROM report_evidence_metadata WHERE report_id = ?
    `);
    const rows = stmt.all(reportId) as any[];
    return rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      filename: r.filename,
      detectedMimeType: r.detected_mime_type,
      sizeBytes: r.size_bytes,
      sha256Hash: r.sha256_hash,
      discordCdnUrl: r.discord_cdn_url,
      discordAttachmentId: r.discord_attachment_id,
      createdAt: r.created_at
    }));
  }

  // --- Investigation Milestones ---

  public addInvestigationMilestone(params: {
    reportId: string;
    phase: string;
    agentName: string;
    content: string;
  }): InvestigationMilestone {
    const id = randomUUID();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO investigation_milestones (
        id, report_id, phase, agent_name, content, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.reportId,
      params.phase,
      params.agentName,
      params.content,
      now
    );

    return {
      id,
      reportId: params.reportId,
      phase: params.phase,
      agentName: params.agentName,
      content: params.content,
      completedAt: now
    };
  }

  public getInvestigationMilestones(reportId: string): InvestigationMilestone[] {
    const stmt = this.db.prepare(`
      SELECT * FROM investigation_milestones
      WHERE report_id = ?
      ORDER BY completed_at ASC
    `);
    const rows = stmt.all(reportId) as any[];
    return rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      phase: r.phase,
      agentName: r.agent_name,
      content: r.content,
      completedAt: r.completed_at
    }));
  }

  // --- Moderation Resolutions ---

  public recordModerationResolution(params: {
    reportId: string;
    moderatorId: string;
    actionTaken: string;
    officialReason: string;
    targetUserId: string;
  }): ModerationResolution {
    const id = randomUUID();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO moderation_resolutions (
        id, report_id, moderator_id, action_taken,
        official_reason, target_user_id, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.reportId,
      params.moderatorId,
      params.actionTaken,
      params.officialReason,
      params.targetUserId,
      now
    );

    return {
      id,
      reportId: params.reportId,
      moderatorId: params.moderatorId,
      actionTaken: params.actionTaken,
      officialReason: params.officialReason,
      targetUserId: params.targetUserId,
      executedAt: now
    };
  }

  public getModerationResolution(reportId: string): ModerationResolution | null {
    const stmt = this.db.prepare(`
      SELECT * FROM moderation_resolutions WHERE report_id = ?
    `);
    const row = stmt.get(reportId) as any;
    if (!row) return null;
    return {
      id: row.id,
      reportId: row.report_id,
      moderatorId: row.moderator_id,
      actionTaken: row.action_taken,
      officialReason: row.official_reason,
      targetUserId: row.target_user_id,
      executedAt: row.executed_at
    };
  }

  private mapReportRow(row: any): Report {
    return {
      id: row.id,
      reportCode: row.report_code,
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      messageLink: row.message_link,
      reportedUserId: row.reported_user_id,
      reporterId: row.reporter_id,
      reason: row.reason,
      status: row.status,
      discordReportsMsgId: row.discord_reports_msg_id,
      discordThreadId: row.discord_thread_id,
      discordThreadInitialMsgId: row.discord_thread_initial_msg_id ?? null,
      switchRoomId: row.switch_room_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

// Lazy global database instance to prevent locking when multiple test files import database.ts
let _defaultDb: Database | null = null;

export const db = new Proxy({} as Database, {
  get(_target, prop) {
    if (!_defaultDb) {
      _defaultDb = new Database();
    }
    const val = (_defaultDb as any)[prop];
    if (typeof val === 'function') {
      return val.bind(_defaultDb);
    }
    return val;
  }
});
