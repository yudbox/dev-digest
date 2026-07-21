# Breaking Change Gate

Flag any diff that removes, renames, or changes the type of a public API element without a version bump.

**Flag as CRITICAL if the diff:**
- Removes a public endpoint without prior deprecation notice
- Renames a field in a request or response body
- Changes a field from optional to required
- Changes a field's type (string → number, array → object)
- Removes a query or path parameter

**Good — additive change (safe):**
```ts
type UserResponse = { id: string; name: string; email?: string }
```

**Bad — breaking removal:**
```ts
type UserResponse = { id: string }  // removed name and email
```

Cite file:line and explain what downstream callers will break.