// Optional real-Host integration: all sessions and workspaces are fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const executable=process.env.DSH_TEST_EXECUTABLE||process.execPath,cli=process.env.DSH_TEST_CLI;
if(!cli)throw Error('Set DSH_TEST_CLI to an installed DSH lib/bin.js.');
const source=fileURLToPath(new URL('../',import.meta.url)),base=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-import-host-'));
const home=path.join(base,'dsh'),profile=path.join(home,'profiles/web'),codex=path.join(base,'codex');
const project=path.join(base,'project'),worktree=path.join(base,'worktree'),proof=path.join(base,'proof.mjs');
let child,link,output='';
try {
 await fs.mkdir(path.join(profile,'node_modules'),{recursive:true});
 link=path.join(profile,'node_modules/dsh-agent-session-import');
 await fs.symlink(source,link,process.platform==='win32'?'junction':'dir');
 await fs.mkdir(path.join(codex,'sessions'),{recursive:true});await fs.mkdir(path.join(codex,'archived_sessions'));
 await fs.mkdir(project);await fs.mkdir(worktree);
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],missing='33333333-3333-4333-8333-333333333333';
 for(let i=0;i<ids.length;i++){
  const records=[{type:'session_meta',payload:{id:ids[i],cwd:worktree,timestamp:'2026-01-01T00:00:00Z'}},
   {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'fixture question'}]}},
   {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'fixture answer'}]}}];
  const dir=i?'archived_sessions':'sessions';
  await fs.writeFile(path.join(codex,dir,'rollout-2026-01-01T00-00-00-'+ids[i]+'.jsonl'),records.map(JSON.stringify).join('\n')+'\n');
 }
 await fs.writeFile(path.join(codex,'.codex-global-state.json'),JSON.stringify({'local-projects':{fixture:{id:'fixture',name:'Fixture project',rootPaths:[project]}},'thread-project-assignments':Object.fromEntries([...ids,missing].map(id=>[id,{projectKind:'local',projectId:'fixture'}]))}));
 const db=new DatabaseSync(path.join(codex,'state_5.sqlite'));
 db.exec('CREATE TABLE threads (id TEXT,name TEXT,title TEXT,cwd TEXT,archived INTEGER,project_id TEXT);');
 for(let i=0;i<ids.length;i++)db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(ids[i],'Fixture title '+i,'old',worktree,i,null);
 db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(missing,'Fixture missing','old',project,0,null);
 db.close();
 await fs.writeFile(path.join(profile,'package.json'),JSON.stringify({name:'isolated-import-fixture',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-agent-session-import']}},dependencies:{}}));
 await fs.writeFile(path.join(profile,'cordis.yml'),'[]\n');
 await fs.writeFile(proof,"export const inject=['webServer','workspaceRegistry'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture/workspaces',handler:async(_req,res)=>{try{const rows=await ctx.workspaceRegistry.list(),out=[];for await(const w of rows)out.push({path:await w.path,title:await w.title,sessionIds:await w.sessionIds});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(out));}catch(e){res.writeHead(500);res.end(e.message);}}}));}");
 await fs.writeFile(path.join(profile,'cordis.patch.yml'),'- id: ui-settings-account\n  config:\n    version: 1\n    step: done\n    purpose: both\n    process: standard\n    completion: completed\n- insert:\n    - id: fixture-proof\n      name: '+JSON.stringify(pathToFileURL(proof).href)+'\n');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/TOKEN|SECRET|PASSWORD|CREDENTIAL|API.?KEY|^DSH_|^CODEX_|^WEBAGENT_|NODE_OPTIONS/i.test(key)));
 Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,CODEX_HOME:codex,DO_NOT_TRACK:'1'});
 const prefix=process.env.DSH_TEST_EXPOSE_INTERNALS==='1'?['--expose-internals']:[];
 child=spawn(executable,[...prefix,cli,'--profile','web','--port','0','--no-open'],{env,cwd:base,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const capture=data=>output=(output+String(data)).slice(-200000);child.stdout.on('data',capture);child.stderr.on('data',capture);
 let origin;const deadline=Date.now()+30000;
 while(Date.now()<deadline&&child.exitCode===null){
  for(const match of output.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g)){
   try{const r=await fetch(match[0]+'/fixture/workspaces',{signal:AbortSignal.timeout(500)});if(r.ok){origin=match[0];break;}}catch{}
  }
  if(origin)break;await new Promise(resolve=>setTimeout(resolve,150));
 }
 assert.ok(origin,'Fixture host failed: '+output.replace(/([?&]token=)[^\s]+/gi,'$1[redacted]').slice(-1800));
 async function rpc(endpoint,input){
  const response=await fetch(origin+'/session-import/'+endpoint,{method:'POST',headers:{'content-type':'application/json','x-dsh-agent-session-import':'1'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
  const data=await response.json();assert.equal(data.ok,true,JSON.stringify(data.error));return data.value;
 }
 const listing=await rpc('list',{refresh:true}),codexRows=listing.sources.find(row=>row.id==='codex').conversations;
 assert.equal(codexRows.length,3);assert.equal(codexRows.find(row=>row.id===ids[1]).isArchived,true);
 assert.equal(codexRows.find(row=>row.id===missing).unavailable,true);
 assert.ok(codexRows.every(row=>row.projectName==='Fixture project'));
 if(process.env.DSH_TEST_PLAYWRIGHT){
  const {chromium}=await import(pathToFileURL(path.resolve(process.env.DSH_TEST_PLAYWRIGHT)).href);
  const browser=await chromium.launch({headless:true,channel:process.env.DSH_TEST_BROWSER||'msedge'});
  try{
   const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   const urls=[...output.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\x1b]*/g)].map(match=>match[0].replace(/[),.;]+$/,''));
   await page.goto(urls.find(url=>url.includes('token='))||origin);
   // The empty fixture has first-run onboarding unrelated to this panel.
   await page.addStyleTag({content:'[role=presentation]:has([role=dialog]) { pointer-events:none !important; }'});
   const nav=page.getByRole('button',{name:/^(导入会话|Import Sessions)$/}).first();
   await nav.waitFor({timeout:15000});await nav.dispatchEvent('click');
   const group=page.locator('.ci-group').filter({hasText:'Fixture project'});
   await group.waitFor({timeout:15000});
   const search=page.getByPlaceholder(/搜索标题或项目|Search title or project/);
   await search.evaluate(element=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'Fixture project');element.dispatchEvent(new Event('input',{bubbles:true}));});
   await group.waitFor({timeout:5000});
   const groupSelector=group.locator('.ci-group-check input, .ci-group-check [role=checkbox]').first();
   await groupSelector.dispatchEvent('click');
   assert.equal(await group.locator('.ci-row[aria-checked="true"]').count(),2);
   assert.equal(await group.locator('.ci-row[aria-disabled="true"]').count(),1);
   await group.locator('.ci-row[aria-disabled="false"]').first().dispatchEvent('click');
   assert.equal(await group.locator('.ci-row[aria-checked="true"]').count(),1);
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }
 const started=await rpc('import',{items:ids.map(id=>({source:'codex',id})),options:{mode:'compatible'}});
 let status;for(let i=0;i<60;i++){status=await rpc('status',{jobId:started.jobId});if(status.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(status.state,'done');assert.equal(status.results.filter(row=>row.ok).length,2,JSON.stringify(status.results));
 const workspaces=await(await fetch(origin+'/fixture/workspaces')).json();
 const workspace=workspaces.find(row=>path.resolve(row.path)===path.resolve(project));
 assert.ok(workspace,JSON.stringify(workspaces));assert.equal(workspace.title,'Fixture project');assert.equal(workspace.sessionIds.length,2);
 assert.deepEqual(status.results.map(row=>row.title).sort(),['Fixture title 0','Fixture title 1']);
 console.log(JSON.stringify({officialHost:true,projectCreated:true,attachedSessions:workspace.sessionIds.length,archivedImported:true,titlesPreserved:true,projectSelectionUi:!!process.env.DSH_TEST_PLAYWRIGHT,modelRequests:0}));
}finally {
 if(child?.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}
 if(link)await fs.unlink(link);
 assert.equal(path.dirname(base),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('dsh-import-host-'));
 await fs.rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
