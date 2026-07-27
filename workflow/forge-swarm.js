export const meta = {
  name: 'forge-swarm',
  description: 'World-class multi-model swarm v3.1: Fable rubric-driven enhance → Opus plan-critique/repair → dataflow tier+kind routing (Mixture-of-Agents on hard units, real tools) → step-level rubric-scored voter panel w/ soundness veto → Reflexion iterative refine (escalating) → Fable rubric-graded synthesis. Budget-aware.',
  whenToUse: 'Any substantive request routed through the FORGE protocol. Pass args:{prompt:"<raw user message>"}.',
  phases: [
    { title: 'Enhance', detail: 'Fable: true goal, success rubric, constraints, risks, minimal-sufficient MECE plan', model: 'fable' },
    { title: 'Critique', detail: 'Opus checks MECE/minimality/critical-path; Fable repairs the plan once', model: 'opus' },
    { title: 'Swarm', detail: 'Dataflow routing by tier+kind; hard units use Mixture-of-Agents (opus+sonnet+fable→aggregator); workers use tools' },
    { title: 'Verify', detail: 'Perspective-diverse judges score 0-5 vs acceptance criteria; soundness failure vetoes' },
    { title: 'Refine', detail: 'Reflexion loop: reflect on root cause → refine → re-verify, escalating (max 2 rounds)' },
    { title: 'Synthesize', detail: 'Fable merges and grades the final answer against the success rubric', model: 'fable' },
  ],
}

// ---------------- MODEL REGISTRY (data-driven, self-adjusting) ----------------
// The routing table is DATA, not code. Defaults use floating family aliases — 'opus'/'sonnet'/
// 'haiku'/'fable' resolve to whatever the CURRENT model in that family is, so within-family
// launches (Opus 5.1, Fable 6, Haiku 5) are adopted with ZERO change here. Structural changes
// (a new family, re-ordered ladder) are handled by passing args.models — resolved OUTSIDE the
// workflow (the hook reads ~/.claude/forge-models.json) — so even those need no code edit.
const DEFAULTS = {
  ladder: ['haiku', 'sonnet', 'opus', 'fable'],                                   // weakest → strongest
  tiers:  { trivial: 'haiku', light: 'haiku', medium: 'sonnet', hard: 'opus' },   // difficulty → model
  mind: 'fable',        // enhancer + synthesizer (the "mind")
  planCritic: 'opus',   // plan critic/optimiser
  aggregator: 'fable',  // Mixture-of-Agents aggregator
  voter: 'sonnet',      // verification judges
  ensemble: ['opus', 'sonnet', 'fable'],   // MoA proposer set for hard units
}
const MC = (args && typeof args === 'object' && args.models && typeof args.models === 'object') ? args.models : {}
const arr = (v, d) => (Array.isArray(v) && v.length) ? v : d
const cfg = {
  ladder: arr(MC.ladder, DEFAULTS.ladder),
  tiers: Object.assign({}, DEFAULTS.tiers, MC.tiers || {}),
  mind: MC.mind || DEFAULTS.mind,
  planCritic: MC.planCritic || DEFAULTS.planCritic,
  aggregator: MC.aggregator || DEFAULTS.aggregator,
  voter: MC.voter || DEFAULTS.voter,
  ensemble: arr(MC.ensemble, DEFAULTS.ensemble),
}
if (typeof log === 'function') log(`Model registry: tiers=${JSON.stringify(cfg.tiers)} mind=${cfg.mind} ensemble=[${cfg.ensemble.join('+')}]${MC.ladder || MC.tiers ? ' (from args.models)' : ' (defaults/aliases)'}`)

