# Firebase Admin SDK Setup Instructions

## Option 1: Quick Setup for Development (Recommended)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **spectrum358-b18c5**
3. Go to **Project Settings** (gear icon) → **Service Accounts**
4. Click **"Generate new private key"**
5. Download the JSON file and save it as `firebase-admin-sdk.json` in the `server/config/` folder
6. Uncomment the line in `.env`:
   ```
   FIREBASE_ADMIN_SDK_PATH=./config/firebase-admin-sdk.json
   ```

## Option 2: Environment Variables (For Production)

Extract the following from your downloaded service account JSON and add to `.env`:

```env
FIREBASE_PRIVATE_KEY_ID=your_private_key_id_from_json
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key_from_json\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@spectrum358-b18c5.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your_client_id_from_json
```

## What This Fixes

The Firebase Admin SDK bypasses Firestore security rules, allowing server-side operations like:

- Creating OTP documents for password reset
- Reading user data for validation
- Updating user passwords directly

## Security Rules Update (Optional)

Your current Firestore rules allow OTP creation with `allow create: if true;` which is correct.
The Admin SDK will bypass these rules entirely, providing more secure server-side access.

## Testing

After setup, restart your server and test the forgot password functionality.
The error "Missing or insufficient permissions" should be resolved.
