import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {buildSessionPlan} from '../lib/host/writer.js';
import {readCodexMetadata,resolveCodexProject} from '../lib/host/providers/codex-metadata.js';

test('Codex discovery restores titles, archives, assigned projects and flags missing bodies', async () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-codex-fixture-'));
 try {
  const project=path.join(home,'project'),worktree=path.join(home,'worktree');
  fs.mkdirSync(project);fs.mkdirSync(worktree);fs.mkdirSync(path.join(home,'sessions'));fs.mkdirSync(path.join(home,'archived_sessions'));
  const active='11111111-1111-4111-8111-111111111111', archived='22222222-2222-4222-8222-222222222222', missing='33333333-3333-4333-8333-333333333333', paged='44444444-4444-4444-8444-444444444444';
  const records=id=>[
   {type:'session_meta',payload:{id,cwd:worktree,timestamp:'2026-01-01T00:00:00Z'}},
   {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'first message <in-app-browser-context>synthetic context</in-app-browser-context> after <external_codex_apps_selected_page_part_1_of_1>synthetic page</external_codex_apps_selected_page_part_1_of_1>'},{type:'input_image',image_url:'data:image/png;base64,fixture'}]}},
   {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'fixture answer'}]}},
   {type:'response_item',payload:{type:'agent_message',author:'agent',recipient:'root',content:[{type:'input_text',text:'fixture collaboration'},{type:'encrypted_content',data:'encrypted-fixture'}]}},
   {type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'call-1',input:'text("fixture");'}},
   {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'call-1',output:[{type:'input_text',text:JSON.stringify([{status:'fulfilled',value:{exit_code:0,output:'readable fixture output'}}])}]}}
  ].map(row=>JSON.stringify(row)).join('\n')+'\n';
  fs.writeFileSync(path.join(home,'sessions','rollout-2026-01-01T00-00-00-'+active+'.jsonl'),records(active));
  fs.writeFileSync(path.join(home,'archived_sessions','rollout-2026-01-02T00-00-00-'+archived+'.jsonl'),records(archived));
  fs.writeFileSync(path.join(home,'session_index.jsonl'),JSON.stringify({id:active,thread_name:'Indexed title'})+'\n'+JSON.stringify({id:missing,thread_name:'Unavailable chat'})+'\n');
  fs.writeFileSync(path.join(home,'.codex-global-state.json'),JSON.stringify({
   'local-projects':{'legacy':{id:'legacy',name:'My project',rootPaths:[project]}},
   'thread-project-assignments':{[active]:{projectKind:'local',projectId:'legacy'},[archived]:{projectKind:'local',projectId:'legacy'},[paged]:{projectKind:'local',projectId:'legacy'}},
   'app-server-project-id-by-legacy-project-id-by-host':{local:{legacy:'project-1'}}
  }));
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT,name TEXT,title TEXT,cwd TEXT,archived INTEGER,project_id TEXT); CREATE TABLE projects (id TEXT,name TEXT); CREATE TABLE project_roots (project_id TEXT,path TEXT);');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(active,'Renamed title','Old title',worktree,0,null);
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(archived,'Archived title','Old title',worktree,1,null);
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(missing,'Unavailable chat','Old title',project,0,null);
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run(paged,'Database title','Old title',worktree,0,null);
  db.prepare('INSERT INTO projects VALUES (?,?)').run('project-1','My project');
  db.prepare('INSERT INTO project_roots VALUES (?,?)').run('project-1',project);db.close();
  const history=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));
  history.exec('CREATE TABLE thread_items (thread_id TEXT,rollout_ordinal INTEGER,item_type TEXT,item_json TEXT,created_at_ms INTEGER);');
  const add=history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?)');
  add.run(paged,1,'userMessage',JSON.stringify({content:[{type:'text',text:'database question<in-app-browser-context>hidden snapshot</in-app-browser-context> after'}]}),1000);
  add.run(paged,2,'commandExecution',JSON.stringify({id:'exec-1',command:'printf fixture',cwd:worktree,aggregatedOutput:'fixture output',exitCode:0}),1100);
  add.run(paged,3,'agentMessage',JSON.stringify({text:'database answer'}),1200);
  history.close();
  const provider=pathToFileURL(path.resolve('lib/host/providers/codex.js')).href;
  const serviceModule=pathToFileURL(path.resolve('lib/host/service.js')).href;
  const code='import {list,load} from '+JSON.stringify(provider)+';import {ImportService} from '+JSON.stringify(serviceModule)+';const rows=await list();const active=await load('+JSON.stringify(active)+');const archived=await load('+JSON.stringify(archived)+');const paged=await load('+JSON.stringify(paged)+');const saved=[],attached=[],created=[];const persistence={async create(header){const row={header,events:[]};saved.push(row);return {async append(events){row.events.push(...events)},async flush(){},async close(){}}}};const registry={async create(cwd,title){created.push({cwd,title});return {async attachSession(id){attached.push(id)}}}};const service=new ImportService({logger:{info(){},warn(){}},get(name){return name==="workspaceRegistry"?registry:undefined}});const job=service.jobs.create(3,"compatible");await service.runJob(job,[{source:"codex",id:'+JSON.stringify(active)+'},{source:"codex",id:'+JSON.stringify(archived)+'},{source:"codex",id:'+JSON.stringify(paged)+'}],persistence,{mode:"compatible"});console.log(JSON.stringify({rows,active,archived,paged,saved,attached,created,job}));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home,DSH_HOME:path.join(home,'dsh')},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout),byId=new Map(data.rows.map(row=>[row.id,row]));
  assert.equal(byId.size,4);
  assert.equal(byId.get(active).title,'Renamed title');
  assert.equal(data.active.title,'Renamed title');
  const userText=data.active.turns[0].user.content[0].text;
  assert.match(userText,/first message/);assert.match(userText,/after/);assert.match(userText,/原图未导入/);
  assert.doesNotMatch(userText,/synthetic context|synthetic page|external_codex_apps/);
  assert.match(JSON.stringify(data.active.turns),/fixture collaboration/);
  assert.match(JSON.stringify(data.active.turns),/readable fixture output/);
  assert.doesNotMatch(JSON.stringify(data.active.turns),/fulfilled/);
  assert.doesNotMatch(JSON.stringify(data.active.turns),/encrypted-fixture/);
  assert.equal(byId.get(active).projectId,'project-1');
  assert.equal(data.active.projectRoot,project);
  assert.equal(byId.get(archived).isArchived,true);
  assert.equal(data.archived.title,'Archived title');
  assert.equal(byId.get(missing).unavailable,true);
  assert.equal(byId.get(paged).unavailable,false);
  assert.equal(data.paged.title,'Database title');
  assert.match(JSON.stringify(data.paged.turns),/database question/);
  assert.match(JSON.stringify(data.paged.turns),/after/);
  assert.doesNotMatch(JSON.stringify(data.paged.turns),/hidden snapshot/);
  assert.match(JSON.stringify(data.paged.turns),/fixture output/);
  assert.equal(data.job.results.filter(row=>row.ok).length,3);
  assert.equal(data.saved.length,3);assert.equal(data.attached.length,3);
  assert.ok(data.created.every(row=>row.cwd===project && row.title==='My project'));
  assert.ok(data.saved.every(row=>row.header.cwd===project));
  assert.equal(data.saved[0].events.find(event=>event.type==='session/title').data.title,'Renamed title');
  const metadata=await readCodexMetadata(home);
  assert.equal(resolveCodexProject(worktree,metadata,null,active).path,project);
 } finally {
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));
  assert.ok(path.basename(home).startsWith('dsh-codex-fixture-'));
  fs.rmSync(home,{recursive:true,force:true});
 }
});

