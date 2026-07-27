// Counts model calls per task shape, old pipeline vs new, to show the token savings.
// Pure arithmetic, no models called. Run: node tests/cost_model.mjs

// New routing rules (mirror of forge-swarm.js):
//   critique runs only if units >= 2 AND (units >= 3 OR any hard)
//   voters: trivial/light 0, medium 2, hard 3; generation/retrieval capped at 1
//   hard unit uses Mixture-of-Agents (4 calls) ONLY if highStakes; else 1 strong call
//   synthesis skipped if a single unit passed
const votersNew = (t) => {
  let base = { trivial: 0, light: 0, medium: 2, hard: 3 }[t.tier] || 0
  if (base === 0) return 0
  if (t.kind === 'generation' || t.kind === 'retrieval') base = 1
  return base
}
const votersOld = (t) => ({ trivial: 0, light: 0, medium: 2, hard: 3 }[t.tier] || 0)

function cost(units, mode) {
  const isNew = mode === 'new'
  let calls = 1 // enhance
  const hasHard = units.some(u => u.tier === 'hard')
  const doCritique = isNew ? (units.length >= 2 && (units.length >= 3 || hasHard)) : true
  if (doCritique) calls += 1
  for (const u of units) {
    if (u.tier === 'hard') {
      const moa = isNew ? (u.highStakes ? 4 : 1) : 4  // old: always MoA on hard
      calls += moa
    } else calls += 1
    calls += (isNew ? votersNew(u) : votersOld(u))
  }
  const singlePassed = units.length === 1
  if (!(isNew && singlePassed)) calls += 1 // synthesis
  return calls
}

const shapes = {
  'simple (1 medium generation)': [{ tier: 'medium', kind: 'generation' }],
  'small (2 medium)': [{ tier: 'medium', kind: 'reasoning' }, { tier: 'medium', kind: 'generation' }],
  'one hard reasoning (not high-stakes)': [{ tier: 'hard', kind: 'reasoning' }],
  'complex (haiku + sonnet + hard high-stakes)': [
    { tier: 'light', kind: 'retrieval' }, { tier: 'medium', kind: 'reasoning' }, { tier: 'hard', kind: 'reasoning', highStakes: true },
  ],
}

let allSaved = true
console.log('task shape'.padEnd(46), 'old', 'new', 'saved')
for (const [name, units] of Object.entries(shapes)) {
  const o = cost(units, 'old'), n = cost(units, 'new')
  const saved = Math.round((1 - n / o) * 100)
  if (n > o) allSaved = false
  console.log(name.padEnd(46), String(o).padEnd(3), String(n).padEnd(3), saved + '%')
}
console.log('\n' + (allSaved ? 'PASS: new pipeline never costs more than old' : 'FAIL: a shape got more expensive'))
process.exit(allSaved ? 0 : 1)
