"""Agents for validated goal decomposition.

The Planning Orchestrator creates a plan, the Validator checks it, the
Replanner repairs rejected plans, and the Finalizer writes the user-facing
guide. No agent executes the plan.
"""

from __future__ import annotations

import json
from typing import Any

from llm import llm_json
from state import SharedState, Step


PLANNING_ORCHESTRATOR_PROMPT = """You are the Planning Orchestrator Agent.

Your only job is to turn the user's goal into a practical, end-to-end,
step-by-step plan. You do NOT execute the plan and must not claim that any
step has been completed.

First infer:
- the goal's scope and desired outcome
- explicit constraints (deadline, budget, technology, audience, resources)
- logical phases and dependencies
- likely risks or verification needs

Return ONLY this JSON shape:
{
  "steps": [
    {
      "id": "s1",
      "description": "Action-oriented step explaining what the user should do",
      "dependencies": [],
      "acceptance_criteria": [
        "Concrete completion check",
        "Concrete completion check"
      ]
    }
  ]
}

Planning rules:
- Simple goal: 3–4 steps.
- Medium goal: 5–6 steps.
- Complex goal: 7–8 steps.
- Order every step chronologically from preparation to final completion.
- Start each description with a strong action verb.
- Make descriptions detailed enough to guide the user, but keep one outcome per step.
- Preserve every user constraint.
- Use dependencies only when a step truly requires an earlier step.
- Give each step 2–4 observable completion checks.
- Cover discovery, preparation, implementation, verification, risk handling,
  and completion when relevant.
- Do not call tools, simulate progress, or assign done/pending status.
"""


PLAN_VALIDATOR_PROMPT = """You are the Plan Validator Agent.

Check whether the proposed ordered steps are sufficient and correct for
achieving the user's original goal. Do not execute any step.

Validate:
- every explicit user constraint is covered
- steps are actionable, chronological, and free of major gaps
- dependencies are valid
- completion checks are observable
- the final step reaches the requested outcome

Return ONLY JSON:
{
  "satisfied": true,
  "reason": "concise overall verdict",
  "issues": [
    {
      "step_id": "s2 or plan",
      "problem": "specific defect",
      "correction": "specific correction the Replanner should make"
    }
  ]
}

If the plan is fully suitable, set satisfied:true and issues:[]."""


PLAN_REPLANNER_PROMPT = """You are the Plan Replanner Agent.

Correct the proposed plan using every issue supplied by the Plan Validator.
Return the complete revised plan, not a patch. Do not execute any step.

Return ONLY JSON:
{
  "steps": [
    {
      "id": "s1",
      "description": "Action-oriented step",
      "dependencies": [],
      "acceptance_criteria": ["Observable completion check"]
    }
  ]
}

Keep correct steps, repair weak steps, insert missing steps, remove duplicates,
and preserve all constraints from the original goal. Limit the plan to 8 steps."""


PLAN_FINALIZER_PROMPT = """You are the Plan Finalizer Agent.

Present the validated plan to the user as a clear, conversational guide.
Explain how to work through it from start to finish. Do not claim that any
step has already been executed.

Return ONLY JSON:
{
  "final_answer": "Detailed conversational plan with numbered steps",
  "summary": "One-sentence summary"
}

For each numbered step, explain the action and its completion checks in
natural language. Keep the answer useful and easy to follow."""


def _parse_steps(raw_steps: list[dict[str, Any]]) -> list[Step]:
    """Validate and normalize an LLM-generated plan."""
    if not raw_steps:
        raise ValueError("Agent returned an empty plan")

    plan: list[Step] = []
    seen_ids: set[str] = set()

    for index, item in enumerate(raw_steps[:8], start=1):
        step_id = str(item.get("id") or f"s{index}").strip()
        if not step_id or step_id in seen_ids:
            step_id = f"s{index}"
        seen_ids.add(step_id)

        description = str(item.get("description") or "").strip()
        if not description:
            raise ValueError(f"Plan step {step_id} is missing a description")

        criteria = [
            str(criterion).strip()
            for criterion in (item.get("acceptance_criteria") or [])
            if str(criterion).strip()
        ][:4]
        if not criteria:
            criteria = [f"The outcome described in '{description}' is ready"]

        dependencies = [
            str(dependency).strip()
            for dependency in (item.get("dependencies") or [])
            if str(dependency).strip() in seen_ids
        ]
        plan.append(
            Step(
                id=step_id,
                description=description,
                dependencies=dependencies,
                status="pending",
                acceptance_criteria=criteria,
            )
        )
    return plan


