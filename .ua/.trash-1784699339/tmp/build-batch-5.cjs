const fs = require('fs');
const batch = JSON.parse(fs.readFileSync('.ua/intermediate/batches.json', 'utf8')).batches.find((item) => item.batchIndex === 5);
const summaries = {
  card: 'Provides reusable styled card primitives for grouped interface content.',
  progress: 'Provides a styled progress indicator for completion and score displays.',
  DashBoard: 'Displays the authenticated user dashboard and its rehabilitation overview.',
  GoalSettingPage: 'Guides the user into the goal-setting workflow.',
  GoalTracker: 'Displays and manages the user’s ongoing rehabilitation goals.',
  InfoCard: 'Renders compact informational card content for dashboard views.',
  NavBar: 'Renders primary navigation for authenticated client views.',
  UserHeader: 'Displays user identity and contextual header information.',
  WelcomePage: 'Provides the authenticated welcome screen and onboarding actions.',
  AuthContext: 'Provides authentication state, session actions, and access helpers to client components.',
  Layout: 'Composes shared layout structure around nested routes.',
  PrivateRoutes: 'Guards protected routes according to the authenticated session state.',
  types: 'Defines shared TypeScript types used by client components and state.'
};
function filename(path) { return path.split('/').pop(); }
function stem(path) { return filename(path).replace(/\.tsx?$/, ''); }
const nodes = batch.files.map((file) => { const key=stem(file.path); return { id:`file:${file.path}`, type:'file', name:filename(file.path), filePath:file.path, summary:summaries[key]||`Provides the ${key} client module.`, tags:key==='AuthContext'?['context','authentication','state-management']:key==='types'?['type-definition','typescript','shared']:key==='PrivateRoutes'?['routing','authentication','access-control']:['component','ui','client'], complexity:file.sizeLines>200?'complex':file.sizeLines>=50?'moderate':'simple' }; });
const edges=[]; for (const [source,targets] of Object.entries(batch.batchImportData)) for (const target of targets) edges.push({source:`file:${source}`,target:`file:${target}`,type:'imports',direction:'forward',weight:0.7});
fs.writeFileSync('.ua/intermediate/batch-5.json', JSON.stringify({nodes,edges},null,2)+'\n');
