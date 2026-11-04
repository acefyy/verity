# Verity: AI-Assisted Discord Moderation & Investigation Workflow

Verity transforms Discord community moderation from chaotic, reactive policing into a structured, auditable business investigation workflow powered by **Switch**.

Submitted to the **Flip the Switch Hackathon** (Track 01: Best Business Workflow).

---

## The Problem

Community moderation in Discord is notoriously broken:
- **Moderator Fatigue & Burnout:** Volunteer moderators juggle dozens of vague, emotionally charged user reports daily.
- **Missing Context & Evidence Tampering:** Reports often lack critical channel context, or rely on manipulated screenshots without cryptographic integrity checks.
- **Inconsistent Enforcement:** Different moderators apply contradictory standards for similar offenses, damaging community trust.
- **Uncontrolled Bot Permissions:** Most moderation bots either automate punitive actions recklessly or require risky, unchecked permissions.

## The Solution

Verity reimagines moderation as an institutional case management workflow:
1. **Secure Intake:** Context-menu report capture with cryptographic anti-replay sessions, in-memory magic-byte evidence inspection, and Discord Components V2 containers.
2. **Switch Multi-Agent Room:** Automatically provisions an isolated Switch room per report with three specialized OpenCode AI agents collaborating in a phased pipeline:
   - **Phase 1: Report Triage** (`report-triage`): Rapid assessment of urgency, severity, and rule categorization.
   - **Phase 2: Evidence Forensics** (`report-investigator`): Detailed verification of reported messages, preceding context, and evidence integrity.
   - **Phase 3: Moderation Advisor** (`moderation-advisor`): Policy synthesis and proportional punishment recommendation.
3. **Human Authorization & Execution:** AI agents never possess Discord punishment permissions. Verity enforces a strict two-tier permission and role-hierarchy check on the human moderator before executing actions (`Dismiss`, `Warn`, `Timeout`, `Kick`, `Ban`) directly via interactive Discord buttons.
4. **Closed-Loop Audit Trail:** Final human decisions are updated in-place inside Discord threads and synchronized back to the Switch room, leaving an immutable record across both platforms.
5. **Server Governance & Settings:** Dedicated `/settings` slash command with Channel Selects and Checkboxes to configure report routing, action audit log channels, and mandatory evidence enforcement.

---

## System Architecture

```
[ Discord User ]
       │
       │ Right-click Message -> "Report Message"
       ▼
[ Intake Gateway ]
  ├── 1. Creates 15-min cryptographic intake session (SQLite WAL)
  ├── 2. Opens Discord Components V2 modal (Reason + File Upload)
  ├── 3. Validates magic bytes (PNG/JPEG/WebP/PDF) & hashes SHA-256 in memory
  └── 4. Re-uploads files to Discord; zero permanent binary disk storage
       │
       ▼
[ Discord #reports Channel ]
  ├── Neutral Components V2 Container (Flags: 32768, Type 17)
  └── Dedicated Investigation Thread created automatically
       │
       ▼
[ Verity Orchestrator ]
  ├── 1. POST /gateway/rooms -> Provisions isolated room in Switch
  ├── 2. Binds 3 agents: report-triage, report-investigator, moderation-advisor
  └── 3. Coordinates multi-phase investigation:
       │
       ├── Phase 1: @report-triage
       │     └── Discord thread live progress -> Edits in place with Triage TL;DR
       │
       ├── Phase 2: @report-investigator
       │     └── Discord thread live progress -> Edits in place with Forensics TL;DR
       │
       └── Phase 3: @moderation-advisor
             └── Discord thread live progress -> Edits in place with Recommendation
                   + 5 Interactive Action Buttons: [Dismiss] [Warn] [Timeout] [Kick] [Ban]
       │
       ▼
[ Human Moderator Decision ]
  ├── Checks server settings (Require Evidence toggle)
  ├── Verifies moderator server permissions (Administrator / Moderate / Kick / Ban)
  ├── Verifies Discord role hierarchy (Moderator > Target, Bot > Target)
  ├── Executes Discord moderation action via API
  ├── Updates Discord action container in place to Emerald Green (0x22C55E)
  ├── Sends formatted audit log to Action Log Channel (if configured)
  └── Synchronizes resolution and reason back to Switch room chat
```

---

## Core Capabilities

### 1. Robust Intake Security & Zero-Storage Evidence
- **Cryptographic Intake Sessions:** Every context-menu invocation generates an atomic intake session tied to the reporter, guild, channel, and target message. Replays, expired sessions, and forged origins are rejected.
- **In-Memory Magic Byte Validation:** Uploaded evidence is inspected via true binary signatures (PNG, JPEG, WebP, PDF), not spoofable file extensions or client MIME headers.
- **Zero Disk Persistence:** Buffers are validated in memory and re-uploaded directly to Discord via native File components. No user binaries or sensitive images are stored on host disk.

