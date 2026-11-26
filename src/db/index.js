const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config");

const dataDir = path.dirname(config.databasePath);

// Ensure the SQLite data directory exists before startup continues.
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Retire the removed offline imagery feature from existing local databases.
db.exec("DROP TABLE IF EXISTS offline_maps");

// Schema bootstrap lives here so the app can start cleanly without a separate migration step.
db.exec(`
  CREATE TABLE IF NOT EXISTS cemeteries (
    cemetery_id TEXT PRIMARY KEY,
    cemetery_name TEXT NOT NULL,
    cemetery_url TEXT NOT NULL,
    memorial_count INTEGER NOT NULL DEFAULT 0,
    photo_request_count INTEGER NOT NULL DEFAULT 0,
    photographed_count INTEGER NOT NULL DEFAULT 0,
    famous_count INTEGER NOT NULL DEFAULT 0,
    gps_count INTEGER NOT NULL DEFAULT 0,
    percentage_with_gps INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS imports (
    import_id INTEGER PRIMARY KEY AUTOINCREMENT,
    cemetery_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT NOT NULL,
    message TEXT,
    memorials_seen INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (cemetery_id) REFERENCES cemeteries(cemetery_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS memorials (
    memorial_id INTEGER PRIMARY KEY,
    cemetery_id TEXT NOT NULL,
    full_name TEXT,
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    birth_city_name TEXT,
    death_city_name TEXT,
    birth_date TEXT,
    death_date TEXT,
    birth_year INTEGER,
    death_year INTEGER,
    approx_age INTEGER,
    is_veteran INTEGER NOT NULL DEFAULT 0,
    is_famous INTEGER NOT NULL DEFAULT 0,
    parents_json TEXT NOT NULL DEFAULT '[]',
    spouses_json TEXT NOT NULL DEFAULT '[]',
    siblings_json TEXT NOT NULL DEFAULT '[]',
    children_json TEXT NOT NULL DEFAULT '[]',
    latitude REAL,
    longitude REAL,
    google_maps_link TEXT,
    findagrave_date_modified TEXT,
    findagrave_date_created TEXT,
    memorial_contributor_id INTEGER,
    creator_contributor_id INTEGER,
    photo_contributor_ids_json TEXT NOT NULL DEFAULT '[]',
    raw_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cemetery_id) REFERENCES cemeteries(cemetery_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memorials_cemetery_id ON memorials(cemetery_id);
  CREATE INDEX IF NOT EXISTS idx_imports_cemetery_id ON imports(cemetery_id);

  CREATE TABLE IF NOT EXISTS research_leads (
    lead_id INTEGER PRIMARY KEY AUTOINCREMENT,
    memorial_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    source_type TEXT NOT NULL DEFAULT '',
    source_date TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    matched_json TEXT NOT NULL DEFAULT '[]',
    conflicts_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    approved_source_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memorial_id) REFERENCES memorials(memorial_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS research_sources (
    source_id INTEGER PRIMARY KEY AUTOINCREMENT,
    memorial_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    source_type TEXT NOT NULL DEFAULT '',
    citation TEXT NOT NULL DEFAULT '',
    extracted_text TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memorial_id) REFERENCES memorials(memorial_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS research_claims (
    claim_id INTEGER PRIMARY KEY AUTOINCREMENT,
    memorial_id INTEGER NOT NULL,
    source_id INTEGER,
    claim_text TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'needs-review',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    conflicts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memorial_id) REFERENCES memorials(memorial_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES research_sources(source_id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_research_leads_memorial_id ON research_leads(memorial_id);
  CREATE INDEX IF NOT EXISTS idx_research_sources_memorial_id ON research_sources(memorial_id);
  CREATE INDEX IF NOT EXISTS idx_research_claims_memorial_id ON research_claims(memorial_id);

  CREATE TABLE IF NOT EXISTS cleaning_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    memorial_id INTEGER NOT NULL REFERENCES memorials(memorial_id) ON DELETE CASCADE,
    visit_date TEXT NOT NULL,
    methods TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_cleaning_sessions_memorial ON cleaning_sessions(memorial_id);

  CREATE TABLE IF NOT EXISTS cleaning_photos (
    photo_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES cleaning_sessions(session_id) ON DELETE CASCADE,
    filename TEXT NOT NULL UNIQUE,
    stage TEXT NOT NULL CHECK(stage IN ('before', 'during', 'after', 'general')),
    caption TEXT NOT NULL DEFAULT '',
    photo_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_cleaning_photos_session ON cleaning_photos(session_id);

`);

function getColumnNames(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

// Small helper for additive schema changes on existing databases.
function ensureColumn(tableName, columnName, definition) {
  const existingColumns = new Set(getColumnNames(tableName));

  if (!existingColumns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("imports", "current_step", "TEXT");
ensureColumn("cleaning_photos", "photo_date", "TEXT NOT NULL DEFAULT ''");
ensureColumn("cleaning_photos", "captured_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("cleaning_photos", "date_source", "TEXT NOT NULL DEFAULT 'manual'");
db.exec(`UPDATE cleaning_photos SET photo_date = (
  SELECT visit_date FROM cleaning_sessions WHERE session_id = cleaning_photos.session_id
) WHERE photo_date = ''`);

// Locally maintained cemetery details are intentionally separate from imported fields.
for (const column of [
  "owner_name", "owner_type", "owner_contact", "permission_status",
  "permission_progress", "owner_requirements", "user_notes"
]) {
  ensureColumn("cemeteries", column, "TEXT NOT NULL DEFAULT ''");
}

ensureColumn("imports", "total_memorials", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("imports", "processed_memorials", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("imports", "progress_percent", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("memorials", "user_notes", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "cleaning_status", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "cleaning_work_status", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "family_relation", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "visit_priority", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "research_status", "TEXT NOT NULL DEFAULT ''");
ensureColumn("memorials", "findagrave_date_modified", "TEXT");
ensureColumn("memorials", "findagrave_date_created", "TEXT");
ensureColumn("memorials", "memorial_contributor_id", "INTEGER");
ensureColumn("memorials", "creator_contributor_id", "INTEGER");
ensureColumn("memorials", "photo_contributor_ids_json", "TEXT NOT NULL DEFAULT '[]'");

module.exports = db;
