# Phase 1 — Auth & User Account

Status: **APPROVED**

---

## Goal

Implement email + password registration and login with JWT-based authentication.
Introduce the `users` table and a `refresh_tokens` table. Add a `verifyJwt` Express
middleware that protects downstream endpoints. Ship minimal frontend login and
register forms. All subsequent phases depend on this phase being in place.

No email verification in this phase — that is explicitly deferred.

---

## Scope

### IN

- `users` table (uuid PK, email, password_hash, created_at)
- `refresh_tokens` table (uuid PK, user_id FK, token_hash, expires_at, revoked_at)
- SQL migrations for both tables
- `POST /auth/register` — create account
- `POST /auth/login` — issue access + refresh tokens
- `POST /auth/refresh` — exchange refresh token for new access token
- `POST /auth/logout` — revoke refresh token
- `GET /auth/me` — return current user (protected)
- `verifyJwt` middleware in `/apps/api`
- bcrypt password hashing (cost factor 12)
- JWT access token (15 min expiry), refresh token (7 day expiry) stored in httpOnly cookie
- Frontend: `/register` and `/login` routes, minimal forms, JWT stored in memory (not localStorage)
- `JWT_SECRET` and `JWT_REFRESH_SECRET` in `.env` / `.env.example`
- Unit tests: hash/verify, JWT sign/verify
- Integration tests: register, login, duplicate email, wrong password, expired token, missing token

### OUT

- Email verification / confirmation flow
- Password reset / forgot password
- OAuth / social login
- Role-based access control (RBAC)
- Rate limiting on auth endpoints (noted as a future hardening step)
- Account deletion
- Session management UI

---

## Data model

```sql
-- Migration: 001_create_users.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- Migration: 002_create_refresh_tokens.sql
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);
```

Notes:
- Email is always stored lowercased (enforced in application layer before insert).
- `password_hash` stores the full bcrypt string (includes salt + cost factor).
- `refresh_tokens.token_hash` stores SHA-256 of the raw refresh token. The raw token is
  only ever sent over the wire; we never store it in plaintext.
- `revoked_at` is NULL for active tokens; set to NOW() on logout or rotation.

---

## API surface

| Method | Path             | Request body / params                          | Response 200                                              | Errors                                                                 |
|--------|------------------|------------------------------------------------|-----------------------------------------------------------|------------------------------------------------------------------------|
| POST   | /auth/register   | `{ email, password }`                          | `{ user: { id, email, created_at } }`                     | 400 missing fields; 409 email already registered; 422 invalid email fmt |
| POST   | /auth/login      | `{ email, password }`                          | `{ accessToken, user: { id, email } }` + Set-Cookie refresh | 400 missing fields; 401 wrong password; 404 email not found           |
| POST   | /auth/refresh    | (no body — reads httpOnly cookie `refreshToken`) | `{ accessToken }`                                        | 401 missing/invalid/expired/revoked cookie                             |
| POST   | /auth/logout     | (no body — reads httpOnly cookie)              | `{ message: "logged out" }`                               | 401 missing/invalid cookie (still clears cookie)                       |
| GET    | /auth/me         | Authorization: Bearer `<accessToken>`          | `{ user: { id, email, created_at } }`                     | 401 missing/invalid/expired token                                      |

Cookie details for refresh token:
- Name: `refreshToken`
- Flags: `HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh`
- Max-Age: 7 days (604800 seconds)

Access token payload:
```json
{ "sub": "<user_uuid>", "email": "<email>", "iat": 0, "exp": 0 }
```

---

## Frontend

### Routes

| Path        | Component       | Auth required? |
|-------------|-----------------|----------------|
| /register   | RegisterPage    | No             |
| /login      | LoginPage       | No             |
| /           | HomePage (stub) | Yes — redirect to /login if no token |

### Components

- `RegisterPage` — email + password + confirm-password fields; calls `POST /auth/register`
  then redirects to `/login` on success.
- `LoginPage` — email + password fields; calls `POST /auth/login`; stores `accessToken`
  in React context (in-memory, never localStorage); redirects to `/`.
- `AuthContext` — React context providing `{ user, accessToken, login, logout }`.
  `login()` stores the access token in memory. `logout()` calls `POST /auth/logout` then
  clears local state.
