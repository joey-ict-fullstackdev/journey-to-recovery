const fs=require('fs');
const graph=JSON.parse(fs.readFileSync('.ua/intermediate/assembled-graph.json','utf8'));
const fileTypes=new Set(['file','config','document','service','pipeline','table','schema','resource','endpoint']);
const layers=[
 ['layer:client-ui','Client Application','React components, routes, styling, and client-side state supporting the rehabilitation experience.'],
 ['layer:server-api','Server API','Express application entry points and HTTP route handlers for rehabilitation platform features.'],
 ['layer:data-persistence','Data & Persistence','Database schema, migrations, and persistence modules backing users, goals, wellness, and check-ins.'],
 ['layer:server-support','Server Support','Authentication middleware, utility modules, and server configuration that support request handling.'],
 ['layer:tests','Automated Tests','Client and server test suites that verify route behavior and application workflows.'],
 ['layer:documentation','Documentation','Project, client, and server documentation plus development handoff material.'],
 ['layer:configuration','Configuration & Tooling','Package manifests, compiler settings, environment templates, build tooling, and local analysis configuration.'],
 ['layer:ci-cd','CI/CD','GitHub Actions workflows that evaluate and promote project baselines.']
].map(([id,name,description])=>({id,name,description,nodeIds:[]}));
function layer(n){const p=n.filePath||'';if(n.type==='pipeline'||p.startsWith('.github/workflows/'))return 7;if(n.type==='document'||/\.md$/i.test(p))return 5;if(p.includes('/tests/')||/\.test\./.test(p))return 4;if(p.startsWith('packages/server/db/'))return 2;if(p.startsWith('packages/server/routes/')||p==='packages/server/index.ts')return 1;if(p.startsWith('packages/server/')){if(p.startsWith('packages/server/config/')||p.startsWith('packages/server/middleware/')||p.startsWith('packages/server/utilities/'))return 3;if(n.type==='config'||p.endsWith('package.json')||p.endsWith('tsconfig.json')||p.includes('.env'))return 6;return 3;}if(p.startsWith('packages/client/src/'))return 0;if(p.startsWith('packages/client/'))return 6;if(n.type==='config'||p==='package.json'||p==='tsconfig.json'||p.startsWith('.ua/')||p==='index.ts')return 6;return 6;}
for(const n of graph.nodes)if(fileTypes.has(n.type))layers[layer(n)].nodeIds.push(n.id);
const out=layers.filter(l=>l.nodeIds.length);fs.writeFileSync('.ua/intermediate/layers.json',JSON.stringify(out,null,2)+'\n');
