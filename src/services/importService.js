const repositories = require("../db/repositories");
const {
  fetchAllMemorials,
  fetchCemetery,
  parseCemeteryUrl
} = require("./findAGraveService");

// Used as a readable placeholder name before the first upstream cemetery fetch completes.
function titleizeSlug(slug) {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Named wrapper keeps progress updates easy to grep and refactor later.
function reportProgress(importId, update) {
  repositories.updateImportProgress(importId, update);
}

// Full import pipeline: fetch cemetery details, collect memorials, then sync them into SQLite.
async function runImport(importId, cemeteryUrl, options = {}) {
  const { isRefresh = false } = options;
  const { cemeteryId, cemeteryUrl: normalizedUrl } = parseCemeteryUrl(cemeteryUrl);
  reportProgress(importId, {
    status: "running",
    message: isRefresh
      ? "Cemetery already exists locally. Fetching fresh details from FindAGrave."
      : "Fetching cemetery details from FindAGrave.",
    current_step: "Fetching cemetery details",
    progress_percent: 5
  });

  const cemetery = await fetchCemetery(cemeteryId, normalizedUrl);

  repositories.upsertCemetery(cemetery);
  reportProgress(importId, {
    message: isRefresh
      ? `Loaded updated cemetery details for ${cemetery.cemetery_name}. Preparing refresh.`
      : `Loaded cemetery details for ${cemetery.cemetery_name}. Preparing first import.`,
    current_step: isRefresh ? "Preparing cemetery refresh" : "Preparing memorial import",
    total_memorials: cemetery.memorial_count,
    progress_percent: cemetery.memorial_count > 0 ? 10 : 90
  });

  if (cemetery.memorial_count === 0) {
    const syncSummary = repositories.syncMemorialsForCemetery(cemetery.cemetery_id, []);
    repositories.finishImport(importId, "completed", "Imported 0 memorials.", 0);

    return {
      cemetery,
      memorialsImported: 0,
      syncSummary
    };
  }

  const { memorials, stopReason } = await fetchAllMemorials(cemetery.cemetery_id, cemetery.memorial_count, {
    onProgress: ({ phase, processed, total, requestsMade, totalRequests, cooldownMs, stopReason: nextStopReason }) => {
      // Reserve the last few percent for the database sync step so progress feels less jumpy.
      const progressPercent = Math.max(10, Math.min(95, Math.round((processed / total) * 85) + 10));

      if (phase === "stalled") {
        const reasonText = nextStopReason?.type === "empty_page"
          ? "FindAGrave returned an empty page"
          : "FindAGrave stopped returning new memorial records";
        reportProgress(importId, {
          message: `${reasonText} at request ${requestsMade} of ${totalRequests} (skip ${nextStopReason?.skip ?? 0}). Stopping early to avoid wasted requests.`,
          current_step: "Import stopped early",
          processed_memorials: processed,
          total_memorials: total,
          memorials_seen: processed,
          progress_percent: progressPercent
        });
        return;
      }

      if (phase === "rate_limited") {
        const cooldownSeconds = Math.round(cooldownMs / 1000);
        reportProgress(importId, {
          message: `FindAGrave returned a 429 rate limit. Waiting ${cooldownSeconds} seconds, then resuming from request ${requestsMade + 1} of ${totalRequests}.`,
          current_step: "Rate limited, waiting to resume",
          processed_memorials: processed,
          total_memorials: total,
          memorials_seen: processed,
          progress_percent: progressPercent
        });
        return;
      }

      if (phase === "cooldown") {
        const cooldownSeconds = (cooldownMs / 1000).toFixed(1);
        reportProgress(importId, {
          message: `Pausing for ${cooldownSeconds} seconds after request ${requestsMade} of ${totalRequests} to avoid rate limiting.`,
          current_step: "Cooling down between requests",
          processed_memorials: processed,
          total_memorials: total,
          memorials_seen: processed,
          progress_percent: progressPercent
        });
        return;
      }

      reportProgress(importId, {
        message: `Processed ${processed} of ${total} memorials. Request ${requestsMade} of ${totalRequests}.`,
        current_step: "Scraping memorial records",
        processed_memorials: processed,
        total_memorials: total,
        memorials_seen: processed,
        progress_percent: progressPercent
      });
    }
  });

  reportProgress(importId, {
    message: isRefresh
      ? `Comparing ${memorials.length} memorials against the existing SQLite data.`
      : `Saving ${memorials.length} memorials to SQLite.`,
    current_step: isRefresh ? "Comparing and syncing memorials" : "Saving memorials to database",
    processed_memorials: memorials.length,
    total_memorials: cemetery.memorial_count,
    memorials_seen: memorials.length,
    progress_percent: 97
  });

  const syncSummary = repositories.syncMemorialsForCemetery(cemetery.cemetery_id, memorials);
  const stopSummary = stopReason
    ? `Stopped early because ${
      stopReason.type === "empty_page"
        ? `FindAGrave returned an empty page at skip ${stopReason.skip}`
        : `FindAGrave stopped returning new records at skip ${stopReason.skip}`
    }.`
    : "";
  const summaryMessage = isRefresh
    ? `Refresh complete. ${syncSummary.inserted} added, ${syncSummary.updated} updated, ${syncSummary.unchanged} unchanged, ${syncSummary.deleted} removed. ${stopSummary}`.trim()
    : `Import complete. ${syncSummary.inserted} added, ${syncSummary.updated} updated, ${syncSummary.deleted} removed. ${stopSummary}`.trim();

  repositories.finishImport(
    importId,
    "completed",
    summaryMessage,
    memorials.length
  );

  return {
    cemetery,
    memorialsImported: memorials.length,
    syncSummary
  };
}

// Creates the import row now, then lets the actual work continue asynchronously.
function startImportFromUrl(cemeteryUrl) {
  const { cemeteryId, cemeterySlug, cemeteryUrl: normalizedUrl } = parseCemeteryUrl(cemeteryUrl);
  const existingCemetery = repositories.getCemeteryById(cemeteryId);

  if (!existingCemetery) {
    repositories.upsertCemetery({
      cemetery_id: cemeteryId,
      cemetery_name: titleizeSlug(cemeterySlug),
      cemetery_url: normalizedUrl,
      memorial_count: 0,
      photo_request_count: 0,
      photographed_count: 0,
      famous_count: 0,
      gps_count: 0,
      percentage_with_gps: 0
    });
  }

  const importId = repositories.createImport({ cemeteryId });
  reportProgress(importId, {
    message: existingCemetery
      ? `Existing cemetery found: ${existingCemetery.cemetery_name}. Starting refresh.`
      : `No local copy found for cemetery ${cemeteryId}. Starting new import.`,
    current_step: existingCemetery ? "Queued cemetery refresh" : "Queued new cemetery import"
  });

  // Fire-and-forget so the HTTP request can return immediately while the import keeps running.
  Promise.resolve()
    .then(() => runImport(importId, normalizedUrl, { isRefresh: Boolean(existingCemetery) }))
    .catch((error) => {
      repositories.finishImport(importId, "failed", error.message, 0);
    });

  return {
    importId,
    cemeteryId,
    isRefresh: Boolean(existingCemetery)
  };
}

module.exports = {
  startImportFromUrl
};
