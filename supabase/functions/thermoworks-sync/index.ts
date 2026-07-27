/**
 * ThermoWorks Cloud -> Supabase sync (server-side).
 *
 * Port of scripts/thermoworks/sync.py. Runs on a schedule via pg_cron so no
 * Windows machine needs to be awake.
 *
 * ThermoWorks Cloud is a Firebase app:
 *   1. fetch the web config to learn the Firestore project id
 *   2. sign in with email/password via Identity Toolkit -> idToken
 *   3. read device channel documents straight out of Firestore REST
 *
 * Required secrets:
 *   THERMOWORKS_EMAIL, THERMOWORKS_PASSWORD
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (injected automatically)
 * Optional:
 *   THERMOWORKS_CONFIG  - JSON, same shape as scripts/thermoworks/config.json.
 *                         Lets you remap channels without redeploying.
 */

// Public Firebase web-app identifiers for cloud.thermoworks.com. Not secrets —
// they ship in the ThermoWorks web client. Lifted from the thermoworks-cloud
// Python package so both implementations stay in step.
const TW_API_KEY = "AIzaSyCf079iccUFc1k7VHdGXng22zXDy8Y3KEY";
const TW_APP_ID = "1:78998049458:web:b41e9d405d8c7de95eefab";
const TW_REFERER = "https://cloud.thermoworks.com/";

const FIREBASE_HOST = "https://firebase.googleapis.com";
const IDENTITY_HOST = "https://identitytoolkit.googleapis.com";
const FIRESTORE_HOST = "https://firestore.googleapis.com";

/** Cold storage rows are stamped in shop-local time, matching the Python script. */
const SHOP_TZ = "America/Denver";

const CHANNEL_TIMEOUT_MS = 30_000;

type ColdStorageMapping = {
  serial: string;
  channel: number;
  unit_key: string;
  channel_label?: string;
};

type CookChannel = { channel: number; label?: string };

type SyncConfig = {
  cold_storage?: ColdStorageMapping[];
  cook_logger?: { serial: string; channels?: CookChannel[] } | null;
};

/**
 * Mirrors scripts/thermoworks/config.json — keep the two in step.
 *
 * Two ThermoWorks devices are misnamed on their side; the mapping below reflects
 * what the probe is physically in, confirmed by Charlie 2026-07-26:
 *   - device "Retail Cooler"  is actually the Showcase Cooler
 *   - device "Retail Freezer" has a stale channel label of "Hog Cooler"
 */
const DEFAULT_CONFIG: SyncConfig = {
  cold_storage: [
    { serial: "24:4C:AB:D7:2B:FC", channel: 1, unit_key: "showcase_freezer_f", channel_label: "Showcase Freezer" },
    { serial: "24:4C:AB:D7:15:E8", channel: 1, unit_key: "showcase_cooler_f", channel_label: "Showcase Cooler" },
    { serial: "10:97:BD:34:82:34", channel: 1, unit_key: "retail_freezer_f", channel_label: "Retail Freezer" },
    { serial: "B0:A7:32:C5:C7:48", channel: 1, unit_key: "custom_freezer_middle_f", channel_label: "Custom Freezer - Middle" },
    { serial: "24:4C:AB:D7:22:44", channel: 1, unit_key: "custom_freezer_east_f", channel_label: "Custom Freezer - East Side" },
    { serial: "70:B8:F6:99:16:58", channel: 1, unit_key: "new_carcass_cooler_f", channel_label: "New Carcass Cooler" },
    { serial: "94:B5:55:8E:29:E0", channel: 1, unit_key: "old_carcass_cooler_f", channel_label: "Old Carcass Cooler" },
  ],
  cook_logger: {
    serial: "D24380282",
    channels: [
      { channel: 1, label: "SENSOR 1" },
      { channel: 2, label: "SENSOR 2" },
    ],
  },
};

const log: string[] = [];
function note(msg: string) {
  console.log(msg);
  log.push(msg);
}

// ── ThermoWorks ───────────────────────────────────────────────────────────────

async function twSignIn(email: string, password: string) {
  const cfgRes = await fetch(
    `${FIREBASE_HOST}/v1alpha/projects/-/apps/${TW_APP_ID}/webConfig`,
    {
      headers: {
        accept: "application/json",
        "x-goog-api-key": TW_API_KEY,
        referer: TW_REFERER,
      },
    },
  );
  if (!cfgRes.ok) {
    throw new Error(
      `ThermoWorks web config failed: ${cfgRes.status} ${await cfgRes.text()}`,
    );
  }
  const { projectId } = await cfgRes.json();

  const authRes = await fetch(
    `${IDENTITY_HOST}/v1/accounts:signInWithPassword?key=${TW_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", referer: TW_REFERER },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!authRes.ok) {
    const body = await authRes.text();
    // Firebase reports INVALID_PASSWORD / EMAIL_NOT_FOUND etc. in error.message
    throw new Error(`ThermoWorks login failed: ${authRes.status} ${body}`);
  }
  const auth = await authRes.json();

  return {
    idToken: auth.idToken as string,
    userId: auth.localId as string,
    firestoreBase:
      `${FIRESTORE_HOST}/v1/projects/${projectId}/databases/(default)`,
  };
}

function toFahrenheit(value: number, units: string | null): number {
  const u = (units ?? "F").trim().toUpperCase();
  const f = u === "C" ? value * 9 / 5 + 32 : value;
  return Math.round(f * 10) / 10;
}

/** Returns the channel temperature in °F, or null if unavailable/offline. */
async function readChannel(
  tw: { idToken: string; firestoreBase: string },
  serial: string,
  channel: number,
): Promise<number | null> {
  const url =
    `${tw.firestoreBase}/documents/devices/${serial}/channels/${channel}?key=${TW_API_KEY}`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${tw.idToken}` },
      signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      note(`    read error (${serial} ch${channel}): ${res.status}`);
      return null;
    }
    const fields = (await res.json())?.fields ?? {};
    // Firestore returns numbers as either doubleValue or integerValue
    const raw = fields.value?.doubleValue ?? fields.value?.integerValue;
    if (raw === undefined || raw === null) return null;
    return toFahrenheit(Number(raw), fields.units?.stringValue ?? null);
  } catch (e) {
    const why = e instanceof DOMException && e.name === "TimeoutError"
      ? "timeout — device may be offline"
      : String(e);
    note(`    read error (${serial} ch${channel}): ${why}`);
    return null;
  }
}

