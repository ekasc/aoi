ID: AUTH-001
Severity: CRITICAL
Category: Session security
Affected area: POST /v1/auth/refresh
Root cause: Refresh token rotation doesn't detect theft. When an already-rotated token is presented, the code returns "session not found" instead of revoking all sessions for that user.
Failure: Attacker who steals a refresh token can use it once. If they use it before the legitimate user, the legitimate user gets locked out silently. If the legitimate user uses it first, the attacker gets "session revoked" but no sessions are cleaned up.
Fix: When an already-revoked session is detected during refresh, revoke all sessions for the user.
Tests: Integration test needed
Pattern search: All session revocation paths
Status: OPEN

ID: AUTH-002
Severity: HIGH
Category: CSRF / OAuth security
Affected area: POST /v1/auth/oauth/start + /v1/auth/oauth/callback
Root cause: The `state` parameter is generated and returned but never stored or validated. The callback accepts any state string.
Failure: CSRF on OAuth callback — attacker can initiate OAuth flow and trick user into completing it with attacker's code.
Fix: Store state in oauth_states table, validate and consume on callback.
Tests: Integration test
Pattern search: All OAuth callback flows
Status: OPEN

ID: DATA-001
Severity: HIGH
Category: Input validation
Affected area: GET /v1/spaces/current/moments (cursor parameter), GET /v1/spaces/current/calendar/events (from/to)
Root cause: Cursor/from/to parameters are strings with no date format validation. `new Date('invalid')` produces Invalid Date, causing SQL errors or unexpected query results.
Failure: Malformed date strings cause 500 errors or incorrect data exposure.
Fix: Validate with z.string().datetime() for cursor/from/to.
Tests: Unit test on validation
Pattern search: All endpoints accepting date strings
Status: OPEN

ID: AUTHZ-001
Severity: HIGH
Category: Authorization
Affected area: PATCH /v1/moments/:id, DELETE /v1/moments/:id, PATCH /v1/calendar/events/:id, DELETE /v1/calendar/events/:id
Root cause: Routes check user owns the resource but don't verify the user is still an active member of the space the resource belongs to.
Failure: A user who has left a space can still modify or delete their old moments and calendar events.
Fix: After finding the resource, verify the user's active space membership before allowing the operation.
Tests: Integration test needed
Pattern search: All resource-level authorization checks
Status: OPEN

ID: RATE-001
Severity: MEDIUM
Category: Rate limiting
Affected area: All auth endpoints, invite code join attempts
Root cause: No rate limiting implemented despite being called out in architecture doc.
Failure: Brute force on refresh tokens, invite codes, or auth endpoints.
Fix: Add rate limiting middleware.
Status: OPEN

ID: SIZE-001
Severity: MEDIUM
Category: Input validation
Affected area: POST /v1/spaces/current/moments (body field), POST /v1/spaces/current/calendar/events, POST /v1/spaces/current/imported-milestones
Root cause: Moment body has no max length constraint. Calendar event title max 500 but no size limit on request body overall.
Failure: Attacker could send multi-MB payloads causing OOM or slow DB writes.
Fix: Add max length to string fields and overall request size limits.
Status: OPEN
