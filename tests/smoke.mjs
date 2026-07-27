// Runs the ENTIRE workflow end to end with mock agents (no real models, no tokens).
// Catches runtime errors that a syntax check misses, like using a const before it is
// defined. Run: node tests/smoke.mjs
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../workflow/forge-swarm.js', import.meta.url), 'utf8')
  .replace(/^export\s+const\s+meta/m, 'const meta')   // 'export' is not valid inside a Function body

const AsyncFunction = (async () => {}).constructor

let calls = 0
function makeAgent() {
  calls = 0
  return (prompt, opts) => {
    calls++
    const s = opts && opts.schema
    if (s) {
      const req = s.required || []
      if (req.includes('subtasks')) return Promise.resolve(SCENARIO)          // enhance / plan-repair
      if (req.includes('sound')) return Promise.resolve({ sound: true, issues: 'none' })   // plan critic
      if (req.includes('holds')) return Promise.resolve({ reasoning: 'checked', score: 5, holds: true, notes: 'no issues' })  // judge
    }
    return Promise.resolve('mock answer for: ' + String(prompt).slice(0, 30))
  }
}
const parallel = (thunks) => Promise.all(thunks.map(f => f()))
const phase = () => {}
const logs = []
const log = (m) => logs.push(m)
const budget = { total: null, remaining: () => Infinity, spent: () => 4242 }

let SCENARIO = null
async function run(prompt, plan) {
  SCENARIO = plan
  logs.length = 0
  const fn = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'budget', 'args', src)
  return await fn(makeAgent(), parallel, phase, log, budget, { prompt })
}

let ok = 0, fail = 0
const chk = (n, c) => { console.log((c ? '  PASS ' : '  FAIL ') + n); c ? ok++ : fail++ }

const simplePlan = {
  trueGoal: 'explain', enhancedPrompt: 'x', successCriteria: ['clear'], constraints: [], risks: [], assumptions: [],
  subtasks: [{ id: 'u1', title: 'explain', prompt: 'explain it', tier: 'medium', kind: 'generation' }],
}
const complexPlan = {
  trueGoal: 'prove', enhancedPrompt: 'x', successCriteria: ['rigorous'], constraints: [], risks: [], assumptions: [],
  subtasks: [
    { id: 'lookup', title: 'facts', prompt: 'get facts', tier: 'light', kind: 'retrieval' },
    { id: 'proof', title: 'proof', prompt: 'prove it', tier: 'hard', kind: 'reasoning', dependsOn: ['lookup'] },
    { id: 'contrast', title: 'contrast', prompt: 'contrast', tier: 'medium', kind: 'reasoning' },
  ],
}

const main = async () => {
  console.log('SMOKE — simple task runs end to end')
  const a = await run('explain a hash map', simplePlan)
  chk('completed without throwing', !!a)
  chk('mode is lean', a.mode === 'lean')
  chk('returns a final answer', typeof a.final === 'string' && a.final.length > 0)
  chk('single unit skipped synthesis (final is the worker output)', a.final.startsWith('mock answer'))
  const simpleCalls = calls

  console.log('SMOKE — complex task runs end to end')
  const b = await run('prove sqrt 2 irrational', complexPlan)
  chk('completed without throwing', !!b)
  chk('mode is full', b.mode === 'full')
  chk('returns a final answer', typeof b.final === 'string')
  chk('reports the model registry', b.modelRegistry && b.modelRegistry.mind === 'fable')
  const complexCalls = calls

  console.log(`\n(model calls: simple=${simpleCalls}, complex=${complexCalls})`)
  console.log(fail === 0 ? '\nALL GREEN' : '\nFAILURES PRESENT', `— ${ok} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('THREW:', e.message); process.exit(1) })
