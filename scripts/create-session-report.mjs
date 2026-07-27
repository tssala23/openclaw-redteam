#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const [resultsPath] = process.argv.slice(2);
if (!resultsPath) throw new Error('usage: node scripts/create-session-report.mjs <session-results.json>');

const sessionDirectory = dirname(resultsPath);
const sessionId = basename(sessionDirectory);
if (!/^RT-\d{4}-\d{3}$/.test(sessionId)) throw new Error(`invalid session directory: ${sessionId}`);

const data = JSON.parse(await readFile(resultsPath, 'utf8'));
const rows = data?.results?.results ?? [];
const stats = data?.results?.stats ?? {};
const failures = rows.filter((row) => !row.success);
const byPlugin = new Map();

for (const row of failures) {
  const plugin = row?.metadata?.pluginId ?? row?.testCase?.metadata?.pluginId ?? 'unknown';
  byPlugin.set(plugin, (byPlugin.get(plugin) ?? 0) + 1);
}

const lines = [
  `# ${sessionId}: Lessons learned (draft)`, '',
  '> Generated draft. A security reviewer must validate runtime evidence, root cause, severity, and recommendations before publishing this under `docs/red-team-sessions/`.', '',
  '## Outcome', '',
  `- Passed: ${stats.successes ?? rows.filter((row) => row.success).length}`,
  `- Failed: ${stats.failures ?? failures.filter((row) => !row.error).length}`,
  `- Errors: ${stats.errors ?? failures.filter((row) => row.error).length}`,
  `- Total: ${rows.length}`, '',
  '## Candidate gaps', '',
];

if (!byPlugin.size) lines.push('No failed cases were recorded. Determine whether this session adds validation evidence to existing findings.', '');
for (const [plugin, count] of [...byPlugin].sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(
    `### ${plugin}`, '',
    `- Failed or errored cases: ${count}`,
    '- Finding ID: REVIEW-REQUIRED',
    '- Runtime impact: REVIEW-REQUIRED',
    '- Root cause: REVIEW-REQUIRED',
    '- Recommendation: REVIEW-REQUIRED',
    '- Runbook control: REVIEW-REQUIRED',
    '- Validation plan: REVIEW-REQUIRED', '',
  );
}

lines.push(
  '## Evidence review', '',
  '- [ ] Gateway and OpenClaw logs reviewed',
  '- [ ] NeMo decisions reviewed when applicable',
  '- [ ] Tool calls and external audit logs reviewed',
  '- [ ] Filesystem and memory changes reviewed',
  '- [ ] Network telemetry reviewed',
  '- [ ] Evaluation errors treated as inconclusive', '',
);

await writeFile(join(sessionDirectory, 'lessons-learned.draft.md'), `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote ${join(sessionDirectory, 'lessons-learned.draft.md')}`);
