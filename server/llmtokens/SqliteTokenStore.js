import fs from "node:fs";

/** Shares the energy store's connection; its owner closes it AFTER the ledger. */
export class SqliteTokenStore {
  constructor({ db, legacyPath }) {
    this.db = db;
    this.legacyPath = legacyPath;
    this.persisted = new Map();
    this.needsInitialization = !db.prepare("SELECT id FROM token_state WHERE id=1").get();
    this.upsert = db.prepare(`INSERT INTO token_records VALUES (?, ?, ?, ?)
      ON CONFLICT(kind, series_key, item_key) DO UPDATE SET payload=excluded.payload
      WHERE token_records.payload IS NOT excluded.payload`);
    this.remove = db.prepare("DELETE FROM token_records WHERE kind=? AND series_key=? AND item_key=?");
  }

  read() {
    const rows = this.db.prepare("SELECT * FROM token_records").all();
    if (this.needsInitialization) {
      if (rows.length) throw new Error("Token records exist without initialization marker");
      if (!fs.existsSync(this.legacyPath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.legacyPath, "utf8"));
      this.validate(raw);
      return raw;
    }
    if (this.db.prepare("SELECT version FROM token_state WHERE id=1").get().version !== 1) {
      throw new Error("Unsupported token ledger version");
    }
    const series = Object.create(null);
    for (const row of rows.filter((r) => r.kind === "series")) {
      if (row.item_key !== "") throw new Error("Invalid token series key");
      series[row.series_key] = { ...JSON.parse(row.payload), models: Object.create(null), daily: Object.create(null) };
    }
    for (const row of rows) {
      if (!series[row.series_key]) throw new Error("Orphan token ledger row");
      if (row.kind === "model") series[row.series_key].models[row.item_key] = JSON.parse(row.payload);
      else if (row.kind === "day") series[row.series_key].daily[row.item_key] = JSON.parse(row.payload);
      else if (row.kind !== "series") throw new Error("Unknown token ledger row kind");
      this.persisted.set(JSON.stringify([row.kind, row.series_key, row.item_key]), row.payload);
    }
    return { version: 1, series };
  }

  validate(raw) {
    if (raw?.version !== 1 || !raw.series || typeof raw.series !== "object" || Array.isArray(raw.series)) {
      throw new Error("Invalid legacy token ledger; refusing migration");
    }
  }

  write(data) {
    this.validate(data);
    const next = new Map();
    const add = (kind, series, item, value) => next.set(JSON.stringify([kind, series, item]), JSON.stringify(value));
    for (const [key, value] of Object.entries(data.series)) {
      const { models, daily, ...metadata } = value;
      add("series", key, "", metadata);
      for (const [model, totals] of Object.entries(models || {})) add("model", key, model, totals);
      for (const [day, totals] of Object.entries(daily || {})) add("day", key, day, totals);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, payload] of next) {
        if (this.persisted.get(key) !== payload) this.upsert.run(...JSON.parse(key), payload);
      }
      for (const key of this.persisted.keys()) {
        if (!next.has(key)) this.remove.run(...JSON.parse(key));
      }
      if (this.needsInitialization) this.db.exec("INSERT INTO token_state VALUES (1, 1)");
      this.db.exec("COMMIT");
      this.persisted = next;
      this.needsInitialization = false;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
