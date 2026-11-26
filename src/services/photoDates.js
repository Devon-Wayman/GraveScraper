const exifr = require("exifr");

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
async function captureDate(buffer) {
  try {
    // Preserve the camera's local calendar date; timezone conversion can change the day.

    const tags = await exifr.parse(buffer, { pick: ["DateTimeOriginal", "CreateDate"], reviveValues: false });

    for (const key of ["DateTimeOriginal", "CreateDate"]) {
      const match = String(tags?.[key] || "").match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);

      if (!match) continue;

      const [, year, month, day, hour, minute, second] = match;
      const date = `${year}-${month}-${day}`;

      if (validDate(date) && +hour < 24 && +minute < 60 && +second < 60) {
        return `${date}T${hour}:${minute}:${second}`;
      }
    }

  } catch { /* Missing or unreadable metadata is handled by requesting a manual date. */ }
  return "";
}
module.exports = { captureDate, validDate };
