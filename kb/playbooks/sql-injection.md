---
title: SQL Injection mitigation playbook
source: sentali
tags: [playbook, sqli, injection, database]
lastReviewed: 2025-09-11
---

# SQL Injection mitigation playbook

## Symptoms
- **Label:** Dynamic SQL built from user input, errors leaking query details.

## Prevent
- **Parameterized queries/ORM binds**
- **Least-privileged DB accounts**
- **Input validation (length/type/whitelist)**
- **Error handling without leaking internals**

## Detect
- **WAF rules for injection patterns**
- **DB logs: unusual statements; tautology patterns**

## Example (Node/pg)
```ts
await client.query("SELECT * FROM users WHERE email = $1", [email]);
