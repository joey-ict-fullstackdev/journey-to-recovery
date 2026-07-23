import fs from 'fs';

try {
  const graph = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outputPath = process.argv[3];
  const fileTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileTypes.has(n.type));
  const byId = new Map(fileNodes.map(n => [n.id, n]));
  const parts = fileNodes.map(n => (n.filePath || '').split('/').filter(Boolean));
  let prefix = parts.length ? [...parts[0]] : [];
  for (const path of parts.slice(1)) { let i = 0; while (i < prefix.length && prefix[i] === path[i]) i++; prefix = prefix.slice(0, i); }
  const groupFor = n => { const p = (n.filePath || '').split('/').filter(Boolean).slice(prefix.length); return p.length > 1 ? p[0] : 'root'; };
  const directoryGroups = {}, nodeTypeGroups = {}, fanIn = {}, fanOut = {};
  for (const n of fileNodes) { const g = groupFor(n); (directoryGroups[g] ||= []).push(n.id); (nodeTypeGroups[n.type] ||= []).push(n.id); fanIn[n.id] = 0; fanOut[n.id] = 0; }
  const allEdges = graph.edges.filter(e => byId.has(e.source) && byId.has(e.target));
  const importEdges = allEdges.filter(e => e.type === 'imports');
  const inter = new Map(), internal = {}, total = {}, cross = new Map();
  for (const e of importEdges) { fanOut[e.source]++; fanIn[e.target]++; const a = groupFor(byId.get(e.source)), b = groupFor(byId.get(e.target)); total[a] = (total[a] || 0) + 1; total[b] = (total[b] || 0) + 1; if (a === b) internal[a] = (internal[a] || 0) + 1; else inter.set(`${a}\u0000${b}`, (inter.get(`${a}\u0000${b}`) || 0) + 1); }
  for (const e of allEdges) { const a = byId.get(e.source).type, b = byId.get(e.target).type, k = `${a}\u0000${b}\u0000${e.type}`; cross.set(k, (cross.get(k) || 0) + 1); }
  const pattern = g => ({routes:'api',api:'api',components:'ui',pages:'ui',hooks:'hooks',utils:'utility',lib:'service',services:'service',types:'types',tests:'test',test:'test',docs:'documentation','.github':'ci-cd',scripts:'utility',assets:'assets',public:'assets'})[g] || (g === 'root' ? 'root' : 'unclassified');
  const infraFiles = fileNodes.filter(n => n.type === 'pipeline' || /(^|\/)(Dockerfile|docker-compose)|\.github\/workflows|\.tf$/i.test(n.filePath || '')).map(n => n.filePath);
  const result = {
    scriptCompleted: true, commonPathPrefix: prefix.join('/'), directoryGroups, nodeTypeGroups,
    crossCategoryEdges: [...cross].map(([k,count]) => { const [fromType,toType,edgeType] = k.split('\u0000'); return {fromType,toType,edgeType,count}; }),
    interGroupImports: [...inter].map(([k,count]) => { const [from,to] = k.split('\u0000'); return {from,to,count}; }),
    intraGroupDensity: Object.fromEntries(Object.keys(directoryGroups).map(g => [g, {internalEdges:internal[g]||0,totalEdges:total[g]||0,density:total[g] ? (internal[g]||0)/total[g] : 0}])),
    patternMatches: Object.fromEntries(Object.keys(directoryGroups).map(g => [g, pattern(g)])),
    deploymentTopology: {hasDockerfile:infraFiles.some(x => /Dockerfile/i.test(x)),hasCompose:infraFiles.some(x => /compose/i.test(x)),hasK8s:false,hasTerraform:infraFiles.some(x => /\.tf$/i.test(x)),hasCI:infraFiles.some(x => /\.github\/workflows/i.test(x)),infraFiles},
    dataPipeline: {schemaFiles:fileNodes.filter(n => ['schema','table'].includes(n.type)).map(n => n.filePath),migrationFiles:fileNodes.filter(n => /migration/i.test(n.filePath||'')).map(n=>n.filePath),dataModelFiles:[],apiHandlerFiles:[]},
    fileStats: {totalFileNodes:fileNodes.length,filesPerGroup:Object.fromEntries(Object.entries(directoryGroups).map(([k,v])=>[k,v.length])),nodeTypeCounts:Object.fromEntries(Object.entries(nodeTypeGroups).map(([k,v])=>[k,v.length]))}, fileFanIn:fanIn,fileFanOut:fanOut
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
} catch (err) { console.error(err.stack || err.message); process.exit(1); }
