const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

test("cemetery details migrate, save, render safely, and survive imports", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-details-"));
  process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
  process.env.APP_ACCESS_TOKEN = "";
  const legacy = new Database(process.env.DATABASE_PATH);
  legacy.exec(`CREATE TABLE cemeteries (
    cemetery_id TEXT PRIMARY KEY, cemetery_name TEXT NOT NULL, cemetery_url TEXT NOT NULL,
    memorial_count INTEGER DEFAULT 0, photo_request_count INTEGER DEFAULT 0,
    photographed_count INTEGER DEFAULT 0, famous_count INTEGER DEFAULT 0,
    gps_count INTEGER DEFAULT 0, percentage_with_gps INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url)
     VALUES ('123', 'Test Cemetery', 'https://example.com/cemetery/123');`);
  legacy.close();

  const { app } = require("../src/server");
  const db = require("../src/db");
  const repositories = require("../src/db/repositories");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const submit = (id, fields) => fetch(`${base}/cemeteries/${id}`, {
    method: "POST", body: new URLSearchParams(fields), redirect: "manual"
  });

  try {
    assert.equal(repositories.getCemeteryById("123").permission_status, "");
    let response = await fetch(`${base}/cemeteries/123`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Not started \/ not confirmed/);

    const fields = {
      ownerName: " City Council ", ownerType: "city", ownerContact: "Jane, 555-0100",
      permissionStatus: "granted", permissionProgress: "Approved by Jane on October 20.",
      ownerRequirements: "North section only.\nCall before visiting.",
      userNotes: '<script>alert("test")</script>'
    };
    response = await submit("123", fields);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /#cemetery-details$/);
    let cemetery = repositories.getCemeteryById("123");
    assert.equal(cemetery.owner_name, "City Council");
    assert.equal(cemetery.owner_type, "city");
    assert.equal(cemetery.owner_contact, fields.ownerContact);
    assert.equal(cemetery.permission_status, "granted");
    assert.equal(cemetery.permission_progress, fields.permissionProgress);
    assert.equal(cemetery.owner_requirements, fields.ownerRequirements);
    response = await fetch(`${base}/cemeteries/123`);
    const html = await response.text();
    assert.match(html, /value="granted" selected/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes(fields.userNotes));

    repositories.upsertCemetery({
      cemetery_id: "123", cemetery_name: "Refreshed Cemetery", cemetery_url: "https://example.com",
      memorial_count: 10, photo_request_count: 0, photographed_count: 0,
      famous_count: 0, gps_count: 0, percentage_with_gps: 0
    });
    cemetery = repositories.getCemeteryById("123");
    assert.equal(cemetery.cemetery_name, "Refreshed Cemetery");
    assert.equal(cemetery.permission_status, "granted");
    assert.equal(cemetery.owner_requirements, fields.ownerRequirements);
    assert.equal(cemetery.user_notes, fields.userNotes);

    await submit("123", { ...fields, ownerType: "invalid", permissionStatus: "invalid" });
    cemetery = repositories.getCemeteryById("123");
    assert.equal(cemetery.owner_type, "");
    assert.equal(cemetery.permission_status, "");
    await submit("123", {});
    assert.equal(repositories.getCemeteryById("123").owner_name, "");
    assert.equal((await submit("missing", fields)).status, 404);
    assert.equal((await fetch(`${base}/cemeteries/missing`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
