# ADR-0009: Scheduled Nightly Teardown and Morning Spinup

**Status:** Accepted | **Date:** 2025-05

## Context

Running compute 24/7 costs ~$50/month. The sandbox is only used during study sessions (roughly 07:00–22:00 CEST on weekdays).

## Options

1. Always-on — ~$50/month; simplest operations
2. Manual teardown — error-prone; easy to forget; unpredictable cost
3. Scheduled teardown via GitHub Actions cron — automated; predictable

## Decision

Scheduled teardown at 20:00 UTC (22:00 CEST, summer) via `scheduled-teardown.yml`; spinup at 05:00 UTC (07:00 CEST) via `scheduled-spinup.yml`. Compute only — all storage persists across teardown.

**Winter adjustment (CET, UTC+1):** shift cron by +1h UTC (teardown `0 21 * * *`, spinup `0 6 * * *`).

## Consequences

~13h/day × 5 days/week running instead of 24/7, saving ~$30/month (~$21 vs ~$50). Teardown deallocates VMs (not delete) to preserve OS disk state.
