// Standalone simulation of v3.0's risky control flow with MOCK agents.
// Proves: dataflow parallelism, dependency ordering, cycle-safety, bounded refine loop.
let now = 0
const clock = () => now
const sleep = (ms) => new Promise(r => { const t = now + ms; setTimeout(() => { now = Math.max(now, t); r() }, ms) })

// ---- mirror of the scheduler under test ----
function buildDeps(subtasks) {
  const byId = {}; subtasks.forEach(t => { byId[t.id] = t })
  const deps = {}; subtasks.forEach(t => { deps[t.id] = (t.dependsOn || []).filter(d => byId[d] && d !== t.id) })
  const color = {}
  const dfs = (id) => { color[id] = 1; deps[id] = deps[id].filter(d => { if (color[d] === 1) return false; if (color[d] === undefined) dfs(d); return true }); color[id] = 2 }
  subtasks.forEach(t => { if (color[t.id] === undefined) dfs(t.id) })
  return { byId, deps }
}

async function schedule(subtasks, work) {
  const { byId, deps } = buildDeps(subtasks)
  const done = {}, promises = {}, trace = []
  const launch = (t) => promises[t.id] || (promises[t.id] = (async () => {
    await Promise.all(deps[t.id].map(d => launch(byId[d])))
    const start = clock(); trace.push({ id: t.id, start })
    const r = await work(t, deps[t.id].map(d => done[d]))
    done[t.id] = r; trace[trace.findIndex(x => x.id === t.id)].end = clock()
    return r
  })())
  await Promise.all(subtasks.map(t => launch(t)))
  return { done, trace }
}

// ---- bounded reflexion loop under test (never-passes case must still terminate) ----
async function refineLoop(MAX, verify) {
  let iter = 0
  for (let k = 0; k < MAX; k++) { iter++; if (await verify(k)) return { passed: true, iter } }
  return { passed: false, iter }
}

let pass = 0, fail = 0
const check = (name, cond) => { cond ? (pass++, console.log('  PASS', name)) : (fail++, console.log('  FAIL', name)) }

;(async () => {
  // TEST 1: independent units run concurrently; dependents wait.
  now = 0
  const g1 = [
    { id: 'a' }, { id: 'b' },                    // independent
    { id: 'c', dependsOn: ['a'] },               // needs a
    { id: 'd', dependsOn: ['a', 'b'] },          // needs both
  ]
  const durs = { a: 100, b: 300, c: 50, d: 20 }
  const { trace } = await schedule(g1, async (t) => { await sleep(durs[t.id]); return t.id })
  const tById = Object.fromEntries(trace.map(x => [x.id, x]))
  console.log('TEST 1 — dataflow parallelism')
  check('a and b start together (t=0)', tById.a.start === 0 && tById.b.start === 0)
  check('c starts right after a (not after slow b)', tById.c.start === 100)   // <- the wave-barrier bug would make this 300
  check('d waits for both a and b', tById.d.start === 300)

  // TEST 2: dependency cycle must NOT hang, both units still run.
  now = 0
  const g2 = [{ id: 'x', dependsOn: ['y'] }, { id: 'y', dependsOn: ['x'] }]
  let ran = []
  const res2 = await Promise.race([
    schedule(g2, async (t) => { await sleep(10); ran.push(t.id); return t.id }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('HANG')), 1000)),
  ]).then(() => 'ok').catch(e => e.message)
  console.log('TEST 2 — cycle safety')
  check('cycle did not hang', res2 === 'ok')
  check('both units in a cycle still ran', ran.includes('x') && ran.includes('y'))

  // TEST 3: bounded reflexion loop terminates even if verification NEVER passes.
  console.log('TEST 3 — reflexion loop is bounded')
  const r = await refineLoop(2, async () => false)  // always fails
  check('stops after MAX_REFINE iterations', r.iter === 2 && r.passed === false)
  const r2 = await refineLoop(2, async (k) => k === 0)  // passes first try
  check('early-exits on first pass', r2.iter === 1 && r2.passed === true)

  // TEST 4: soundness veto — a single soundness=false overrides a passing majority.
  console.log('TEST 4 — soundness veto')
  const veto = (votes) => {
    const yes = votes.filter(v => v.holds).length
    const vetoed = votes.some(v => v.lens === 'soundness' && v.holds === false)
    return (yes > votes.length / 2) && !vetoed
  }
  check('2/3 majority but soundness fail => NOT passed',
    veto([{ lens: 'correctness', holds: true }, { lens: 'completeness', holds: true }, { lens: 'soundness', holds: false }]) === false)
  check('clean 3/3 => passed',
    veto([{ lens: 'correctness', holds: true }, { lens: 'completeness', holds: true }, { lens: 'soundness', holds: true }]) === true)

  console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
