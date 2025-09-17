---
title: "JS/TS secure coding: ESLint security rules + Node patterns"
source: sentali
tags: [javascript, typescript, eslint, node, secure-coding]
lastReviewed: 2025-09-11
---

# JS/TS secure coding: ESLint security rules + Node patterns

## Summary
ESLint security plugins and Node hardening patterns to reduce common risks.

## Lint baseline
```js
// .eslintrc.cjs
module.exports = {
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:security/recommended-legacy"],
  plugins: ["@typescript-eslint","security"],
  rules: { "security/detect-object-injection": "warn" }
};
Patterns
No eval/new Function: Use safe parsers.

Template rendering: Encode output; avoid innerHTML with untrusted data.

Crypto: Use crypto.randomBytes; avoid Math.random for secrets.

Child processes: Avoid non-literal commands; prefer whitelisted args.

HTTP: Set security headers (CSP, HSTS), cookie flags (HttpOnly, Secure, SameSite).

Example: safe HTML
ts
res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'");
res.send(escapeHtml(userInput));
Why this is secure
Label: Reduces XSS and code injection via enforced encoding and CSP.