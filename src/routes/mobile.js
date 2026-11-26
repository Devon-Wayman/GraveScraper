const express = require("express");
const path = require("node:path");
const repositories = require("../db/repositories");
const cleaning = require("../db/cleaning");
const config = require("../config");
const { upload, savePhotos, cleanupUploads } = require("../services/photoUpload");
const { CEMETERY_FIELD_OPTIONS, MEMORIAL_FIELD_OPTIONS } = require("../services/fieldOptions");
const router = express.Router();
const { removePhotoFiles } = require("../services/cleaningDeletion");
const asyncRoute = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(body, key, fallback = "", max = 10000) {
  const value = body?.[key] ?? fallback;
  if (typeof value !== "string" || value.length > max) fail(`${key} must be text of at most ${max} characters.`);
  return value.trim();
}
function option(body, key, fallback, options) {
  const value = text(body, key, fallback);
  if (!options.some(item => item.value === value)) fail(`Invalid ${key}.`);
  return value;
}
function cemetery(id) { return repositories.getCemeteryById(id) || fail("Cemetery not found.", 404); }
function memorial(id) { return repositories.getMemorialById(id) || fail("Memorial not found.", 404); }
function session(id) { return cleaning.getSession(id) || fail("Cleaning session not found.", 404); }
function sessionFields(body, existing = {}) {
  const visitDate = text(body, "visitDate", existing.visit_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate) || !Number.isFinite(Date.parse(visitDate)) || new Date(visitDate).toISOString().slice(0, 10) !== visitDate) {
    fail("Enter a valid visit date (YYYY-MM-DD).");
  }
  return { visitDate, methods: text(body, "methods", existing.methods), notes: text(body, "notes", existing.notes) };
}

router.get("/api/v1/options", (_req, res) => res.json({ cemetery: CEMETERY_FIELD_OPTIONS, memorial: MEMORIAL_FIELD_OPTIONS, photoStages: ["before", "during", "after", "general"] }));
router.get("/api/v1/active-cleaning", asyncRoute((req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1) fail("Invalid page.");
  res.json(repositories.getActiveCleaning({ search: text(req.query, "q", "", 200), page }));
}));
router.get("/api/v1/cemeteries", (_req, res) => res.json({ cemeteries: repositories.getCemeteries() }));
router.get("/api/v1/cemeteries/:id", asyncRoute((req, res) => res.json({ cemetery: cemetery(req.params.id) })));
router.patch("/api/v1/cemeteries/:id", asyncRoute((req, res) => {
  const row = cemetery(req.params.id);
  repositories.updateCemeteryUserFields(row.cemetery_id, {
    ownerName: text(req.body, "ownerName", row.owner_name),
    ownerType: option(req.body, "ownerType", row.owner_type, CEMETERY_FIELD_OPTIONS.ownerTypes),
    ownerContact: text(req.body, "ownerContact", row.owner_contact),
    permissionStatus: option(req.body, "permissionStatus", row.permission_status, CEMETERY_FIELD_OPTIONS.permissionStatuses),
    permissionProgress: text(req.body, "permissionProgress", row.permission_progress),
    ownerRequirements: text(req.body, "ownerRequirements", row.owner_requirements),
    userNotes: text(req.body, "userNotes", row.user_notes)
  });
  res.json({ cemetery: cemetery(row.cemetery_id) });
}));
router.get("/api/v1/cemeteries/:id/memorials", asyncRoute((req, res) => {
  cemetery(req.params.id);
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1) fail("Invalid page.");
  const search = text(req.query, "q", "", 200);
  res.json({ memorials: repositories.getMemorialPageByCemeteryId(req.params.id, { search, limit: 50, offset: (page - 1) * 50 }),
    page, pageSize: 50, total: repositories.countMemorialsByCemeteryId(req.params.id, { search }) });
}));
router.get("/api/v1/memorials/:id", asyncRoute((req, res) => res.json({ memorial: memorial(req.params.id) })));
router.patch("/api/v1/memorials/:id", asyncRoute((req, res) => {
  const row = memorial(req.params.id);
  const workStatus = option(req.body, "cleaningWorkStatus", row.cleaning_work_status, MEMORIAL_FIELD_OPTIONS.cleaningWorkStatuses);
  repositories.updateMemorialUserFields(row.memorial_id, {
    userNotes: text(req.body, "userNotes", row.user_notes),
    cleaningStatus: option(req.body, "cleaningStatus", row.cleaning_status, MEMORIAL_FIELD_OPTIONS.cleaningStatuses),
    familyRelation: option(req.body, "familyRelation", row.family_relation, MEMORIAL_FIELD_OPTIONS.familyRelations),
    visitPriority: option(req.body, "visitPriority", row.visit_priority, MEMORIAL_FIELD_OPTIONS.visitPriorities),
    researchStatus: option(req.body, "researchStatus", row.research_status, MEMORIAL_FIELD_OPTIONS.researchStatuses)
  });
  repositories.setCleaningWorkStatus(row.memorial_id, workStatus);
  res.json({ memorial: memorial(row.memorial_id) });
}));
router.get("/api/v1/memorials/:id/cleaning-sessions", asyncRoute((req, res) => {
  memorial(req.params.id);
  res.json({ sessions: cleaning.listSessions(req.params.id) });
}));
router.post("/api/v1/memorials/:id/cleaning-sessions", asyncRoute((req, res) => {
  const row = memorial(req.params.id);
  res.status(201).json({ session: cleaning.saveSession(row.memorial_id, sessionFields(req.body)) });
}));
router.get("/api/v1/cleaning-sessions/:id", asyncRoute((req, res) => res.json({ session: session(req.params.id) })));
router.patch("/api/v1/cleaning-sessions/:id", asyncRoute((req, res) => {
  const row = session(req.params.id);
  res.json({ session: cleaning.saveSession(row.memorial_id, sessionFields(req.body, row), row.session_id) });
}));
router.delete("/api/v1/cleaning-sessions/:id", asyncRoute(async (req, res) => {
  session(req.params.id);
  const removed = cleaning.removeSession(req.params.id);
  const warning = await removePhotoFiles(removed.files);
  res.json({ deleted: true, ...(warning ? { warning } : {}) });
}));
router.post("/cleaning-sessions/:id/delete", asyncRoute(async (req, res) => {
  if (req.body.confirmation !== "delete") fail("Confirm deletion before removing this cleaning session.");
  session(req.params.id);
  const removed = cleaning.removeSession(req.params.id);
  const warning = await removePhotoFiles(removed.files);
  const message = warning || "Cleaning session and attached photos deleted.";
  res.redirect(`/memorials/${removed.memorialId}?message=${encodeURIComponent(message)}#cleaning-history`);
}));

