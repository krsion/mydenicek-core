# ADR-0002: Standard Load Balancer for Public Ingress

**Status:** Accepted | **Date:** 2025-05

## Context

Need public ingress for sync VMSS and acl VM. Options exist at very different price points.

## Options

1. Application Gateway v2 — ~$130/month; L7 WAF, URL routing
2. Standard LB — ~$18/month (free if rules ≤ 5); L4 only
3. Direct public IP per instance — no LB, no HA

## Decision

Standard LB. Meets requirements and is cost-appropriate for a learning sandbox.

## Consequences

No L7 features (WAF, URL-based routing). App Gateway is covered conceptually in RUNBOOK.md.
