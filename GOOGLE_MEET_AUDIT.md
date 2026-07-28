# Google Meet Integration Audit

Below is the complete audit of the Google Meet OAuth 2.0 implementation, identifying the root causes of the reported issues and other underlying problems.

## 1. ROUTES
❌ **Broken**
- **Mismatch**: The route in `backend/src/routes/google.routes.ts` is mounted as `router.get('/callback', ...)`, making the final URL `/api/google/callback`. However, the `.env` file is configured with `GOOGLE_REDIRECT_URI=http://localhost:5001/api/google/oauth/callback`. 
- **Impact**: This causes Issue 2 (`Cannot GET /api/google/oauth/callback`). Because the callback fails, the user cannot retrieve the tokens, which causes Issue 4 (No `GOOGLE_REFRESH_TOKEN`).

## 2. SERVER REGISTRATION
✅ **Working**
- `server.ts` and `app.ts` correctly import and mount all routes under `/api`. The `/google` prefix is correctly added in `index.ts`.

## 3. GOOGLE OAUTH
✅ **Working**
- `google.service.ts` properly implements `google.auth.OAuth2`, requests offline access (`access_type: 'offline'`), and forces consent (`prompt: 'consent'`) to ensure a refresh token is returned.

## 4. REDIRECT URI
❌ **Broken**
- `.env` points to `/oauth/callback`.
- `google.routes.ts` points to `/callback`.

## 5. ENVIRONMENT VARIABLES
❌ **Broken (Missing)**
- `GOOGLE_REFRESH_TOKEN` is entirely missing from `.env` (Issue 4). This happens because the OAuth flow could never complete due to the redirect URI mismatch.

## 6. CALLBACK IMPLEMENTATION
✅ **Working**
- The callback successfully extracts the `code` query parameter, exchanges it for tokens, and returns them.

## 7. REFRESH TOKEN
❌ **Broken**
- Why it's not generated: The OAuth consent screen redirects to the `GOOGLE_REDIRECT_URI` defined in Google Cloud/`.env`. Since this URI (`/api/google/oauth/callback`) does not exist on the Express server, the server returns a 404 error. The backend logic to exchange the code for the refresh token is never executed.

## 8. CALENDAR API
✅ **Working**
- `conferenceDataVersion: 1` is set.
- `requestId` uniqueness using `uuidv4()` is implemented properly.
- Meet URL extraction to `meetingCode` is correct.

## 9. SESSION SERVICE
❌ **Broken**
- **Error Handling**: `SessionService.updateSession` calls `GoogleService.updateMeetEvent` but does not wrap it in a `try/catch`. If Google API fails on update, the entire request crashes.
- **Mock Fallback Bug**: If `GOOGLE_REFRESH_TOKEN` is missing, `GoogleService` returns mock data. However, `session.service.ts` fails to save this data (causing Issue 1) because the database schema is outdated (see below).

## 10. EMAIL SERVICE
✅ **Working**
- Uses the provided `meetLink` dynamically. 

## 11 & 12. FRONTEND & API REQUESTS
✅ **Working**
- The frontend correctly sends the payload to `POST /api/sessions`. The "Internal Server Error" is originating entirely from the backend.

## 13. BACKEND LOGGING
⚠ **Missing**
- The catch block in `SessionService.createSession` simply logs a generic string (`Failed to integrate with Google Meet...`) and throws an `AppError`. It does not log the underlying `error.message` or `error.stack`, making debugging difficult. Same goes for `GoogleService`.

## 14. DATABASE & PRISMA
❌ **Broken**
- **Root Cause of Issue 1 (Internal Server Error)**: `backend/prisma/schema.prisma` is missing the `url` and `directUrl` properties in the `datasource db` block. Because of this, the command `npx prisma db push` failed/hung in the background and was never completed.
- Since Prisma Client was never updated to include the `meetingCode` column, when `SessionService.createSession` tries to insert `meetingCode` into the database, Prisma throws a `PrismaClientValidationError` (Unknown argument). This unhandled Prisma validation error bubbles up to the Express global error handler, which defaults to returning a 500 "Internal Server Error".

## 15. GOOGLE CLOUD
⚠ **Missing Verification**
- Since the redirect URI in `.env` (`/oauth/callback`) mismatched the backend, it's highly likely Google Cloud Console is also configured with `/oauth/callback`. We need to standardize on one URI.

---

# ERROR ANALYSIS SUMMARY

### Problem 1: Internal Server Error on Session Creation
- **Root Cause**: Prisma Client does not know about the `meetingCode` field because `prisma db push` failed.
- **Impact**: Server throws 500 on every session creation.
- **Fix**: Update `schema.prisma` to include `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`, then rerun `prisma db push`.

### Problem 2: Cannot GET /api/google/oauth/callback
- **Root Cause**: Route mismatch.
- **Impact**: OAuth flow cannot complete.
- **Fix**: Rename the route in `google.routes.ts` from `router.get('/callback', ...)` to `router.get('/oauth/callback', ...)`.

### Problem 3: No GOOGLE_REFRESH_TOKEN generated
- **Root Cause**: Consequence of Problem 2.

### Problem 4: Google Meet links are not being generated
- **Root Cause**: Consequence of Problem 3 (mock logic takes over) and Problem 1 (crashing on DB save).

---

# FIX PLAN

**Step 1: Fix Route Mismatch**
- **File**: `backend/src/routes/google.routes.ts`
- **Line**: 15
- **Reason**: Align the Express route with the `.env` `GOOGLE_REDIRECT_URI`.
- **Expected Outcome**: Navigating to `/api/google/oauth/callback` will successfully exchange the token.

**Step 2: Fix Prisma Configuration & Run Migration**
- **File**: `backend/prisma/schema.prisma`
- **Line**: 6
- **Reason**: Add `url` and `directUrl` so Prisma can connect to Supabase properly.
- **Expected Outcome**: `npx prisma db push` will complete successfully, updating the Prisma Client with `meetingCode`.

**Step 3: Improve Error Handling & Logging**
- **File**: `backend/src/services/session.service.ts`
- **Lines**: 57-61, 161-169
- **Reason**: Log the actual Google API errors. Wrap `updateMeetEvent` in a `try/catch` to prevent server crashes on update.
- **Expected Outcome**: Accurate logs in terminal; graceful degradation on update.

**Step 4: Improve GoogleService Error Throwing**
- **File**: `backend/src/services/google.service.ts`
- **Lines**: 107, 134
- **Reason**: When throwing an error, attach or log the original `error.message` from Google.
