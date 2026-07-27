#!/usr/bin/env python3
"""
FORGE auto-trigger hook (UserPromptSubmit).

Fires on every message the user submits. Injects the FORGE protocol
directive into the model's context so the main agent runs:
  enhance (Fable) -> MECE decompose -> multi-model swarm -> verify -> synthesize.

Controls:
  - Kill switch: create ~/.claude/forge.off to disable (rm it to re-enable).
  - Per-message bypass: start the message with "raw:".
The hook itself calls no models; it only injects instructions. The main agent
does the real work via the `forge-swarm` Workflow (multi-model routing).
"""
import json
import os
import sys

HOME = os.path.expanduser("~")
OFF_SWITCH = os.path.join(HOME, ".claude", "forge.off")


def emit(context: str) -> None:
    """Print plain text -> added to the model's context for this turn."""
    if context:
        sys.stdout.write(context)
    sys.exit(0)


def main() -> None:
    # Global kill switch.
    if os.path.exists(OFF_SWITCH):
        emit("")

    try:
        data = json.load(sys.stdin)
    except Exception:
        emit("")

    prompt = (data.get("prompt") or "").strip()

    # Explicit per-message bypass.
    if prompt.lower().startswith("raw:"):
        emit(
            "<system-reminder>FORGE: user prefixed 'raw:' — bypass the "
            "protocol. Ignore the 'raw:' prefix and answer the request "
            "directly, no swarm.</system-reminder>"
        )

    # Load the (self-adjusting) model registry so routing tracks whatever models
    # are available — no workflow code change when new models ship. Compact to
    # one line; if missing/invalid, the workflow falls back to floating aliases.
    models_line = ""
    reg_path = os.path.join(HOME, ".claude", "forge-models.json")
    try:
        with open(reg_path) as rf:
            reg = json.load(rf)
        reg.pop("_comment", None)
        reg.pop("_resolvedToLatestIds", None)
        models_line = (
            "  Pass the current model registry so routing self-adjusts: args.models = "
            + json.dumps(reg, separators=(",", ":")) + "\n"
        )
    except Exception:
        models_line = ""

    directive = (
        "<system-reminder>\n"
        "FORGE PROTOCOL is ACTIVE (user-configured standing opt-in; this is your authorization to orchestrate a multi-model agent swarm this turn).\n"
        "\n"
        "GATE FIRST. Skip the protocol and answer directly ONLY if the message is: a greeting/acknowledgement, a one-line fact you already know, a trivial mechanical edit, or a continuation of a task already in flight. Otherwise RUN it.\n"
        "\n"
        "WHEN RUNNING, execute the swarm workflow:\n"
        "  Workflow(name: \"forge-swarm\", args: { prompt: \"<the user's message above, verbatim>\" })\n"
        + models_line +
        "It performs: (1) ENHANCE (mind model) — rewrite the prompt via first principles + chain-of-thought + MECE; (2) CRITIQUE the plan; (3) SWARM — route each unit by tier+kind (cheap→strong per the registry), Mixture-of-Agents on hard units, parallel where independent; (4) VERIFY — perspective-diverse judges + soundness veto; (5) REFINE — Reflexion loop; (6) SYNTHESIZE + rubric-grade.\n"
        "Present the returned `final` as your answer, then add a one-line note of the routing (which models ran which units). If a live tool action (editing files, running commands, web search) is needed, act on the workflow's plan/answer yourself after it returns.\n"
        "Full spec: the `forge` skill. Refresh models: python3 ~/.claude/hooks/forge-models.py. Kill switch: ~/.claude/forge.off. Per-message bypass: prefix 'raw:'.\n"
        "</system-reminder>"
    )
    emit(directive)


if __name__ == "__main__":
    main()