// Browser forms share the same validation and storage as the API.
router.post("/memorials/:id/cleaning-sessions", asyncRoute((req, res) => {
  const row = memorial(req.params.id);
  const saved = cleaning.saveSession(row.memorial_id, sessionFields(req.body));
  const next = req.body.next === "photos" ? `&addPhotos=${saved.session_id}` : "";
  res.redirect(`/memorials/${row.memorial_id}?message=Cleaning%20session%20saved.${next}#session-${saved.session_id}`);
}));
router.post("/cleaning-sessions/:id", asyncRoute((req, res) => {
  const row = session(req.params.id);
  cleaning.saveSession(row.memorial_id, sessionFields(req.body, row), row.session_id);
  res.redirect(`/memorials/${row.memorial_id}?message=Session%20updated.#session-${row.session_id}`);
}));

function receivePhoto(req, res, next) {
  try { session(req.params.id); } catch (error) { return next(error); }
  upload(req, res, error => {
    if (!error) return next();
    cleanupUploads(req.files).then(() => next(error), next);
  });
}
function photoFields(body, existing = {}, allowCaptureDate = false) {
  const stage = text(body, "stage", existing.stage || "general");
  if (!["before", "during", "after", "general"].includes(stage)) fail("Invalid photo stage.");
  const photoDate = text(body, "photoDate", existing.photo_date || (allowCaptureDate ? "" : new Date().toISOString().slice(0, 10)));
  if (photoDate || !allowCaptureDate) sessionFields({ visitDate: photoDate });
  return { stage, caption: text(body, "caption", existing.caption || "", 2000), photoDate };
}
async function storePhotos(req) {
  try {
    const parent = session(req.params.id);
    const fields = photoFields(req.body, { stage: parent.entry_type === "pre-cleaning" ? "before" : "during" }, true);
    // A blank date reads capture metadata independently for each selected image.
    return await savePhotos(req.params.id, req.files, fields.stage, fields.caption, fields.photoDate);
  } finally { await cleanupUploads(req.files); }
}
router.get("/photo-metadata.js", (_req, res) => res.sendFile(path.join(config.rootDir, "node_modules/exifr/dist/lite.umd.js")));
router.get("/api/v1/memorials/:id/timeline", asyncRoute((req, res) => {
  memorial(req.params.id);
  res.json({ events: cleaning.timeline(req.params.id) });
}));
router.get("/memorials/:id/timeline", asyncRoute((req, res) => {
  const row = memorial(req.params.id);
  res.render("timeline", { memorial: row, events: cleaning.timeline(row.memorial_id), offline: false });
}));
router.get("/memorials/:id/cleaning-progress.zip", asyncRoute((req, res) =>
  require("../services/cleaningReport").exportReport(res, memorial(req.params.id))));
