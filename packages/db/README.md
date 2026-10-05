# db

Persistence boundary for FitCoach.

Status: **boundary only**. The relational schema is deliberately deferred to
the next phase (docs/ARCHITECTURE.md, "Long-term data model"). No ORM, no
driver, no migrations are installed or configured yet.

When implemented, this package will expose narrow persistence ports over the
domain aggregates in `@fitcoach/domain`. Database-specific models must not
leak into the domain package, and application code must not depend on a
concrete database client.
