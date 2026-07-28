import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

// In a real application, you would load these credentials securely (e.g., from a JSON file or environment variables).
// We use a dummy setup for the MVP if variables aren't provided, allowing the code to compile.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export class GoogleService {
  private static getAuthClient() {
    const credentialsStr = process.env.GOOGLE_CREDENTIALS;
    if (!credentialsStr) {
      console.warn('⚠️ GOOGLE_CREDENTIALS env variable is not set. Google Meet generation will be mocked.');
      return null;
    }
    try {
      const credentials = JSON.parse(credentialsStr);
      return new google.auth.JWT(
        credentials.client_email,
        undefined,
        credentials.private_key,
        SCOPES
      );
    } catch (error) {
      console.error('Failed to parse Google credentials', error);
      return null;
    }
  }

  static async createMeetEvent(title: string, description: string, startTime: Date, endTime: Date) {
    const auth = this.getAuthClient();
    
    if (!auth) {
      // Return a mocked event if credentials aren't set
      return {
        eventId: `mock-event-${uuidv4()}`,
        meetLink: `https://meet.google.com/mock-${uuidv4().substring(0, 10)}`,
      };
    }

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
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: 1, // crucial for generating the meet link
      });

      return {
        eventId: response.data.id,
        meetLink: response.data.hangoutLink,
      };
    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      throw new Error('Failed to create Google Meet event');
    }
  }

  static async updateMeetEvent(eventId: string, title: string, description: string, startTime: Date, endTime: Date) {
    const auth = this.getAuthClient();
    if (!auth) return true; // Mocked

    const calendar = google.calendar({ version: 'v3', auth });
    
    const event = {
      summary: title,
      description,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
    };

    try {
      await calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: event,
      });
      return true;
    } catch (error) {
      console.error('Error updating Google Calendar event:', error);
      throw new Error('Failed to update Google Meet event');
    }
  }

  static async deleteMeetEvent(eventId: string) {
    const auth = this.getAuthClient();
    if (!auth) return true; // Mocked

    const calendar = google.calendar({ version: 'v3', auth });
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
      return true;
    } catch (error) {
      console.error('Error deleting Google Calendar event:', error);
      return false;
    }
  }
}
