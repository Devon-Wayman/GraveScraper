const config = require("../config");

const CEMETERY_QUERY = JSON.stringify({
  operationName: "Cemetery",
  query:
    "query Cemetery($cemeteryID: [ID!], $memorialSearchSearch: MemorialSearchInput) { cemeteries(ids: $cemeteryID) { __typename total cemeteries { __typename id phone memorialCount photoRequestCount photographedCount acceptingPhotos url isFavorited isPhotoVolunteer famousCount myCount gpsCount acceptingBurials acceptingPhotoRequests names { __typename name abbreviation language } description { __typename value } coordinates { __typename lat lon } physicalAddress { __typename postalCode street } locations { __typename city county state country } transcriptionCount { __typename public private } dateCreated photos { __typename photos { __typename path id caption dateCreated sortOrder type contributor { __typename id publicName } } } } } memorialSearch(search: $memorialSearchSearch) { __typename memorials { __typename id name { __typename first middle last } photos { __typename photos { __typename path } } } } nearbyCemeteries(ids: $cemeteryID) { __typename names { __typename name } locations { __typename city county state country } id memorialCount gpsCount photographedCount photoRequestCount coordinates { __typename lat lon } photos(size: 1) { __typename photos { __typename path } } } }",
  variables: {
    cemeteryID: ["CEM_ID_HERE"],
    memorialSearchSearch: {
      cemeteryIds: ["CEM_ID_HERE"],
      from: 0,
      isFamous: true,
      size: 10
    }
  }
});

// Brief pause between page requests so the upstream service is not hammered.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInteger(min, max) {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function buildHttpError(response, body) {
  const error = new Error(`FindAGrave request failed (${response.status}): ${body.slice(0, 250)}`);
  error.status = response.status;
  return error;
}

function getHeaders() {
  if (!config.findAGrave.headers.ak) {
    throw new Error("Set FINDAGRAVE_AK in your local .env before importing from FindAGrave.");
  }
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    mv: config.findAGrave.headers.mv,
    ak: config.findAGrave.headers.ak
  };
}

// Extract the cemetery id and canonical URL pieces from a public FindAGrave URL.
function parseCemeteryUrl(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const cemeterySegmentIndex = segments.findIndex((segment) => segment === "cemetery");

  if (cemeterySegmentIndex === -1 || segments.length < cemeterySegmentIndex + 3) {
    throw new Error("Expected a FindAGrave cemetery URL like /cemetery/12345/name");
  }

  return {
    cemeteryId: segments[cemeterySegmentIndex + 1],
    cemeterySlug: segments[cemeterySegmentIndex + 2],
    cemeteryUrl: `${parsed.origin}/cemetery/${segments[cemeterySegmentIndex + 1]}/${segments[cemeterySegmentIndex + 2]}`
  };
}

// Central fetch helper so upstream failures include a useful error snippet.
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.text();
    throw buildHttpError(response, body);
  }

  return response.json();
}

// Reduces the GraphQL cemetery response to the summary fields stored locally.
function extractCemeteryInfo(graphqlResponse, cemeteryUrl) {
  const cemetery = graphqlResponse?.data?.cemeteries?.cemeteries?.[0];

  if (!cemetery) {
    throw new Error("Cemetery details were not present in the GraphQL response.");
  }

  const cemeteryName = cemetery.names?.[0]?.name ?? cemeteryUrl.split("/").pop();
  const memorialCount = Number(cemetery.memorialCount ?? 0);
  const gpsCount = Number(cemetery.gpsCount ?? 0);

  return {
    cemetery_id: String(cemetery.id),
    cemetery_name: cemeteryName,
    cemetery_url: cemeteryUrl,
    memorial_count: memorialCount,
    photo_request_count: Number(cemetery.photoRequestCount ?? 0),
    photographed_count: Number(cemetery.photographedCount ?? 0),
    famous_count: Number(cemetery.famousCount ?? 0),
    gps_count: gpsCount,
    percentage_with_gps: memorialCount > 0 ? Math.round((gpsCount * 100) / memorialCount) : 0
  };
}

// Normalizes one memorial payload from FindAGrave into the app's local shape.
function mapMemorial(memorial) {
  // FindAGrave sends location as [lon, lat], so convert it into a named object for internal use.
  const locationArray = Array.isArray(memorial.location) ? memorial.location : [];
  const lon = typeof locationArray[0] === "number" ? locationArray[0] : null;
  const lat = typeof locationArray[1] === "number" ? locationArray[1] : null;
  const birthYear = Number(memorial.birthYear ?? 0);
  const deathYear = Number(memorial.deathYear ?? 0);
  const photoContributors = Array.isArray(memorial.photoContributors) ? memorial.photoContributors : [];

  return {
    memorialId: Number(memorial.memorialId ?? 0),
    isVeteran: Boolean(memorial.isVeteran),
    isFamous: Boolean(memorial.isFamous),
    firstName: memorial.firstName ?? null,
    middleName: memorial.middleName ?? null,
    lastName: memorial.lastName ?? null,
    fullName: memorial.fullName ?? null,
    birthCityName: memorial.birthCityName ?? null,
    deathCityName: memorial.deathCityName ?? null,
    birthDate: memorial.birthDate ?? null,
    deathDate: memorial.deathDate ?? null,
    birthYear,
    deathYear,
    approxAge: birthYear && deathYear ? deathYear - birthYear : null,
    parents: Array.isArray(memorial.Parents) ? memorial.Parents : [],
    spouses: Array.isArray(memorial.Spouses) ? memorial.Spouses : [],
    siblings: Array.isArray(memorial.Siblings) ? memorial.Siblings : [],
    children: Array.isArray(memorial.Children) ? memorial.Children : [],
    location: lat !== null && lon !== null ? { lat, lon } : null,
    googleMapsLink: lat !== null && lon !== null ? `https://www.google.com/maps/place/${lat},${lon}` : null,
    findAGraveDateModified: memorial.dateModified ?? null,
    findAGraveDateCreated: memorial.IntermentDateCreated ?? null,
    memorialContributorId: memorial.memorialContributorId ?? null,
    creatorContributorId: memorial.creatorContributorId ?? null,
    photoContributorIds: photoContributors,
    rawPayload: memorial
  };
}

