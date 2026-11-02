# Relay design · Phase 1

## Problem and actors

An owner needs to capture leads on a website without developing a custom form integration. The product gives the owner one script tag. The customer's website is a separate browser origin. Visitors are untrusted and do not authenticate. Owners authenticate and can only access their own workspace. This design is written with the implementation; it is not evidence of an earlier design-phase commit.

## Data model

| Entity | Important fields | Integrity / indexes |
| --- | --- | --- |
| tenants | UUID, name, normalized unique email, salted password hash | Unique email |
| sessions | SHA-256 of random opaque token, tenant, expiry | Token PK; expiry index; FK cascade |
| widgets | UUID, tenant, type, title, description, fields JSON, color, active, targeting JSON | Tenant/time index; tenant FK |
| submissions | UUID, tenant, widget, field data JSON, optional geo JSON, consent text, source, status, created time | Tenant/time and widget/time indexes; unique widget/idempotency key; FK cascades |
| jobs | UUID, tenant, submission, status, attempts, next availability, generic last error | Unique submission; due-job index; FK cascade |
| audit_events | UUID, tenant, action, entity UUID, timestamp | Tenant/time index; no lead answers |
| schema_migrations | Version, applied timestamp | Monotonic numbered SQL files; transaction per version |

## Three API boundaries

**Owner:** register/login → HttpOnly session → tenant-scoped CRUD, snippets, analytics, leads, jobs, audit and SSE. Every private object operation includes both object ID and tenant ID. Another tenant receives 404. No wildcard CORS is granted to owner endpoints. Owner mutations with a browser Origin must match BASE_URL.

**Delivery:** a cached immutable versioned script fetches a small config with a 30-second TTL and ETag, checks targeting, and renders within a Shadow Root. Text uses DOM textContent or HTML escaping. One script tag is sufficient. No cookies are sent to public routes.

**Submission:** IP budget → bounded JSON parser → active widget lookup → schema validation and honeypot/consent → idempotency lookup → widget budget → geo fallback → second idempotency/active-state check → atomic lead/outbox transaction → 201 and owner SSE invalidation. A replay with matching data returns 200; conflicting reuse returns 409. Geo calls stay outside the write transaction. A notification outage has no effect on acceptance.

## Background work and recovery

A single-process timer reads due jobs, increments attempts before delivery, and marks success. Failure schedules exponential backoff; exhausted jobs become dead letters and emit a structured alert. The owner can retry dead letters. Startup resets interrupted running jobs to pending. Crashes can produce duplicate downstream delivery, so integrations must use the stable job UUID for deduplication. The atomic outbox prevents loss of delivery intent when the lead is stored.

## Decisions and explicit non-goals

Use Node 24's bundled SQLite and standard-library HTTP to make a zero-install local demo reproducible. Keep SQL in a repository, boundary rules in security helpers, providers in enrichment, and delivery lifecycle in a worker. SQL statements bind values; no owner input becomes SQL syntax.

Single-node deployment is an explicit non-goal boundary: this project does not promise distributed rate limits, multi-worker claiming, infinite analytics scale, production email, or managed hosting. The advanced work is resilience, tenancy, verification, and usability rather than adding dependencies without a demonstrated need.
