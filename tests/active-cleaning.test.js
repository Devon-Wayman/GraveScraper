const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('home searches only active cleaning projects across cemeteries and completion preserves history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gravesite-active-'));
  Object.assign(process.env, { DATABASE_PATH: path.join(directory,'test.sqlite'), GRAVESITE_CONFIG_FOLDER: directory, GRAVESITE_ENV_PATH: path.join(directory,'.env'), APP_ACCESS_TOKEN: '' });
  const { app } = require('../src/server');
  const db = require('../src/db');
  const repo = require('../src/db/repositories');
  const cleaning = require('../src/db/cleaning');
  for (const [id,name] of [['1','Maple Grove'],['2','Oak Hill']]) db.prepare('INSERT INTO cemeteries (cemetery_id,cemetery_name,cemetery_url) VALUES (?,?,?)').run(id,name,'https://example.com');
  const insert = db.prepare("INSERT INTO memorials (memorial_id,cemetery_id,full_name,raw_payload) VALUES (?,?,?,'{}')");
  insert.run(1,'1','Alice Smith'); insert.run(2,'2','Bob Jones'); insert.run(3,'1','Untracked Smith'); insert.run(4,'2','Paused Smith'); insert.run(5,'1','Complete Smith'); insert.run(6,'2','Hidden Smith');
  for (const id of [1,4,5,6]) cleaning.saveSession(id,{visitDate:'2026-11-21',methods:'',notes:''});
  repo.setCleaningWorkStatus(2,'monitoring'); repo.setCleaningWorkStatus(4,'paused'); repo.setCleaningWorkStatus(5,'complete'); repo.setCleaningWorkStatus(6,'not-tracked');
  const server = app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (id,status) => fetch(`${base}/memorials/${id}/cleaning-project`,{method:'POST',body:new URLSearchParams({cleaningWorkStatus:status,returnTo:'dashboard'}),redirect:'manual'});
  try {
    assert.deepEqual(repo.getActiveCleaning().memorials.map(row=>row.memorial_id),[1,2]);
    assert.deepEqual(repo.getActiveCleaning({search:'SMITH'}).memorials.map(row=>row.memorial_id),[1]);
    assert.deepEqual(repo.getActiveCleaning({search:'oak hill'}).memorials.map(row=>row.memorial_id),[2]);
    assert.equal(repo.getActiveCleaning({search:'%'}).total,0);
    let response = await fetch(base+'/?activeSearch=Smith');
    const html = await response.text();
    assert.match(html,/Active cleaning/); assert.match(html,/Alice Smith/); assert.ok(!html.includes('Untracked Smith')); assert.ok(!html.includes('Paused Smith'));
    response = await fetch(base+'/api/v1/active-cleaning?q=Oak');
    assert.equal((await response.json()).total,1);
    assert.equal((await fetch(base+'/api/v1/active-cleaning?page=0')).status,400);
    assert.equal((await post(1,'complete')).status,302);
    assert.equal(repo.getActiveCleaning().total,1);
    assert.equal(cleaning.listSessions(1).length,1);
    assert.equal((await post(1,'active')).status,302);
    assert.equal(repo.getActiveCleaning().total,2);
    assert.equal((await post(1,'invalid')).status,400);
    assert.equal(repo.getMemorialById(1).cleaning_work_status,'active');
    response = await fetch(base+'/api/v1/memorials/1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({userNotes:'Keep project active'})});
    assert.equal((await response.json()).memorial.cleaning_work_status,'active');
    repo.syncMemorialsForCemetery('2',[]);
    assert.ok(repo.getMemorialById(2),'monitoring project without sessions survives imports');
    for (let id=10;id<24;id++) {insert.run(id,'1',`Project ${id}`);repo.setCleaningWorkStatus(id,'active');}
    assert.equal(repo.getActiveCleaning().memorials.length,12);
    assert.equal(repo.getActiveCleaning({page:2}).memorials.length,4);
    assert.equal(repo.getActiveCleaning({page:999}).page,2);
    const memorialHtml = await (await fetch(base+'/memorials/1')).text();
    assert.match(memorialHtml,/Cleaning project/); assert.match(memorialHtml,/Monitoring \/ follow-up/);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
