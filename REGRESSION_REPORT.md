# Regression Audit Report

## Issue Summary
The user reported the following regression after the Google Meet OAuth integration:
1. Students page remains stuck on "Loading students..."
2. Instructors page displays "No users found."
3. Adding new Students does not work.
4. Adding new Instructors does not work.

## Investigation Details
I conducted a full regression audit spanning the backend API, the frontend React Query configuration, and the Prisma Database. 

### 1. API Endpoints (Backend)
- Tested `GET /api/users?role=STUDENT` directly on the running backend: **Returns 200 OK** with 3 students.
- Tested `GET /api/users?role=INSTRUCTOR` directly on the backend: **Returns 200 OK** with 1 instructor.
- Tested `POST /api/users` directly on the backend: **Returns 201 Created** successfully creating the user.
- **Result:** The backend code, Prisma Client, and Database are 100% healthy and functioning correctly. The schema changes made during the Google Meet integration did NOT break any users API.

### 2. Frontend Application (Vite + React Query)
- Investigated `api.ts` (Axios configuration) and React Query usage in `StudentsManagement.tsx` and `InstructorsManagement.tsx`.
- The frontend `axios` instance intercepts requests to attach the JWT token from `localStorage`, but **it lacks a response interceptor to handle `401 Unauthorized` errors.**

### 3. Root Cause Analysis
The issue is **NOT** a regression from the Google Meet code. It is an **expired JWT token** combined with a lack of global error handling on the frontend. 

Here is exactly what happened:
1. The JWT token is configured to expire in 1 day (`JWT_EXPIRES_IN = '1d'`). The token generated yesterday during testing has now expired.
2. Because the token is expired, the backend correctly rejects all API requests (GET, POST, PATCH) with a `401 Unauthorized` response.
3. **"Students page stuck on Loading":** React Query sees the 401 error and automatically retries the failing request 3 times with exponential backoff (which takes ~7 seconds). During this time, the UI says "Loading students...".
4. **"Instructors page displays No users found":** Once the retries are exhausted, React Query sets the data to the fallback default `data: instructors = []`. The empty array triggers the `UserTable` to render "No users found."
5. **"Adding users does not work":** The `useMutation` for `POST /users` fails with a 401, but because there is no `onError` handler attached, the UI fails silently and the dialog stays open.
6. The user was never redirected to the login page because the frontend doesn't handle 401 errors globally.

## Recommended Fix Plan
### Priority: High | Risk: Low
1. **Frontend `api.ts`**: Add an Axios response interceptor that globally catches `401 Unauthorized` errors. If a 401 is encountered, it should automatically clear `localStorage` and redirect the user to the login screen.
2. **Frontend Mutations**: Optionally add global or localized `onError` handlers to mutations (like `createMutation`) so that API failures display a toast notification instead of failing silently.
3. **Immediate Action for User**: Log out and log back in to generate a fresh JWT token.
