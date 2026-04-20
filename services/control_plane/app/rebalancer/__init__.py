"""Phase 7 portfolio rebalancer — plan synthesis + FSM helpers.

The rebalancer sits between Phase 6 allocation targets
(``AllocationPlanRow.target_percent``) and the Phase 4 execution bus.
Entry points:

  * :func:`synthesize_plan` — read allocation targets + current
    positions, decide which (strategy, symbol) legs need to move,
    and return a structured ``PlanDraft`` ready for persistence.
  * :func:`warnings_for_plan` — translate the draft into the
    ``RebalancePlanWarningSchema`` envelope the wire uses.
  * :func:`plan_to_row` / :func:`draft_to_intent_rows` — persistence
    mappers used by the HTTP route + the cron.

Plan synthesis is deterministic given (allocation rows, positions,
equity) so the cron + operator-manual paths share one implementation.
"""

from app.rebalancer.planner import (
    PlanDraft,
    PlanIntent,
    PlanWarning,
    draft_to_intent_rows,
    plan_to_row,
    synthesize_plan,
    warnings_for_plan,
)

__all__ = [
    "PlanDraft",
    "PlanIntent",
    "PlanWarning",
    "draft_to_intent_rows",
    "plan_to_row",
    "synthesize_plan",
    "warnings_for_plan",
]
