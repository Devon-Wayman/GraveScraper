const express = require("express");
const repositories = require("../db/repositories");
const { startImportFromUrl } = require("../services/importService");
const { buildCsv, buildKml, buildXml } = require("../services/exportService");
const { PROVIDERS, searchProvider } = require("../services/researchProviders");

const router = express.Router();
const MEMORIALS_PER_PAGE = 50;
const { CEMETERY_FIELD_OPTIONS, MEMORIAL_FIELD_OPTIONS } = require("../services/fieldOptions");

function normalizeOption(value, options) {
  const normalized = String(value ?? "").trim();
  return options.some((option) => option.value === normalized) ? normalized : "";
}

function buildExportFilename(name, extension) {
  const safeName = String(name || "memorials")
    .replace(/"/g, "")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return `${safeName || "memorials"}.${extension}`;
}

function sendMemorialExport(res, memorials, format, documentName) {
  if (format === "csv") {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${buildExportFilename(documentName, "csv")}"`
    );
    res.type("text/csv");
    res.send(buildCsv(memorials));
    return;
  }

  if (format === "kml") {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${buildExportFilename(documentName, "kml")}"`
    );
    res.type("application/vnd.google-earth.kml+xml");
    res.send(buildKml(memorials, documentName));
    return;
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${buildExportFilename(documentName, "xml")}"`
  );

  res.type("application/xml");
  res.send(buildXml(memorials, documentName));
}


// Landing page with cemetery list and recent import activity.
router.get("/", (req, res) => {
  res.render("index", {
    cemeteries: repositories.getCemeteries(),
    imports: repositories.getRecentImports(),
    activeCleaning: repositories.getActiveCleaning({ search: String(req.query.activeSearch ?? "").trim().slice(0, 200), page: Number(req.query.activePage || 1) }),
    message: req.query.message ?? null,
    error: req.query.error ?? null
  });
});

