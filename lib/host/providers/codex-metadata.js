import fs from 'node:fs';
import path from 'node:path';
let cached;

// Read only local metadata; old/missing databases do not block JSONL imports.
export async function readCodexMetadata(home) {
  const files = ['session_index.jsonl','state_5.sqlite','state_5.sqlite-wal','.codex-global-state.json'];
  const signature = home + files.map(name => {
    try { const stat=fs.statSync(path.join(home,name)); return ':'+stat.mtimeMs+':'+stat.size; }
    catch { return ':missing'; }
  }).join('');
  if (cached?.signature === signature) return cached.value;
  const byId = new Map(), roots = [], assignments = new Map(), projects = new Map();
  try {
    for (const line of fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8').split(/\r?\n/)) {
      try {
        const row = JSON.parse(line);
        if (typeof row.id === 'string' && typeof row.thread_name === 'string' && row.thread_name.trim())
          byId.set(row.id, { title: row.thread_name.trim(), indexed: true });
      } catch { /* A partially written line is normal. */ }
    }
  } catch { /* Optional index. */ }
  try {
    const state = JSON.parse(fs.readFileSync(path.join(home,'.codex-global-state.json'),'utf8'));
    const idMap = Object.assign({}, ...Object.values(state['app-server-project-id-by-legacy-project-id-by-host'] || {}).filter(v => v && typeof v === 'object'));
    for (const [id, project] of Object.entries(state['local-projects'] || {})) {
      const projectId = typeof idMap[id] === 'string' ? idMap[id] : id;
      const paths = (Array.isArray(project.rootPaths) ? project.rootPaths : [])
        .filter(p => typeof p === 'string' && path.isAbsolute(p)).map(p => path.normalize(p));
      const entries = paths.map(p => ({ id: projectId, name: project.name, path: p }));
      projects.set(id, entries);
      roots.push(...entries);
    }
    for (const [thread, value] of Object.entries(state['thread-project-assignments'] || {})) {
      if (value?.projectKind === 'local' && projects.has(value.projectId)) assignments.set(thread, projects.get(value.projectId));
    }
  } catch { /* Desktop state does not exist in CLI-only installations. */ }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(home, 'state_5.sqlite'), { readOnly: true });
    try {
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
      if (columns.has('id')) {
        const field = name => columns.has(name) ? name : 'NULL AS ' + name;
        for (const row of db.prepare('SELECT id, '+['name','title','cwd','archived','project_id','created_at_ms','updated_at_ms'].map(field).join(', ')+' FROM threads').all()) {
          if (typeof row.id !== 'string') continue;
          const prior = byId.get(row.id) || {};
          byId.set(row.id, { ...prior, ...row, title:
            (typeof row.name === 'string' && row.name.trim()) || prior.title || (typeof row.title === 'string' && row.title.trim()) || '' });
        }
      }
      try {
        for (const row of db.prepare('SELECT p.id, p.name, r.path FROM projects p JOIN project_roots r ON r.project_id=p.id').all()) {
          if (typeof row.path === 'string' && path.isAbsolute(row.path))
            roots.push({ id: row.id, name: row.name, path: path.normalize(row.path) });
        }
      } catch { /* Projects are absent on older Codex versions. */ }
    } finally { db.close(); }
  } catch { /* Database is optional or unavailable. */ }
  roots.sort((a,b) => b.path.length-a.path.length);
  const value = { byId, roots, assignments };
  cached = { signature, value };
  return value;
}

export function resolveCodexProject(cwd, metadata, projectId, threadId) {
  const assigned = metadata.assignments?.get(threadId);
  const candidates = assigned || (projectId ? metadata.roots.filter(root => root.id === projectId) : metadata.roots);
  const match = typeof cwd === 'string' && path.isAbsolute(cwd) && candidates.find(item => {
    const rel = path.relative(item.path, cwd);
    return rel === '' || (rel !== '..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));
  });
  // A user-assigned project can include worktrees outside its main root.
  return match || (assigned?.length === 1 ? assigned[0] : null);
}
