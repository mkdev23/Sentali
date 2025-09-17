---
title: "Golang secure coding: gosec and core patterns"
source: sentali
tags: [golang, gosec, secure-coding]
lastReviewed: 2025-09-11
---


# Golang secure coding: gosec and core patterns

## Summary
Use type safety, standard libs, and gosec to prevent common issues.

## Practices
- **Input validation:** Strong types; regex limits; size caps.
- **SQL:** `database/sql` with placeholders; avoid string concat.
- **HTTP:** `html/template` for auto-escaping; CSRF tokens for POST.
- **Crypto:** `crypto/rand` for secrets; `bcrypt` for passwords.
- **Filesystem:** Principle of least privilege; path sanitization.

## Example: parameterized SQL
```go
row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = $1", userID)
Tooling
gosec: gosec ./...

Staticcheck: staticcheck ./...

Why this is secure
Label: Eliminates injection vectors and enforces safe output encoding.