- `RequireAuth` — wrapper component; if no `accessToken` in context, redirects to `/login`.
- `apiClient` utility — thin fetch wrapper that injects `Authorization: Bearer <token>`
  header from `AuthContext` on every request.

### State

- Access token lives in `AuthContext` (React state / ref). It is lost on page refresh.
- On page load, `AuthContext` fires `POST /auth/refresh` automatically to restore the
  session from the httpOnly cookie (silent re-auth).
- No Redux. No localStorage for tokens.

---

## Algorithms

### Password hashing (bcrypt, cost 12)

```
function hashPassword(plaintext):
  return bcrypt.hash(plaintext, 12)   // async

function verifyPassword(plaintext, hash):
  return bcrypt.compare(plaintext, hash)  // async, returns bool
```

Cost factor 12 targets ~250ms on commodity hardware — acceptable for auth, meaningfully
slow for offline brute-force attacks.

### JWT sign / verify

```
ACCESS_TOKEN_TTL  = 15 * 60          // 900 seconds
REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 // 604800 seconds

function signAccessToken(user):
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256" }
  )

function signRefreshToken(user):
  rawToken = crypto.randomBytes(64).toString("hex")  // 128 hex chars, 256 bits entropy
  tokenHash = sha256(rawToken)
  expiresAt = NOW() + REFRESH_TOKEN_TTL
  // INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  return rawToken  // sent to client via cookie, never stored raw

function verifyAccessToken(token):
  try:
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })
    return { valid: true, payload }
  catch TokenExpiredError:
    return { valid: false, reason: "expired" }
  catch JsonWebTokenError:
    return { valid: false, reason: "invalid" }

function verifyRefreshToken(rawToken):
  tokenHash = sha256(rawToken)
  row = SELECT * FROM refresh_tokens WHERE token_hash = tokenHash
  if not row: return { valid: false, reason: "not found" }
  if row.revoked_at IS NOT NULL: return { valid: false, reason: "revoked" }
  if row.expires_at < NOW(): return { valid: false, reason: "expired" }
  return { valid: true, userId: row.user_id }
```

### verifyJwt middleware

```
function verifyJwt(req, res, next):
  header = req.headers["authorization"]
  if not header or not header.startsWith("Bearer "):
    return res.status(401).json({ error: "Missing token" })
  token = header.slice(7)
  result = verifyAccessToken(token)
  if not result.valid:
    return res.status(401).json({ error: result.reason })
  req.user = result.payload   // { sub, email }
  next()
```

### Registration flow

```
POST /auth/register:
  validate email format, password length >= 8
  normalizedEmail = email.toLowerCase().trim()
  existing = SELECT id FROM users WHERE email = normalizedEmail
  if existing: return 409
  hash = await hashPassword(password)
  INSERT INTO users (email, password_hash) VALUES (normalizedEmail, hash) RETURNING id, email, created_at
  return 201 { user }
```

### Login flow

```
POST /auth/login:
  normalizedEmail = email.toLowerCase().trim()
  user = SELECT * FROM users WHERE email = normalizedEmail
  if not user: return 401 (do NOT say "email not found" — say "invalid credentials")
  valid = await verifyPassword(password, user.password_hash)
  if not valid: return 401
  accessToken = signAccessToken(user)
  rawRefresh = await signRefreshToken(user)   // stores hash in DB
  Set-Cookie: refreshToken=rawRefresh; HttpOnly; Secure; SameSite=Strict; MaxAge=604800; Path=/auth/refresh
  return 200 { accessToken, user: { id, email } }
```

Note: returning 401 for "email not found" AND "wrong password" (not 404) prevents user
enumeration.

---

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| Email already registered | 409 Conflict with `{ error: "Email already in use" }` |
| Password too short (< 8 chars) | 422 Unprocessable with field-level error |
| Invalid email format | 422 Unprocessable with field-level error |
| Access token expired | 401 `{ error: "expired" }` — client auto-retries via `/auth/refresh` |
| Refresh token already revoked | 401 `{ error: "revoked" }` — force re-login |
| Refresh token not in DB (tampered) | 401 `{ error: "not found" }` |
| DB down during login | 500 — let the error propagate through Express error handler |
| Concurrent refresh requests with same token | Token is revoked after first use (rotation); second request gets 401 |
| JWT_SECRET not set | Process should fail at startup with a clear error — check on boot |
| Very long email/password input | Truncate or 422 at > 320 chars (email) / > 1000 chars (password) to prevent bcrypt DoS (bcrypt silently truncates at 72 bytes — log a warning if input exceeds 72 bytes) |
| HTTPS not enforced in dev | `Secure` cookie flag only set when `NODE_ENV=production`; dev uses HTTP |

