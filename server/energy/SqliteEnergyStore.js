import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Local, single-writer persistence. One JSON payload per minute, not per history.
 * Metadata/counter baselines and changed minutes commit together. Keep the
 * legacy JSON untouched: it is an import source, never a second live writer.
 */
export class SqliteEnergyStore {
  constructor({ filePath, legacyPath = null }) {
    this.filePath = filePath;
    this.legacyPath = legacyPath;
    this.closed = false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = fs.openSync(filePath, "a", 0o600);
    fs.closeSync(fd);
    fs.chmodSync(filePath, 0o600);
    this.db = new DatabaseSync(filePath);
    try {
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (![0, 1, 2].includes(version)) throw new Error(`Unsupported energy SQLite schema ${version}`);
      if (version === 0 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) {
        throw new Error("Refusing to initialize an unrecognized energy database");
      }
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;");
      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE energy_state (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL);
          CREATE TABLE energy_minutes (minute_start_ms INTEGER PRIMARY KEY, payload TEXT NOT NULL);
          PRAGMA user_version=1;
          COMMIT;`);
      }
      if (version < 2) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE token_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
          CREATE TABLE token_records (
            kind TEXT NOT NULL, series_key TEXT NOT NULL, item_key TEXT NOT NULL,
            payload TEXT NOT NULL, PRIMARY KEY(kind, series_key, item_key));
          PRAGMA user_version=2;
          COMMIT;`);
      }
      const check = this.db.prepare("PRAGMA quick_check").all();
      if (check.length !== 1 || check[0].quick_check !== "ok") throw new Error("Energy database integrity check failed");
      this.needsInitialization = !this.db.prepare("SELECT id FROM energy_state WHERE id=1").get();
      if (this.needsInitialization && this.db.prepare("SELECT 1 FROM energy_minutes LIMIT 1").get()) {
        throw new Error("Energy database has minute records without metadata");
      }
      this.upsertMinute = this.db.prepare(`INSERT INTO energy_minutes VALUES (?, ?)
        ON CONFLICT(minute_start_ms) DO UPDATE SET payload=excluded.payload
        WHERE energy_minutes.payload IS NOT excluded.payload`);
      this.deleteMinute = this.db.prepare("DELETE FROM energy_minutes WHERE minute_start_ms=?");
      this.upsertState = this.db.prepare(`INSERT INTO energy_state VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload
        WHERE energy_state.payload IS NOT excluded.payload`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  read() {
    if (this.needsInitialization) {
      if (!this.legacyPath || !fs.existsSync(this.legacyPath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.legacyPath, "utf8"));
      if (raw?.version !== 1 || !Array.isArray(raw.buckets)) throw new Error("Invalid legacy energy history; refusing migration");
      return raw;
    }
    this.db.exec("BEGIN");
    try {
      const raw = JSON.parse(this.db.prepare("SELECT payload FROM energy_state WHERE id=1").get().payload);
      if (raw?.version !== 1 || !Array.isArray(raw.nodeIds)) throw new Error("Invalid energy database metadata");
      raw.buckets = this.db.prepare("SELECT minute_start_ms, payload FROM energy_minutes ORDER BY minute_start_ms").all().map((row) => {
        const bucket = JSON.parse(row.payload);
        if (bucket.minuteStartMs !== row.minute_start_ms) throw new Error("Energy minute key/payload mismatch");
        return bucket;
      });
      this.db.exec("COMMIT");
      return raw;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  write(metadata, buckets, deletedMinutes, { replace = false } = {}) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (replace) this.db.exec("DELETE FROM energy_minutes");
      for (const minute of deletedMinutes) this.deleteMinute.run(minute);
      for (const bucket of buckets) this.upsertMinute.run(bucket.minuteStartMs, JSON.stringify(bucket));
      this.upsertState.run(JSON.stringify(metadata));
      this.db.exec("COMMIT");
      this.needsInitialization = false;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
