# ADR-0008: Exclude AZ-204 / AZ-305 Services from Scope

**Status:** Accepted | **Date:** 2025-05

## Context

Azure Functions, Logic Apps, API Management, Event Hub, Service Bus, and Cosmos DB are frequently used Azure services but belong to the AZ-204 (developer) and AZ-305 (architect) exam syllabi, not AZ-104.

## Options

1. Include for completeness — broader Azure coverage but scope creep; budget pressure
2. Exclude explicitly — clean scope boundary; focus on AZ-104 objectives

## Decision

Exclude all AZ-204/AZ-305 services. The deployment uses only AZ-104-relevant services.

## Consequences

Some services familiar to developers (Functions, Event Hub) are absent. This is documented in the out-of-scope section of the design doc. Future work may introduce them when preparing for AZ-204.
