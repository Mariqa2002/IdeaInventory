/* ==========================================================================
   Timeline generation.

   Two engines, same output shape — [{ taskId, start, days }]:

   1. `planLocally` — a built-in planner that runs offline. It reads the
      project brief and the task titles, sorts the work into delivery phases,
      estimates a realistic length for each task, then lays the phases out
      back to back (with two parallel lanes inside a phase) around weekends.

   2. `planWithClaude` — optional. If an Anthropic API key has been saved in
      Settings, the same brief is sent to Claude for a judgement call. Any
      failure quietly falls back to the local planner.
   ========================================================================== */

import { todayISO, addDays, daysBetween, isWeekend, fromISO, clamp } from './util.js';

/* --- Phase + duration heuristics --------------------------------------- */

const PHASES = [
  { key: 'discovery', label: 'Research & discovery', words: ['research', 'explore', 'investigate', 'discover', 'interview', 'survey', 'validate', 'competitor', 'benchmark', 'read', 'learn', 'study', 'scope', 'brainstorm', 'idea', 'audit', 'analys', 'analyz'] },
  { key: 'planning',  label: 'Planning & definition', words: ['plan', 'define', 'spec', 'requirement', 'outline', 'brief', 'budget', 'estimate', 'roadmap', 'decide', 'choose', 'pick', 'shortlist', 'structure'] },
  { key: 'design',    label: 'Design',                words: ['design', 'wireframe', 'mockup', 'prototype', 'sketch', 'branding', 'logo', 'palette', 'ux', 'ui', 'layout', 'style', 'moodboard', 'copywriting', 'draft'] },
  { key: 'build',     label: 'Build',                 words: ['build', 'implement', 'develop', 'code', 'create', 'make', 'set up', 'setup', 'configure', 'write', 'integrate', 'migrate', 'record', 'film', 'assemble', 'produce', 'api', 'database', 'backend', 'frontend', 'feature'] },
  { key: 'test',      label: 'Test & refine',         words: ['test', 'qa', 'review', 'fix', 'bug', 'polish', 'refine', 'optimis', 'optimiz', 'accessibilit', 'feedback', 'iterate', 'proofread', 'check'] },
  { key: 'launch',    label: 'Launch',                words: ['launch', 'ship', 'release', 'deploy', 'publish', 'announce', 'market', 'promote', 'submit', 'send', 'share', 'onboard', 'sell', 'pitch'] },
  { key: 'aftercare', label: 'Aftercare',             words: ['monitor', 'measure', 'metric', 'support', 'maintain', 'retro', 'report', 'follow up', 'follow-up', 'improve'] },
];

const BIG_WORDS = ['system', 'platform', 'full', 'entire', 'whole', 'complete', 'end-to-end', 'architecture', 'database', 'migration', 'redesign', 'rebuild', 'integration', 'infrastructure'];
const SMALL_WORDS = ['email', 'call', 'note', 'list', 'name', 'quick', 'small', 'tweak', 'rename', 'add', 'ask', 'book', 'buy', 'post', 'reply', 'update'];

function phaseIndexFor(title) {
  const text = title.toLowerCase();
  let best = -1, bestHit = 0;
  PHASES.forEach((phase, index) => {
    for (const word of phase.words) {
      if (text.includes(word) && word.length > bestHit) { best = index; bestHit = word.length; }
    }
  });
  return best === -1 ? 3 : best;   // unclassified work sits with the build
}