// Server-rendered import form handler for the homepage.
router.post("/imports", async (req, res) => {
  const cemeteryUrl = req.body.cemeteryUrl?.trim();

  if (!cemeteryUrl) {
    res.redirect("/?error=Please provide a cemetery URL.");
    return;
  }

  try {
    startImportFromUrl(cemeteryUrl);
    res.redirect("/?message=Import started.");
  } catch (error) {
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

// Main cemetery detail page.
router.get("/cemeteries/:cemeteryId", (req, res) => {
  const cemetery = repositories.getCemeteryById(req.params.cemeteryId);

  if (!cemetery) {
    res.status(404).render("404");
    return;
  }

  const searchQuery = String(req.query.q ?? "").trim();
  const requestedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
  const totalResults = repositories.countMemorialsByCemeteryId(req.params.cemeteryId, {
    search: searchQuery
  });
  const totalPages = Math.max(1, Math.ceil(totalResults / MEMORIALS_PER_PAGE));
  const page = Number.isFinite(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, totalPages)
    : 1;
  const memorials = repositories.getMemorialPageByCemeteryId(req.params.cemeteryId, {
    search: searchQuery,
    limit: MEMORIALS_PER_PAGE,
    offset: (page - 1) * MEMORIALS_PER_PAGE
  });

  res.render("cemetery", {
    cemetery,
    fieldOptions: CEMETERY_FIELD_OPTIONS,
    message: req.query.message ?? null,
    memorials,
    searchQuery,
    pagination: {
      page,
      totalPages,
      totalResults,
      startRow: totalResults === 0 ? 0 : ((page - 1) * MEMORIALS_PER_PAGE) + 1,
      endRow: totalResults === 0 ? 0 : Math.min(page * MEMORIALS_PER_PAGE, totalResults),
      hasPrevious: page > 1,
      hasNext: page < totalPages
    }
  });
});

router.post("/cemeteries/:cemeteryId", (req, res) => {
  const cemetery = repositories.getCemeteryById(req.params.cemeteryId);
  if (!cemetery) {
    res.status(404).render("404");
    return;
  }

  repositories.updateCemeteryUserFields(cemetery.cemetery_id, {
    ownerName: String(req.body.ownerName ?? "").trim(),
    ownerType: normalizeOption(req.body.ownerType, CEMETERY_FIELD_OPTIONS.ownerTypes),
    ownerContact: String(req.body.ownerContact ?? "").trim(),
    permissionStatus: normalizeOption(req.body.permissionStatus, CEMETERY_FIELD_OPTIONS.permissionStatuses),
    permissionProgress: String(req.body.permissionProgress ?? "").trim(),
    ownerRequirements: String(req.body.ownerRequirements ?? "").trim(),
    userNotes: String(req.body.userNotes ?? "").trim()
  });

  res.redirect(`/cemeteries/${encodeURIComponent(cemetery.cemetery_id)}?message=Cemetery%20details%20saved.#cemetery-details`);
});

router.get("/api/cemeteries", (req, res) => {
  res.json(repositories.getCemeteries());
});

router.get("/api/cemeteries/:cemeteryId", (req, res) => {
  const cemetery = repositories.getCemeteryById(req.params.cemeteryId);

  if (!cemetery) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({
    cemetery,
    memorials: repositories.getMemorialsByCemeteryId(req.params.cemeteryId)
  });
});

router.get("/memorials/:memorialId", (req, res) => {
  const memorial = repositories.getMemorialById(req.params.memorialId);

  if (!memorial) {
    res.status(404).render("404");
    return;
  }

  const cleaning = require("../db/cleaning");
  const cleaningSessions = cleaning.listSessions(memorial.memorial_id);
  res.render("memorial", {
    memorial,
    cleaningSessions,
    cleaningTimeline: cleaning.timeline(memorial.memorial_id, cleaningSessions),
    fieldOptions: MEMORIAL_FIELD_OPTIONS,
    researchProviders: PROVIDERS,
    researchLeads: repositories.getResearchLeadsByMemorialId(memorial.memorial_id),
    researchSources: repositories.getResearchSourcesByMemorialId(memorial.memorial_id),
    researchClaims: repositories.getResearchClaimsByMemorialId(memorial.memorial_id),
    message: req.query.message ?? null,
    error: req.query.error ?? null
  });
});

router.post("/memorials/:memorialId/cleaning-project", (req, res) => {
  const memorial = repositories.getMemorialById(req.params.memorialId);

  if (!memorial) {
    return res.status(404).render("404");
  }

  const status = String(req.body.cleaningWorkStatus ?? "");

  if (!MEMORIAL_FIELD_OPTIONS.cleaningWorkStatuses.some(option => option.value === status)) {
    return res.status(400).render("action-error", { message: "Choose a valid cleaning project status." });
  }

  repositories.setCleaningWorkStatus(memorial.memorial_id, status);
  const target = req.body.returnTo === "dashboard" ? "/" : `/memorials/${memorial.memorial_id}`;
  res.redirect(`${target}?message=Cleaning%20project%20status%20saved.${target === "/" ? "#active-cleaning" : "#cleaning-history"}`);
});

router.post("/memorials/:memorialId", (req, res) => {
  const memorial = repositories.getMemorialById(req.params.memorialId);

  if (!memorial) {
    res.redirect("/?error=Memorial not found.");
    return;
  }

  repositories.updateMemorialUserFields(memorial.memorial_id, {
    userNotes: String(req.body.userNotes ?? "").trim(),
    cleaningStatus: normalizeOption(req.body.cleaningStatus, MEMORIAL_FIELD_OPTIONS.cleaningStatuses),
    familyRelation: normalizeOption(req.body.familyRelation, MEMORIAL_FIELD_OPTIONS.familyRelations),
    visitPriority: normalizeOption(req.body.visitPriority, MEMORIAL_FIELD_OPTIONS.visitPriorities),
    researchStatus: normalizeOption(req.body.researchStatus, MEMORIAL_FIELD_OPTIONS.researchStatuses)
  });

  res.redirect(`/memorials/${memorial.memorial_id}?message=Memorial notes saved.`);
});

router.post("/memorials/:memorialId/research", async (req, res) => {
  const memorial = repositories.getMemorialById(req.params.memorialId);

  if (!memorial) {
    res.redirect("/?error=Memorial not found.");
    return;
  }

  const provider = String(req.body.provider ?? "").trim();

  try {
    const leads = await searchProvider(provider, memorial);
    const savedLeads = repositories.saveResearchLeads(memorial.memorial_id, leads);
    const message = savedLeads.length > 0
      ? `Found ${savedLeads.length} possible research leads.`
      : "No research leads came back from that source.";
    res.redirect(`/memorials/${memorial.memorial_id}?message=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(`/memorials/${memorial.memorial_id}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post("/api/memorials/:memorialId/research", async (req, res) => {
  const memorial = repositories.getMemorialById(req.params.memorialId);

  if (!memorial) {
    res.status(404).json({ error: "Memorial not found" });
    return;
  }

  const provider = String(req.body.provider ?? "").trim();

  try {
    const leads = await searchProvider(provider, memorial);
    const savedLeads = repositories.saveResearchLeads(memorial.memorial_id, leads);
    res.status(201).json({ leads: savedLeads });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/research/leads/:leadId/approve", (req, res) => {
  const lead = repositories.approveResearchLead(req.params.leadId);

  if (!lead) {
    res.redirect("/?error=Research lead not found.");
    return;
  }

  res.redirect(`/memorials/${lead.memorial_id}?message=Research lead approved.`);
});

router.post("/api/research/leads/:leadId/approve", (req, res) => {
  const lead = repositories.approveResearchLead(req.params.leadId);

  if (!lead) {
    res.status(404).json({ error: "Research lead not found" });
    return;
  }

  res.json({ lead });
});

router.post("/research/leads/:leadId/reject", (req, res) => {
  const lead = repositories.rejectResearchLead(req.params.leadId);

  if (!lead) {
    res.redirect("/?error=Research lead not found.");
    return;
  }

  res.redirect(`/memorials/${lead.memorial_id}?message=Research lead rejected.`);
});

router.post("/api/research/leads/:leadId/reject", (req, res) => {
  const lead = repositories.rejectResearchLead(req.params.leadId);

  if (!lead) {
    res.status(404).json({ error: "Research lead not found" });
    return;
  }

  res.json({ lead });
});

// Browser-side import modal entry point.
router.post("/api/imports", (req, res) => {
  const cemeteryUrl = req.body.cemeteryUrl?.trim();

  if (!cemeteryUrl) {
    res.status(400).json({ error: "Please provide a cemetery URL." });
    return;
  }

  try {
    const result = startImportFromUrl(cemeteryUrl);
    res.status(202).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Import progress polling endpoint.
router.get("/api/imports/:importId", (req, res) => {
  const importRun = repositories.getImportById(req.params.importId);

  if (!importRun) {
    res.status(404).json({ error: "Import not found" });
    return;
  }

  res.json(importRun);
});

// Exports are generated on demand so they always reflect the latest SQLite state.
router.get("/exports/memorials.:format(csv|kml|xml)", (req, res) => {
  sendMemorialExport(res, repositories.getAllMemorials(), req.params.format, "All Memorials");
});

router.get("/cemeteries/:cemeteryId/export.:format(csv|kml|xml)", (req, res) => {
  const cemetery = repositories.getCemeteryById(req.params.cemeteryId);

  if (!cemetery) {
    res.redirect("/?error=Cemetery not found.");
    return;
  }

  sendMemorialExport(
    res,
    repositories.getMemorialsByCemeteryId(cemetery.cemetery_id),
    req.params.format,
    cemetery.cemetery_name
  );
});

router.post("/cemeteries/:cemeteryId/delete", (req, res) => {
  const cemetery = repositories.getCemeteryById(req.params.cemeteryId);

  if (!cemetery) {
    res.redirect("/?error=Cemetery not found.");
    return;
  }

  repositories.deleteCemeteryById(cemetery.cemetery_id);
  res.redirect(`/?message=${encodeURIComponent(`${cemetery.cemetery_name} deleted.`)}`);
});

module.exports = router;
