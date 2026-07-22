import fs from 'node:fs';

try {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map(nodes.map(n => [n.id, 0]));
  const outgoing = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges) {
    if (incoming.has(e.target)) incoming.set(e.target, incoming.get(e.target) + 1);
    if (outgoing.has(e.source)) outgoing.set(e.source, outgoing.get(e.source) + 1);
  }
  const rank = (map, field) => [...map.entries()].map(([id, value]) => ({ id, [field]: value, name: byId.get(id)?.name || id }))
    .sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id)).slice(0, 20);
  const fileLevel = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = nodes.filter(n => fileLevel.has(n.type));
  const fanOutValues = [...outgoing.values()].sort((a,b) => a-b);
  const lowCut = fanOutValues[Math.max(0, Math.floor((fanOutValues.length - 1) * .25))] || 0;
  const highCut = fanOutValues[Math.max(0, Math.floor((fanOutValues.length - 1) * .9))] || Infinity;
  const entryNames = /^(index|main|app|server|mod|manage|run|__main__|application|program)\.(ts|tsx|js|jsx|py|rs|go|java|cs|php|swift|kt|cpp|c)$/i;
  const entryPointCandidates = fileNodes.map(n => {
    let score = 0;
    if (n.type === 'document' && n.filePath === 'README.md') score += 5;
    else if (n.type === 'document' && !n.filePath.includes('/')) score += 2;
    if (n.type === 'file') {
      if (entryNames.test(n.name || '')) score += 3;
      if ((n.filePath || '').split('/').length <= 2) score += 1;
      if ((outgoing.get(n.id) || 0) >= highCut) score += 1;
      if ((incoming.get(n.id) || 0) <= lowCut) score += 1;
    }
    return {id:n.id, score, name:n.name, summary:n.summary};
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0, 5);
  const codeStart = entryPointCandidates.find(x => byId.get(x.id)?.type === 'file');
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) if ((e.type === 'imports' || e.type === 'calls') && adj.has(e.source) && adj.has(e.target)) adj.get(e.source).push(e.target);
  const order=[], depthMap={}, byDepth={};
  if (codeStart) { const q=[codeStart.id]; depthMap[codeStart.id]=0; for(let i=0;i<q.length;i++){ const id=q[i], d=depthMap[id]; order.push(id); (byDepth[d] ||= []).push(id); for(const next of adj.get(id)||[]) if(depthMap[next] === undefined){depthMap[next]=d+1;q.push(next);} } }
  const nonCodeFiles={documentation:[], infrastructure:[], data:[], config:[]};
  for(const n of fileNodes){const item={id:n.id,name:n.name,type:n.type,summary:n.summary}; if(n.type==='document')nonCodeFiles.documentation.push(item); else if(['service','pipeline','resource'].includes(n.type))nonCodeFiles.infrastructure.push(item); else if(['table','schema','endpoint'].includes(n.type))nonCodeFiles.data.push(item); else if(n.type==='config')nonCodeFiles.config.push(item);}
  const pairSet=new Set(edges.filter(e=>e.type==='imports'||e.type==='calls').map(e=>`${e.source}\0${e.target}`));
  const clusters=[]; for(const e of edges){if((e.type==='imports'||e.type==='calls') && pairSet.has(`${e.target}\0${e.source}`) && e.source < e.target)clusters.push({nodes:[e.source,e.target],edgeCount:2});}
  const nodeSummaryIndex=Object.fromEntries(nodes.map(n=>[n.id,{name:n.name,type:n.type,summary:n.summary}]));
  const result={scriptCompleted:true,entryPointCandidates,fanInRanking:rank(incoming,'fanIn'),fanOutRanking:rank(outgoing,'fanOut'),bfsTraversal:{startNode:codeStart?.id||null,order,depthMap,byDepth},nonCodeFiles,clusters:clusters.slice(0,10),layers:{count:(input.layers||[]).length,list:(input.layers||[]).map(({id,name,description})=>({id,name,description}))},nodeSummaryIndex,totalNodes:nodes.length,totalEdges:edges.length};
  fs.writeFileSync(process.argv[3], JSON.stringify(result,null,2));
} catch (err) { console.error(err.stack || err.message); process.exit(1); }
