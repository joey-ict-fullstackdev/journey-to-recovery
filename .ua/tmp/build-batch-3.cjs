const fs = require('fs');
const root = process.cwd();
const batches = JSON.parse(fs.readFileSync('.ua/intermediate/batches.json', 'utf8'));
const batch = batches.batches.find((item) => item.batchIndex === 3);
const result = JSON.parse(fs.readFileSync('.ua/tmp/ua-file-extract-results-3.json', 'utf8'));
const descriptions = {
  MotivationIntroPage: 'Introduces the motivation assessment flow and advances participants to the next step.',
  MotivationWhyPage: 'Captures the participant’s reasons for their current motivation assessment.',
  NewGoalIntroPage: 'Introduces the flow for setting a new rehabilitation goal.',
  ReminderSchedulePage: 'Collects reminder schedule preferences for rehabilitation activities.',
  SmartGoalConfirmPage: 'Confirms the selected SMART-goal details before continuing.',
  SmartGoalExamplesPage: 'Presents expandable examples that guide SMART goal creation.',
  SmartGoalFormIntroPage: 'Prepares users to complete the structured SMART-goal form.',
  SmartGoalFormPage: 'Collects specific, measurable, achievable, relevant, and timed goal details.',
  SmartGoalPage: 'Provides a SMART-goal learning and navigation step.',
  StrengthsIntroPage: 'Introduces the strengths reflection flow.',
  StrengthsSummaryPage: 'Summarizes selected strengths before the participant continues.',
  WeeklyReminderPage: 'Collects weekly reminder settings and submits them to the API.',
  WellnessWheelFormPage: 'Implements the detailed wellness-wheel assessment form and scoring workflow.',
  WellnessWheelInstructionsPage: 'Explains how to complete the wellness-wheel assessment.',
  WellnessWheelIntroPage: 'Introduces the wellness-wheel reflection flow.',
  WellnessWheelSummaryPage: 'Summarizes wellness-wheel results and persists the completed assessment.',
  routes: 'Defines the client route tree that connects application paths to page components.',
  axiosConfig: 'Configures the shared Axios API client used by authenticated client-side submissions.'
};
function baseName(filePath) { return filePath.split('/').pop(); }
function componentName(filePath) { return baseName(filePath).replace(/\.tsx?$/, '').replace(/\.ts$/, ''); }
const nodes = batch.files.map((file) => {
  const component = componentName(file.path);
  const route = component === 'routes';
  const utility = component === 'axiosConfig';
  return { id: `file:${file.path}`, type: 'file', name: baseName(file.path), filePath: file.path,
    summary: descriptions[component] || `Provides the ${component} client-side component.`,
    tags: route ? ['routing','react','configuration'] : utility ? ['api-client','http','configuration'] : ['component','assessment','navigation'],
    complexity: file.sizeLines > 200 ? 'complex' : file.sizeLines >= 50 ? 'moderate' : 'simple' };
});
const edges = [];
for (const [source, targets] of Object.entries(batch.batchImportData)) {
  for (const target of targets) edges.push({ source: `file:${source}`, target: `file:${target}`, type: 'imports', direction: 'forward', weight: 0.7 });
}
fs.writeFileSync('.ua/intermediate/batch-3.json', JSON.stringify({ nodes, edges }, null, 2) + '\n');
