# accounts

**Owns:** `Account`, `Company`, `BankAccount`, `User`, `FeatureSwitch`. The spine every other module is scoped by.

**Routes:** `POST /api/accounts` (public, the set-up questions) · `GET /api/account` ·
`PATCH /api/companies/:id` · `POST /api/companies/:id/banks` · `GET /api/users` · `POST /api/users` ·
`POST /api/users/:id/suspend | reactivate | reinvite`.

**Events:** `account_created`, `company_updated`, `bank_added`, `user_invited`, `user_suspended`, `user_reactivated`.

**Rules:** exactly one MAIN company and one biller per account · a BRANCH shares its parent's book and banks ·
a GROUP needs a PARTNER and a hand-over stage · a company-bound role must name a company · nobody changes
their own access · a one-company user lists only their company (and its branches).

**Later slices add:** four-eyes on bank changes (Payments), feature-switch screen (owner portal).

**28 Oct 2026:** `GET /api/account` needs the `sub` screen and `GET /api/users` the `adm` screen (the MD); every
other role learns its own company from `/api/auth/me`. The reads of `/api/settings`, `/api/rates` (history) and
`/api/tip-reasons` need the `cfg` screen; `/api/rates/latest` and `/api/cost-categories` stay open to the roles that
enter costs; `/api/containers/check` is the booking side's.
