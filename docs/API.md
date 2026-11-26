# API reference

[Back to README](../README.md)

## Connecting

Start the Electron app or the standalone Node server first. Use the listening address and port shown in Settings. Examples use a local server on port 3000. Access from other devices depends on the host firewall and network configuration. If optional authentication is enabled, send `Authorization: Bearer <token>`. Keep that token outside source control. See [configuration](CONFIGURATION.md).

## Endpoints and formats


All paths below start with `/api/v1`. JSON writes use `Content-Type: application/json`; uploads use multipart form data. Responses wrap records as `{ cemetery }`, `{ memorial }`, `{ session }`, or `{ photo }`. Photo uploads return `{ photos: [...] }`; single-image uploads also return `{ photo }` for compatibility. Read fields use SQLite snake_case names; write fields use the camelCase names below. PATCH preserves omitted fields; send an empty string to clear optional text.

| Method | Path | Purpose / write fields |
| --- | --- | --- |
| GET | `/active-cleaning?q=Smith&page=1` | Active/monitoring projects across cemeteries, counts, and pagination |
| GET | `/options` | Allowed cemetery and memorial field values, photo stages |
| GET | `/cemeteries` | List cemeteries |
| GET, PATCH | `/cemeteries/:id` | `ownerName`, `ownerType`, `ownerContact`, `permissionStatus`, `permissionProgress`, `ownerRequirements`, `userNotes` |
| GET | `/cemeteries/:id/memorials?page=1&q=Smith` | Search, 50 results per page; returns `memorials`, `page`, `pageSize`, `total` |
| GET, PATCH | `/memorials/:id` | `userNotes`, `cleaningStatus`, `familyRelation`, `visitPriority`, `researchStatus`, `cleaningWorkStatus` |
| GET, POST | `/memorials/:id/cleaning-sessions` | List/create sessions; `visitDate` (YYYY-MM-DD), `methods`, `notes` |
| GET, PATCH, DELETE | `/cleaning-sessions/:id` | Read/update a session, including its photos |
| POST | `/cleaning-sessions/:id/photos` | Multipart: repeated `photo` file fields (1–20), shared `stage`, `caption`, optional `photoDate` (YYYY-MM-DD; omitted/blank reads EXIF; missing EXIF requires a manual date) |
| GET | `/memorials/:id/timeline` | Combined chronological session and photo events |
| GET | `/photos/:id/image` | Display JPEG |
| GET | `/photos/:id/thumbnail` | Display thumbnail JPEG |
| PATCH, DELETE | `/photos/:id` | Update `photoDate`, `stage`, or `caption`, or delete one photo |

Photo stages are `before`, `during` (displayed as Progress / follow-up), `after`, and `general`. Every photo has a separate `photo_date`, `captured_at` (camera-local timestamp, if available), and `date_source` (`exif` or `manual`). Sessions return photos chronologically. The HTML timeline and ZIP are available at `/memorials/:id/timeline` and `/memorials/:id/cleaning-progress.zip` outside the API prefix. Invalid data returns 400, missing records 404, oversized uploads 413, and missing credentials 401 when optional authentication is enabled. Errors return `{ "error": "..." }`.

Example upload from a future mobile client or the command line:

```bash
curl -X POST http://100.x.y.z:3000/api/v1/cleaning-sessions/1/photos \
  -F 'photo=@stone.jpg' -F 'stage=during' \
  -F 'photoDate=2026-11-20' -F 'caption=One-month follow-up'
```


## Project status

`cleaningWorkStatus` accepts an empty string for automatic tracking, `active`, `monitoring`, `paused`, `complete`, or `not-tracked`. Automatic tracking includes memorials with cleaning history. Active and monitoring projects appear in home-screen search; other explicit states do not. Project status is separate from stone condition (`cleaningStatus`).

## Cleaning entries and deletion

Sessions expose a derived `entry_type`: the earliest dated entry is `pre-cleaning`, and later entries are `cleaning`. Editing dates, creating a backdated entry, or deleting the earliest entry recalculates the baseline.

Deleting a session also deletes its photos and thumbnails. Deleting a photo preserves the rest of its session. Successful deletions return `{ "deleted": true }`; missing records return 404. Deletion can return a `warning` if an entry was removed but image files could not be removed from disk.

## Batch uploads

Repeat the `photo` multipart field for up to 20 images, 20 MB each. HEIC/HEIF, JPEG, PNG, and WebP are supported; saved images and thumbnails are JPEGs. Stage and caption apply to the batch. A supplied `photoDate` overrides all selected images; otherwise each uses its own camera capture date. Photos without readable date metadata require a manual date.

Batches are processed sequentially. If an image fails, newly saved photos from that batch are removed so the entire batch can be corrected and retried. Existing uploads remain intact. Success returns `{ photos: [...] }`; single-image uploads also return `{ photo }` for compatibility.

```bash
curl -X POST http://127.0.0.1:3000/api/v1/cleaning-sessions/1/photos \
  -F 'photo=@front.heic' -F 'photo=@side.jpg' \
  -F 'stage=during' -F 'caption=Two-week follow-up'
```
