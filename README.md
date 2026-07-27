# Forge

Forge is an add-on for Claude Code. When you send a message, it rewrites your request into a clear brief, breaks it into smaller tasks, runs each task on the model that fits it, checks the work, and combines the results into one answer.

The goal is simple. Cheap tasks go to cheap models, hard tasks go to strong models, and the answer gets checked before you see it.

## What happens when you send a message

Forge runs on every message through a Claude Code hook. For small messages (a greeting, a one line question, a tiny edit) it stays out of the way and Claude answers normally. For a real request it runs six steps:

1. Rewrite. A strong model turns your raw message into a clear brief: the real goal, what a good answer needs to include, the constraints, and the things that usually go wrong.
2. Check the plan. A second model reviews the breakdown for gaps, overlap, and wasted steps, and fixes it once if needed.
3. Run the tasks. Each task runs on a model chosen by its difficulty. Independent tasks run at the same time. The hardest tasks are attempted by more than one model and the answers are combined.
4. Verify. Separate reviewers score each result against the plan. If a result looks dishonest or made up, it is sent back regardless of the other scores.
5. Fix. Anything that fails review is reflected on and retried, up to two times, moving to a stronger model each time.
6. Combine. A strong model merges everything into one answer and grades it against the brief before returning it.

## How it picks models

Forge does not hardcode model names in its logic. It reads a small config file, `~/.claude/forge-models.json`, that lists which models exist and how they rank from cheap to strong. The code routes by that config.

This means new models are handled without editing any code:

- A new version of an existing model (for example a newer Opus or a newer Fable) is picked up on its own, because the config uses family names that always point at the current model in that family.
- A larger change, like a brand new model family or a different ranking, is handled by running `python3 ~/.claude/hooks/forge-models.py`, which rebuilds the config from whatever models are available. It matches each model to its family and keeps the newest version.
- If a model in the config is ever unavailable at run time, Forge retries the task on the next model down the list.

## Install

You need Claude Code and Python 3.

```
git clone https://github.com/somudatta06/forge.git
cd forge
bash install.sh
```

Then quit and reopen Claude Code so it loads the hook.

The installer copies three things into `~/.claude`, generates the model config for your machine, and adds one hook to your Claude Code settings. It does not overwrite your other settings and is safe to run again.

## Using it

- It runs on its own for every real request. You do not need to type anything special.
- To skip it for one message, start the message with `raw:`.
- To turn it off, run `touch ~/.claude/forge.off`. To turn it back on, run `rm ~/.claude/forge.off`.
- You can also run it by name with `/forge <your request>`.

## Requirements

- Claude Code (the CLI or the desktop app, both share the `~/.claude` folder).
- Python 3 on your PATH.
- An account with access to the model families Forge routes to. Today those are Haiku, Sonnet, Opus, and Fable. If your account is missing one, edit `~/.claude/forge-models.json` and remove it from the list.

## What is in this repo

```
skill/SKILL.md        the instructions Claude follows for Forge
workflow/forge-swarm.js   the six step pipeline
hooks/forge-inject.py     runs on every message and starts Forge
hooks/forge-models.py     builds and refreshes the model config
tests/logic_test.mjs      checks the scheduling, retry, and veto logic
tests/cost_model.mjs      counts model calls per task shape to check the savings
install.sh            copies everything into place
```

## Tests

These checks run without calling any models:

```
node tests/logic_test.mjs                      # scheduling, cycles, retry loop, veto
node tests/cost_model.mjs                      # model-call count per task shape, old vs new
python3 hooks/forge-models.py --selftest       # model classification, including future versions
```

## Keeping costs down

Forge spends effort in proportion to how hard the task is, so simple requests stay cheap.

- Small requests take a lean path: it skips the plan review, uses one model per task instead of several, checks the work more lightly, and skips the final combine step when there is only one task and it passed. In tests this cuts the number of model calls for a simple task by about half.
- The multi-model step (running the same task on several models and combining the answers) only runs on tasks the planner marks as high risk. Ordinary hard tasks use one strong model.
- Reviews are scaled by risk. Tasks that need to be correct (calculations, reasoning) get more reviewers than tasks like writing text.
- If you set a token budget for a run, Forge uses fewer reviewers and fewer models, and stops before it goes over.

## Notes

- Every retry loop has a fixed limit, so a run always finishes.
- Forge starts the model work through Claude Code's background workflow runner, so it keeps working while you do other things.

## License

MIT. See LICENSE.
