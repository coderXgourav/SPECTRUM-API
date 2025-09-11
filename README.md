# Spectrum358 Backend Server

This is the backend server for the Spectrum358 application, built with Node.js, Express, and Firebase.

## Features

- **Firebase Integration**: Full Firebase integration with Authentication, Firestore, and Storage
- **RESTful API**: Complete REST API for all application features
- **Authentication**: User registration, login, logout, and profile management
- **Ticket Management**: Create, update, delete, and manage support tickets
- **Package Management**: Manage subscription packages and pricing
- **Reports**: Generate analytics and summary reports
- **CORS Support**: Cross-origin resource sharing for frontend integration
- **Security**: Helmet.js for security headers and input validation

## Project Structure

```
server/
├── routes/
│   ├── auth.js          # Authentication routes
│   ├── tickets.js       # Ticket management routes
│   ├── packages.js      # Package management routes
│   └── reports.js       # Report generation routes
├── config/
│   └── firebase-admin-sdk.json  # Firebase Admin SDK (place your file here)
├── .env                 # Environment variables
├── package.json         # Dependencies and scripts
└── server.js           # Main server file
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Environment Configuration

Copy the `.env` file and update the values if needed:

```bash
# .env file is already created with your Firebase configuration
# You can modify the PORT or CLIENT_URL if needed
```

### 3. Firebase Admin SDK (Optional)

If you need admin operations, place your Firebase Admin SDK JSON file in the `config/` directory:

```bash
# Download from Firebase Console > Project Settings > Service Accounts
# Save as: config/firebase-admin-sdk.json
```

### 4. Start the Server

Development mode with auto-restart:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The server will start on `http://localhost:5000` by default.

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/profile/:uid` - Get user profile
- `PUT /api/auth/profile/:uid` - Update user profile
- `GET /api/auth/users` - Get all users (admin only)

### Tickets

- `GET /api/tickets` - Get all tickets
- `GET /api/tickets/:id` - Get ticket by ID
- `POST /api/tickets` - Create new ticket
- `PUT /api/tickets/:id` - Update ticket
- `DELETE /api/tickets/:id` - Delete ticket
- `GET /api/tickets/user/:userId` - Get tickets by user
- `POST /api/tickets/:id/comments` - Add comment to ticket

### Packages

- `GET /api/packages` - Get all packages
- `GET /api/packages/:id` - Get package by ID
- `POST /api/packages` - Create new package
- `PUT /api/packages/:id` - Update package
- `DELETE /api/packages/:id` - Delete package
- `GET /api/packages/active/list` - Get active packages only

### Reports

- `GET /api/reports` - Get all reports
- `GET /api/reports/:id` - Get report by ID
- `POST /api/reports` - Create new report
- `PUT /api/reports/:id` - Update report
- `DELETE /api/reports/:id` - Delete report
- `POST /api/reports/generate/user-analytics` - Generate user analytics
- `POST /api/reports/generate/ticket-summary` - Generate ticket summary

### System

- `GET /` - Server status and API information
- `GET /health` - Health check endpoint

## Firebase Configuration

The server is configured with your Firebase project:

- **Project ID**: spectrum358-b18c5
- **Auth Domain**: spectrum358-b18c5.firebaseapp.com
- **Storage Bucket**: spectrum358-b18c5.appspot.com

## Environment Variables

| Variable     | Default               | Description           |
| ------------ | --------------------- | --------------------- |
| `NODE_ENV`   | development           | Environment mode      |
| `PORT`       | 5000                  | Server port           |
| `CLIENT_URL` | http://localhost:5173 | Frontend URL for CORS |

## Frontend Integration

Install Firebase in your client:

```bash
cd client
npm install firebase
```

Use the API service in your React components:

```javascript
import { authService, ticketService } from "../services/api.js";

// Login example
const handleLogin = async (email, password) => {
  try {
    const response = await authService.login(email, password);
    console.log("Login successful:", response);
  } catch (error) {
    console.error("Login failed:", error.message);
  }
};
```

## Testing the API

You can test the API using curl, Postman, or any HTTP client:

```bash
# Test server status
curl http://localhost:5000/

# Test health check
curl http://localhost:5000/health

# Register a user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","displayName":"Test User"}'
```

## Security Features

- CORS protection with specific origin
- Helmet.js for security headers
- Input validation and sanitization
- Firebase security rules (configure in Firebase Console)
- Environment variable protection

## Monitoring and Logging

- Morgan for HTTP request logging
- Console error logging for debugging
- Health check endpoint for monitoring
- Process uptime and memory usage tracking

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Use a process manager like PM2
3. Set up SSL/HTTPS
4. Configure Firebase security rules
5. Set up monitoring and alerts

## Support

For questions or issues, please refer to the Firebase documentation or contact the development team.

## License

MIT License - see LICENSE file for details.