### 2. Deep Switch Integration
- **Isolated Case Rooms:** Every report spins up a dedicated Switch room (`internal_only: true`) populated exclusively by the report's assigned investigation agents.
- **OpenCode Agent Pipeline:** Agents collaborate sequentially, with each agent building on the findings and context produced by the previous agent.
- **Structured Briefing:** The orchestrator feeds target message content, channel history (preceding context), and cryptographic attachment hashes into the room.
- **Compact Syntheses:** Strict prompt instructions enforce concise `**TL;DR:**` summaries and structured bullet points to ensure readability.

### 3. Modern Discord Components V2 UI
- **Pure Components V2 Architecture:** Built with `flags: 32768`, using Container components (`type: 17`), Text Display components (`type: 10`), Separators (`type: 14`), and File components (`type: 13`).
- **In-Place Live Updates:** When an agent begins work, Verity posts a live progress container (`⏳ @agent is working...`) and edits it in place to the final findings upon completion.
- **In-Place Case Resolution:** When a moderator clicks an action button, the message is updated in place to an Emerald Green resolution badge (`0x22C55E`), disabling the buttons and displaying who authorized the action, what action was taken, and the official reason.

### 4. Human-in-the-Loop Governance & Evidence Enforcement
- **Zero Agent Autonomy for Punishments:** AI agents advise; humans decide.
- **Two-Tier Discord Permission Verification:** Validates server-side that the clicking user has the required native Discord permissions (`ModerateMembers`, `KickMembers`, `BanMembers`).
- **Role Hierarchy Enforcement:** Ensures neither the moderator nor the bot can act against a user with equal or higher role position, preventing privilege escalation.
- **Require Evidence Policy:** When enabled in `/settings`, moderators cannot complete punitive actions on reports lacking evidence without providing verified proof details via an interactive confirmation modal.

### 5. Server-Specific Settings & Action Audit Logs (`/settings`)
- **Immediate Configuration Modal:** Running `/settings` opens an interactive configuration modal with native Channel Selects and Checkboxes.
- **Report Channel Routing:** Directs incoming reports and investigation threads to any designated channel per guild.
- **Action Log Channel:** Sends formatted Components V2 audit logs to an authorized channel whenever moderation actions (`Warn`, `Timeout`, `Kick`, `Ban`, `Dismiss`) are completed.
- **Graceful Fault Tolerance:** Gracefully handles missing channels, deleted channels, and insufficient bot permissions without crashing or halting moderation workflows.

---

## Switch Agent Specifications

Verity utilizes three specialized agents configured in the Switch workspace:

| Agent Name | Switch Identifier | Primary Responsibility |
| :--- | :--- | :--- |
| **Report Triage** | `report-triage` | Analyzes initial report claims, assigns urgency level, and categorizes violation type against server rules. |
| **Report Investigator** | `report-investigator` | Evaluates message content, reviews preceding conversation context, cross-references evidence files, and identifies unsubstantiated claims. |
| **Moderation Advisor** | `moderation-advisor` | Synthesizes triage and forensics, evaluates mitigating or aggravating circumstances, and recommends a specific, proportionate moderation action. |

---

## Project Structure

```
verity/
├── src/
│   ├── index.ts                                # Application entry point & crash resilience
│   ├── config.ts                               # Environment configuration and validation
│   ├── db/
│   │   ├── database.ts                         # SQLite WAL repository (Sessions, Reports, Settings, Milestones)
│   │   └── schema.ts                           # Database table definitions and indices
│   ├── discord/
│   │   ├── client.ts                           # Discord client setup & interaction routing
│   │   ├── registerCommands.ts                 # Slash and context menu command registration
│   │   ├── commands/
│   │   │   ├── reportCommand.ts                # "Report Message" context menu definition
│   │   │   └── settingsCommand.ts              # "/settings" slash command definition
│   │   ├── components/
│   │   │   ├── modalBuilder.ts                 # 2-field Components V2 report modal
│   │   │   ├── settingsModalBuilder.ts         # Channel Select & Checkbox configuration modal
│   │   │   ├── actionLogContainerBuilder.ts    # Moderation action audit log container
│   │   │   ├── reportContainerBuilder.ts       # #reports neutral container & thread initial message
│   │   │   └── investigationContainerBuilder.ts # Live progress, phase findings & resolution containers
│   │   └── interactions/
│   │       ├── contextMenuHandler.ts           # Intake session initialization & modal display
│   │       ├── modalSubmitHandler.ts           # Modal ingestion, validation, thread creation & dispatch
│   │       ├── modalParsers.ts                 # Channel Select, Checkbox and input extraction helpers
│   │       ├── settingsHandler.ts              # /settings command and settings modal submission handler
│   │       ├── actionButtonHandler.ts          # Moderator authorization, role hierarchy & action triggers
│   │       └── actionExecution.ts              # Resolution execution, container edits & action logging
│   ├── evidence/
│   │   └── validator.ts                        # Magic byte inspection, SHA-256 & memory buffers
│   ├── investigation/
│   │   └── orchestrator.ts                     # Switch room lifecycle & 3-phase handoff coordinator
│   └── switch/
│       └── switchClient.ts                     # Switch Gateway REST client & polling manager
├── test/
│   ├── actionButtonHandler.test.ts             # Moderator authorization & resolution persistence
│   ├── componentsV2.test.ts                    # Components V2 payload layout & styling
│   ├── evidenceValidator.test.ts               # Magic byte checks, file bounds & path traversal safety
│   ├── intakeFlowE2E.test.ts                   # Full end-to-end report lifecycle simulation
│   ├── intakeSession.test.ts                   # Intake session creation, replay prevention & TTL
│   ├── investigationContainers.test.ts         # Agent containers, buttons & resolution styling
│   ├── settingsWorkflow.test.ts                # Settings modal, channel selectors, checkboxes & logs
│   └── switchClient.test.ts                    # Switch authentication, room provisioning & messaging
├── .env.example                                # Sample environment configuration
├── package.json                                # Project dependencies and scripts
└── tsconfig.json                               # TypeScript compiler configuration
```

