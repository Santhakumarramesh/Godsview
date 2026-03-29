# Godsview Brain Schema

This document defines the persistent memory layer for the Godsview AI Trading Brain.

## Tables

## `brain_entities`

Represents a tradable entity (stock, crypto pair, index, macro signal source).

- `symbol`: canonical key (e.g. `AAPL`, `BTCUSD`)
- `entity_type`: default `stock`
- `name`, `sector`, `regime`
- `volatility`, `last_price`
- `state_json`: serialized snapshot state
- `created_at`, `updated_at`

## `brain_relations`

Represents relationship edges between entities.

- `source_entity_id`
- `target_entity_id`
- `relation_type` (examples: `correlates_with`, `macro_exposed_to`, `sector_peer`)
- `strength` (0.0000–1.0000)
- `context_json`
- `created_at`

## `brain_memories`

Represents memory entries linked to one entity.

- `entity_id`
- `memory_type` (examples: `episodic`, `semantic`, `trade`, `reasoning`)
- `title`, `content`
- `signal_id`, `trade_id` (optional linkage)
- `confidence`
- `outcome_score`
- `tags`
- `context_json`
- `created_at`

## API Endpoints

All routes are mounted under `/api`.

- `GET /brain/entities`
  - Query: `symbol`, `entity_type`, `limit`
- `POST /brain/entities`
  - Upsert entity by `symbol`.
- `POST /brain/relations`
  - Create entity-to-entity relation.
- `POST /brain/memories`
  - Append memory for an entity symbol.
- `GET /brain/:symbol/memories`
  - Query: `type`, `limit`
- `GET /brain/:symbol/context`
  - Query: `memory_limit`, `relation_limit`
  - Returns entity + recent memories + linked relations.

## Design Intent

- Keep write path deterministic and auditable.
- Store context-rich memory for post-trade learning loops.
- Enable graph-style reasoning without introducing a separate graph database in v1.
