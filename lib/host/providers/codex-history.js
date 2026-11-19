import path from 'node:path';

async function openHistory(home) {
  const {DatabaseSync}=await import('node:sqlite');
  return new DatabaseSync(path.join(home,'thread_history_1.sqlite'),{readOnly:true});
}

export async function availableHistoryIds(home, ids) {
  const available=new Set();
  try {
    const db=await openHistory(home);
    try {
      const query=db.prepare("SELECT 1 FROM thread_items WHERE thread_id=? AND item_type IN ('userMessage','agentMessage') LIMIT 1");
      for(const id of ids)if(query.get(id))available.add(id);
    } finally {db.close();}
  } catch { /* Other Codex versions may not have a local history database. */ }
  return available;
}

function textParts(parts) {
  const result=[];
  for(const part of Array.isArray(parts)?parts:[]) {
    if(typeof part==='string')result.push(part);
    else if(part && typeof part.text==='string' && part.text)result.push(part.text);
    else if(part && /image/i.test(String(part.type||'')))result.push('[图片：原图未导入]');
  }
  return result.filter(Boolean).join('\n');
}

function readable(value) {
  if(typeof value==='string')return value;
  if(value===null||value===undefined)return '';
  try{return JSON.stringify(value,null,2);}catch{return '[无法读取的结果]';}
}

function resultText(value) {
  if(value && typeof value==='object' && Array.isArray(value.content)) {
    const text=textParts(value.content);
    if(text)return text;
  }
  return readable(value);
}
function bounded(value, limit) {
  const text=String(value||'');
  return text.length<=limit?text:text.slice(0,limit)+'\n…[已截断 '+(text.length-limit)+' 字符]';
}

/** Convert Codex's paginated local history into the existing provider contract. */
export async function loadCodexHistory(home, id, info, project, sanitizeUser = value => value) {
  const db=await openHistory(home),turns=[];
  let turn=null,run=null,count=0,firstAt=0,lastAt=0;
  const ensureTurn=at=>turn||(turn={at,user:null,runs:[]},turns.push(turn),turn);
  const newRun=at=>{run={at,blocks:[],toolResults:[]};ensureTurn(at).runs.push(run);return run;};
  const ensureRun=at=>run||newRun(at);
  const call=(at,item,name,args,output,error=false)=>{
    const current=newRun(at),callId=String(item.id||'history-'+(++count));
    current.blocks.push({type:'tool-call',id:callId,name,arguments:JSON.stringify(args||{})});
    current.toolResults.push({callId,name,arguments:JSON.stringify(args||{}),output:bounded(output,20000),isError:!!error,at});
  };
  try {
    const rows=db.prepare('SELECT item_type,item_json,created_at_ms FROM thread_items WHERE thread_id=? ORDER BY rollout_ordinal').iterate(id);
    for(const row of rows){
      let item;try{item=JSON.parse(row.item_json);}catch{continue;}
      const recordedAt=Number(row.created_at_ms)||0;
      if(recordedAt>0){if(!firstAt)firstAt=recordedAt;lastAt=Math.max(lastAt,recordedAt);}
      const at=recordedAt||Number(info.created_at_ms)||Date.now();
      switch(row.item_type){
        case 'userMessage': {
          const text=sanitizeUser(textParts(item.content));if(!text)break;
          turn={at,user:{content:[{type:'text',text}]},runs:[]};turns.push(turn);run=null;break;
        }
        case 'agentMessage': if(typeof item.text==='string'&&item.text)newRun(at).blocks.push({type:'text',text:item.text});break;
        case 'reasoning': {
          const text=textParts(item.summary)||textParts(item.content);
          if(text)ensureRun(at).blocks.push({type:'reasoning',text:bounded(text,12000)});
          break;
        }
        case 'commandExecution':
          call(at,item,'command',{command:item.command,cwd:item.cwd},
            String(item.aggregatedOutput||'')+(item.status==='inProgress'?'\n[原记录未显示完成]':''),
            (typeof item.exitCode==='number'&&item.exitCode!==0)||item.status==='failed');break;
        case 'mcpToolCall':
          call(at,item,[item.server,item.tool].filter(Boolean).join('.')||'mcp',item.arguments,resultText(item.error||item.result),!!item.error);break;
        case 'dynamicToolCall':
          call(at,item,[item.namespace,item.tool].filter(Boolean).join('.')||'tool',item.arguments,textParts(item.contentItems),item.success===false);break;
        case 'fileChange':
          call(at,item,'file_change',{changes:item.changes},item.status||'');break;
        case 'webSearch':
          call(at,item,'web_search',{query:item.query,action:item.action},readable(item.results));break;
        case 'imageView':
          ensureRun(at).blocks.push({type:'text',text:'[查看图片：'+String(item.path||'原图未导入')+']'});break;
        case 'imageGeneration':
          ensureRun(at).blocks.push({type:'text',text:'[生成图片：'+String(item.savedPath||'原图未导入')+']'});break;
        case 'plan': if(typeof item.text==='string'&&item.text)ensureRun(at).blocks.push({type:'text',text:'【计划】\n'+item.text});break;
        case 'subAgentActivity':
          ensureRun(at).blocks.push({type:'text',text:'【代理活动】'+[item.kind,item.agentPath].filter(Boolean).join(' ')});break;
        case 'collabAgentToolCall':
          call(at,item,String(item.tool||'代理协作'),{prompt:item.prompt,model:item.model},readable(item.agentsStates),item.status==='failed');break;
        case 'functionCallOutput':
          ensureRun(at).blocks.push({type:'text',text:'【工具结果】'+bounded(item.output,20000)});break;
        case 'contextCompaction':
          ensureRun(at).blocks.push({type:'text',text:'[原会话在此处压缩过上下文]'});break;
        default: break;
      }
    }
  } finally {db.close();}
  const createdAt=Number(info.created_at_ms)||firstAt||Date.now(),updatedAt=Math.max(Number(info.updated_at_ms)||0,lastAt,createdAt);
  return {source:'codex',id,title:info.title||'Codex 会话 '+id.slice(0,8),cwd:info.cwd||null,
    projectId:project?.id??null,projectRoot:project?.path??null,projectName:project?.name??null,
    createdAt,updatedAt,messageCount:turns.reduce((n,t)=>n+(t.user?1:0)+t.runs.filter(r=>r.blocks.some(b=>b.type==='text')).length,0),turns};
}
