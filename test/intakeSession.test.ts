import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';

describe('Intake Session Lifecycle & Security', () => {
  const db = new Database(':memory:');

  test('creates an intake session bound to reporter, guild, channel, target message and reported user', () => {
    const session = db.createIntakeSession({
      reporterId: 'reporter_123',
      guildId: 'guild_456',
      channelId: 'channel_789',
      targetMessageId: 'msg_999',
      reportedUserId: 'suspect_001',
      ttlMinutes: 15
    });

    assert.ok(session.id);
    assert.ok(session.sessionId);
    assert.equal(session.reporterId, 'reporter_123');
    assert.equal(session.guildId, 'guild_456');
    assert.equal(session.targetMessageId, 'msg_999');
    assert.equal(session.reportedUserId, 'suspect_001');
    assert.equal(session.used, false);
    assert.ok(session.expiresAt > Date.now());
  });

  test('successfully consumes an active, matching intake session', () => {
    const session = db.createIntakeSession({
      reporterId: 'reporter_user_a',
      guildId: 'guild_alpha',
      channelId: 'channel_main',
      targetMessageId: 'msg_101',
      reportedUserId: 'bad_actor_9',
      ttlMinutes: 15
    });

    const consumed = db.consumeIntakeSession({
      sessionId: session.sessionId,
      reporterId: 'reporter_user_a',
      guildId: 'guild_alpha'
    });

    assert.equal(consumed.used, true);
    assert.equal(consumed.reportedUserId, 'bad_actor_9');
  });

  test('prevents replay attacks: cannot consume the same session twice', () => {
    const session = db.createIntakeSession({
      reporterId: 'reporter_replay',
      guildId: 'guild_alpha',
      channelId: 'channel_main',
      targetMessageId: 'msg_102',
      reportedUserId: 'bad_actor_9'
    });

    // First consumption succeeds
    db.consumeIntakeSession({
      sessionId: session.sessionId,
      reporterId: 'reporter_replay',
      guildId: 'guild_alpha'
    });

    // Second consumption must fail
    assert.throws(
      () => {
        db.consumeIntakeSession({
          sessionId: session.sessionId,
          reporterId: 'reporter_replay',
          guildId: 'guild_alpha'
        });
      },
      /already been used/
    );
  });

  test('rejects expired intake sessions', () => {
    // TTL of negative minutes = already expired
    const session = db.createIntakeSession({
      reporterId: 'reporter_expired',
      guildId: 'guild_alpha',
      channelId: 'channel_main',
      targetMessageId: 'msg_103',
      reportedUserId: 'bad_actor_9',
      ttlMinutes: -5
    });

    assert.throws(
      () => {
        db.consumeIntakeSession({
          sessionId: session.sessionId,
          reporterId: 'reporter_expired',
          guildId: 'guild_alpha'
        });
      },
      /has expired/
    );
  });

  test('rejects forged submissions from a different reporter', () => {
    const session = db.createIntakeSession({
      reporterId: 'legit_reporter',
      guildId: 'guild_alpha',
      channelId: 'channel_main',
      targetMessageId: 'msg_104',
      reportedUserId: 'bad_actor_9'
    });

    assert.throws(
      () => {
        db.consumeIntakeSession({
          sessionId: session.sessionId,
          reporterId: 'imposter_user',
          guildId: 'guild_alpha'
        });
      },
      /reporter mismatch/
    );
  });

  test('rejects submissions with guild mismatch', () => {
    const session = db.createIntakeSession({
      reporterId: 'legit_reporter',
      guildId: 'guild_alpha',
      channelId: 'channel_main',
      targetMessageId: 'msg_105',
      reportedUserId: 'bad_actor_9'
    });

    assert.throws(
      () => {
        db.consumeIntakeSession({
          sessionId: session.sessionId,
          reporterId: 'legit_reporter',
          guildId: 'wrong_guild'
        });
      },
      /guild mismatch/
    );
  });
});
