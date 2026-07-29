# Student Training Portal

A full-stack, production-ready training portal for managing students, instructors, batches, and tech stacks. Features include role-based access, attendance tracking, progress monitoring, and automated Google Meet integration for online sessions.

## 🏗 Architecture & Tech Stack

**Frontend:**
- React (Vite)
- TypeScript
- TailwindCSS & Shadcn UI
- TanStack Query (React Query)
- React Router

**Backend:**
- Node.js & Express
- Prisma ORM
- PostgreSQL (Supabase)
- JSON Web Tokens (JWT)
- Google Calendar API & Google Meet Integration
- Nodemailer (SMTP)

## ✨ Features
- **Role-Based Dashboards:** Distinct views for ADMIN, INSTRUCTOR, and STUDENT.
- **Batch & Tech Stack Management:** Create technology stacks and group students into learning batches.
- **Session Scheduling:** Admins and Instructors can schedule classes.
- **Google Meet Integration:** Automatically creates Calendar events and Meet links for sessions using OAuth 2.0.
- **Attendance & Progress Tracking:** Instructors can mark attendance and track individual student proficiency.
- **Email Notifications:** Automated SMTP notifications for scheduled, updated, or cancelled sessions.
- **Production Ready Security:** Helmet, CORS restrictions, Rate Limiting, and robust error handling.

## 🚀 Installation & Setup

1. **Clone the repository:**
   \`\`\`bash
   git clone <repo-url>
   cd "Internship Portal"
   \`\`\`

2. **Install Dependencies:**
   \`\`\`bash
   # Backend
   cd backend
   npm install

   # Frontend
   cd ../frontend
   npm install
   \`\`\`

3. **Environment Variables:**
   - Copy `backend/.env.example` to `backend/.env` and fill in the required database, SMTP, and Google OAuth credentials.
   - Copy `frontend/.env.example` to `frontend/.env` and configure `VITE_API_URL`.

4. **Database Setup:**
   \`\`\`bash
   cd backend
   npx prisma generate
   npx prisma db push
   # Optional: Seed the database
   npm run prisma:seed
   \`\`\`

## 🏃 Running Locally

Run both frontend and backend development servers concurrently or in separate terminals:

**Backend:**
\`\`\`bash
cd backend
npm run dev
\`\`\`

**Frontend:**
\`\`\`bash
cd frontend
npm run dev
\`\`\`

## 🌍 Deployment

### Backend (Render)
1. Fork or clone this repository and connect it to your Render account.
2. Create a new **Web Service** on Render and point it to the `backend` folder.
3. Configure the **Build Command** to: `npm install && npx prisma generate && npm run build`
4. Configure the **Start Command** to: `npm run start`
5. Populate all the Environment Variables using the `.env.example` as a template.

### Frontend (Vercel)
1. In Vercel, create a new Project and point it to the `frontend` folder.
2. The `vercel.json` and Vite framework preset will automatically configure the build and SPA routing.
3. Set your `VITE_API_URL` to point to the newly deployed Render backend URL (e.g., `https://my-backend.onrender.com/api`).

### Database (Supabase)
Supabase provides a powerful managed PostgreSQL database. Ensure you use the `pgbouncer=true` connection pooler URL for `DATABASE_URL` and the standard direct connection string for `DIRECT_URL`.

## 🔐 Google OAuth Setup
1. Create a project in Google Cloud Console.
2. Enable **Google Calendar API**.
3. Configure OAuth Consent Screen.
4. Create **OAuth Client ID** (Web application).
5. Set Authorized Redirect URI to match your backend (`https://your-render-app-url.onrender.com/api/google/oauth/callback`).
6. Generate a Refresh Token using the Google OAuth Playground and place it in the `.env` file along with Client ID and Secret.

## ✉️ SMTP Setup
Ensure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` (App Password for Gmail) are configured in the backend `.env` for email functionality.
