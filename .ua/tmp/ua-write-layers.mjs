import fs from 'fs';

const graph = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const output = process.argv[3];
const fileTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
const layers = [
  ['layer:client-experience', 'Client Experience', 'The React application, including recovery workflows, authentication screens, routing, shared UI primitives, styling, and client-side integrations.', []],
  ['layer:server-application', 'Server Application', 'The Express API implementation, covering routes, domain operations, request validation, integrations, and operational jobs for the recovery platform.', []],
  ['layer:data', 'Data Layer', 'SQL migrations and database table definitions that persist accounts, recovery activity, conversations, goals, and clinician alerts.', []],
  ['layer:quality-evaluation', 'Quality & Evaluation', 'Server tests, test fixtures, evaluation runners, and scenario datasets that validate APIs and chatbot quality.', []],
  ['layer:configuration', 'Configuration & Tooling', 'Repository and package settings, build tooling, environment templates, and analysis configuration that support local development and releases.', []],
  ['layer:documentation', 'Documentation', 'Repository and package documentation covering architecture, contribution practices, handoff context, and server usage.', []],
  ['layer:ci-cd', 'CI/CD', 'GitHub Actions workflows that gate evaluations and promote approved baselines.', []]
];
const target = new Map(layers.map(l => [l[0], l]));
function assign(n) {
  const p = n.filePath || '';
  if (n.type === 'pipeline' || p.startsWith('.github/workflows/')) return 'layer:ci-cd';
  if (n.type === 'document') return 'layer:documentation';
  if (n.type === 'table' || n.type === 'schema' || n.type === 'resource' || n.type === 'endpoint' || p.includes('/db/')) return 'layer:data';
  if (p.includes('/tests/') || /(?:^|\/)(test|tests)(?:\/|$)/.test(p)) return 'layer:quality-evaluation';
  if (n.type === 'config' || p.startsWith('.ua/') || p === 'index.ts' || /^packages\/client\/(?:eslint\.config\.js|vite\.config\.ts)$/.test(p)) return 'layer:configuration';
  if (p.startsWith('packages/client/src/')) return 'layer:client-experience';
  if (p.startsWith('packages/server/')) return 'layer:server-application';
  return 'layer:configuration';
}
for (const n of graph.nodes.filter(n => fileTypes.has(n.type))) target.get(assign(n))[3].push(n.id);
const result = layers.filter(l => l[3].length).map(([id,name,description,nodeIds]) => ({id,name,description,nodeIds}));
const expected = graph.nodes.filter(n => fileTypes.has(n.type)).map(n => n.id);
const assigned = result.flatMap(l => l.nodeIds);
if (assigned.length !== expected.length || new Set(assigned).size !== expected.length || expected.some(id => !assigned.includes(id))) throw new Error('Layer coverage validation failed');
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.map(l => ({name:l.name, count:l.nodeIds.length}))));
