"""Validated goal-decomposition flow.

Goal Input
    ↓
Planning Orchestrator Agent
    ↓
Plan Validator Agent ── satisfied ─→ Plan Finalizer Agent → Plan Presenter
    │
    └── corrections needed ─→ Plan Replanner Agent ─→ Validator (loop)

The validation/replanning loop is capped to prevent infinite runs.
"""

from __future__ import annotations

from typing import Any, Generator

from agents import (
    plan_finalizer_agent,
    plan_replanner_agent,
    plan_validator_agent,
    planning_orchestrator_agent,
)
from state import SharedState

MAX_REPLAN_ATTEMPTS = 2


def _event(
    node: str,
    phase: str,
    state: SharedState,
    **payload: Any,
) -> dict[str, Any]:
    return {
        "agent": node,
        "phase": phase,
        "iteration": state.iteration,
        "state": state.snapshot(),
        **payload,
    }


def _fail(
    state: SharedState,
    node: str,
    error: Exception,
) -> Generator[dict[str, Any], None, SharedState]:
    state.status = "failed"
    state.final_summary = f"{node} failed: {error}"
    state.terminate_reason = f"{node}_error"
    yield _event(
        node,
        "error",
        state,
        message=str(error),
        note=state.final_summary,
    )
    return state


def run_multi_agent_loop(
    goal: str,
    *,
    api_key: str | None = None,
    **_unused: Any,
) -> Generator[dict[str, Any], None, SharedState]:
    """Create, validate, repair, finalize, and present an ordered plan."""
    state = SharedState(goal=goal.strip(), status="planning")

    yield _event(
        "goal_input",
        "received",
        state,
        note="Goal received",
    )

    # 1. Create the initial plan.
    try:
        yield _event(
            "planning_orchestrator",
            "planning",
            state,
            note="Analyzing the goal and creating ordered steps",
        )
        plan = planning_orchestrator_agent(state, api_key=api_key)
    except Exception as error:  # noqa: BLE001
        return (yield from _fail(state, "planning_orchestrator", error))

    yield _event(
        "planning_orchestrator",
        "plan_ready",
        state,
        plan=[step.to_dict() for step in plan],
        note=f"Initial {len(plan)}-step plan created",
    )

    # 2. Validate. If needed, Replanner corrects issues and sends it back.
    validation: dict[str, Any] = {
        "satisfied": False,
        "reason": "Not validated yet",
        "issues": [],
    }

    for attempt in range(MAX_REPLAN_ATTEMPTS + 1):
        state.iteration = attempt + 1
        try:
            yield _event(
                "plan_validator",
                "validating",
                state,
                note=f"Checking plan correctness (review {attempt + 1})",
            )
            validation = plan_validator_agent(state, api_key=api_key)
        except Exception as error:  # noqa: BLE001
            return (yield from _fail(state, "plan_validator", error))

        yield _event(
            "plan_validator",
            "satisfied" if validation["satisfied"] else "corrections_needed",
            state,
            validation=validation,
            note=validation["reason"],
        )

        if validation["satisfied"]:
            break

        if attempt >= MAX_REPLAN_ATTEMPTS:
            state.status = "partial"
            state.terminate_reason = "validation_limit"
            yield _event(
                "plan_validator",
                "review_limit",
                state,
                validation=validation,
                note="Review limit reached; finalizing the best available plan",
            )
            break

        try:
            yield _event(
                "plan_replanner",
                "correcting",
                state,
                validation=validation,
                note=f"Correcting {len(validation['issues'])} validator issue(s)",
            )
            revised_plan = plan_replanner_agent(
                state,
                validation,
                api_key=api_key,
            )
        except Exception as error:  # noqa: BLE001
            return (yield from _fail(state, "plan_replanner", error))

        yield _event(
            "plan_replanner",
            "revised",
            state,
            plan=[step.to_dict() for step in revised_plan],
            note="Corrected plan sent back to the Validator",
        )

    # 3. Finalizer Agent writes the conversational answer.
    try:
        yield _event(
            "plan_finalizer",
            "finalizing",
            state,
            validation=validation,
            note="Writing the validated plan as a conversational guide",
        )
        presentation = plan_finalizer_agent(
            state,
            validation,
            api_key=api_key,
        )
    except Exception as error:  # noqa: BLE001
        return (yield from _fail(state, "plan_finalizer", error))

    state.final_answer = presentation["final_answer"]
    state.final_summary = presentation["summary"]
    if validation["satisfied"]:
        state.status = "success"
        state.terminate_reason = "plan_validated"
    elif state.status != "partial":
        state.status = "partial"
        state.terminate_reason = "best_available_plan"

    state.log_transition(
        "plan_finalizer",
        input_data={"validation": validation},
        output_data=presentation,
        pass_fail=validation["satisfied"],
        note=state.final_summary,
    )
    yield _event(
        "plan_finalizer",
        "final_plan",
        state,
        validation=validation,
        final_answer=state.final_answer,
        summary=state.final_summary,
        note=state.final_summary,
    )

    # 4. Deterministic UI presenter receives the final content.
    yield _event(
        "plan_presenter",
        "presenting",
        state,
        final_answer=state.final_answer,
        summary=state.final_summary,
        note="Displaying the final plan and vertical timeline",
    )
    yield _event(
        "orchestrator",
        "complete",
        state,
        validation=validation,
        final_answer=state.final_answer,
        summary=state.final_summary,
    )
    return state
