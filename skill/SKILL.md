---
name: forge
version: 3.3.0
description: |
  FORGE protocol — world-class multi-model agent swarm and prompt optimiser.
  Fable engineers a rubric-driven plan (true goal + success rubric + constraints +
  risks + minimal-sufficient MECE decomposition); Opus critiques & repairs it for
  MECE/minimality/critical-path; sub-tasks route by tier+kind with effort scaling
  and real tool use; a perspective-diverse voter panel (with a soundness veto)
  verifies; failures escalate UP a tier and re-verify; Fable synthesizes and grades
  the final answer against the rubric. Cost-aware routing: haiku → sonnet → opus → fable.
  Runs automatically on every message via the UserPromptSubmit hook, and can be
  invoked manually as /forge <prompt>.
allowed-tools:
  - Agent
  - Workflow
  - Task
  - Bash
  - Read
  - Write
  - Edit
---

# FORGE

The mind is **Fable**. Workers are **Haiku / Sonnet / Opus**. Nothing is wasted:
cheap tasks go to Haiku, real reasoning to Sonnet/Opus, and only the two hardest
jobs — *enhancing the prompt* and *synthesizing the answer* — go to Fable.

This protocol runs automatically (via the hook) OR when invoked as
`/forge <prompt>`. When invoked manually, treat the args as the raw prompt.

---

## The phases (v2.1 — world-class)

Pipeline: **Enhance (Fable)** → **Critique+Repair plan (Opus→Fable)** → **Swarm (tier+kind routed, tool-using)** → **Verify (voter panel + soundness veto)** → **Escalating self-repair + re-verify** → **Synthesize + rubric-grade (Fable)**.

The four roles, each made world-class:
- **Prompter (Enhance):** extracts the *true goal*, writes an explicit *success rubric* (the 10/10 bar), surfaces implicit constraints + failure modes, then does a *minimal-sufficient* MECE decomposition (fewest units, no busywork, shortest critical path).
- **Router:** each unit carries a **kind** (retrieval/computation/reasoning/generation/synthesis/verification) plus a tier; model + effort + tool-use follow from them. Failed units **escalate UP a tier** on repair (haiku→sonnet→opus).
- **Optimiser (Critique):** Opus enforces MECE, minimality, correct tiering, and critical-path parallelism; Fable repairs the plan once.
- **Doer:** workers actually run tools when `needsExecution`/`needsSearch` is set; a **soundness veto** forces repair on any honesty failure even if outvoted; repairs are **re-verified**; the synthesizer **grades the final answer against the rubric** before returning.
- **Parallelism:** the swarm uses **true dataflow scheduling** — each unit starts the instant *its own* dependencies resolve (no wave barrier), so independent units run fully concurrent and wall-clock ≈ the longest dependency chain. Dependency cycles are auto-broken so the scheduler can't deadlock.
- **Prior art:** for build/design/research tasks the enhancer adds an early **reconnaissance** unit (`kind: retrieval, needsSearch: true`) that surveys the web + GitHub for existing tools to reuse or learn from — never reinvent a battle-tested tool.

