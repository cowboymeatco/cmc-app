# 3CX ↔ cmc-app

The phone system (hosted 3CX, through Range) talks to the app two ways,
both driven by the CRM template in this folder:

| When                | 3CX does                                  | App route           |
|---------------------|-------------------------------------------|---------------------|
| Phone rings / dials | `GET /api/pbx/lookup?number=…`            | shows the customer on the ringing phone |
| Call ends           | `POST /api/pbx/report` (JSON)             | inserts one row in `phone_calls` |

Nothing is installed on the PBX. It only needs to reach the app over HTTPS.

## Setup

1. **App side.** Apply `scripts/2026-11-10_phone_calls.sql` as a Supabase
   migration, then set `PBX_API_KEY` in the app's Vercel environment to a
   long random string (`openssl rand -hex 32`). Both routes refuse everything
   until that variable exists.
2. **PBX side** (Range, or whoever has the 3CX admin console; needs 3CX Pro
   or Enterprise): Integrations > CRM > Add, upload `cmc-app.xml`, then fill
   in the three parameters: the app URL, the same API key, and `10` for digits
   to match. Save. Changes to the template itself need a 3CX service restart.
3. **Test** with the Test button on that page using a known customer's
   number and a made-up one. Both should return a contact; the second one as
   "Unknown caller". Then place a real call: journaling only runs after a real
   call ends, the Test button cannot exercise it.

## Known limits

- 3CX V20 U6+ only journals a call whose lookup returned a contact, which is
  why the lookup never returns empty.
- Community reports say 3CX skips journaling *missed* calls that rang a
  ring group or queue, to avoid one record per extension. If the main line
  rings a group, watch whether missed calls arrive at all before relying on
  the missed-call count. The fallback is the Call Control API, which needs an
  extra 3CX licence and a long-running listener; not built.
- `Transcription`, `Summary`, `RecordingUrl` only carry data if recording and
  transcription are enabled on the PBX.

## Field map (ReportCall body)

| Body field         | 3CX variable                      |
|--------------------|-----------------------------------|
| `call_type`        | `CallType` (Inbound / Outbound / Missed / Notanswered) |
| `direction`        | `CallDirection`                   |
| `number`           | `Number`                          |
| `entity_id`        | `EntityId` (customer uuid or `unknown:<digits>` from the lookup) |
| `contact_name`     | `Name`                            |
| `agent_ext`        | `Agent`                           |
| `agent_first/last` | `AgentFirstName` / `AgentLastName`|
| `agent_email`      | `AgentEmail`                      |
| `queue_ext`        | `QueueExtension`                  |
| `started_ms`       | `CallStartTimeUTCMillis`          |
| `answered_ms`      | `CallEstablishedTimeUTCMillis`    |
| `ended_ms`         | `CallEndTimeUTCMillis`            |
| `duration_seconds` | `DurationTimespan` total seconds  |
| `transcription`    | `Transcription`                   |
| `summary`          | `Summary`                         |
| `recording_url`    | `RecordingUrl`                    |