function estimateDays(task, phaseIndex) {
  const text = task.title.toLowerCase();
  let days = [2, 2, 3, 4, 2, 2, 2][phaseIndex] ?? 3;

  if (BIG_WORDS.some((w) => text.includes(w))) days += 3;
  if (SMALL_WORDS.some((w) => text.includes(w))) days -= 1;
  if (text.split(/\s+/).length > 8) days += 1;          // a long title means a fat task
  if (/\band\b|,|\+|\//.test(text)) days += 1;          // several things bundled together
  if (task.priority) days = Math.max(1, days - 1);      // urgent work gets cut down

  return clamp(Math.round(days), 1, 15);
}

/* --- Calendar helpers --------------------------------------------------- */

function nextWorkday(iso) {
  let cursor = iso;
  while (isWeekend(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

/** Turn "N working days from `iso`" into a calendar start + span. */
function workingSpan(iso, workDays, skipWeekends) {
  if (!skipWeekends) return { start: iso, days: workDays, end: addDays(iso, workDays - 1) };
  const start = nextWorkday(iso);
  let counted = 1, cursor = start;
  while (counted < workDays) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) counted++;
  }
  return { start, days: daysBetween(start, cursor) + 1, end: cursor };
}

/* --- Local planner ------------------------------------------------------ */

/**
 * @param {object} idea
 * @param {object} [options]
 * @param {string} [options.startDate]      first day of the project
 * @param {boolean} [options.skipWeekends]  keep work on weekdays
 * @param {boolean} [options.onlyUnscheduled] leave tasks that already have dates
 * @param {number} [options.lanes]          how many tasks may run side by side
 */
export function planLocally(idea, options = {}) {
  const {
    startDate = idea.startDate || todayISO(),
    skipWeekends = true,
    onlyUnscheduled = false,
    lanes = 2,
  } = options;

  const candidates = idea.tasks
    .filter((t) => !t.archived)
    .filter((t) => (onlyUnscheduled ? !(t.start && t.days) : true));

  if (!candidates.length) return { plan: [], summary: 'Every task already has dates.', phases: [] };

  const enriched = candidates.map((task, index) => {
    const phase = phaseIndexFor(task.title);
    return { task, phase, days: estimateDays(task, phase), index };
  });

  // Done work anchors nothing — it drops to the front so it does not push the
  // rest of the plan out. Priority work leads its phase.
  enriched.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    if (a.task.priority !== b.task.priority) return a.task.priority ? -1 : 1;
    return a.index - b.index;
  });

  const plan = [];
  const usedPhases = [];
  let cursor = nextWorkdayIf(startDate, skipWeekends);

  let group = [];
  const flush = () => {
    if (!group.length) return;
    // Two lanes: each lane keeps its own finish date, the phase ends at the latest.
    const laneEnds = new Array(Math.max(1, lanes)).fill(null);
    let phaseEnd = null;

    group.forEach((entry, position) => {
      const lane = position % Math.max(1, lanes);
      const laneStart = laneEnds[lane] ? addDays(laneEnds[lane], 1) : cursor;
      const span = workingSpan(nextWorkdayIf(laneStart, skipWeekends), entry.days, skipWeekends);
      laneEnds[lane] = span.end;
      if (!phaseEnd || span.end > phaseEnd) phaseEnd = span.end;
      plan.push({ taskId: entry.task.id, start: span.start, days: span.days });
    });

    usedPhases.push({ label: PHASES[group[0].phase].label, count: group.length, end: phaseEnd });
    cursor = nextWorkdayIf(addDays(phaseEnd, 1), skipWeekends);
    group = [];
  };

  let currentPhase = enriched[0].phase;
  for (const entry of enriched) {
    if (entry.phase !== currentPhase) { flush(); currentPhase = entry.phase; }
    group.push(entry);
  }
  flush();

  const last = plan.reduce((latest, item) => {
    const end = addDays(item.start, item.days - 1);
    return !latest || end > latest ? end : latest;
  }, null);

  const weeks = last ? Math.max(1, Math.ceil((daysBetween(startDate, last) + 1) / 7)) : 0;
  const summary = `${plan.length} task${plan.length === 1 ? '' : 's'} laid out across ` +
    `${usedPhases.length} phase${usedPhases.length === 1 ? '' : 's'} — about ${weeks} week${weeks === 1 ? '' : 's'}` +
    (skipWeekends ? ', weekends kept free.' : '.');

  return { plan, summary, phases: usedPhases };
}

function nextWorkdayIf(iso, skipWeekends) {
  return skipWeekends ? nextWorkday(iso) : iso;
}

/* --- Claude planner (optional) ------------------------------------------ */

const MODEL = 'claude-sonnet-5';

export async function planWithClaude(idea, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error('no-key');

  const startDate = options.startDate || idea.startDate || todayISO();
  const tasks = idea.tasks
    .filter((t) => !t.archived)
    .filter((t) => (options.onlyUnscheduled ? !(t.start && t.days) : true));
  if (!tasks.length) return { plan: [], summary: 'Every task already has dates.' };

  const brief = [
    `Project: ${idea.title}`,
    idea.description && `Description: ${idea.description}`,
    idea.why && `Why it is being made: ${idea.why}`,
    idea.who && `Who it is for: ${idea.who}`,
    idea.value && `What makes it valuable: ${idea.value}`,
    `Project start date: ${startDate}`,
    options.skipWeekends ? 'The person works weekdays only.' : 'Weekend work is fine.',
    '',
    'Tasks:',
    ...tasks.map((t, i) => `${i + 1}. [${t.id}] ${t.title}${t.priority ? ' (priority)' : ''}${t.due ? ` (wanted by ${t.due})` : ''}`),
  ].filter(Boolean).join('\n');

  const prompt =
    `${brief}\n\n` +
    'Draw up a realistic schedule for one person working on this alongside other commitments. ' +
    'Order the tasks sensibly (research before building, testing before launch), let independent tasks overlap, ' +
    'and give each a start date and a duration in calendar days.\n\n' +
    'Reply with JSON only, no prose, in exactly this shape:\n' +
    '{"summary":"one sentence about the shape of the plan","plan":[{"taskId":"<id>","start":"YYYY-MM-DD","days":<integer>}]}';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  const text = (payload.content || []).map((block) => block.text || '').join('').trim();
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  const known = new Set(tasks.map((t) => t.id));
  const plan = (parsed.plan || [])
    .filter((item) => known.has(item.taskId) && fromISO(item.start))
    .map((item) => ({
      taskId: item.taskId,
      start: item.start,
      days: clamp(Math.round(Number(item.days) || 1), 1, 365),
    }));

  if (!plan.length) throw new Error('Claude returned no usable dates.');
  return { plan, summary: parsed.summary || 'Schedule drafted by Claude.' };
}

/** Claude when a key is set, the built-in planner otherwise (or on failure). */
export async function generateTimeline(idea, options = {}) {
  if (options.apiKey) {
    try {
      const result = await planWithClaude(idea, options);
      return { ...result, source: 'claude' };
    } catch (err) {
      console.warn('Claude planning failed, using the built-in planner.', err);
      return { ...planLocally(idea, options), source: 'local', fallbackReason: err.message };
    }
  }
  return { ...planLocally(idea, options), source: 'local' };
}
