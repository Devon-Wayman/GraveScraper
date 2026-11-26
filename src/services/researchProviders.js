const USER_AGENT = "GraveScraperResearch/2.0 personal research tool";

const PROVIDERS = [
  { key: "loc", label: "Library of Congress" }
];

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function buildResearchProfile(memorial) {
  return {
    memorialId: memorial.memorial_id,
    fullName: memorial.full_name ?? "",
    firstName: memorial.first_name ?? "",
    lastName: memorial.last_name ?? "",
    birthYear: memorial.birth_year,
    deathYear: memorial.death_year,
    birthPlace: memorial.birth_city_name ?? "",
    deathPlace: memorial.death_city_name ?? "",
    cemeteryName: memorial.cemetery_name ?? ""
  };
}

function scoreTextMatch(profile, haystack) {
  const text = normalizeText(haystack);
  const matched = [];
  let score = 0;
  const fullName = normalizeText(profile.fullName);
  const lastName = normalizeText(profile.lastName);

  if (fullName && text.includes(fullName)) {
    score += 0.35;
    matched.push("full name");
  } else if (lastName && text.includes(lastName)) {
    score += 0.12;
    matched.push("last name");
  }

  for (const [label, year] of [
    ["birth year", profile.birthYear],
    ["death year", profile.deathYear]
  ]) {
    if (year && text.includes(String(year))) {
      score += 0.16;
      matched.push(label);
    }
  }

  for (const [label, place] of [
    ["birth place", profile.birthPlace],
    ["death place", profile.deathPlace],
    ["cemetery", profile.cemeteryName]
  ]) {
    const placeText = normalizeText(place);
    if (placeText && text.includes(placeText)) {
      score += 0.1;
      matched.push(label);
    }
  }

  return {
    confidence: Math.min(score, 0.95),
    matched
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = body ? `: ${body.slice(0, 180)}` : "";
    const error = new Error(`Remote source returned HTTP ${response.status}${detail}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function firstText(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : "";
  }

  return String(value ?? "");
}

async function searchLibraryOfCongress(profile, limit = 8) {
  const terms = [profile.fullName];
  if (profile.deathYear) {
    terms.push(String(profile.deathYear));
  }
  if (profile.deathPlace) {
    terms.push(profile.deathPlace);
  }

  const params = new URLSearchParams({
    fo: "json",
    c: String(limit),
    q: terms.filter(Boolean).join(" ")
  });

  const data = await fetchJson(`https://www.loc.gov/collections/chronicling-america/?${params.toString()}`);

  return (data.results ?? []).slice(0, limit).map((item) => {
    const title = item.title || item.item?.title || "Library of Congress result";
    const date = String(item.date || item.date_display || "");
    const location = Array.isArray(item.location) ? item.location.join(" ") : "";
    const description = firstText(item.description);
    const snippet = [date, location, description].filter(Boolean).join(" ");
    const scored = scoreTextMatch(profile, [title, snippet].join(" "));

    return {
      provider: "loc",
      title,
      url: item.url || item.id || "",
      sourceType: "newspaper/archive",
      sourceDate: date,
      snippet: snippet.slice(0, 700),
      confidence: scored.confidence || 0.18,
      matched: scored.matched,
      conflicts: [],
      raw: item
    };
  }).sort((a, b) => b.confidence - a.confidence);
}

async function searchProvider(providerKey, memorial) {
  const profile = buildResearchProfile(memorial);

  if (!profile.fullName) {
    throw new Error("This memorial does not have enough name data to search.");
  }

  if (providerKey === "loc") {
    return searchLibraryOfCongress(profile);
  }

  throw new Error("Unknown research provider.");
}

module.exports = {
  PROVIDERS,
  searchProvider
};
