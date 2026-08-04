#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';

const registry = JSON.parse(await readFile('docs/findings.yaml', 'utf8'));
const runbook = await readFile('docs/SECURITY_RUNBOOK.md', 'utf8');
const errors = [];
const knownFindings = new Set();
const registrySessions = new Set();

for (const finding of registry.findings ?? []) {
  if (!/^OC-[A-Z]+-\d{3}$/.test(finding.id ?? '')) errors.push(`invalid finding ID: ${finding.id}`);
  if (knownFindings.has(finding.id)) errors.push(`duplicate finding ID: ${finding.id}`);
  knownFindings.add(finding.id);

  const sessions = [...(finding.discoveredBy ?? []), ...(finding.reproducedBy ?? []), ...(finding.validatedBy ?? [])];
  if (!sessions.length) errors.push(`${finding.id} has no linked session`);
  for (const session of new Set(sessions)) {
    registrySessions.add(session);
    try { await access(`docs/red-team-sessions/${session}.md`); }
    catch { errors.push(`${finding.id} references missing session ${session}`); }
  }

  if (!(finding.runbookControls ?? []).length) errors.push(`${finding.id} has no runbook control`);
  for (const control of finding.runbookControls ?? []) {
    if (!runbook.includes(`### ${control}:`)) errors.push(`${finding.id} references missing control ${control}`);
  }
  if (finding.status === 'mitigated-by-control' && !(finding.validatedBy ?? []).length) {
    errors.push(`${finding.id} is mitigated but has no validation session`);
  }
  if (!runbook.includes(`\`${finding.id}\``)) errors.push(`${finding.id} is not referenced by the runbook`);
}

const sessionLinks = [...runbook.matchAll(/red-team-sessions\/(RT-\d{4}-\d{3})\.md/g)].map((match) => match[1]);
for (const session of new Set(sessionLinks)) {
  try { await access(`docs/red-team-sessions/${session}.md`); }
  catch { errors.push(`runbook references missing session ${session}`); }
}

for (const filename of await readdir('docs/red-team-sessions')) {
  if (!/^RT-\d{4}-\d{3}\.md$/.test(filename)) {
    errors.push(`invalid reviewed session filename: ${filename}`);
    continue;
  }
  const session = filename.slice(0, -3);
  const summary = await readFile(`docs/red-team-sessions/${filename}`, 'utf8');
  if (!registrySessions.has(session)) errors.push(`${session} is not referenced by the findings registry`);
  if (!/SEC-CTRL-\d{3}/.test(summary)) errors.push(`${session} does not reference a runbook control`);
  if (!/OC-[A-Z]+-\d{3}/.test(summary)) errors.push(`${session} does not reference a finding`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Traceability valid: ${knownFindings.size} findings and ${registrySessions.size} reviewed sessions.`);
}
