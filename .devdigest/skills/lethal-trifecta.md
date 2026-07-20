# Security: Lethal Trifecta

The "lethal trifecta" is when a single change touches all three of:
1. **Private data** — PII, credentials, financial data, internal IDs
2. **Untrusted input** — user-supplied query params, request body, headers, file uploads
3. **Exfiltration path** — HTTP response, log statement, file write, external API call

**Flag as CRITICAL** if the diff introduces or modifies code where all three elements are reachable in the same data-flow path.

**Examples:**
- Reading `req.body.userId` and returning it in an error message that includes DB row data
- Logging user input alongside internal system state
- Passing URL query params directly to an external HTTP call that returns sensitive data