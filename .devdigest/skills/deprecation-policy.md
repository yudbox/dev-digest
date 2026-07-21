# Deprecation Policy

Never silently remove a public API element. Always deprecate first, then remove in a future major version.

**Correct cycle:** v1.x → Add @deprecated JSDoc + runtime warning log → v2.0 → Remove

**Flag as WARNING if the diff:**
- Removes an endpoint without a prior @deprecated marker in the codebase
- Removes a field without documenting the removal in CHANGELOG
- Deletes a route handler without a redirect or 410 Gone response

**Good pattern:**
```ts
/** @deprecated Use /v2/users instead. Scheduled for removal in v3.0. */
app.get('/v1/users', deprecationMiddleware('/v2/users'), handler);
```