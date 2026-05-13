# ADR-0004: Five Services Instead of a Monolith

**Status:** Accepted | **Date:** 2025-05

## Context

The AZ-104 syllabus requires hands-on experience with VMSS, App Service, VMs, and ACI. A monolith on a single compute type would cover only one.

## Options

1. Monolith on a single App Service — simplest, least AZ-104 coverage
2. Microservices (many small services) — over-engineered for this scale
3. Five-service split (sync, docs-api, acl, attachments, shared) — one compute type per AZ-104 domain

## Decision

Five services: sync on VMSS, docs-api on App Service, acl on VM, attachments on ACI, shared resources.

## Consequences

More complex networking (hub-spoke, private endpoints per service). Educational value justifies the overhead.
