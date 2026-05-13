# ADR-0006: Managed Identities Exclusively

**Status:** Accepted | **Date:** 2025-05

## Context

Service-to-Azure-resource authentication. Options range from static secrets to certificate-based service principals to managed identities.

## Options

1. Shared secrets / connection strings — simple but secret rotation burden; secrets leak risk
2. Service principals with certificates — more secure but certificate lifecycle overhead
3. Managed identities — no secrets to manage; Azure handles rotation automatically

## Decision

Managed identities exclusively. No account keys, no connection strings, no secrets in code or environment variables. All RBAC assignments declared in Bicep.

## Consequences

Requires Azure RBAC role assignments for every MI → resource pair in Bicep. Local development uses `DefaultAzureCredential` which falls back to `az login` credentials transparently.
