import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Required environment variables
const requiredEnvVars = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN', 
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'EMAIL_USER',
  'EMAIL_PASS'
];

// Optional environment variables (with defaults)
const optionalEnvVars = [
  { name: 'NODE_ENV', default: 'development' },
  { name: 'PORT', default: '5000' },
  { name: 'CLIENT_URL', default: 'http://localhost:5173' },
  { name: 'FRONTEND_URL', default: 'http://localhost:5173' },
  { name: 'FIREBASE_MEASUREMENT_ID', default: '' },
  { name: 'JWT_SECRET', default: 'your_jwt_secret_here' }
];

console.log('🔍 Validating environment variables...\n');

// Check required variables
const missingRequired = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingRequired.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingRequired.forEach(envVar => console.error(`   - ${envVar}`));
  console.error('\nPlease add these to your .env file\n');
  process.exit(1);
} else {
  console.log('✅ All required environment variables are present');
}

// Check optional variables and set defaults
optionalEnvVars.forEach(({ name, default: defaultValue }) => {
  if (!process.env[name]) {
    process.env[name] = defaultValue;
    console.log(`⚠️  ${name} not set, using default: ${defaultValue}`);
  } else {
    console.log(`✅ ${name}: ${process.env[name]}`);
  }
});

console.log('\n🎉 Environment validation complete!');