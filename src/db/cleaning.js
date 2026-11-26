const db = require("./index");

function photo(row, session) {
  if (!row) return null;

  const { filename, ...fields } = row;

  session ||= getSessionRow(row.session_id);

  if (session?.entry_type === "pre-cleaning" && row.photo_date <= session.visit_date && ["during", "general"].includes(row.stage)) {
    fields.stage = "before";
  }

  return { ...fields, url: `/api/v1/photos/${row.photo_id}/image`, thumbnail_url: `/api/v1/photos/${row.photo_id}/thumbnail` };
}

function getSessionRow(id) {
  return db.prepare(`SELECT s.*, CASE WHEN s.session_id = (
    SELECT session_id FROM cleaning_sessions WHERE memorial_id = s.memorial_id
    ORDER BY visit_date, session_id LIMIT 1
  ) THEN 'pre-cleaning' ELSE 'cleaning' END AS entry_type
  FROM cleaning_sessions s WHERE s.session_id = ?`).get(id);
}

function getSession(id) {
  const session = getSessionRow(id);
  return session ? { ...session, photos: db.prepare("SELECT * FROM cleaning_photos WHERE session_id = ? ORDER BY photo_date, CASE WHEN substr(captured_at, 1, 10) = photo_date THEN substr(captured_at, 12) ELSE '' END, photo_id").all(id).map(row => photo(row, session)) } : null;
}

function listSessions(memorialId) {
  return db.prepare("SELECT session_id FROM cleaning_sessions WHERE memorial_id = ? ORDER BY visit_date DESC, session_id DESC")
    .all(memorialId).map(row => getSession(row.session_id));
}

function saveSession(memorialId, fields, id) {
  if (id) {
    db.prepare(`UPDATE cleaning_sessions SET visit_date = ?, methods = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`)
      .run(fields.visitDate, fields.methods, fields.notes, id);
  } else {
    id = db.prepare("INSERT INTO cleaning_sessions (memorial_id, visit_date, methods, notes) VALUES (?, ?, ?, ?)")
      .run(memorialId, fields.visitDate, fields.methods, fields.notes).lastInsertRowid;
  }

  return getSession(id);
}

function getPhotoFile(id) {
  return db.prepare("SELECT * FROM cleaning_photos WHERE photo_id = ?").get(id);
}

function addPhoto(sessionId, filename, stage, caption, photoDate, capturedAt = "", dateSource = "manual") {
  const result = db.prepare("INSERT INTO cleaning_photos (session_id, filename, stage, caption, photo_date, captured_at, date_source) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(sessionId, filename, stage, caption, photoDate, capturedAt, dateSource);
  return photo(getPhotoFile(result.lastInsertRowid));
}

function updatePhoto(id, fields) {
  db.prepare("UPDATE cleaning_photos SET stage = ?, caption = ?, date_source = CASE WHEN photo_date != ? THEN 'manual' ELSE date_source END, photo_date = ? WHERE photo_id = ?")
    .run(fields.stage, fields.caption, fields.photoDate, fields.photoDate, id);
  return photo(getPhotoFile(id));
}

function removePhotos(ids) {
  return db.transaction(() => ids.map(id => {
    const row = getPhotoFile(id);
    db.prepare("DELETE FROM cleaning_photos WHERE photo_id = ?").run(id);
    return row;
  }).filter(Boolean))();
}

function removeSession(id) {
  return db.transaction(() => {
    const session = getSession(id);
    if (!session) return null;
    const files = db.prepare("SELECT filename FROM cleaning_photos WHERE session_id = ?").all(id);
    db.prepare("DELETE FROM cleaning_sessions WHERE session_id = ?").run(id);
    return { memorialId: session.memorial_id, files };
  })();
}

function timeline(memorialId, sessions = listSessions(memorialId)) {
  const events = [];

  for (const session of sessions) {
    const { photos, ...fields } = session;
    events.push({ ...fields, type: "session", date: session.visit_date, time: "" });

    for (const image of photos) {
      events.push({
        ...image, type: "photo", date: image.photo_date,
        time: image.captured_at.startsWith(image.photo_date) ? image.captured_at.slice(11) : "",
        visit_date: session.visit_date, entry_type: session.entry_type
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) ||
    (a.type === b.type ? (a.photo_id || a.session_id) - (b.photo_id || b.session_id) : a.type === "session" ? -1 : 1));
}

module.exports = { getSession, listSessions, saveSession, getPhotoFile, addPhoto, updatePhoto, removePhotos, removeSession, timeline };