test('Codex execution code and wait parameters render without escaped JSON strings', () => {
 const text='const result = await example();\ntext(result);';
 const conversation={source:'codex',id:'x',title:'Title',createdAt:1,turns:[{at:1,user:{content:[{type:'text',text:'task'}]},runs:[{
  at:2,blocks:[{type:'tool-call',id:'a',name:'exec',arguments:text},{type:'tool-call',id:'b',name:'wait',arguments:JSON.stringify({cell_id:'38',yield_time_ms:1000})}],toolResults:[]
 }]}]};
 const plan=buildSessionPlan(conversation,{cwd:os.tmpdir(),mode:'compatible'});
 const output=plan.events.filter(event=>event.type==='assistant/message').flatMap(event=>event.data.message.content).map(part=>part.text).join('\n');
 assert.ok(output.includes(text));assert.ok(output.includes('javascript\n'));assert.ok(output.includes('"cell_id": "38"'));
 assert.equal(output.includes('example();\\ntext'),false);
});

test('an archived-only Codex home remains available to the importer', () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-codex-fixture-'));
 try {
  fs.mkdirSync(path.join(home,'archived_sessions'));
  const file=path.join(home,'archived_sessions','rollout-2026-01-01T00-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl');
  fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{cwd:home}})+'\n');
  const provider=pathToFileURL(path.resolve('lib/host/providers/codex.js')).href;
  const code='import {status,list} from '+JSON.stringify(provider)+';console.log(JSON.stringify({status:await status(),rows:await list()}));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);assert.equal(value.status.available,true);assert.equal(value.rows[0].isArchived,true);
 } finally {
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('dsh-codex-fixture-'));
  fs.rmSync(home,{recursive:true,force:true});
 }
});

