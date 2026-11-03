# Verity — AI-Assisted Discord Moderation & Investigation Workflow

Verity transforms Discord community moderation from ad-hoc, reactive policing into a structured, auditable business investigation workflow using **Switch**.

## Milestone 1: Discord Report Intake

This milestone implements the complete Discord report intake experience:
1. **Message Context Menu Command:** `Report Message` (`ApplicationCommandType.Message`).
2. **Two-Field Modal:**
   - Required Reason text input (15–1000 characters, paragraph style).
   - Optional File Upload (maximum 5 files, up to 10MB each).
3. **Automatic Author Identification:** Reported member is captured authoritatively from `targetMessage.author.id`. No User Select Menu.
4. **Server-Side Intake Session:** Cryptographically random session with 15-minute TTL, enforcing one-time atomic consumption, origin verification, and anti-replay protection.
5. **In-Memory Evidence Validation:**
   - Validates magic byte signatures (PNG, JPEG, WebP, PDF).
   - Rejects spoofed or truncated files.
   - Computes SHA-256 integrity hashes in memory.
   - Zero local disk storage or permanent file copies (immediately re-uploaded to Discord).
6. **Components V2 Container:**
   - Neutral styling (`flags: 32768`, Container type `17`, no decorative accent colors).
   - Displays report ID (`V-001`), reported member, reporter, channel, jump link, reason, and native File components (`type: 13`).
   - Automatically creates an isolated investigation thread under the report.

## Setup & Testing

### 1. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your Discord credentials:
```bash
cp .env.example .env
```
Set the following keys:
- `DISCORD_TOKEN`: Your Discord Bot Token.
- `DISCORD_CLIENT_ID`: Your Discord Application Client ID.
- `DISCORD_GUILD_ID`: (Optional) Your target server ID for instant command registration.
- `DISCORD_REPORTS_CHANNEL_ID`: Channel ID of `#reports`.

### 2. Run Automated Test Suite
```bash
npm test
```
Runs 19 automated unit and integration tests covering:
- Components V2 UI payload specifications.
- In-memory magic byte inspection and file limits.
- Intake session lifecycle, anti-replay, and expiration.
- End-to-end report intake flow simulation.

### 3. Launch Discord Bot
```bash
npm start
```
Registers the `Report Message` context menu command and connects to the Discord gateway.
