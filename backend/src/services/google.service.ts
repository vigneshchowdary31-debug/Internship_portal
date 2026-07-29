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

  static async createMeetEvent(title: string, description: string, startTime: Date, endTime: Date) {
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

    const event = {
      summary: title,
      description,
      start: {
        dateTime: startTime.toISOString(),
      },
      end: {
        dateTime: endTime.toISOString(),
      },
      conferenceData: {
        createRequest: {
          requestId: uuidv4(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: 1,
      });

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
