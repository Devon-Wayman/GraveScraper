# User guide

[Back to README](../README.md)

## Cemeteries and permissions

Import a cemetery using its FindAGrave cemetery URL. The progress window shows the import status and memorial count. Importing needs an internet connection and local integration configuration; see [configuration](CONFIGURATION.md).

On a cemetery page, record the owner or managing organization, contact details, permission status, follow-up notes, and any requirements to follow. These details are retained when you fetch updated records.

Browse or search memorials within a cemetery to open an individual grave’s record. Local notes, stone condition, family relationship, visit priority, and research status are editable there. Optional Library of Congress research is under **Optional archival research**.

## Pre-cleaning records and cleaning sessions

The earliest dated entry is a **Pre-cleaning record**, even if it has no photos. Use it to describe the original condition before doing any work. Later entries represent cleaning sessions.

Choose **New cleaning session** to open a separate visit form. Record the date, methods/materials, and observations. **Save & add photos** takes you straight to the photo dialog for that visit; saving without photos is also supported.

The baseline is determined by date, with entry ID breaking ties. Backdating, changing dates, or deleting the earliest entry recalculates it. Initial-visit photos that previously defaulted to Progress/General display as Before, while explicitly labeled After photos and later-dated follow-ups keep their labels.

## Progress updates and photos

Choose **Add check-in / photos**, then select the baseline or cleaning entry the images belong to. Add more angles, immediate after photos, or follow-ups days or months later.

- Select up to **20 images** per upload, **20 MB each**.
- Supported types are **HEIC/HEIF, JPEG, PNG, and WebP**.
- Choose Before, Progress / follow-up, After, or General. The stage and caption apply to the batch.
- Leave the date blank to use each image’s own capture date. Entering a date overrides all selected photos.
- If an image has no readable capture metadata, enter its observation date manually. File modification time and upload time are not substituted for capture dates.
- Individual dates, labels, and captions remain editable after uploading.

Images are converted locally to compressed JPEGs up to 2560 pixels per side, with thumbnails for browsing. Capture dates are read before GPS and other image metadata are stripped. Camera-local dates are retained without timezone conversion. For HEIC files containing multiple images, the first image is imported.

If a photo fails, the batch is rolled back so you can correct it and retry without duplicating successfully processed images from that batch. Previous uploads remain intact. After a connection failure or timeout, check the timeline before retrying in case the upload finished.

Keep your original files if you need full-resolution images or original metadata. Previously saved photos are not automatically recompressed, and metadata already stripped from an earlier upload cannot be recovered.

## Using the timeline

Entries are collapsed by default and ordered by their latest activity. Expand a cleaning entry to see its notes and dated updates; expand an update to see its photos. Photos are grouped by date and stage within their own entry, so photos from different sessions do not mix.

Editing and uploading return you to the relevant entry or photo update. The separate printable report lists events oldest first.

## Finding active projects

Use **Active cleaning** on the home screen to search ongoing work across all cemeteries by name, cemetery, or memorial ID. Results show the cemetery, last recorded update, timeline link, and a map link when location data is available.

Graves with cleaning history appear automatically unless an explicit project status excludes them. The **Cleaning project** selector above a memorial’s timeline offers Active cleaning, Monitoring / follow-up, Paused, Complete, and Not tracking. A grave can be marked active before its first visit. These statuses track the project separately from the stone’s condition.

Use **Mark complete** on a home-screen card to hide a finished project without deleting its history. Set it active again when work resumes.

## Reports and exports

**Print progress report** opens a report with visit dates, methods, observations, photo dates, and captions. Use **Print / Save as PDF** to save or print it.

**Export report & photos** downloads a ZIP containing `report.html`, `timeline.json`, and an `images` folder with numbered, date-prefixed JPEGs. Extract the entire ZIP and open `report.html`; the report works without the app or an internet connection. Same-date photos use capture time where available, then upload order.

Memorial records can also be exported as CSV, KML, or XML from the cemetery and home-screen export links.

## Editing and deletion

Session editing and photo editing open separate dialogs. To remove a duplicate or accidental entry, choose **Delete entry**. The confirmation shows the visit and attached photo count. Deletion permanently removes that entry and its attached photos, including linked follow-ups.

To remove just one image, choose **Delete photo** in its editor. The entry and its other images remain.

Explicitly deleting a cemetery also removes its memorials, cleaning history, and uploaded photos. Memorials with cleaning history, or explicitly active/monitoring projects, are retained if an import no longer returns them.

## Phone access and backups

The desktop app or Node server must stay running for phone access. Use Settings to configure LAN or Tailscale access, then open a listed address your phone can reach. Uploads require a live connection; there is no offline upload queue. See [configuration](CONFIGURATION.md) for network options and access controls.

Back up the records database and uploads together while the app is stopped. Restoring only the database will not restore photos.

## FindAGrave windows

The desktop app opens web links in a separate window with Back, Forward, Refresh, and Original page controls. Related links stay in that window so history is preserved. Original page returns to the memorial or cemetery page you first opened. You can copy the displayed address.

Keyboard shortcuts: Cmd/Ctrl+[ for Back, Cmd/Ctrl+] for Forward, Cmd/Ctrl+R for Refresh, and Cmd/Ctrl+Shift+R for Force Refresh.
