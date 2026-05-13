# ADR-0005: Azure Table Storage Over SQL or Cosmos DB

**Status:** Accepted | **Date:** 2025-05

## Context

Persistent state for docs metadata, ACL entries, and peer keys. Need a cost-appropriate store that covers AZ-104 storage objectives.

## Options

1. Azure SQL (B1) — ~$5/month; full SQL, ACID
2. Cosmos DB (serverless) — ~$25/month; global distribution, ACID
3. Azure Table Storage — $0.045/GB; key-value, no ACID across tables

## Decision

Azure Table Storage. Cheapest option; covers AZ-104 storage syllabus; sufficient for key-value access patterns used by the CRDT backend.

## Consequences

No complex queries, no joins, no cross-table ACID transactions. All read patterns are point lookups (partitionKey + rowKey) which Table Storage handles efficiently.