const EFFORT   = { trivial: 'low', light: 'low', medium: 'high', hard: 'max' }  // effort is tier-based, model-agnostic
const LENSES   = ['correctness', 'completeness', 'soundness']
const MAX_REFINE = 2       // Reflexion iterations per still-failing unit (bounded → always terminates)
const modelFor   = (t) => cfg.tiers[t] || cfg.tiers.medium || cfg.ladder[Math.floor(cfg.ladder.length / 2)]
const effortFor  = (t) => EFFORT[t] || 'high'
const rung       = (m) => { const i = cfg.ladder.indexOf(m); return i < 0 ? cfg.ladder.length - 1 : i }   // unknown model → treat as top
const escalate   = (m) => cfg.ladder[Math.min(cfg.ladder.length - 1, rung(m) + 1)] || m                  // repair routes UP the ladder
const demote     = (m) => cfg.ladder[Math.max(0, rung(m) - 1)] || m                                       // self-heal routes DOWN
const bigEffort  = (m) => (rung(m) >= rung(cfg.tiers.hard)) ? 'max' : 'high'
// Self-healing agent call: if a model is unavailable (null result), retry once one rung DOWN the ladder.
const ask = async (prompt, opts) => {
  let r = null
  try { r = await agent(prompt, opts) } catch (e) { r = null }
  if (r == null && opts && opts.model && demote(opts.model) !== opts.model) {
    try { r = await agent(prompt, Object.assign({}, opts, { model: demote(opts.model), label: (opts.label || '') + ':fallback' })) } catch (e) { r = null }
  }
  return r
}

// ---------------- budget awareness (cost-aware, with hard stops) ----------------
const B = (typeof budget !== 'undefined' && budget) ? budget : { total: null, remaining: () => Infinity, spent: () => 0 }
const remaining = () => { try { return B.remaining() } catch (e) { return Infinity } }
const generous  = () => (B.total === null) || (remaining() > 300000)
const canAfford = (n) => (B.total === null) || (remaining() > n)
const votersFor = (tier) => {
  const base = { trivial: 0, light: 0, medium: 2, hard: 3 }[tier] || 0
  if (base > 1 && B.total !== null && remaining() < 120000) return 1   // budget-squeezed → single judge
  return base
}

const HONESTY =
  'HONESTY: Never claim you executed code, ran tests, benchmarked, or browsed the web unless a tool in THIS task actually produced that output. If a claim can only be confirmed by running or looking it up, either DO it with a tool now, or state it and mark it UNVERIFIED — never fabricate "tested and passes" or a specific version/number/result you did not observe.'

const rawPrompt = (args && typeof args === 'object' && args.prompt)
  ? args.prompt
  : (typeof args === 'string' ? args : '')
if (!rawPrompt) return { error: 'No prompt provided. Pass args:{prompt:"..."}.' }

// ============================ PHASE 1 — ENHANCE (prompter) ============================
phase('Enhance')

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['enhancedPrompt', 'trueGoal', 'successCriteria', 'subtasks'],
  properties: {
    trueGoal: { type: 'string', description: 'The real underlying goal in one sentence — what would actually satisfy the user, not the literal words.' },
    enhancedPrompt: { type: 'string', description: 'Rigorous rewrite: first-principles framing + explicit chain-of-thought scaffold for workers.' },
    successCriteria: { type: 'array', items: { type: 'string' }, description: 'The RUBRIC — concrete, checkable properties a 10/10 answer must have.' },
    constraints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    subtasks: {
      type: 'array',
      description: 'MINIMAL-SUFFICIENT, MECE decomposition: fewest units that fully cover the goal, no overlap, no busywork. Only genuine data-dependencies get dependsOn so independents run in parallel.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'prompt', 'tier', 'kind'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          prompt: { type: 'string', description: 'Fully self-contained instruction for one worker.' },
          kind: { type: 'string', enum: ['retrieval', 'computation', 'reasoning', 'generation', 'synthesis', 'verification'] },
          tier: { type: 'string', enum: ['trivial', 'light', 'medium', 'hard'] },
          acceptanceCriteria: { type: 'string', description: 'What "done" means for THIS unit — how a judge scores it.' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          needsExecution: { type: 'boolean' }, needsSearch: { type: 'boolean' },
        },
      },
    },
  },
}

