const fs = require('fs');
const [graphPath, outputPath] = process.argv.slice(2);
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  const types = new Set(['file','function','class','module','concept','config','document','service','pipeline','table','schema','resource','endpoint']);
  const nodeIds = new Set(), seen = new Set();
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  for (const [i, n] of graph.nodes.entries()) {
    if (!n.id) issues.push(`Node[${i}] missing id`);
    else if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}'`);
    else { seen.add(n.id); nodeIds.add(n.id); }
    if (!types.has(n.type)) issues.push(`Node[${i}] invalid type '${n.type}'`);
    if (!n.name) issues.push(`Node[${i}] missing name`);
    if (!n.summary) issues.push(`Node[${i}] missing summary`);
    if (!Array.isArray(n.tags) || !n.tags.length) issues.push(`Node[${i}] missing tags`);
  }
  for (const [i,e] of graph.edges.entries()) if (!nodeIds.has(e.source)||!nodeIds.has(e.target)) issues.push(`Edge[${i}] has dangling reference`);
  if (!Array.isArray(graph.layers)) issues.push('graph.layers is missing or not an array');
  if (!Array.isArray(graph.tour)) issues.push('graph.tour is missing or not an array');
  const assigned = new Map();
  for (const l of graph.layers || []) {
    if (!l.id || !l.name || !l.description || !Array.isArray(l.nodeIds)) issues.push(`Invalid layer '${l.id || '<missing>'}'`);
    for (const id of l.nodeIds || []) { if (!nodeIds.has(id)) issues.push(`Layer references missing node '${id}'`); if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`); assigned.set(id,l.id); }
  }
  const fileTypes = new Set(['file','config','document','service','pipeline','table','schema','resource','endpoint']);
  for (const n of graph.nodes) if(fileTypes.has(n.type) && !assigned.has(n.id)) issues.push(`File node '${n.id}' not in any layer`);
  for (const [i,t] of (graph.tour || []).entries()) { if(!Number.isInteger(t.order)||!t.title||!t.description||!Array.isArray(t.nodeIds)) issues.push(`Invalid tour step ${i}`); for(const id of t.nodeIds||[]) if(!nodeIds.has(id)) issues.push(`Tour references missing node '${id}'`); }
  const stats={totalNodes:graph.nodes.length,totalEdges:graph.edges.length,totalLayers:(graph.layers||[]).length,tourSteps:(graph.tour||[]).length,nodeTypes:graph.nodes.reduce((a,n)=>(a[n.type]=(a[n.type]||0)+1,a),{}),edgeTypes:graph.edges.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{})};
  fs.writeFileSync(outputPath, JSON.stringify({issues,warnings,stats},null,2));
} catch(e) { console.error(e.stack); process.exit(1); }
