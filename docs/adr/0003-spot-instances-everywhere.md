# ADR-0003: Spot Instances for All VMs and VMSS

**Status:** Accepted | **Date:** 2025-05

## Context

Cost optimisation is a hard requirement (N1: ≤ $50/month 24/7). Compute is the largest cost driver.

## Options

1. On-demand — full price, no eviction risk
2. Reserved (1-year) — ~40% discount, upfront commitment
3. Spot — ~70% discount, eviction risk

## Decision

Spot with `evictionPolicy: Deallocate` (not `Delete`) so OS disk state survives eviction.

## Consequences

Services must tolerate eviction. Mitigated by the CRDT's event-log persistence to Blob Storage — no data is lost on eviction. Demos require awareness of potential respawn latency.
