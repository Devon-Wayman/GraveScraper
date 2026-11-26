const db = require("./index");

// Relationship fields are stored as JSON strings in SQLite, so normalize them before writes.
function normalizeArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

// Maps imported memorial data into the local SQLite column names.
function serializeMemorial(memorial, cemeteryId) {
  return {
    memorial_id: memorial.memorialId,
    cemetery_id: cemeteryId,
    full_name: memorial.fullName,
    first_name: memorial.firstName,
    middle_name: memorial.middleName,
    last_name: memorial.lastName,
    birth_city_name: memorial.birthCityName,
    death_city_name: memorial.deathCityName,
    birth_date: memorial.birthDate,
    death_date: memorial.deathDate,
    birth_year: memorial.birthYear,
    death_year: memorial.deathYear,
    approx_age: memorial.approxAge,
    is_veteran: memorial.isVeteran ? 1 : 0,
    is_famous: memorial.isFamous ? 1 : 0,
    parents_json: normalizeArray(memorial.parents),
    spouses_json: normalizeArray(memorial.spouses),
    siblings_json: normalizeArray(memorial.siblings),
    children_json: normalizeArray(memorial.children),
    latitude: memorial.location?.lat ?? null,
    longitude: memorial.location?.lon ?? null,
    google_maps_link: memorial.googleMapsLink ?? null,
    findagrave_date_modified: memorial.findAGraveDateModified,
    findagrave_date_created: memorial.findAGraveDateCreated,
    memorial_contributor_id: memorial.memorialContributorId,
    creator_contributor_id: memorial.creatorContributorId,
    photo_contributor_ids_json: normalizeArray(memorial.photoContributorIds),
    raw_payload: JSON.stringify(memorial.rawPayload)
  };
}

// Used to detect whether a memorial changed enough to require an UPDATE.
function buildMemorialFingerprint(serializedMemorial) {
  return JSON.stringify([
    serializedMemorial.cemetery_id,
    serializedMemorial.full_name,
    serializedMemorial.first_name,
    serializedMemorial.middle_name,
    serializedMemorial.last_name,
    serializedMemorial.birth_city_name,
    serializedMemorial.death_city_name,
    serializedMemorial.birth_date,
    serializedMemorial.death_date,
    serializedMemorial.birth_year,
    serializedMemorial.death_year,
    serializedMemorial.approx_age,
    serializedMemorial.is_veteran,
    serializedMemorial.is_famous,
    serializedMemorial.parents_json,
    serializedMemorial.spouses_json,
    serializedMemorial.siblings_json,
    serializedMemorial.children_json,
    serializedMemorial.latitude,
    serializedMemorial.longitude,
    serializedMemorial.google_maps_link,
    serializedMemorial.findagrave_date_modified,
    serializedMemorial.findagrave_date_created,
    serializedMemorial.memorial_contributor_id,
    serializedMemorial.creator_contributor_id,
    serializedMemorial.photo_contributor_ids_json,
    serializedMemorial.raw_payload
  ]);
}

// Inserts a new cemetery or refreshes its summary stats after a later import.
function upsertCemetery(cemetery) {
  const statement = db.prepare(`
    INSERT INTO cemeteries (
      cemetery_id,
      cemetery_name,
      cemetery_url,
      memorial_count,
      photo_request_count,
      photographed_count,
      famous_count,
      gps_count,
      percentage_with_gps
    ) VALUES (
      @cemetery_id,
      @cemetery_name,
      @cemetery_url,
      @memorial_count,
      @photo_request_count,
      @photographed_count,
      @famous_count,
      @gps_count,
      @percentage_with_gps
    )
    ON CONFLICT(cemetery_id) DO UPDATE SET
      cemetery_name = excluded.cemetery_name,
      cemetery_url = excluded.cemetery_url,
      memorial_count = excluded.memorial_count,
      photo_request_count = excluded.photo_request_count,
      photographed_count = excluded.photographed_count,
      famous_count = excluded.famous_count,
      gps_count = excluded.gps_count,
      percentage_with_gps = excluded.percentage_with_gps,
      updated_at = CURRENT_TIMESTAMP
  `);

  statement.run(cemetery);
}