const ENHANCE_PROMPT = (extra) =>
  `You are the ENHANCER — the mind and prompt-engineer of a world-class multi-model agent swarm. Do NOT answer the request. Engineer the BEST possible plan of attack.

THE METHOD (apply every step, visibly):
1. TRUE GOAL — first principles. Strip to irreducible intent. What would actually satisfy the user? One sentence; often NOT the literal question.
2. BAR FOR EXCELLENCE — write the success rubric: concrete, checkable properties a 10/10 answer must have. Everything downstream is graded against it.
3. CONSTRAINTS & RISKS — explicit AND implicit constraints (format, audience, scope, non-goals) and the failure modes / common wrong answers to avoid.
4. MINIMAL-SUFFICIENT MECE DECOMPOSITION — the fewest sub-tasks that FULLY cover the true goal, zero overlap, zero busywork. If simple, ONE sub-task is correct. CRITICAL FOR SPEED: set dependsOn ONLY for genuine data dependencies; independent units MUST stay independent so they run in parallel. Minimize the critical path.
5. PRIOR ART / RECONNAISSANCE — for build/design/implement/research tasks, add an early unit (kind: retrieval, needsSearch: true, no deps) surveying the web + GitHub for existing tools/libraries/repos to reuse or learn from, feeding the build units. Never reinvent a battle-tested tool.
6. REASONED ROUTING — per unit set: kind; tier by real difficulty (trivial/light→cheap, medium→mid, hard→top); acceptanceCriteria; needsExecution when truth requires running code; needsSearch when it requires current/external facts or prior art. Every sub-task prompt is fully self-contained with its own acceptance bar.
${HONESTY}${extra || ''}

RAW REQUEST:
"""
${rawPrompt}
"""`

let plan = await ask(ENHANCE_PROMPT(), { label: `${cfg.mind}:enhance`, phase: 'Enhance', model: cfg.mind, effort: 'max', schema: PLAN_SCHEMA })
if (!plan || !plan.subtasks || !plan.subtasks.length) {
  return { enhancedPrompt: plan && plan.enhancedPrompt, subtasks: [], final: '(enhancer produced no sub-tasks)' }
}

// ============================ PHASE 2 — CRITIQUE + REPAIR PLAN (optimiser) ============================
phase('Critique')

const CRITIQUE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['sound', 'issues'],
  properties: {
    sound: { type: 'boolean' },
    overlaps: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    busywork: { type: 'array', items: { type: 'string' } },
    mistiered: { type: 'array', items: { type: 'string' } },
    serialization: { type: 'string' },
    issues: { type: 'string' },
  },
}

const critique = await agent(
  `You are the PLAN CRITIC / OPTIMISER. Judge this plan against the true goal and rubric — do NOT solve the task. Check: (a) MECE — overlaps? gaps vs rubric? (b) MINIMALITY — busywork or mergeable units? (c) tiering/kind — over/under-powered units? (d) CRITICAL PATH — needless serialization parallelism could remove? Be specific and terse.

TRUE GOAL: ${plan.trueGoal}
SUCCESS RUBRIC:
${(plan.successCriteria || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n')}
SUB-TASKS:
${plan.subtasks.map(t => `- [${t.id}] (${t.tier}/${t.kind}) ${t.title} :: ${t.prompt}${(t.dependsOn && t.dependsOn.length) ? ' (deps: ' + t.dependsOn.join(',') + ')' : ''}`).join('\n')}`,
  { label: `${cfg.planCritic}:plan-critic`, phase: 'Critique', model: cfg.planCritic, effort: 'high', schema: CRITIQUE_SCHEMA }
)

