# Google Meet & Calendar OAuth 2.0 Implementation Guide

This document details the transition from a mock Google Meet implementation to a real integration with Google Calendar and Google Meet, utilizing OAuth 2.0. 

## 1. OAuth Flow
Instead of using a Service Account, this integration now uses OAuth 2.0. This means the application accesses Google APIs on behalf of a real user (usually an admin or the service owner) whose calendar will host the events.

1. **Authorization**: An admin navigates to `/api/google/auth`. This redirects them to Google's consent screen.
2. **Callback**: Once consented, Google redirects to `/api/google/callback` with an authorization code.
3. **Token Exchange**: The backend exchanges this code for access and refresh tokens. 
4. **Token Storage**: The `refresh_token` is printed on the screen. The admin copies this token into the server's `.env` file as `GOOGLE_REFRESH_TOKEN`.
5. **API Calls**: For any subsequent operation (creating, updating, deleting sessions), the application uses the refresh token to automatically acquire fresh access tokens and interact with the Google Calendar API.

## 2. Google Cloud Setup
To make this work, you must configure a Google Cloud project:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Navigate to **APIs & Services > Library** and enable the **Google Calendar API**.
4. Navigate to **APIs & Services > OAuth consent screen**. Choose "External" or "Internal" depending on your Google Workspace setup. Fill in the required details.
5. Navigate to **APIs & Services > Credentials**. Click **Create Credentials** -> **OAuth client ID**.
6. Select **Web application** as the application type.
7. Add your backend URL to **Authorized redirect URIs** (e.g., `http://localhost:3000/api/google/callback`).
8. Save and copy the generated **Client ID** and **Client Secret**.

## 3. Required Credentials & Environment Variables
Update your `.env` file with the following variables. *Do not hardcode any of these in the codebase!*

```env
GOOGLE_CLIENT_ID="your-client-id-from-gcp"
GOOGLE_CLIENT_SECRET="your-client-secret-from-gcp"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/callback"

# The refresh token obtained after going through the OAuth flow
GOOGLE_REFRESH_TOKEN="your-refresh-token"

# Optional: ID of the calendar to create events on. Defaults to 'primary' (the user's default calendar).
GOOGLE_CALENDAR_ID="primary" 
```

## 4. Backend Files Modified
The following backend files were updated to accomplish this integration:
- `backend/prisma/schema.prisma`: Added `meetingCode` to the `Session` model.
- `backend/src/services/google.service.ts`: Completely rewritten to use `google.auth.OAuth2` instead of `google.auth.JWT` (Service Account). Added functions to generate auth URLs and handle token exchange. Enabled `conferenceDataVersion: 1` in event creation to generate Meet links natively.
- `backend/src/services/session.service.ts`: Updated to store the newly generated `meetingCode` in the database, and modified calls to `EmailService` to include the batch name and instructor name in email templates.
- `backend/src/services/email.service.ts`: Updated templates for creation, update, and cancellation to parse and format `Batch` and `Instructor`.
- `backend/src/routes/google.routes.ts` (NEW): Contains the `/auth` and `/callback` endpoints.
- `backend/src/routes/index.ts`: Registered the new `/google` routes.

## 5. API Endpoints (New)
| Endpoint | Method | Description |
|---|---|---|
| `/api/google/auth` | GET | Redirects the user to the Google OAuth consent screen. |
| `/api/google/callback` | GET | Handles the OAuth callback, exchanges the code for tokens, and returns them. |

## 6. Database Changes
The `Session` table in the database was modified.
Added:
- `meetingCode` (`String?`): Stores the unique Meet meeting code (e.g., the last part of `https://meet.google.com/abc-defg-hij`).

*A database schema push (`npx prisma db push`) is required to sync this change to the database.*

## 7. Testing Steps & Final Verification
1. **OAuth Login**: Navigate to `/api/google/auth` via your browser. Accept the permissions.
2. **Refresh Token Generation**: Upon redirect to `/api/google/callback`, copy the `refresh_token` from the JSON response and place it in your `.env` under `GOOGLE_REFRESH_TOKEN`. Restart the server.
3. **Calendar Event Creation**: Create a new session via the admin/instructor portal. Verify in the database that `googleEventId`, `meetLink`, and `meetingCode` are correctly populated. 
4. **Google Meet Generation**: Verify that navigating to the generated `meetLink` actually opens a real Google Meet room. 
5. **Emails**: Check your email inbox. The email should now contain the exact Batch name, Instructor name, Date, Time, and the real Meet URL.
6. **Event Update**: Edit the session's time or title. Check your Google Calendar to verify the event reflects these updates without duplicating the event.
7. **Event Deletion**: Cancel the session. Check Google Calendar; the event should be deleted.
8. **Dashboards**: Instructor and Student dashboards should render the real Google Meet URL perfectly, reusing the existing UI. 

This implementation seamlessly integrates Google Meet directly into the existing Session Management workflow.
