# Environment Variables Setup Guide

This guide explains how to set up environment variables for the Spectrum358 backend server.

## Required Environment Variables

The following environment variables are **required** and must be set in your `.env` file:

### Firebase Configuration
```env
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

### Email Configuration
```env
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

## Optional Environment Variables

These variables have default values but can be customized:

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
FIREBASE_MEASUREMENT_ID=your_measurement_id
JWT_SECRET=your_jwt_secret_here
```

## Firebase Admin SDK Configuration

For production deployment, you can use environment variables instead of the service account file:

```env
FIREBASE_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your_service_account@your_project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your_client_id
```

## Setup Instructions

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your actual values in the `.env` file

3. Validate your environment variables:
   ```bash
   npm run validate-env
   ```

4. Start the server:
   ```bash
   npm run dev
   ```

## Security Notes

- Never commit your `.env` file to version control
- Use strong, unique values for JWT_SECRET
- For Gmail, use App Passwords instead of your regular password
- In production, consider using a secrets management service

## Troubleshooting

If you encounter environment variable errors:

1. Run the validation script: `npm run validate-env`
2. Check that all required variables are set
3. Ensure there are no extra spaces or quotes around values
4. Verify Firebase project settings match your configuration