def planning_orchestrator_agent(
    state: SharedState,
    *,
    api_key: str | None = None,
) -> list[Step]:
    """Convert the shared goal into an ordered plan with one Groq call."""
    response = llm_json(
        PLANNING_ORCHESTRATOR_PROMPT,
        f"USER GOAL:\n{state.goal}",
        api_key=api_key,
        temperature=0.25,
    )
    plan = _parse_steps(response.get("steps") or [])

    state.plan = plan
    state.current_index = 0
    state.status = "running"
    state.log_transition(
        "planning_orchestrator",
        input_data={"goal": state.goal},
        output_data={
            "step_count": len(plan),
            "plan": [step.to_dict() for step in plan],
        },
        pass_fail=True,
        note="Goal decomposed into an ordered plan",
    )
    return plan


def plan_validator_agent(
    state: SharedState,
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Judge whether the plan can achieve the original goal."""
    result = llm_json(
        PLAN_VALIDATOR_PROMPT,
        (
            f"ORIGINAL GOAL:\n{state.goal}\n\n"
            f"PROPOSED PLAN:\n{json.dumps([step.to_dict() for step in state.plan])}"
        ),
        api_key=api_key,
        temperature=0.1,
    )
    issues = [
        {
            "step_id": str(issue.get("step_id") or "plan"),
            "problem": str(issue.get("problem") or "").strip(),
            "correction": str(issue.get("correction") or "").strip(),
        }
        for issue in (result.get("issues") or [])
        if isinstance(issue, dict) and str(issue.get("problem") or "").strip()
    ]
    validation = {
        "satisfied": bool(result.get("satisfied")) and not issues,
        "reason": str(result.get("reason") or "").strip(),
        "issues": issues,
    }
    state.log_transition(
        "plan_validator",
        input_data={"plan": [step.to_dict() for step in state.plan]},
        output_data=validation,
        pass_fail=validation["satisfied"],
        note=validation["reason"],
    )
    return validation


def plan_replanner_agent(
    state: SharedState,
    validation: dict[str, Any],
    *,
    api_key: str | None = None,
) -> list[Step]:
    """Repair the plan based on the Validator's exact issues."""
    response = llm_json(
        PLAN_REPLANNER_PROMPT,
        (
            f"ORIGINAL GOAL:\n{state.goal}\n\n"
            f"CURRENT PLAN:\n{json.dumps([step.to_dict() for step in state.plan])}\n\n"
            f"VALIDATOR FEEDBACK:\n{json.dumps(validation)}"
        ),
        api_key=api_key,
        temperature=0.2,
    )
    revised_plan = _parse_steps(response.get("steps") or [])
    state.plan = revised_plan
    state.current_index = 0
    state.log_transition(
        "plan_replanner",
        input_data={"validation": validation},
        output_data={"plan": [step.to_dict() for step in revised_plan]},
        pass_fail=True,
        note="Validator issues corrected and full plan revised",
    )
    return revised_plan


def plan_finalizer_agent(
    state: SharedState,
    validation: dict[str, Any],
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Explain the validated plan conversationally."""
    try:
        result = llm_json(
            PLAN_FINALIZER_PROMPT,
            (
                f"ORIGINAL GOAL:\n{state.goal}\n\n"
                f"VALIDATED PLAN:\n{json.dumps([step.to_dict() for step in state.plan])}\n\n"
                f"VALIDATOR VERDICT:\n{json.dumps(validation)}"
            ),
            api_key=api_key,
            temperature=0.25,
        )
        final_answer = str(result.get("final_answer") or "").strip()
        summary = str(result.get("summary") or "").strip()
        if final_answer:
            return {
                "final_answer": final_answer,
                "summary": summary or f"Validated {len(state.plan)}-step plan ready.",
            }
    except Exception:  # noqa: BLE001
        # Preserve a usable result if the final presentation call is unavailable.
        pass
    return present_plan(state)


def present_plan(state: SharedState) -> dict[str, Any]:
    """Deterministically format the plan as a conversational response."""
    lines = [
        f"Here’s a step-by-step plan for your goal: {state.goal}",
        "",
        (
            f"I’ve organized the work into {len(state.plan)} stages. "
            "Follow them in order from start to finish."
        ),
        "",
    ]

    for index, step in enumerate(state.plan, start=1):
        lines.append(f"Step {index}: {step.description}")
        lines.append("How to know this step is ready:")
        for criterion in step.acceptance_criteria:
            lines.append(f"• {criterion}")
        if step.dependencies:
            lines.append(f"Complete after: {', '.join(step.dependencies)}")
        lines.append("")

    lines.extend(
        [
            "Use the completion checks as milestones before moving to the next step.",
        ]
    )

    return {
        "final_answer": "\n".join(lines),
        "summary": f"Created a complete {len(state.plan)}-step plan.",
    }
