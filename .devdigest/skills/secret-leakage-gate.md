# Security: Secret Leakage Gate

**Critical check:** Scan the diff for hardcoded secrets.

Flag as CRITICAL if the diff contains:
- API keys (patterns: `sk_live_`, `pk_live_`, `AKIA`, `ghp_`, `ghs_`)
- Passwords or tokens in string literals assigned to variables named `password`, `secret`, `token`, `key`, `credential`
- Private keys (PEM headers: `-----BEGIN RSA PRIVATE KEY-----`)
- Database connection strings with embedded credentials
- JWT secrets hardcoded in source

**Action:** If found, mark severity CRITICAL and suggest moving to environment variable or secrets manager.