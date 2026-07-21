const fs=require('fs');
const batch=JSON.parse(fs.readFileSync('.ua/intermediate/batches.json','utf8')).batches.find((item)=>item.batchIndex===7);
function filename(path){return path.split('/').pop();}
const nodes=batch.files.map((file)=>({id:`file:${file.path}`,type:'file',name:filename(file.path),filePath:file.path,summary:file.path.endsWith('_testUtils.ts')?'Provides shared setup and assertions used by server route tests.':`Integration tests covering the server ${filename(file.path).replace('.test.ts','')} route behavior.`,tags:file.path.endsWith('_testUtils.ts')?['test','utility','server']:['test','integration-test','server'],complexity:file.sizeLines>200?'complex':file.sizeLines>=50?'moderate':'simple'}));
const edges=[];for(const [source,targets]of Object.entries(batch.batchImportData))for(const target of targets)edges.push({source:`file:${source}`,target:`file:${target}`,type:'imports',direction:'forward',weight:0.7});
fs.writeFileSync('.ua/intermediate/batch-7.json',JSON.stringify({nodes,edges},null,2)+'\n');
