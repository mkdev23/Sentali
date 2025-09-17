---
title: "Python secure coding: PEP 8 + Bandit practices"
source: sentali
tags: [python, pep8, bandit, secure-coding, lint]
lastReviewed: 2025-09-11
---

# Python secure coding: PEP 8 + Bandit practices

## Summary
Style consistency (PEP 8) improves reviewability; Bandit flags common security pitfalls.

## Core practices
- **Inputs/outputs:** Validate and encode; never `eval` user input.
- **Secrets:** Use env/Key Vault; never hardcode.
- **SQL:** Use parameterized queries/ORM binds.
- **Crypto:** Use `hashlib`, `hmac`, `secrets`, `bcrypt/argon2`; avoid MD5/SHA1 for security.
- **Requests:** Timeouts, allowlists, cert validation.

## Bandit config snippet
```toml
# pyproject.toml
[tool.bandit]
targets = ["."]
skips = ["B101"] # assert used intentionally in tests
Example: parameterized query
python
cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
Why this is secure
Label: Minimizes injection risks and enforces least privilege at the query layer.