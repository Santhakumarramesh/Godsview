"""Phase 6 — Portfolio Intelligence module.

Public surface:

  * :mod:`app.portfolio.correlation`  — symbol_id → CorrelationClass map
  * :mod:`app.portfolio.exposure`     — per-account exposure aggregator
  * :mod:`app.portfolio.allocation`   — allocation plan builder + updater
  * :mod:`app.portfolio.pnl`          — daily PnL timeseries + summary
  * :mod:`app.portfolio.dto`          — Pydantic wire DTOs

The portfolio layer is read-biased: it projects Phase 4 state
(``positions``, ``live_trades``, ``account_equity_snapshots``) into
operator-friendly shapes. The single mutation surface is
:func:`app.portfolio.allocation.set_allocation` which persists a row in
the ``allocation_plans`` table.
"""