// Creates the import history row before background work begins.
function createImport({ cemeteryId }) {
  const result = db
    .prepare(`
      INSERT INTO imports (cemetery_id, status, message, current_step)
      VALUES (?, 'queued', 'Import queued.', 'Waiting to start')
    `)
    .run(cemeteryId);

  return result.lastInsertRowid;
}

// Accepts partial fields so callers can report progress without rewriting the full row.
function updateImportProgress(importId, update) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(update)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) {
    return;
  }

  values.push(importId);

  db.prepare(`
    UPDATE imports
    SET ${fields.join(", ")}
    WHERE import_id = ?
  `).run(...values);
}

// Marks an import as finished and records the final UI-facing status fields.
function finishImport(importId, status, message, memorialsSeen) {
  db.prepare(`
    UPDATE imports
    SET
      completed_at = CURRENT_TIMESTAMP,
      status = ?,
      message = ?,
      memorials_seen = ?,
      processed_memorials = ?,
      progress_percent = ?,
      current_step = ?
    WHERE import_id = ?
  `).run(
    status,
    message,
    memorialsSeen,
    memorialsSeen,
    status === "completed" ? 100 : 0,
    status === "completed" ? "Import complete" : "Import failed",
    importId
  );
}

// Reconciles the latest imported memorial list against what is already stored locally.
function syncMemorialsForCemetery(cemeteryId, memorials) {
  const insertStatement = db.prepare(`
    INSERT INTO memorials (
      memorial_id,
      cemetery_id,
      full_name,
      first_name,
      middle_name,
      last_name,
      birth_city_name,
      death_city_name,
      birth_date,
      death_date,
      birth_year,
      death_year,
      approx_age,
      is_veteran,
      is_famous,
      parents_json,
      spouses_json,
      siblings_json,
      children_json,
      latitude,
      longitude,
      google_maps_link,
      findagrave_date_modified,
      findagrave_date_created,
      memorial_contributor_id,
      creator_contributor_id,
      photo_contributor_ids_json,
      raw_payload
    ) VALUES (
      @memorial_id,
      @cemetery_id,
      @full_name,
      @first_name,
      @middle_name,
      @last_name,
      @birth_city_name,
      @death_city_name,
      @birth_date,
      @death_date,
      @birth_year,
      @death_year,
      @approx_age,
      @is_veteran,
      @is_famous,
      @parents_json,
      @spouses_json,
      @siblings_json,
      @children_json,
      @latitude,
      @longitude,
      @google_maps_link,
      @findagrave_date_modified,
      @findagrave_date_created,
      @memorial_contributor_id,
      @creator_contributor_id,
      @photo_contributor_ids_json,
      @raw_payload
    )
    ON CONFLICT(memorial_id) DO UPDATE SET
      cemetery_id = excluded.cemetery_id,
      full_name = excluded.full_name,
      first_name = excluded.first_name,
      middle_name = excluded.middle_name,
      last_name = excluded.last_name,
      birth_city_name = excluded.birth_city_name,
      death_city_name = excluded.death_city_name,
      birth_date = excluded.birth_date,
      death_date = excluded.death_date,
      birth_year = excluded.birth_year,
      death_year = excluded.death_year,
      approx_age = excluded.approx_age,
      is_veteran = excluded.is_veteran,
      is_famous = excluded.is_famous,
      parents_json = excluded.parents_json,
      spouses_json = excluded.spouses_json,
      siblings_json = excluded.siblings_json,
      children_json = excluded.children_json,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      google_maps_link = excluded.google_maps_link,
      findagrave_date_modified = excluded.findagrave_date_modified,
      findagrave_date_created = excluded.findagrave_date_created,
      memorial_contributor_id = excluded.memorial_contributor_id,
      creator_contributor_id = excluded.creator_contributor_id,
      photo_contributor_ids_json = excluded.photo_contributor_ids_json,
      raw_payload = excluded.raw_payload,
      updated_at = CURRENT_TIMESTAMP
  `);

  const deleteMissingStatement = db.prepare(`
    DELETE FROM memorials
    WHERE cemetery_id = ?
      AND NOT EXISTS (SELECT 1 FROM cleaning_sessions s WHERE s.memorial_id = memorials.memorial_id)
      AND cleaning_work_status NOT IN ('active', 'monitoring')
      AND memorial_id NOT IN (
        SELECT value FROM json_each(?)
      )
  `);

  const deleteAllStatement = db.prepare(`
    DELETE FROM memorials WHERE cemetery_id = ?
      AND NOT EXISTS (SELECT 1 FROM cleaning_sessions s WHERE s.memorial_id = memorials.memorial_id)
      AND cleaning_work_status NOT IN ('active', 'monitoring')
  `);

  const selectExistingStatement = db.prepare(`
    SELECT
      memorial_id,
      cemetery_id,
      full_name,
      first_name,
      middle_name,
      last_name,
      birth_city_name,
      death_city_name,
      birth_date,
      death_date,
      birth_year,
      death_year,
      approx_age,
      is_veteran,
      is_famous,
      parents_json,
      spouses_json,
      siblings_json,
      children_json,
      latitude,
      longitude,
      google_maps_link,
      findagrave_date_modified,
      findagrave_date_created,
      memorial_contributor_id,
      creator_contributor_id,
      photo_contributor_ids_json,
      raw_payload
    FROM memorials
    WHERE cemetery_id = ?
  `);

  const transaction = db.transaction((items) => {
    const existingRows = selectExistingStatement.all(cemeteryId);
    const existingById = new Map(
      existingRows.map((row) => [row.memorial_id, buildMemorialFingerprint(row)])
    );
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    if (items.length === 0) {
      const deleted = deleteAllStatement.run(cemeteryId).changes;
      return { inserted, updated, unchanged, deleted };
    }

    for (const memorial of items) {
      const serialized = serializeMemorial(memorial, cemeteryId);
      const existingFingerprint = existingById.get(memorial.memorialId);
      const nextFingerprint = buildMemorialFingerprint(serialized);

      if (!existingFingerprint) {
        inserted += 1;
        insertStatement.run(serialized);
        continue;
      }

      if (existingFingerprint !== nextFingerprint) {
        updated += 1;
        insertStatement.run(serialized);
        continue;
      }

      unchanged += 1;
    }

    // Remove memorials that disappeared upstream so refreshes behave like a true sync.
    const deleted = deleteMissingStatement.run(
      cemeteryId,
      JSON.stringify(items.map((item) => item.memorialId))
    ).changes;

    return { inserted, updated, unchanged, deleted };
  });

  return transaction(memorials);
}