Design lineage (mechanisms adopted, not just names):
- **MasRouter** → the enhancer↔router (query → subtask topology + count + per-unit model/kind).
- **FrugalGPT / RouteLLM** → confidence-gated cascade: cheap first, escalate UP a tier only when verification fails.
- **LangGraph** → the dataflow dependency graph (each unit fires when its own deps resolve).
- **Reflexion / Self-Refine** → the Refine phase: reflect on root cause → refine → re-verify, escalating, bounded to 2 rounds.
- **Mixture-of-Agents** (Together AI; 65.1% AlpacaEval) → hard units are attempted by diverse frontier models (Opus + Sonnet + Fable) in parallel, then a Fable aggregator cross-checks agreement and synthesizes the best. Self-consistency is the budget-squeezed fallback.
- **Self-Consistency** (Wang et al.) → agreement across the ensemble doubles as a calibrated confidence signal (more reliable than a model's self-reported confidence).
- **Process reward / step-level verification** (ThinkPRM) → the correctness judge checks each reasoning *step*, not just the final answer.
- **LLM-as-Judge best practices** → verifiers reason before verdict, score 0–5 against acceptance criteria, bias-guarded; soundness failure vetoes.
- **Magentic-One** → stall detection inside the Refine loop (jump to top model when objections stop changing).
- **Token-economy / cost-aware** → rigor (voters, self-consistency samples) scales with remaining `budget`, with hard-stops so a run can't overrun.

Every loop is strictly bounded (max 2 refine rounds, budget hard-stops, cycle-broken graph) — verified by a control-flow simulation before shipping.

Effort scales by tier (hard→max, medium→high, cheap→low); verifier count scales by tier (hard=3 lenses, medium=2, cheap=0). The honesty rule forbids fabricated "tested/verified" claims and surfaces `needsExecution`/`needsSearch` so anything tool-dependent is either run in-swarm or flagged for me to run live.

### 0. GATE (decide whether to run)
Run the full protocol **only for substantive requests**. Answer directly and skip
the swarm when the message is:
- a greeting / acknowledgement ("hi", "thanks", "cool"),
- a one-line factual question you already know,
- a trivial mechanical edit (rename, typo, one-liner),
- a continuation of a task already in flight, or
- prefixed with `raw:` (explicit bypass — strip the prefix and answer plainly).

If none apply → run phases 1–4.

### 1. ENHANCE — *Fable is the mind*
Send the raw prompt to **Fable**. Fable does not answer it — Fable **rewrites** it:
- **First principles**: strip the request to its irreducible truths and the real
  underlying goal (not the literal words).
- **Chain of thought**: lay out the reasoning scaffold the workers should follow.
- **MECE decomposition**: break the problem into sub-tasks that are **M**utually
  **E**xclusive (no overlap) and **C**ollectively **E**xhaustive (nothing missing).
- **Tier each sub-task**: `trivial` / `light` → Haiku, `medium` → Sonnet,
  `hard` → Opus. Mark dependencies between sub-tasks.

### 2. SWARM — *route by tier, fan out*
Run the sub-tasks with **cost-aware model routing**:
| tier | model | use for |
|------|-------|---------|
| trivial / light | **haiku** | lookups, formatting, boilerplate, extraction |
| medium | **sonnet** | analysis, moderate code, reasoning with some depth |
| hard | **opus** | deep reasoning, tricky architecture, subtle logic |
Independent sub-tasks run **in parallel**; dependent ones **pipeline** (a sub-task
receives its dependencies' outputs as context). Never send a Haiku task to Opus or
vice-versa — that is the waste this protocol exists to prevent.

### 3. VERIFY — *adversarial check*
For every `hard` (and any high-stakes `medium`) result, spawn a cheap
**sonnet/haiku** skeptic prompted to *refute* it — find factual errors, unsupported
claims, or broken logic. Drop or flag anything that fails.

### 4. SYNTHESIZE — *Fable closes the loop*
Send everything back to **Fable**: original intent + enhanced spec + verified
sub-task results. Fable produces the single best answer to the **original** intent,
integrating what held and flagging what didn't.

---

## How to execute it

The whole pipeline is a saved workflow. Run:

```
Workflow(name: "forge-swarm", args: { prompt: "<the user's raw message>" })
```

The workflow does enhance → route+swarm → verify → synthesize and returns
`{ enhancedPrompt, routing, verification, final }`. Present `final` as the answer,
and briefly note the routing (which models did what) so the user sees the swarm at
work. If Workflow is unavailable, fall back to running the phases manually with the
`Agent` tool using the same model routing (`model: "haiku" | "sonnet" | "opus" | "fable"`).

## Model registry — self-adjusting, no code changes
Routing is **data, not code**. The workflow never hardcodes model IDs; it reads a
registry (`~/.claude/forge-models.json`) passed in as `args.models`. Defaults
use floating family **aliases** (`haiku`/`sonnet`/`opus`/`fable`) that the harness
resolves to the *current* model per family.

- **New version of a family** (Opus 5.1, Fable 6, Haiku 5): adopted automatically —
  the alias floats. Nothing to do.
- **Structural change** (new family, re-ordered ladder, pin a version): run
  `python3 ~/.claude/hooks/forge-models.py` to re-derive the registry (it
  classifies model IDs by family + newest version), or hand-edit the JSON. The
  workflow code never changes.
- **Self-heal at runtime**: if a configured model is unavailable, the swarm retries
  one rung down the ladder automatically.

The hook injects the current registry on every message, so `args.models` is passed
for you. To execute manually: `Workflow(name:"forge-swarm", args:{ prompt, models })`.

## Controls
- **Bypass one message**: prefix it with `raw:`
- **Kill switch (session/global)**: `touch ~/.claude/forge.off` to disable the
  auto-hook; `rm ~/.claude/forge.off` to re-enable.
- **Tune**: edit `~/.claude/workflows/forge-swarm.js` (routing table, verify
  policy, fleet size) or `~/.claude/hooks/forge-inject.py` (the gate).