test('a database-only Codex home lists and loads paginated history', () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-codex-fixture-'));
 try {
  const id='55555555-5555-4555-8555-555555555555';
  fs.writeFileSync(path.join(home,'session_index.jsonl'),JSON.stringify({id,thread_name:'Database-only session'})+'\n');
  const history=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));
  history.exec('CREATE TABLE thread_items (thread_id TEXT,rollout_ordinal INTEGER,item_type TEXT,item_json TEXT,created_at_ms INTEGER);');
  const add=history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?)');
  add.run(id,1,'userMessage',JSON.stringify({content:[{type:'text',text:'question'}]}),1000);
  add.run(id,2,'agentMessage',JSON.stringify({text:'answer'}),1200);
  history.close();
  const provider=pathToFileURL(path.resolve('lib/host/providers/codex.js')).href;
  const code='import {status,list,load} from '+JSON.stringify(provider)+';console.log(JSON.stringify({status:await status(),rows:await list(),loaded:await load('+JSON.stringify(id)+')}));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);
  assert.equal(value.status.available,true);assert.equal(value.rows[0].unavailable,false);
  assert.equal(value.loaded.title,'Database-only session');assert.match(JSON.stringify(value.loaded.turns),/answer/);
  assert.equal(value.loaded.createdAt,1000);assert.equal(value.loaded.updatedAt,1200);
 } finally {
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('dsh-codex-fixture-'));
  fs.rmSync(home,{recursive:true,force:true});
 }
});

test('Codex extended-length cwds join their real project instead of becoming pseudo projects', async () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-codex-fixture-'));
 try {
  const BS=String.fromCharCode(92);
  const project='D:'+BS+'Work'+BS+'Bohr';
  const runDir=project+BS+'runs'+BS+'dev-03'+BS+'fast-r3';
  const id='66666666-6666-4666-8666-666666666666';
  fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
  fs.writeFileSync(path.join(home,'sessions','rollout-2026-01-01T00-00-00-'+id+'.jsonl'),
   JSON.stringify({type:'session_meta',payload:{id,cwd:BS+BS+'?'+BS+runDir}})+'\n');
  fs.writeFileSync(path.join(home,'.codex-global-state.json'),JSON.stringify({
   'local-projects':{p:{id:'p',name:'Bohr',rootPaths:[project]}},
   'thread-project-assignments':{},
   'app-server-project-id-by-legacy-project-id-by-host':{}
  }));
  const provider=pathToFileURL(path.resolve('lib/host/providers/codex.js')).href;
  const code='import {list} from '+JSON.stringify(provider)+';const rows=await list();console.log(JSON.stringify(rows[0]));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const row=JSON.parse(result.stdout);
  assert.equal(row.cwd,runDir);
  assert.equal(row.projectName,'Bohr');
  assert.equal(row.cwdLabel,'fast-r3');
 } finally {
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('dsh-codex-fixture-'));
  fs.rmSync(home,{recursive:true,force:true});
 }
});