router.post("/api/v1/cleaning-sessions/:id/photos", receivePhoto, asyncRoute(async (req, res) => {
  const photos = await storePhotos(req);
  res.status(201).json({ photos, ...(photos.length === 1 ? { photo: photos[0] } : {}) });
}));
router.post("/cleaning-sessions/:id/photos", receivePhoto, asyncRoute(async (req, res) => {
  const photos = await storePhotos(req);
  const row = session(req.params.id);
  res.redirect(`/memorials/${row.memorial_id}?message=${photos.length}%20photo(s)%20uploaded.#session-${row.session_id}`);
}));
router.patch("/api/v1/photos/:id", asyncRoute((req, res) => {
  const row = cleaning.getPhotoFile(req.params.id) || fail("Photo not found.", 404);
  res.json({ photo: cleaning.updatePhoto(row.photo_id, photoFields(req.body, row)) });
}));
async function deletePhoto(id) {
  const row = cleaning.getPhotoFile(id) || fail("Photo not found.", 404);
  const parent = session(row.session_id);
  const files = cleaning.removePhotos([row.photo_id]);
  return { memorialId: parent.memorial_id, warning: await removePhotoFiles(files) };
}
router.delete("/api/v1/photos/:id", asyncRoute(async (req, res) => {
  const { warning } = await deletePhoto(req.params.id);
  res.json({ deleted: true, ...(warning ? { warning } : {}) });
}));
router.post("/photos/:id/delete", asyncRoute(async (req, res) => {
  if (req.body.confirmation !== "delete") fail("Confirm deletion before removing this photo.");
  const { memorialId, warning } = await deletePhoto(req.params.id);
  res.redirect(`/memorials/${memorialId}?message=${encodeURIComponent(warning || "Photo deleted.")}#cleaning-history`);
}));
router.post("/photos/:id", asyncRoute((req, res) => {
  const row = cleaning.getPhotoFile(req.params.id) || fail("Photo not found.", 404);
  cleaning.updatePhoto(row.photo_id, photoFields(req.body, row));
  const parent = session(row.session_id);
  res.redirect(`/memorials/${parent.memorial_id}?message=Photo%20details%20saved.#photo-${row.photo_id}`);
}));
for (const variant of ["image", "thumbnail"]) {
  router.get(`/api/v1/photos/:id/${variant}`, asyncRoute((req, res) => {
    const row = cleaning.getPhotoFile(req.params.id) || fail("Photo not found.", 404);
    res.type("jpeg").sendFile(path.resolve(config.uploadsPath, `${variant === "thumbnail" ? "thumb-" : ""}${row.filename}`));
  }));
}
router.use("/api/v1", (_req, res) => res.status(404).json({ error: "Endpoint not found." }));
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.name === "MulterError" ? 400 : error.status || 500;
  const message = status === 500 ? "Unable to save changes. Please try again." : error.code === "LIMIT_FILE_SIZE" ? "A photo exceeds the 20 MB upload limit." : ["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error.code) ? "Select up to 20 photos using the photo upload field." : error.message;
  if (status === 500) console.error(error);
  if (req.path.startsWith("/api/")) return res.status(status).json({ error: message });
  res.status(status).render("action-error", { message });
});
module.exports = router;