---

## Getting Started

### Prerequisites

- **Node.js:** v20.x or higher (tested on Node v22 and v24)
- **Discord Bot:** Created in the [Discord Developer Portal](https://discord.com/developers/applications) with:
  - `bot` and `applications.commands` OAuth2 scopes
  - Privileged Intents: `Guild Messages`, `Message Content`
  - Permissions: `Manage Messages`, `Moderate Members`, `Kick Members`, `Ban Members`, `Send Messages`, `Create Public Threads`
- **Switch AI Server:** A running Switch instance (local Docker or remote deployment)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/acefyy/verity.git
cd verity
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Populate the required configuration keys:

```ini
# Discord Bot Credentials
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id_here
DISCORD_GUILD_ID=your_testing_guild_id_here
DISCORD_REPORTS_CHANNEL_ID=your_reports_channel_id_here

# SQLite Database
DATABASE_PATH=./verity.db

# Switch Gateway & Agent IDs
SWITCH_API_URL=http://localhost:58014/gateway
SWITCH_ADMIN_EMAIL=admin@switch.local
SWITCH_ADMIN_PASSWORD=your_switch_admin_password
SWITCH_AGENT_TRIAGE_ID=7839ce54-ba74-4ccf-89d3-dd56412ff843
SWITCH_AGENT_INVESTIGATOR_ID=9f7e0e8f-c00b-4734-b25d-473b06513c10
SWITCH_AGENT_ADVISOR_ID=9646eee2-cea5-436e-9aba-8a3a2040b1d7
```

### 3. Run Automated Tests

Verity includes an extensive suite of 39 automated tests covering database operations, cryptographic intake sessions, magic byte validation, Switch REST client calls, Discord Components V2 formatting, and server settings workflows:

```bash
npm test
```

Expected output:
```
ℹ tests 39
ℹ suites 8
ℹ pass 39
ℹ fail 0
```

### 4. Start the Application

Start the service in development mode:

```bash
npm run dev
```

Or for production:

```bash
npm start
```

Upon startup, Verity registers the `Report Message` context-menu command and `/settings` slash command with Discord, verifies Switch gateway connectivity, and resumes any pending investigations if recovering from an interruption.

---

## Verifying the Workflow in Discord

1. **Configure Server Settings:** Run `/settings` in any server channel to open the Reports configuration modal:
   - Select the **Report Channel** for incoming reports.
   - (Optional) Select an **Action Log Channel** for moderation audit logs.
   - Toggle **Require Evidence** to enforce proof before moderation actions can be executed.
2. **Submit a Report:** In any Discord server channel, right-click any message -> **Apps** -> **Report Message**.
3. **Modal Intake:** Enter a detailed reason (15 to 1,000 characters) and optionally upload evidence screenshots or PDF files.
4. **Automated Multi-Agent Review:** Watch the thread as Switch orchestrates the 3 phases in real time:
   - Progress container announces active agent work.
   - Phase 1 delivers Triage findings.
   - Phase 2 delivers Evidence Forensics.
   - Phase 3 delivers Moderation Advisor recommendation with action buttons.
5. **Human Moderator Authorization:** A moderator clicks any action button (`Warn`, `Timeout`, `Kick`, `Ban`, or `Dismiss`).
   - If **Require Evidence** is enabled and the report lacks evidence, Verity presents an interactive confirmation modal requiring proof before completion.
6. **Execution & Auditing:** Verity validates moderator permissions and role hierarchy, executes the action, updates the container in place to Emerald Green, sends an audit log to the Action Log Channel, and notifies the Switch room.

---

## License

MIT
