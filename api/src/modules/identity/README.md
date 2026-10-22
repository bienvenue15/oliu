# identity

**Owns:** sessions, one-time codes, set-password and reset links. (User rows belong to `accounts`.)

**Routes:** `POST /api/auth/login` → `{challengeId}`; `POST /api/auth/otp` → session cookie;
`POST /api/auth/logout`; `GET /api/auth/me`; `POST /api/auth/set-password`; `POST /api/auth/forgot`.

**Events written to the audit trail:** `login`, `login_refused`, `password_set`, `password_reset`,
`invited`, `reset_requested`.

**Depends on:** `lib/crypto` (argon2id, HMAC-signed cookie, sha256 for codes and tokens), `lib/mail`,
`@oliu/shared` for roles, menus and the home screen per role.

**Rules:** same error for wrong password and unknown e-mail · five tries per code, ten minutes ·
links work once, three days · suspending deletes sessions · nothing here reads another module's tables.