if (critique && critique.sound === false && critique.issues && critique.issues !== 'none') {
  log(`Plan critic flagged issues → repairing plan. ${critique.issues}`)
  const repaired = await ask(
    ENHANCE_PROMPT(`\n\nA critic/optimiser reviewed your FIRST plan and found problems. Produce a corrected plan resolving ALL of them.\nCRITIC — overlaps: ${JSON.stringify(critique.overlaps || [])}; gaps: ${JSON.stringify(critique.gaps || [])}; busywork: ${JSON.stringify(critique.busywork || [])}; mistiered: ${JSON.stringify(critique.mistiered || [])}; serialization: ${critique.serialization || 'none'}; notes: ${critique.issues}`),
    { label: `${cfg.mind}:plan-repair`, phase: 'Critique', model: cfg.mind, effort: 'max', schema: PLAN_SCHEMA }
  )
  if (repaired && repaired.subtasks && repaired.subtasks.length) plan = repaired
} else {
  log('Plan critic: sound.')
}

const subtasks = plan.subtasks
log(`Plan ready. ${subtasks.length} units → ${subtasks.map(t => `${t.id}:${modelFor(t.tier)}/${t.kind}`).join(', ')}`)

// ---------------- shared helpers ----------------
const toolLine = (t) => {
  const parts = []
  if (t.needsExecution) parts.push('This unit is marked needsExecution: you MUST run the code/tool now and report REAL output — do not reason about what it "would" print.')
  if (t.needsSearch) parts.push('This unit is marked needsSearch: you MUST search the web AND look for existing tools/libraries/GitHub repos — cite URLs, note what to reuse/avoid. If web tools are unavailable here, say so and mark findings UNVERIFIED.')
  return parts.length ? '\n' + parts.join(' ') : ''
}
const workerPrompt = (t, ctx) =>
  `${ctx ? ctx + '\n\n----------------\n\n' : ''}You are a worker in a world-class agent swarm. Complete ONLY this sub-task, thoroughly and self-containedly, meeting its acceptance criteria exactly.\n${HONESTY}${toolLine(t)}\n\nSUB-TASK [${t.id}] — ${t.title} (kind: ${t.kind}):\n${t.prompt}${t.acceptanceCriteria ? `\n\nACCEPTANCE CRITERIA: ${t.acceptanceCriteria}` : ''}`

// LLM-as-judge (best practice): reason BEFORE verdict, score vs acceptance criteria, bias-guarded.
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reasoning', 'score', 'holds', 'notes'],
  properties: {
    reasoning: { type: 'string', description: 'Step-by-step check AGAINST the acceptance criteria, written BEFORE the verdict.' },
    score: { type: 'integer', minimum: 0, maximum: 5, description: '0=broken … 5=flawless against the acceptance criteria for this lens.' },
    holds: { type: 'boolean', description: 'true if it clears the bar for THIS lens (score >= 4). Default false if genuinely uncertain.' },
    notes: { type: 'string', description: 'specific defect, or "no issues".' },
  },
}
const LENS_BRIEF = {
  correctness: 'Attack factual/logical correctness at the STEP level: check each reasoning step, not just the final answer — a right answer via wrong steps still fails. Wrong claims, invalid inference, bugs, edge cases that break it.',
  completeness: 'Attack completeness: does it fully meet the sub-task and its acceptance criteria, or are requirements/cases missing?',
  soundness: 'Attack soundness & honesty: unsupported assertions, fabricated "tested/verified" claims, or specific values/versions that could only come from running or looking something up. A single fabricated-provenance claim is disqualifying.',
}