function getCemeteries() {
  return db.prepare(`
    SELECT
      c.*,
      COUNT(m.memorial_id) AS stored_memorials
    FROM cemeteries c
    LEFT JOIN memorials m ON m.cemetery_id = c.cemetery_id
    GROUP BY c.cemetery_id
    ORDER BY c.updated_at DESC
  `).all();
}

function getCemeteryById(cemeteryId) {
  return db.prepare(`
    SELECT *
    FROM cemeteries
    WHERE cemetery_id = ?
  `).get(cemeteryId);
}

function updateCemeteryUserFields(cemeteryId, fields) {
  return db.prepare(`
    UPDATE cemeteries SET
      owner_name = @ownerName,
      owner_type = @ownerType,
      owner_contact = @ownerContact,
      permission_status = @permissionStatus,
      permission_progress = @permissionProgress,
      owner_requirements = @ownerRequirements,
      user_notes = @userNotes,
      updated_at = CURRENT_TIMESTAMP
    WHERE cemetery_id = @cemeteryId
  `).run({ ...fields, cemeteryId });
}

function hydrateMemorialRow(row) {
  return {
    ...row,
    parents: JSON.parse(row.parents_json),
    spouses: JSON.parse(row.spouses_json),
    siblings: JSON.parse(row.siblings_json),
    children: JSON.parse(row.children_json),
    photo_contributor_ids: JSON.parse(row.photo_contributor_ids_json)
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function hydrateResearchLead(row) {
  return {
    ...row,
    matched: safeJsonParse(row.matched_json, []),
    conflicts: safeJsonParse(row.conflicts_json, [])
  };
}

function hydrateResearchClaim(row) {
  return {
    ...row,
    evidence: safeJsonParse(row.evidence_json, []),
    conflicts: safeJsonParse(row.conflicts_json, [])
  };
}

function getMemorialById(memorialId) {
  const row = db.prepare(`
    SELECT
      m.*,
      c.cemetery_name,
      c.cemetery_url
    FROM memorials m
    JOIN cemeteries c ON c.cemetery_id = m.cemetery_id
    WHERE m.memorial_id = ?
  `).get(memorialId);

  return row ? hydrateMemorialRow(row) : null;
}

function getResearchLeadsByMemorialId(memorialId) {
  return db.prepare(`
    SELECT *
    FROM research_leads
    WHERE memorial_id = ? AND provider NOT IN ('wikidata', 'wikipedia')
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      confidence DESC,
      created_at DESC
  `).all(memorialId).map(hydrateResearchLead);
}

function getResearchSourcesByMemorialId(memorialId) {
  return db.prepare(`
    SELECT *
    FROM research_sources
    WHERE memorial_id = ?
    ORDER BY created_at DESC
  `).all(memorialId);
}

function getResearchClaimsByMemorialId(memorialId) {
  return db.prepare(`
    SELECT *
    FROM research_claims
    WHERE memorial_id = ?
    ORDER BY created_at DESC
  `).all(memorialId).map(hydrateResearchClaim);
}

function saveResearchLead(memorialId, lead) {
  const existing = db.prepare(`
    SELECT *
    FROM research_leads
    WHERE memorial_id = ?
      AND provider = ?
      AND COALESCE(url, '') = COALESCE(?, '')
      AND title = ?
      AND status != 'rejected'
    ORDER BY lead_id DESC
    LIMIT 1
  `).get(memorialId, lead.provider, lead.url || "", lead.title);

  if (existing) {
    return hydrateResearchLead(existing);
  }

  const result = db.prepare(`
    INSERT INTO research_leads (
      memorial_id,
      provider,
      title,
      url,
      source_type,
      source_date,
      snippet,
      confidence,
      matched_json,
      conflicts_json,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memorialId,
    lead.provider,
    lead.title,
    lead.url || null,
    lead.sourceType || "",
    lead.sourceDate || "",
    lead.snippet || "",
    lead.confidence || 0,
    JSON.stringify(lead.matched || []),
    JSON.stringify(lead.conflicts || []),
    JSON.stringify(lead.raw || {})
  );

  return hydrateResearchLead(db.prepare("SELECT * FROM research_leads WHERE lead_id = ?").get(result.lastInsertRowid));
}

function saveResearchLeads(memorialId, leads) {
  const transaction = db.transaction((items) => items.map((lead) => saveResearchLead(memorialId, lead)));
  return transaction(leads);
}

function approveResearchLead(leadId) {
  const lead = db.prepare("SELECT * FROM research_leads WHERE lead_id = ?").get(leadId);

  if (!lead) {
    return null;
  }

  if (lead.status === "approved") {
    return hydrateResearchLead(lead);
  }

  const transaction = db.transaction(() => {
    const citation = [lead.title, lead.source_date, lead.url].filter(Boolean).join(" · ");
    const sourceResult = db.prepare(`
      INSERT INTO research_sources (
        memorial_id,
        title,
        url,
        source_type,
        citation,
        extracted_text,
        confidence,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
    `).run(
      lead.memorial_id,
      lead.title,
      lead.url,
      lead.source_type,
      citation,
      lead.snippet,
      lead.confidence
    );

    db.prepare(`
      INSERT INTO research_claims (
        memorial_id,
        source_id,
        claim_text,
        confidence,
        status,
        evidence_json,
        conflicts_json
      ) VALUES (?, ?, ?, ?, 'needs-review', ?, ?)
    `).run(
      lead.memorial_id,
      sourceResult.lastInsertRowid,
      `Possible matching source found via ${lead.provider}: ${lead.title}`,
      lead.confidence,
      lead.matched_json,
      lead.conflicts_json
    );

    db.prepare(`
      UPDATE research_leads
      SET
        status = 'approved',
        approved_source_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE lead_id = ?
    `).run(sourceResult.lastInsertRowid, leadId);

    return db.prepare("SELECT * FROM research_leads WHERE lead_id = ?").get(leadId);
  });

  return hydrateResearchLead(transaction());
}

function rejectResearchLead(leadId) {
  const lead = db.prepare("SELECT * FROM research_leads WHERE lead_id = ?").get(leadId);

  if (!lead) {
    return null;
  }

  if (lead.status === "approved") {
    return hydrateResearchLead(lead);
  }

  db.prepare(`
    UPDATE research_leads
    SET
      status = 'rejected',
      updated_at = CURRENT_TIMESTAMP
    WHERE lead_id = ?
  `).run(leadId);

  return hydrateResearchLead(db.prepare("SELECT * FROM research_leads WHERE lead_id = ?").get(leadId));
}

function setCleaningWorkStatus(memorialId, status) {
  return db.prepare("UPDATE memorials SET cleaning_work_status = ?, updated_at = CURRENT_TIMESTAMP WHERE memorial_id = ?").run(status, memorialId);
}

function getActiveCleaning({ search = "", page = 1 } = {}) {
  const condition = `(m.cleaning_work_status IN ('active', 'monitoring') OR
    (m.cleaning_work_status = '' AND EXISTS (SELECT 1 FROM cleaning_sessions s WHERE s.memorial_id = m.memorial_id)))`;
  const query = String(search).trim();
  const filter = `${condition} AND (instr(lower(COALESCE(m.full_name, '')), lower(@search)) > 0
    OR instr(lower(c.cemetery_name), lower(@search)) > 0 OR instr(CAST(m.memorial_id AS TEXT), @search) > 0)`;
  const totalActive = db.prepare(`SELECT COUNT(*) AS total FROM memorials m WHERE ${condition}`).get().total;
  const total = db.prepare(`SELECT COUNT(*) AS total FROM memorials m JOIN cemeteries c ON c.cemetery_id = m.cemetery_id WHERE ${filter}`).get({ search: query }).total;
  const totalPages = Math.max(1, Math.ceil(total / 12));
  page = Math.min(Math.max(1, Number.isSafeInteger(page) ? page : 1), totalPages);
  const memorials = db.prepare(`SELECT m.memorial_id, m.full_name, m.cemetery_id, m.google_maps_link,
    c.cemetery_name, CASE WHEN m.cleaning_work_status = '' THEN 'active' ELSE m.cleaning_work_status END AS work_status,
    MAX(COALESCE((SELECT MAX(visit_date) FROM cleaning_sessions s WHERE s.memorial_id = m.memorial_id), ''),
        COALESCE((SELECT MAX(p.photo_date) FROM cleaning_photos p JOIN cleaning_sessions s ON s.session_id = p.session_id WHERE s.memorial_id = m.memorial_id), '')) AS last_activity_date
    FROM memorials m JOIN cemeteries c ON c.cemetery_id = m.cemetery_id WHERE ${filter}
    ORDER BY last_activity_date DESC, m.full_name COLLATE NOCASE, m.memorial_id
    LIMIT 12 OFFSET @offset`).all({ search: query, offset: (page - 1) * 12 });
  return { memorials, total, totalActive, page, totalPages, search: query };
}

function updateMemorialUserFields(memorialId, fields) {
  return db.prepare(`
    UPDATE memorials
    SET
      user_notes = ?,
      cleaning_status = ?,
      family_relation = ?,
      visit_priority = ?,
      research_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE memorial_id = ?
  `).run(
    fields.userNotes,
    fields.cleaningStatus,
    fields.familyRelation,
    fields.visitPriority,
    fields.researchStatus,
    memorialId
  );
}

function buildMemorialSearchParts(cemeteryId, search = "") {
  const whereParts = ["cemetery_id = ?"];
  const values = [cemeteryId];
  const normalizedSearch = String(search).trim();

  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    whereParts.push(`(
      CAST(memorial_id AS TEXT) LIKE ? COLLATE NOCASE
      OR full_name LIKE ? COLLATE NOCASE
      OR first_name LIKE ? COLLATE NOCASE
      OR last_name LIKE ? COLLATE NOCASE
      OR birth_city_name LIKE ? COLLATE NOCASE
      OR death_city_name LIKE ? COLLATE NOCASE
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  return {
    whereClause: whereParts.join(" AND "),
    values
  };
}

// Re-hydrate relationship arrays so route/view layers do not need to parse JSON manually.
function getMemorialsByCemeteryId(cemeteryId) {
  return db.prepare(`
    SELECT *
    FROM memorials
    WHERE cemetery_id = ?
    ORDER BY full_name COLLATE NOCASE ASC
  `).all(cemeteryId).map(hydrateMemorialRow);
}

function countMemorialsByCemeteryId(cemeteryId, options = {}) {
  const { search = "" } = options;
  const { whereClause, values } = buildMemorialSearchParts(cemeteryId, search);

  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM memorials
    WHERE ${whereClause}
  `).get(...values).total;
}

function getMemorialPageByCemeteryId(cemeteryId, options = {}) {
  const {
    search = "",
    limit = 50,
    offset = 0
  } = options;
  const { whereClause, values } = buildMemorialSearchParts(cemeteryId, search);

  return db.prepare(`
    SELECT *
    FROM memorials
    WHERE ${whereClause}
    ORDER BY full_name COLLATE NOCASE ASC, memorial_id ASC
    LIMIT ?
    OFFSET ?
  `).all(...values, limit, offset).map(hydrateMemorialRow);
}

function getAllMemorials() {
  return db.prepare(`
    SELECT *
    FROM memorials
    ORDER BY cemetery_id ASC, full_name COLLATE NOCASE ASC
  `).all().map((row) => ({
    ...hydrateMemorialRow(row)
  }));
}

// Recent imports power the homepage activity list and the import progress UI.
function getRecentImports(limit = 10) {
  return db.prepare(`
    SELECT i.*, c.cemetery_name
    FROM imports i
    JOIN cemeteries c ON c.cemetery_id = i.cemetery_id
    ORDER BY i.started_at DESC
    LIMIT ?
  `).all(limit);
}

function getImportById(importId) {
  return db.prepare(`
    SELECT i.*, c.cemetery_name, c.cemetery_url
    FROM imports i
    JOIN cemeteries c ON c.cemetery_id = i.cemetery_id
    WHERE i.import_id = ?
  `).get(importId);
}

function deleteCemeteryById(cemeteryId) {
  const photos = db.prepare(`SELECT p.filename FROM cleaning_photos p
    JOIN cleaning_sessions s ON s.session_id = p.session_id
    JOIN memorials m ON m.memorial_id = s.memorial_id WHERE m.cemetery_id = ?`).all(cemeteryId);
  const result = db.prepare(`
    DELETE FROM cemeteries
    WHERE cemetery_id = ?
  `).run(cemeteryId);
  const fs = require("node:fs");
  const path = require("node:path");
  const config = require("../config");
  for (const { filename } of photos) {
    for (const name of [filename, `thumb-${filename}`]) {
      try { fs.rmSync(path.join(config.uploadsPath, name), { force: true }); }
      catch (error) { console.error("Unable to remove deleted cemetery photo:", error.message); }
    }
  }
  return result;
}

module.exports = {
  getActiveCleaning,
  setCleaningWorkStatus,
  updateCemeteryUserFields,
  createImport,
  deleteCemeteryById,
  finishImport,
  getAllMemorials,
  getCemeteries,
  getCemeteryById,
  getImportById,
  getMemorialById,
  countMemorialsByCemeteryId,
  getMemorialPageByCemeteryId,
  getMemorialsByCemeteryId,
  getRecentImports,
  getResearchClaimsByMemorialId,
  getResearchLeadsByMemorialId,
  getResearchSourcesByMemorialId,
  approveResearchLead,
  rejectResearchLead,
  saveResearchLeads,
  syncMemorialsForCemetery,
  updateMemorialUserFields,
  updateImportProgress,
  upsertCemetery
};
