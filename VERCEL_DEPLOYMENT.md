# Vercel Deployment Guide

This document outlines how to deploy the Student Training Portal frontend to Vercel.

## Prerequisites
1. A Vercel account.
2. The GitHub repository linked to your Vercel account.
3. A deployed backend URL (e.g., from Render).

## Deployment Steps
1. In the Vercel Dashboard, click **Add New** -> **Project**.
2. Select your GitHub repository.
3. Configure the following project settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

## Environment Variables
Expand the Environment Variables section and add the following:

```text
VITE_API_URL=https://<your-render-app-url>.onrender.com/api
```

## Routing Configuration
The `vercel.json` file in the `frontend` directory automatically configures SPA (Single Page Application) routing so that direct links to routes like `/admin/students` resolve to `index.html` instead of returning 404 errors. No manual configuration is required in the Vercel dashboard.

## Validation
Once deployed, navigate to your Vercel URL and confirm that the application correctly loads the Login page and communicates with the backend without CORS errors.
