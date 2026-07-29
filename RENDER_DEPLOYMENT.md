# Render Deployment Guide

This document outlines how to deploy the Student Training Portal backend to Render.

## Prerequisites
1. A Render account.
2. The GitHub repository linked to your Render account.
3. A provisioned Supabase PostgreSQL database.

## Deployment Steps
1. Create a new **Web Service** on Render.
2. Connect your GitHub repository.
3. Configure the following settings:
   - **Root Directory:** `backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install && npx prisma generate && npm run build`
   - **Start Command:** `npm run start`

## Environment Variables
In the Render dashboard, navigate to the **Environment** tab and add the following variables. (Do not wrap values in quotes in Render UI):

```text
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://user:password@host:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://user:password@host:5432/postgres
JWT_SECRET=your-secure-random-string
JWT_EXPIRES_IN=1d
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://<your-render-app-url>.onrender.com/api/google/oauth/callback
GOOGLE_REFRESH_TOKEN=your-refresh-token
GOOGLE_CALENDAR_ID=primary
CORS_ORIGIN=https://<your-vercel-app-url>.vercel.app
```

*Note: Replace placeholders with your actual production URLs once Vercel and Render services are created.*

## Health Check Configuration
To ensure zero-downtime deployments, configure the Health Check endpoint in Render's Advanced Settings:
- **Health Check Path:** `/api/health`

## Validation
Once deployed, navigate to `https://<your-render-app-url>.onrender.com/api/health` to confirm the backend is successfully running.
