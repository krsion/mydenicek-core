# ADR-0001: No Application Gateway, Bastion, or VPN Gateway

**Status:** Accepted | **Date:** 2025-05

## Context

These services each cost >$130/month, which would push the sandbox budget well above $50/month.

## Options

1. Deploy App Gateway + Bastion + VPN Gateway for "production realism"
2. Skip deployment; cover conceptually in RUNBOOK.md and theory sections

## Decision

Option 2. All three are covered conceptually. For SSH access, `az ssh vm` + Defender JIT is used. Standard LB provides public ingress.

## Consequences

The sandbox is not fully production-representative for network edge services. However, all AZ-104 exam objectives for these services are covered through theory exercises.
