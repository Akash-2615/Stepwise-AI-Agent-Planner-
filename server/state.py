"""Single shared state object — passed by reference to every agent."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Literal


StepStatus = Literal["pending", "in_progress", "done", "failed", "skipped"]
RunStatus = Literal["idle", "planning", "running", "success", "failed", "partial"]


@dataclass
class Step:
    id: str
    description: str
    dependencies: list[str] = field(default_factory=list)
    status: StepStatus = "pending"
    # "what success looks like" — Critic checks these, not vague intent
    acceptance_criteria: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SharedState:
    """Mutable shared context for the entire multi-agent loop."""

    goal: str
    plan: list[Step] = field(default_factory=list)
    current_index: int = 0
    history: list[dict[str, Any]] = field(default_factory=list)
    iteration: int = 0
    max_iterations: int = 0
    status: RunStatus = "idle"
    final_summary: str | None = None
    final_answer: str | None = None
    logs: list[dict[str, Any]] = field(default_factory=list)
    # Reflexion episodic buffer: subgoal_id → plain-English critiques (capped)
    critiques: dict[str, list[str]] = field(default_factory=dict)
    max_critiques_per_subgoal: int = 5
    # False = in-context only for this run; True = also write external store
    persist_critiques_externally: bool = False
    completed_since_alignment: int = 0
    alignment_check_every: int = 3
    # Cap retries per subgoal to prevent infinite fail→replan loops
    step_attempts: dict[str, int] = field(default_factory=dict)
    max_attempts_per_step: int = 2
    hard_iteration_cap: int = 12
    terminate_reason: str | None = None

    def current_step(self) -> Step | None:
        if 0 <= self.current_index < len(self.plan):
            return self.plan[self.current_index]
        return None

    def all_steps_done(self) -> bool:
        return bool(self.plan) and all(
            s.status in ("done", "skipped") for s in self.plan
        )

    def pending_steps(self) -> list[Step]:
        return [s for s in self.plan if s.status in ("pending", "failed", "in_progress")]

    def bump_attempt(self, subgoal_id: str) -> int:
        self.step_attempts[subgoal_id] = self.step_attempts.get(subgoal_id, 0) + 1
        return self.step_attempts[subgoal_id]

    def attempts_for(self, subgoal_id: str | None) -> int:
        if not subgoal_id:
            return 0
        return self.step_attempts.get(subgoal_id, 0)

    def critiques_for(self, subgoal_id: str | None) -> list[str]:
        if not subgoal_id:
            return []
        return list(self.critiques.get(subgoal_id, []))

    def append_critique(self, subgoal_id: str, critique: str) -> None:
        bucket = self.critiques.setdefault(subgoal_id, [])
        bucket.append(critique.strip())
        # Cap per subgoal — summarize by keeping newest only
        if len(bucket) > self.max_critiques_per_subgoal:
            self.critiques[subgoal_id] = bucket[-self.max_critiques_per_subgoal :]

    def snapshot(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "plan": [s.to_dict() for s in self.plan],
            "current_index": self.current_index,
            "iteration": self.iteration,
            "max_iterations": self.max_iterations,
            "status": self.status,
            "history_len": len(self.history),
            "final_summary": self.final_summary,
            "final_answer": self.final_answer,
            "critiques": {k: list(v) for k, v in self.critiques.items()},
            "completed_since_alignment": self.completed_since_alignment,
            "persist_critiques_externally": self.persist_critiques_externally,
            "step_attempts": dict(self.step_attempts),
            "terminate_reason": self.terminate_reason,
        }

    def log_transition(
        self,
        agent: str,
        *,
        input_data: Any = None,
        output_data: Any = None,
        pass_fail: bool | None = None,
        note: str = "",
    ) -> dict[str, Any]:
        entry = {
            "agent": agent,
            "iteration": self.iteration,
            "step_id": self.current_step().id if self.current_step() else None,
            "input": input_data,
            "output": output_data,
            "pass": pass_fail,
            "note": note,
        }
        self.logs.append(entry)
        return entry
