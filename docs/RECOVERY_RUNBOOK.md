# QQURZ recovery runbook

Use this runbook only after identifying which environment and release is affected.

## 1. Stop promotion

Do not promote `develop -> staging` or `staging -> main` while an incident is open. Keep production and staging isolated.

## 2. Identify the release

Check `GET /_health` on the affected API. Record:

- environment
- release SHA
- current Worker version/deployment ID in Cloudflare
- current schema version from the operator/operations view

## 3. Frontend rollback

Run **Deploy QQURZ frontend environment** manually from the environment's required branch and provide the last known-good commit/tag in `source_ref`.

## 4. Worker rollback

If the database schema remains compatible, run **Roll back QQURZ API environment** with the previous known-good Worker version ID.

A Worker rollback changes code/config only. It does not reverse Durable Object storage mutations.

## 5. Data recovery

QQURZ Durable Object classes are required by the release check to use SQLite storage. Cloudflare SQLite Durable Objects provide point-in-time recovery for the previous 30 days.

Use PITR only after deciding exactly which Durable Object instance and recovery point are correct. Restoring one object's storage can make it inconsistent with other objects if a multi-object business operation already completed, especially payments, tournament settlement, ratings, or account state.

For money-related recovery:

1. Preserve provider webhook/event evidence.
2. Compare the immutable ledger/audit records with the provider state.
3. Prefer compensating/refund transactions over destructive ledger edits.
4. Never delete or rewrite append-only ledger/audit rows to make balances "look right".

## 6. Migration failure

If a release failed after a schema migration:

- do not automatically roll code back;
- verify the previous Worker understands the new schema first;
- if it does not, either deploy a forward fix or use a reviewed PITR recovery plan;
- reproduce the recovery on staging before production whenever possible.

## 7. Close the incident

After recovery, run the normal quality gates, mobile overlap audit, API health check, and staging promotion flow before resuming production releases.
