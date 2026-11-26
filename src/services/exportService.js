// Quote CSV fields only when they contain characters that would break parsing.
function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function formatArray(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.join(" | ");
}

// Flatten memorial records into export-friendly scalar fields.
function normalizeMemorialForExport(memorial) {
  return {
    memorial_id: memorial.memorial_id,
    cemetery_id: memorial.cemetery_id,
    full_name: memorial.full_name,
    first_name: memorial.first_name,
    middle_name: memorial.middle_name,
    last_name: memorial.last_name,
    birth_city_name: memorial.birth_city_name,
    death_city_name: memorial.death_city_name,
    birth_date: memorial.birth_date,
    death_date: memorial.death_date,
    birth_year: memorial.birth_year,
    death_year: memorial.death_year,
    approx_age: memorial.approx_age,
    is_veteran: memorial.is_veteran,
    is_famous: memorial.is_famous,
    latitude: memorial.latitude,
    longitude: memorial.longitude,
    google_maps_link: memorial.google_maps_link,
    findagrave_date_modified: memorial.findagrave_date_modified,
    findagrave_date_created: memorial.findagrave_date_created,
    memorial_contributor_id: memorial.memorial_contributor_id,
    creator_contributor_id: memorial.creator_contributor_id,
    photo_contributor_ids: formatArray(memorial.photo_contributor_ids),
    cleaning_status: memorial.cleaning_status,
    cleaning_work_status: memorial.cleaning_work_status,
    family_relation: memorial.family_relation,
    visit_priority: memorial.visit_priority,
    research_status: memorial.research_status,
    user_notes: memorial.user_notes,
    parents: formatArray(memorial.parents),
    spouses: formatArray(memorial.spouses),
    siblings: formatArray(memorial.siblings),
    children: formatArray(memorial.children)
  };
}

function buildCsv(memorials) {
  const normalized = memorials.map(normalizeMemorialForExport);
  const headers = normalized.length > 0
    ? Object.keys(normalized[0])
    : [
      "memorial_id",
      "cemetery_id",
      "full_name",
      "latitude",
      "longitude",
      "findagrave_date_modified",
      "memorial_contributor_id",
      "cleaning_status",
      "cleaning_work_status",
      "family_relation",
      "visit_priority",
      "research_status",
      "user_notes"
    ];

  const rows = normalized.map((row) =>
    headers.map((header) => escapeCsvValue(row[header])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// Shared XML escaping for KML text values.
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Only memorials with coordinates become placemarks, because KML points require longitude/latitude.
function buildKml(memorials, documentName) {
  const placemarks = memorials
    .filter((memorial) => Number.isFinite(memorial.longitude) && Number.isFinite(memorial.latitude))
    .map((memorial) => {
      const parts = [
        memorial.full_name || "Unknown memorial",
        memorial.birth_year || "?",
        memorial.death_year || "?"
      ];

      const descriptionLines = [
        `Memorial ID: ${memorial.memorial_id ?? ""}`,
        `Birth: ${memorial.birth_date ?? ""}`,
        `Death: ${memorial.death_date ?? ""}`,
        `Birth City: ${memorial.birth_city_name ?? ""}`,
        `Death City: ${memorial.death_city_name ?? ""}`,
        `FindAGrave Modified: ${memorial.findagrave_date_modified ?? ""}`,
        `Memorial Contributor ID: ${memorial.memorial_contributor_id ?? ""}`,
        `Creator Contributor ID: ${memorial.creator_contributor_id ?? ""}`,
        `Cleaning Status: ${memorial.cleaning_status ?? ""}`,
        `Family Relation: ${memorial.family_relation ?? ""}`,
        `Visit Priority: ${memorial.visit_priority ?? ""}`,
        `Research Status: ${memorial.research_status ?? ""}`,
        `Notes: ${memorial.user_notes ?? ""}`,
        `Google Maps: ${memorial.google_maps_link ?? ""}`
      ];

      return `
        <Placemark>
          <name>${escapeXml(parts[0])}</name>
          <description>${escapeXml(descriptionLines.join("\n"))}</description>
          <Point>
            <coordinates>${memorial.longitude},${memorial.latitude},0</coordinates>
          </Point>
        </Placemark>
      `;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(documentName)}</name>
    ${placemarks}
  </Document>
</kml>`;
}

function buildXml(memorials, documentName) {
  const rows = memorials
    .map(normalizeMemorialForExport)
    .map((memorial) => {
      const fields = Object.entries(memorial)
        .map(([key, value]) => `      <${key}>${escapeXml(value)}</${key}>`)
        .join("\n");

      return `    <memorial>\n${fields}\n    </memorial>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gravescraper>
  <document_name>${escapeXml(documentName)}</document_name>
  <memorials>
${rows}
  </memorials>
</gravescraper>`;
}

module.exports = {
  buildCsv,
  buildKml,
  buildXml
};
