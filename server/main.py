"""FastAPI backend — multi-agent goal decomposition endpoints."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from orchestrator import run_multi_agent_loop

ROOT = Path(__file__).resolve().parent.parent


def refresh_env() -> str:
    load_dotenv(ROOT / ".env", override=True)
    return (os.getenv("GROQ_API_KEY") or "").strip()


refresh_env()

app = FastAPI(
    title="Stepwise — Planner-Critic Refinement API",
    version="4.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DecomposeRequest(BaseModel):
    goal: str = Field(..., min_length=1)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/api/health")
def health() -> dict[str, Any]:
    key = refresh_env()
    return {
        "ok": True,
        "hasKey": bool(key),
        "backend": "python",
        "architecture": "validated-planning-loop",
        "architectureName": "Planner–Critic Iterative Refinement Architecture",
        "provider": "groq",
    }


@app.get("/api/architecture")
def architecture() -> dict[str, Any]:
    """Static architecture map for the frontend diagram."""
    return {
        "name": "Planner–Critic Iterative Refinement Architecture",
        "shortName": "Planner–Critic Refinement Loop",
        "agentCount": 4,
        "agents": [
            {
                "id": "planning_orchestrator",
                "label": "Planning Orchestrator",
                "role": "Goal → ordered plan",
            },
            {
                "id": "plan_validator",
                "label": "Plan Validator",
                "role": "Checks correctness and completeness",
            },
            {
                "id": "plan_replanner",
                "label": "Plan Replanner",
                "role": "Corrects Validator issues",
            },
            {
                "id": "plan_finalizer",
                "label": "Plan Finalizer",
                "role": "Writes the conversational plan",
            },
        ],
        "components": [
            {"id": "goal_input", "label": "Goal Input", "role": "Software input"},
            {
                "id": "plan_presenter",
                "label": "Plan Presenter",
                "role": "Software formatter",
            },
        ],
        "pattern": "Hierarchical planning with critic-guided iterative refinement",
        "activeFlow": (
            "Goal Input → Planning Orchestrator → Validator "
            "→ (Replanner → Validator)* → Finalizer → Presenter"
        ),
        "flow": (
            "Validator satisfied → Finalizer; otherwise → Replanner "
            "→ Validator until accepted or the safety limit is reached"
        ),
    }


@app.post("/api/decompose")
def decompose(body: DecomposeRequest) -> StreamingResponse:
    goal = body.goal.strip()
    if not goal:
        raise HTTPException(status_code=400, detail="Please provide a goal.")

    api_key = refresh_env()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not set. Save your .env file, then try again.",
        )

    def event_stream():
        yield _sse(
            "start",
            {
                "goal": goal,
                "architecture": "validated-planning-loop",
                "architectureName": "Planner–Critic Iterative Refinement Architecture",
            },
        )

        final: dict[str, Any] | None = None
        try:
            loop = run_multi_agent_loop(goal, api_key=api_key)
            while True:
                try:
                    event = next(loop)
                except StopIteration as stop:
                    state = stop.value
                    if state is not None:
                        final = {
                            "status": state.status,
                            "plan": [s.to_dict() for s in state.plan],
                            "history": state.history,
                            "logs": state.logs,
                            "critiques": state.critiques,
                            "summary": state.final_summary,
                            "final_answer": state.final_answer,
                            "goal": state.goal,
                            "iterations": state.iteration,
                            "terminate_reason": state.terminate_reason,
                        }
                    break

                yield _sse("tick", event)

                if event.get("phase") in ("complete", "final_answer", "max_iterations"):
                    snap = event.get("state") or {}
                    final = {
                        "status": snap.get("status"),
                        "plan": snap.get("plan"),
                        "summary": event.get("summary") or snap.get("final_summary"),
                        "final_answer": event.get("final_answer") or snap.get("final_answer"),
                        "goal": goal,
                        "iterations": snap.get("iteration"),
                        "terminate_reason": snap.get("terminate_reason"),
                    }

            yield _sse(
                "complete",
                final
                or {"status": "failed", "plan": [], "goal": goal, "summary": "No result"},
            )
        except Exception as err:  # noqa: BLE001
            yield _sse("error", {"message": str(err) or "Multi-agent loop failed"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3001"))
    print(f"Multi-agent server on http://localhost:{port}")
    print("Groq key loaded ✓" if refresh_env() else "⚠ GROQ_API_KEY missing")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