test('automation and subagent threads are classified apart from conversations', async () => {
 const {classifyCodexThread}=await import('../lib/host/providers/codex-metadata.js');
 assert.equal(classifyCodexThread({source:'exec',thread_source:'user'}).kind,'automation');
 assert.equal(classifyCodexThread({source:'vscode',thread_source:'user'}).kind,'conversation');
 assert.equal(classifyCodexThread({source:'x',thread_source:'subagent'}).kind,'subagent');
});

test('Codex exec programs render as readable code, not escaped JSON', () => {
 const program='const r = await tools.exec_command({cmd:"pwd"});\ntext(r.output);';
 const conversation={source:'codex',id:'x',title:'T',createdAt:1,turns:[{at:1,user:{content:[{type:'text',text:'task'}]},runs:[{
  at:2,blocks:[{type:'tool-call',id:'a',name:'exec',arguments:JSON.stringify({text:program})}],
  toolResults:[{callId:'a',name:'exec',arguments:JSON.stringify({text:program}),output:'ok',isError:false,at:3}]
 }]}]};
 const plan=buildSessionPlan(conversation,{cwd:os.tmpdir(),mode:'full'});
 const call=plan.events.find(event=>event.type==='tool/call');
 const args=JSON.parse(call.data.arguments);
 assert.equal(args.command,program);
 assert.equal(args.code,program);
 assert.equal(Object.keys(args).sort().join(','),'code,command');
 const compatible=buildSessionPlan(conversation,{cwd:os.tmpdir(),mode:'compatible'});
 const text=compatible.events.filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content).map(b=>b.text).join('\n');
 assert.ok(text.includes(program));
 assert.equal(text.includes('\\n'),false);
});

test('Codex file citations become Markdown links with the file name', () => {
 const text='指南：\n\n:codex-file-citation{path="D:/Work/交付/先读_指南.pdf" purpose="output"}\n\n也见 :codex-file-citation{path="/tmp/review.pdf" purpose="source"} 处。';
 // The directive is module-private; exercise it through the provider loader.
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-codex-fixture-'));
 try {
  fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
  const id='77777777-7777-4777-8777-777777777777';
  fs.writeFileSync(path.join(home,'sessions','rollout-2026-01-01T00-00-00-'+id+'.jsonl'),
   [JSON.stringify({type:'session_meta',payload:{id,cwd:home}}),
    JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'task'}]}}),
    JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text}]}})
   ].join('\n')+'\n');
  const provider=pathToFileURL(path.resolve('lib/host/providers/codex.js')).href;
  const code='import {load} from '+JSON.stringify(provider)+';const c=await load('+JSON.stringify(id)+');console.log(JSON.stringify(c.turns.flatMap(t=>t.runs).flatMap(r=>r.blocks).map(b=>b.text)));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const out=JSON.parse(result.stdout).join('\n');
  assert.equal(out.includes(':codex-file-citation'),false);
  assert.match(out,/\[先读_指南\.pdf\]\(D:\/Work\/交付\/先读_指南\.pdf\)/);
  assert.match(out,/\[review\.pdf\]\(\/tmp\/review\.pdf\)/);
 } finally {
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('dsh-codex-fixture-'));
  fs.rmSync(home,{recursive:true,force:true});
 }
});