// Verify a set of units with the perspective-diverse panel; soundness failure vetoes.
const runVerify = async (items, tag) => {
  const jobs = []
  items.forEach(t => { const n = votersFor(t.tier); for (let i = 0; i < n; i++) jobs.push({ t, lens: LENSES[i % LENSES.length] }) })
  const votes = (await parallel(jobs.map(j => () =>
    agent(
      `You are an adversarial verifier / judge. LENS = ${j.lens}. ${LENS_BRIEF[j.lens]}
Judge ONLY against the acceptance criteria below — ignore superficial features (length, tone, confident wording). Write your reasoning FIRST, then score 0-5, then the boolean. Try hard to REFUTE; approve only if it genuinely withstands this lens. ${HONESTY}

SUB-TASK: ${j.t.prompt}${j.t.acceptanceCriteria ? `\nACCEPTANCE CRITERIA: ${j.t.acceptanceCriteria}` : ''}

RESULT TO CHECK:
${done[j.t.id]}`,
      { label: `${tag}:${j.t.id}:${j.lens}`, phase: 'Verify', model: cfg.voter, effort: 'medium', schema: VERDICT_SCHEMA }
    ).then(v => ({ id: j.t.id, lens: j.lens, ...v }))
  ))).filter(Boolean)
  const tally = {}
  votes.forEach(v => { (tally[v.id] = tally[v.id] || []).push(v) })
  const summary = [], failed = []
  for (const t of items) {
    const vs = tally[t.id] || []
    if (!vs.length) continue
    const yes = vs.filter(v => v.holds).length
    const soundnessVeto = vs.some(v => v.lens === 'soundness' && v.holds === false)
    const passed = (yes > vs.length / 2) && !soundnessVeto
    const avg = vs.reduce((a, v) => a + (v.score || 0), 0) / vs.length
    const objections = vs.filter(v => !v.holds).map(v => `[${v.lens} ${v.score}/5] ${v.notes}`)
    summary.push({ id: t.id, passed, votes: `${yes}/${vs.length}`, score: Math.round(avg * 10) / 10, vetoed: soundnessVeto, objections })
    if (!passed) failed.push({ t, notes: objections.join(' | '), vetoed: soundnessVeto })
  }
  return { summary, failed }
}

// ============================ PHASE 3 — SWARM (dataflow + self-consistency) ============================
phase('Swarm')

// Build dependency graph, break cycles.
const byId = {}; subtasks.forEach(t => { byId[t.id] = t })
const deps = {}; subtasks.forEach(t => { deps[t.id] = (t.dependsOn || []).filter(d => byId[d] && d !== t.id) })
const color = {}
const dfs = (id) => { color[id] = 1; deps[id] = deps[id].filter(d => { if (color[d] === 1) return false; if (color[d] === undefined) dfs(d); return true }); color[id] = 2 }
subtasks.forEach(t => { if (color[t.id] === undefined) dfs(t.id) })

// MIXTURE-OF-AGENTS: the hardest units are attempted by DIVERSE frontier models in parallel
// (Opus + Sonnet + Fable), then an aggregator cross-checks agreement and synthesizes the best
// answer. More diverse than same-model self-consistency; agreement doubles as a confidence signal.
const usesEnsemble = (t) => t.tier === 'hard'
const framingFor = (m) => ({
  haiku:  'Give a fast, direct first-pass answer.',
  sonnet: 'Reason efficiently and double-check each step against the acceptance criteria.',
  opus:   'Reason with maximum rigor and depth; show the critical steps.',
  fable:  'Take an INDEPENDENT angle and stress-test the obvious answer before committing.',
}[m] || 'Solve it rigorously and from an independent angle.')
const byStrengthDesc = (a, b) => rung(b) - rung(a)
const proposerSet = () => {
  if (!generous()) { const s = cfg.ensemble.slice().sort(byStrengthDesc); return canAfford(150000) ? s.slice(0, 2) : s.slice(0, 1) }
  return cfg.ensemble                                                          // full configured ensemble
}
const runUnit = async (t, ctx) => {
  const base = workerPrompt(t, ctx)
  if (!usesEnsemble(t)) {
    return await ask(base, { label: `${modelFor(t.tier)}:${t.id}`, phase: 'Swarm', model: modelFor(t.tier), effort: effortFor(t.tier) })
  }
  const proposers = proposerSet()
  const drafts = (await parallel(proposers.map(m => () =>
    ask(`${base}\n\nENSEMBLE MEMBER (${m}): ${framingFor(m)}`, { label: `moa:${t.id}:${m}`, phase: 'Swarm', model: m, effort: bigEffort(m) })
      .then(r => r ? { model: m, text: r } : null)
  ))).filter(Boolean)
  if (drafts.length <= 1) return drafts[0] ? drafts[0].text : null
  return await ask(
    `You are the MIXTURE-OF-AGENTS AGGREGATOR. Independent frontier models each attempted this sub-task below. Cross-check them: mark where they AGREE (treat as high-confidence) and where they DISAGREE (decide which is right — use a tool to actually verify if the truth is checkable, do not guess). Then synthesize the single best, correct answer, scoring each candidate on its merits and keeping only what survives scrutiny. If they broadly disagree and you cannot resolve it, say so explicitly and give the most defensible answer. ${HONESTY}\n\nSUB-TASK: ${t.prompt}${t.acceptanceCriteria ? `\nACCEPTANCE CRITERIA: ${t.acceptanceCriteria}` : ''}\n\nCANDIDATE ANSWERS:\n${drafts.map(d => `### Candidate from ${d.model}\n${d.text}`).join('\n\n')}`,
    { label: `moa-agg:${t.id}`, phase: 'Swarm', model: cfg.aggregator, effort: 'max' }
  )
}

