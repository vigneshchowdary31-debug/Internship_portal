import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export class GoogleService {
  private static getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    if (!clientId || !clientSecret || !redirectUri) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL ERROR: Google OAuth credentials are not fully set in production environment.');
      }
      console.warn('⚠️ OAuth credentials not fully set. Meet generation might fail if not mocked.');
      return new google.auth.OAuth2(
        'mock-client-id',
        'mock-client-secret',
        redirectUri || 'https://mock-redirect-uri.local/callback'
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (refreshToken) {
      oauth2Client.setCredentials({ refresh_token: refreshToken });
    }

    return oauth2Client;
  }

  static getAuthUrl() {
    const oauth2Client = this.getOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent' // Forces refresh token generation
    });
  }

  static async getTokensFromCode(code: string) {
    const oauth2Client = this.getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  /**
   * Creates a Calendar event with a Google Meet link on the shared backend account.
   *
   * IMPORTANT — Meet host semantics on a personal (free) Gmail organizer account:
   * The account that creates the event is the ONLY Meet host. There is no public
   * Google API that can grant co-host / host-management rights to an attendee, and
   * co-host is a paid-edition entitlement that free personal accounts do not have
   * at all. See docs/google-meet-cohost-feasibility.md.
   *
   * What `attendeeEmails` DOES buy us: guests on the event's guest list join a
   * personal-account meeting directly instead of knocking and waiting to be
   * admitted. Since the shared backend account never joins the call, nobody would
   * be able to admit knockers — so everyone who needs to attend must be on this
   * list. This is the only supported lever available on free Google services.
   */
  static async createMeetEvent(
    title: string,
    description: string,
    startTime: Date,
    endTime: Date,
    rawStartTime?: string,
    attendeeEmails: string[] = []
  ) {
    const auth = this.getOAuthClient();
    
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      // Mocked response if refresh token is not set
      console.warn('⚠️ GOOGLE_REFRESH_TOKEN not set. Mocking Google Meet generation.');
      const mockCode = uuidv4().substring(0, 10);
      return {
        eventId: `mock-event-${uuidv4()}`,
        meetLink: `https://meet.google.com/mock-${mockCode}`,
        meetingCode: `mock-${mockCode}`,
      };
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const calendar = google.calendar({ version: 'v3', auth });

    const uniqueAttendees = [...new Set(
      attendeeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
    )];

    const event = {
      summary: title,
      description,
      start: {
        dateTime: startTime.toISOString(),
      },
      end: {
        dateTime: endTime.toISOString(),
      },
      attendees: uniqueAttendees.map((email) => ({ email })),
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
      conferenceData: {
        createRequest: {
          requestId: uuidv4(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    };

    console.log(`\n--- Google Calendar Event Payload ---`);
    console.log(`Input datetime from frontend: ${rawStartTime || 'N/A'}`);
    console.log(`Parsed backend datetime: ${startTime.toISOString()}`);
    console.log(`Event start.dateTime: ${event.start.dateTime}`);
    console.log(`Event end.dateTime: ${event.end.dateTime}`);
    console.log(`Guest list (join without knocking): ${uniqueAttendees.length} attendee(s)`);
    console.log(`-------------------------------------\n`);

    try {
      const insertPromise = calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: 1,
        // The app sends its own notification emails via the Gmail API, so suppress
        // Google's duplicate invitation email. Attendees on Google accounts still
        // get the event added to their Google Calendar.
        sendUpdates: 'none',
      });

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Google API Timeout after 10000ms')), 10000)
      );

      console.log('Sending request to Google Calendar API...');
      const response = await Promise.race([insertPromise, timeoutPromise]) as any;
      console.log('Received response from Google Calendar API');

      const meetLink = response.data.hangoutLink;
      let meetingCode = null;
      if (meetLink) {
        // Extract meeting code (e.g. from https://meet.google.com/abc-defg-hij)
        const parts = meetLink.split('/');
        meetingCode = parts[parts.length - 1];
      }

      return {
        eventId: response.data.id || null,
        meetLink: meetLink || null,
        meetingCode,
      };
    } catch (error: any) {
      console.error('Error creating Google Calendar event:', error.message, error.stack);
      throw new Error('Failed to create Google Meet event: ' + error.message);
    }
  }

  static async updateMeetEvent(eventId: string, title: string, description: string, startTime: Date, endTime: Date) {
    if (!process.env.GOOGLE_REFRESH_TOKEN) return true; // Mocked

    const auth = this.getOAuthClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const calendar = google.calendar({ version: 'v3', auth });
    
    const event = {
      summary: title,
      description,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
    };

    try {
      await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: event,
      });
      return true;
    } catch (error: any) {
      console.error('Error updating Google Calendar event:', error.message, error.stack);
      throw new Error('Failed to update Google Meet event: ' + error.message);
    }
  }

  static async deleteMeetEvent(eventId: string) {
    if (!process.env.GOOGLE_REFRESH_TOKEN) return true; // Mocked

    const auth = this.getOAuthClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const calendar = google.calendar({ version: 'v3', auth });
    
    try {
      await calendar.events.delete({
        calendarId,
        eventId,
      });
      return true;
    } catch (error) {
      console.error('Error deleting Google Calendar event:', error);
      return false;
    }
  }
}
