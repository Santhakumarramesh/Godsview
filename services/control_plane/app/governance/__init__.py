"""Governance surface — approvals, policies, anomalies, trust tiers.

The governance layer sits above every privileged mutation in GodsView:

  operator action ──► GovernanceApprovalRequest
                         │
                         ├──► ApprovalPolicy lookup (tier × action)
                         │
                         ├──► required approvers resolved
                         │
                         └──► approval decisions audit-logged

  AnomalyDetector ──► AnomalyAlert ──► operator acknowledgement

This package holds:

  * :mod:`app.governance.tiers`   — TrustTier ordering helpers.
  * :mod:`app.governance.dto`     — Pydantic v2 wire mirror.
  * :mod:`app.governance.policy`  — policy CRUD + bootstrap defaults.
  * :mod:`app.governance.approvals` — request + decide + withdraw logic.
  * :mod:`app.governance.anomaly` — list + ack + resolve logic.
  * :mod:`app.governance.trust`   — trust registry read + assign.
"""

from __future__ import annotations

__all__: list[str] = []
