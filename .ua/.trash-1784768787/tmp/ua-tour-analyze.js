import fs from 'node:fs';
const [inputPath, outputPath] = process.argv.slice(2);
try {
  const graph = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map(nodes.map(n => [n.id, 0]));
  const outgoing = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges) { if (incoming.has(e.target)) incoming.set(e.target, incoming.get(e.target) + 1); if (outgoing.has(e.source)) outgoing.set(e.source, outgoing.get(e.source) + 1); }
  const ranked = (map, key) => [...map].map(([id, value]) => ({ id, [key]: value, name: byId.get(id).name })).sort((a,b) => b[key] - a[key] || a.id.localeCompare(b.id)).slice(0,20);
  const code = nodes.filter(n => n.type === 'file');
  const outValues = code.map(n => outgoing.get(n.id)).sort((a,b) => a-b);
  const highOut = outValues[Math.max(0, Math.ceil(outValues.length * .9)-1)] || 0;
  const lowIn = [...code].map(n => incoming.get(n.id)).sort((a,b) => a-b)[Math.max(0, Math.floor(code.length * .25)-1)] || 0;
  const entryNames = /(^|\/)(index\.(ts|js|tsx|jsx)|main\.(ts|js|tsx|jsx)|app\.(ts|js)|server\.(ts|js)|main\.py|manage\.py|app\.py|run\.py|__main__\.py|main\.go|main\.rs)$/i;
  const candidates = nodes.map(n => { let score = 0; if(n.type === 'document' && n.filePath === 'README.md') score += 5; else if(n.type === 'document' && !n.filePath.includes('/')) score += 2; if(n.type === 'file' && entryNames.test(n.filePath || '')) score += 3; if(n.type === 'file' && (n.filePath || '').split('/').length <= 2) score++; if(n.type === 'file' && outgoing.get(n.id) >= highOut) score++; if(n.type === 'file' && incoming.get(n.id) <= lowIn) score++; return {id:n.id, score, name:n.name, summary:n.summary}; }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0,5);
  const start = candidates.find(c => byId.get(c.id).type === 'file');
  const next = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) if ((e.type === 'imports' || e.type === 'calls') && next.has(e.source) && next.has(e.target)) next.get(e.source).push(e.target);
  const order=[], depthMap={}, byDepth={}; if(start) { const q=[start.id]; depthMap[start.id]=0; for(let i=0;i<q.length;i++){const id=q[i], d=depthMap[id];order.push(id);(byDepth[d] ||= []).push(id);for(const t of next.get(id)){if(depthMap[t]===undefined){depthMap[t]=d+1;q.push(t)}}} }
  const buckets = {documentation:[], infrastructure:[], data:[], config:[]};
  for (const n of nodes) { const v={id:n.id,name:n.name,type:n.type,summary:n.summary}; if(n.type==='document') buckets.documentation.push(v); else if(['service','pipeline','resource'].includes(n.type)) buckets.infrastructure.push(v); else if(['table','schema','endpoint'].includes(n.type)) buckets.data.push(v); else if(n.type==='config') buckets.config.push(v); }
  const result={scriptCompleted:true,entryPointCandidates:candidates,fanInRanking:ranked(incoming,'fanIn'),fanOutRanking:ranked(outgoing,'fanOut'),bfsTraversal:{startNode:start?.id || null,order,depthMap,byDepth},nonCodeFiles:buckets,clusters:[],layers:{count:(graph.layers||[]).length,list:(graph.layers||[]).map(({id,name,description})=>({id,name,description}))},nodeSummaryIndex:Object.fromEntries(nodes.map(n=>[n.id,{name:n.name,type:n.type,summary:n.summary}])),totalNodes:nodes.length,totalEdges:edges.length};
  fs.writeFileSync(outputPath, JSON.stringify(result,null,2));
} catch (err) { console.error(err.stack || err.message); process.exit(1); }
