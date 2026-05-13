# ADR-0007: Auth Behind a Feature Flag

**Status:** Accepted | **Date:** 2025-05

## Context

The existing mydenicek demo works without any authentication (loginless mode). Adding Entra auth must not break this. A hard requirement (N6) is that `AUTH_ENABLED=false` preserves all existing behavior.

## Options

1. Hard-enforce auth — breaks existing loginless demo and all existing tests
2. Feature flag via `AUTH_ENABLED` env var — two code paths, default off
3. Separate auth branch — diverges indefinitely; merge pain

## Decision

Feature flag. `AUTH_ENABLED=false` (default) skips all auth middleware. `AUTH_ENABLED=true` enables Entra JWT validation and ACL enforcement.

## Consequences

Two code paths to maintain in sync, docs-api, and acl services. Tests use stub auth (`AUTH_ENABLED=false`). Auth-specific integration tests run only against the Azure environment.