const done = {}
const promises = {}
const launch = (t) => promises[t.id] || (promises[t.id] = (async () => {
  const depResults = await Promise.all(deps[t.id].map(d => launch(byId[d])))
  const ctx = deps[t.id].map((d, i) => `### Output of dependency "${d}":\n${depResults[i]}`).join('\n\n')
  let r = null
  try { r = await runUnit(t, ctx) } catch (e) { r = null }
  done[t.id] = r
  return r
})())
await Promise.all(subtasks.map(t => launch(t)))

// ============================ PHASE 4 — VERIFY ============================
phase('Verify')
const verifiable = subtasks.filter(t => (t.id in done) && votersFor(t.tier) > 0)
let { summary: verifySummary, failed } = await runVerify(verifiable, 'verify')

// ============================ PHASE 5 — REFINE (Reflexion loop, escalating, bounded) ============================
phase('Refine')
const refineLog = []
const refine = async (f) => {
  const t = f.t
  let objections = f.notes, model = escalate(modelFor(t.tier)), iterations = 0, lastObj = null
  for (let k = 0; k < MAX_REFINE; k++) {
    if (!canAfford(40000)) break                       // hard stop: out of budget
    iterations++
    const fix = await ask(
      `Your previous result FAILED verification. Work like Reflexion: FIRST reflect briefly on the ROOT CAUSE of each objection, THEN produce a corrected result that resolves every one — especially any honesty/soundness objection (use a tool to actually verify rather than assert). ${HONESTY}${toolLine(t)}\n\nSUB-TASK: ${t.prompt}${t.acceptanceCriteria ? `\nACCEPTANCE CRITERIA: ${t.acceptanceCriteria}` : ''}\n\nPREVIOUS RESULT:\n${done[t.id]}\n\nVERIFIER OBJECTIONS:\n${objections}`,
      { label: `refine:${t.id}#${k + 1}`, phase: 'Refine', model, effort: bigEffort(model) }
    )
    if (!fix) break
    done[t.id] = fix
    const rc = await runVerify([t], 'reverify')
    const s = rc.summary[0]
    if (s && s.passed) { refineLog.push({ id: t.id, passed: true, iterations, finalModel: model }); return { id: t.id, passed: true, iterations } }
    const newObj = s ? s.objections.join(' | ') : objections
    const stalled = newObj === lastObj                 // Magentic-One-style stall detection
    lastObj = objections; objections = newObj
    model = stalled ? cfg.ladder[cfg.ladder.length - 1] : escalate(model)   // escalate; jump to top of ladder if stalling
  }
  refineLog.push({ id: t.id, passed: false, iterations, finalModel: model })
  return { id: t.id, passed: false, iterations, notes: objections }
}