---

## Test plan

### Unit tests (`packages/core` or `apps/api/src/__tests__/`)

| Test | Assertion |
|------|-----------|
| `hashPassword` returns a bcrypt string | string starts with `$2b$12$` |
| `verifyPassword` correct password returns true | result === true |
| `verifyPassword` wrong password returns false | result === false |
| `signAccessToken` produces a verifiable JWT | `jwt.verify` succeeds, payload has `sub` and `email` |
| `verifyAccessToken` with expired token returns `{ valid: false, reason: "expired" }` | exact shape |
| `verifyAccessToken` with tampered token returns `{ valid: false, reason: "invalid" }` | exact shape |
| `verifyAccessToken` with valid token returns payload | `payload.sub` matches |

### Integration tests (against `macroracle_test` DB)

| Test | Steps | Assertion |
|------|-------|-----------|
| Register — happy path | POST /auth/register with valid email+password | 201, body has `user.id` (UUID), `user.email` lowercased |
| Register — duplicate email | Register same email twice | Second call returns 409 |
| Register — invalid email | POST with `"notanemail"` | 422 |
| Register — short password | POST with password `"abc"` | 422 |
| Login — happy path | Register then login | 200, body has `accessToken`, cookie `refreshToken` is set |
| Login — wrong password | Register then login with wrong password | 401 |
| Login — unknown email | POST /auth/login with unregistered email | 401 (not 404) |
| GET /auth/me — valid token | Login, use accessToken in Authorization header | 200, body has correct user |
| GET /auth/me — missing token | No Authorization header | 401 |
| GET /auth/me — expired token | Manually craft an expired JWT | 401 |
| POST /auth/refresh — valid cookie | Login, call /auth/refresh with cookie | 200, new accessToken issued |
| POST /auth/refresh — no cookie | Call /auth/refresh with no cookie | 401 |
| POST /auth/refresh — revoked token | Login, logout, then refresh with same cookie | 401 |
| POST /auth/logout | Login, logout | 200, cookie cleared |

---

## Migration / rollback

### Forward

Run in order:
1. `001_create_users.sql` — creates `users` table and index
2. `002_create_refresh_tokens.sql` — creates `refresh_tokens` table and indexes

The migration runner (built in Phase 0) records each file in `schema_migrations` and
skips already-applied migrations.

### Rollback

```sql
-- rollback 002
DROP TABLE IF EXISTS refresh_tokens;

-- rollback 001
DROP TABLE IF EXISTS users;
```

No data loss concern at this phase — the tables are new. If rolling back in production
(future), all user sessions are invalidated and all accounts are lost; coordinate with
the team before running.

---

## Open questions

1. **Token rotation on refresh**: should we implement refresh token rotation (revoke old,
   issue new) on every `/auth/refresh` call? Rotation prevents replay of stolen refresh
   tokens but adds complexity. Leaning yes — mark as required before shipping.

2. **bcrypt 72-byte truncation**: passwords longer than 72 bytes are silently truncated by
   bcrypt. Should we pre-hash with SHA-256 before bcrypt (prehash pattern) to support
   passphrases? Low priority for v1 but worth noting.

3. **Rate limiting**: `/auth/register` and `/auth/login` are brute-force targets. Should
   we add `express-rate-limit` now or defer? Deferring creates a window of risk. Recommend
   adding basic rate limiting (e.g., 10 req/15min per IP) in this phase.

4. **`Secure` cookie flag in dev**: running over HTTP locally means the `Secure` flag
   prevents the cookie from being sent. Plan: set `Secure` only when
   `NODE_ENV === "production"`. Confirm this is acceptable.

5. **CORS configuration**: the React dev server runs on a different origin than the API.
   We need to configure `cors()` with `credentials: true` and the correct `origin`. What
   is the expected dev origin? (`http://localhost:5173` from Vite default — confirm.)