// ── Supabase REST ─────────────────────────────────────────────────────────────

class Db {
  constructor(private url: string, private key: string) {
    this.url = url.replace(/\/$/, "");
  }
  private get headers() {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }
  async insert(table: string, rows: unknown) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      throw new Error(`insert ${table} failed: ${res.status} ${await res.text()}`);
    }
    return await res.json();
  }
  async selectOne(table: string, filters: Record<string, string>) {
    const qs = new URLSearchParams({ select: "*", limit: "1" });
    for (const [k, v] of Object.entries(filters)) qs.set(k, `eq.${v}`);
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
    });
    if (!res.ok) {
      throw new Error(`select ${table} failed: ${res.status} ${await res.text()}`);
    }
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  }
}

/** date + time in shop-local terms — the Python used naive local time. */
function shopNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
  };
}

// ── Sync steps ────────────────────────────────────────────────────────────────

async function syncColdStorage(
  tw: { idToken: string; firestoreBase: string },
  mappings: ColdStorageMapping[],
  db: Db,
) {
  const now = shopNow();
  const row: Record<string, unknown> = {
    recorded_date: now.date,
    recorded_time: now.time,
    initials: "TW-AUTO",
    notes: "Auto-synced from ThermoWorks Cloud",
    source: "TW-AUTO",
  };

  let hasData = false;
  for (const m of mappings) {
    if (m.unit_key.startsWith("←")) {
      note(`  Skipping unmapped channel: ${m.channel_label} (edit config)`);
      continue;
    }
    const temp = await readChannel(tw, m.serial, m.channel);
    if (temp !== null) {
      row[m.unit_key] = temp;
      hasData = true;
      note(`  ${m.unit_key}: ${temp}°F`);
    }
  }

  if (!hasData) {
    note("No cold storage readings — skipping insert");
    return 0;
  }
  const result = await db.insert("cold_storage_log", row);
  note(`Cold storage row inserted (id: ${result?.[0]?.id ?? "?"})`);
  return 1;
}

async function syncCookReadings(
  tw: { idToken: string; firestoreBase: string },
  cook: { serial: string; channels?: CookChannel[] },
  db: Db,
) {
  const serial = cook.serial;
  const readAt = new Date().toISOString();

  const session = await db.selectOne("cook_session", {
    device_serial: serial,
    status: "active",
  });
  const sessionId = session?.id ?? null;
  note(
    sessionId
      ? `  Active cook session: ${sessionId}`
      : "  No active cook session — readings recorded without session link",
  );

  const readings: Record<string, unknown>[] = [];
  for (const ch of cook.channels ?? []) {
    const label = ch.label ?? `Ch${ch.channel}`;
    const temp = await readChannel(tw, serial, ch.channel);
    if (temp !== null) {
      readings.push({
        session_id: sessionId,
        device_serial: serial,
        read_at: readAt,
        channel: ch.channel,
        channel_label: label,
        temp_f: temp,
      });
      note(`  ${label}: ${temp}°F`);
    }
  }

  if (!readings.length) {
    note("No cook readings obtained");
    return 0;
  }
  await db.insert("cook_reading", readings);
  note(`Inserted ${readings.length} cook reading(s)`);
  return readings.length;
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async () => {
  log.length = 0;
  const started = Date.now();

  try {
    const email = Deno.env.get("THERMOWORKS_EMAIL");
    const password = Deno.env.get("THERMOWORKS_PASSWORD");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const missing = [
      ["THERMOWORKS_EMAIL", email],
      ["THERMOWORKS_PASSWORD", password],
      ["SUPABASE_URL", supabaseUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      throw new Error(`Missing secrets: ${missing.join(", ")}`);
    }

    let config: SyncConfig = DEFAULT_CONFIG;
    const rawConfig = Deno.env.get("THERMOWORKS_CONFIG");
    if (rawConfig) {
      try {
        config = JSON.parse(rawConfig);
      } catch (e) {
        throw new Error(`THERMOWORKS_CONFIG is not valid JSON: ${e}`);
      }
    }

    const db = new Db(supabaseUrl!, serviceKey!);

    note("--- ThermoWorks sync start ---");
    const tw = await twSignIn(email!, password!);
    note(`Authenticated as ${email}`);

    let coldRows = 0;
    let cookRows = 0;

    if (config.cold_storage?.length) {
      note("Syncing cold storage...");
      coldRows = await syncColdStorage(tw, config.cold_storage, db);
    } else {
      note("No cold_storage channels mapped — skipping");
    }

    if (config.cook_logger?.serial) {
      note("Syncing cook logger...");
      cookRows = await syncCookReadings(tw, config.cook_logger, db);
    }

    note("--- sync complete ---");
    return Response.json({
      ok: true,
      cold_storage_rows: coldRows,
      cook_readings: cookRows,
      ms: Date.now() - started,
      log,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    note(`SYNC FAILED: ${message}`);
    return Response.json(
      { ok: false, error: message, ms: Date.now() - started, log },
      { status: 500 },
    );
  }
});