let stillOpen = []
if (failed.length && canAfford(60000)) {
  log(`${failed.length} finding(s) failed${failed.some(f => f.vetoed) ? ' (incl. soundness veto)' : ''} → Reflexion refine (≤${MAX_REFINE} rounds, escalating).`)
  const outcomes = await parallel(failed.map(f => () => refine(f)))
  const byIdOut = {}; outcomes.filter(Boolean).forEach(o => { byIdOut[o.id] = o })
  verifySummary = verifySummary.map(s => byIdOut[s.id]
    ? { ...s, passed: byIdOut[s.id].passed, refined: true, refineIterations: byIdOut[s.id].iterations, objections: byIdOut[s.id].passed ? [] : s.objections }
    : s)
  stillOpen = outcomes.filter(o => o && !o.passed).map(o => o.id)
} else if (failed.length) {
  log('Budget low — skipping refine; flagging open findings for honest disclosure in synthesis.')
  stillOpen = failed.map(f => f.t.id)
} else {
  log('All verified findings passed — no refine needed.')
}

// ============================ PHASE 6 — SYNTHESIZE (rubric-graded) ============================
phase('Synthesize')

const bundle = subtasks.map(t => `## [${t.id}] ${t.title}  (tier=${t.tier}, kind=${t.kind}, model=${modelFor(t.tier)}${usesEnsemble(t) ? ', mixture-of-agents' : ''})\n${done[t.id] || '(no result)'}`).join('\n\n')
const verifyNotes = verifySummary.length
  ? verifySummary.map(v => `- ${v.id}: ${v.passed ? 'PASSED' : 'STILL-OPEN'} (votes ${v.votes}, avg ${v.score}/5${v.vetoed ? ', soundness-veto' : ''}${v.refined ? `, refined x${v.refineIterations}` : ''})${(!v.passed && v.objections && v.objections.length) ? ' — ' + v.objections.join('; ') : ''}`).join('\n')
  : '(no units required a voter panel)'
const rubric = (plan.successCriteria || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n')
const openTools = subtasks.filter(t => t.needsExecution || t.needsSearch).map(t => `- [${t.id}] ${t.title}${t.needsExecution ? ' (needs execution)' : ''}${t.needsSearch ? ' (needs search)' : ''}`)

const final = await agent(
  `You are the SYNTHESIZER, closing the loop on a world-class multi-model swarm. Produce the single best final answer to the user's ORIGINAL intent — direct, well-structured, complete. Integrate results that passed; for any STILL-OPEN unit, use the best available result but flag its known weakness honestly. ${HONESTY} Then GRADE your own answer against the success rubric and fix any unmet criterion before finalizing. If a criterion truly cannot be met, say so plainly.

ORIGINAL REQUEST:
"""
${rawPrompt}
"""

TRUE GOAL: ${plan.trueGoal}

SUCCESS RUBRIC (your answer must satisfy every item):
${rubric}

CONSTRAINTS: ${(plan.constraints || []).join(' | ') || '(none)'}
RISKS TO AVOID: ${(plan.risks || []).join(' | ') || '(none)'}

SUB-TASK RESULTS:
${bundle}

VERIFICATION LEDGER:
${verifyNotes}
${openTools.length ? '\nUNITS THAT REQUIRED TOOLS (ensure claims are real, else mark unverified):\n' + openTools.join('\n') : ''}`,
  { label: `${cfg.mind}:synthesize`, phase: 'Synthesize', model: cfg.mind, effort: 'max' }
)

return {
  trueGoal: plan.trueGoal,
  successCriteria: plan.successCriteria || [],
  constraints: plan.constraints || [],
  risks: plan.risks || [],
  enhancedPrompt: plan.enhancedPrompt,
  assumptions: plan.assumptions || [],
  planCritique: critique ? { sound: critique.sound, issues: critique.issues } : null,
  routing: subtasks.map(t => ({ id: t.id, title: t.title, tier: t.tier, kind: t.kind, model: usesEnsemble(t) ? 'mixture-of-agents (opus+sonnet+fable)' : modelFor(t.tier), effort: effortFor(t.tier), ensemble: usesEnsemble(t), needsExecution: !!t.needsExecution, needsSearch: !!t.needsSearch })),
  verification: verifySummary,
  refine: refineLog,
  stillOpen,
  tokensSpent: (() => { try { return B.spent() } catch (e) { return null } })(),
  modelRegistry: cfg,
  final,
}