async function fetchCemetery(cemeteryId, cemeteryUrl) {
  const body = CEMETERY_QUERY.replaceAll("CEM_ID_HERE", String(cemeteryId));
  const data = await fetchJson(config.findAGrave.graphqlUrl, {
    method: "POST",
    headers: getHeaders(),
    body
  });

  return extractCemeteryInfo(data, cemeteryUrl);
}

// Fetches one page of memorial search results. Page sizing is configured centrally.
async function fetchMemorialPage(cemeteryId, skip) {
  const url = new URL("/memorial/search", config.findAGrave.baseUrl);
  url.searchParams.set("cemeteryId", cemeteryId);
  url.searchParams.set("orderby", "r");
  url.searchParams.set("skip", String(skip));
  url.searchParams.set("limit", String(config.findAGrave.memorialPageSize));

  return fetchJson(url, {
    headers: getHeaders()
  });
}

async function fetchMemorialPageWithResume(cemeteryId, skip, options = {}) {
  const {
    pageCache,
    onProgress,
    processed,
    total,
    requestsMade,
    totalRequests
  } = options;

  if (pageCache?.has(skip)) {
    return pageCache.get(skip);
  }

  for (; ;) {
    try {
      const page = await fetchMemorialPage(cemeteryId, skip);
      pageCache?.set(skip, page);
      return page;
    } catch (error) {
      if (error.status !== 429) {
        throw error;
      }

      const backoffMs = config.findAGrave.rateLimitBackoffMs;
      onProgress?.({
        phase: "rate_limited",
        processed,
        total,
        skip,
        requestsMade,
        totalRequests,
        cooldownMs: backoffMs
      });
      await sleep(backoffMs);
    }
  }
}

// Walks all memorial pages and reports progress back to the import service.
async function fetchAllMemorials(cemeteryId, totalMemorials, options = {}) {
  const { onProgress } = options;
  const memorials = [];
  const pageCache = new Map();
  const seenMemorialIds = new Set();
  const totalRequests = Math.ceil(totalMemorials / config.findAGrave.memorialPageSize);
  const cooldownEveryRequests = Math.max(1, config.findAGrave.cooldownEveryRequests || 3);
  let requestsMade = 0;
  let stopReason = null;

  for (let skip = 0; skip < totalMemorials; skip += config.findAGrave.memorialPageSize) {
    const page = await fetchMemorialPageWithResume(cemeteryId, skip, {
      pageCache,
      onProgress,
      processed: Math.min(memorials.length, totalMemorials),
      total: totalMemorials,
      requestsMade,
      totalRequests
    });
    requestsMade += 1;
    const items = Array.isArray(page.memorials) ? page.memorials : [];
    const mappedItems = items.map(mapMemorial).filter((item) => item.memorialId > 0);
    const newItems = mappedItems.filter((item) => {
      if (seenMemorialIds.has(item.memorialId)) {
        return false;
      }

      seenMemorialIds.add(item.memorialId);
      return true;
    });

    // Stop early if the upstream endpoint has stopped advancing through unique records.
    if (mappedItems.length === 0) {
      stopReason = {
        type: "empty_page",
        skip,
        requestsMade
      };

      onProgress?.({
        phase: "stalled",
        processed: memorials.length,
        total: totalMemorials,
        pageSize: items.length,
        skip,
        requestsMade,
        totalRequests,
        stopReason
      });
      break;
    }

    if (newItems.length === 0) {
      stopReason = {
        type: "duplicate_page",
        skip,
        requestsMade
      };

      onProgress?.({
        phase: "stalled",
        processed: memorials.length,
        total: totalMemorials,
        pageSize: items.length,
        skip,
        requestsMade,
        totalRequests,
        stopReason
      });
      break;
    }

    memorials.push(...newItems);

    onProgress?.({
      phase: "scraping",
      processed: Math.min(memorials.length, totalMemorials),
      total: totalMemorials,
      pageSize: items.length,
      skip,
      requestsMade,
      totalRequests
    });

    const hasMoreRequests = requestsMade < totalRequests;

    if (!hasMoreRequests) {
      continue;
    }

    if (requestsMade % cooldownEveryRequests === 0) {
      const cooldownMs = randomInteger(
        config.findAGrave.cooldownMinMs,
        config.findAGrave.cooldownMaxMs
      );

      onProgress?.({
        phase: "cooldown",
        processed: Math.min(memorials.length, totalMemorials),
        total: totalMemorials,
        pageSize: items.length,
        skip,
        requestsMade,
        totalRequests,
        cooldownMs
      });

      await sleep(cooldownMs);
      continue;
    }

    if (config.findAGrave.requestDelayMs > 0) {
      await sleep(config.findAGrave.requestDelayMs);
    }
  }

  return {
    memorials,
    stopReason
  };
}

module.exports = {
  fetchAllMemorials,
  fetchCemetery,
  parseCemeteryUrl
};
