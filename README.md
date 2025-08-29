# Medzy Backend API

A comprehensive Node.js/Express backend for the Medzy healthcare platform.

## Features

- User Authentication & Authorization
- Medicine Management & Search
- Order Processing & Tracking
- Payment Gateway Integration (bKash, SSLCommerz, Stripe)
- Medicine Donation System
- AI-Powered Smart Doctor
- Medicine Reminder System
- Reviews & Rating System
- Real-time Notifications
- Customer Support System

## Quick Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/abdulla2025/medzy-web-backend)

## Environment Variables

The following environment variables need to be configured in Vercel:

### Database
- `MONGODB_URI` - MongoDB connection string
- `NODE_ENV` - Set to "production"

### JWT
- `JWT_SECRET` - Secret key for JWT token generation

### Payment Gateways
- `BKASH_BASE_URL` - bKash API base URL
- `BKASH_APP_KEY` - bKash app key
- `BKASH_APP_SECRET` - bKash app secret
- `BKASH_USERNAME` - bKash username
- `BKASH_PASSWORD` - bKash password
- `SSLCOMMERZ_STORE_ID` - SSLCommerz store ID
- `SSLCOMMERZ_STORE_PASSWORD` - SSLCommerz store password
- `SSLCOMMERZ_IS_LIVE` - Set to "false" for sandbox, "true" for production

### URLs
- `FRONTEND_URL` - Your frontend URL (e.g., https://your-frontend.vercel.app)
- `BACKEND_URL` - Your backend URL (e.g., https://your-backend.vercel.app)

### Email Service (Optional)
- `EMAIL_USER` - Email service username
- `EMAIL_PASS` - Email service password

## API Endpoints

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/signin` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Medicines
- `GET /api/medicines` - Get all medicines
- `POST /api/medicines` - Add new medicine (admin only)
- `GET /api/medicines/search` - Search medicines

### Orders
- `GET /api/orders` - Get user orders
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id` - Update order status

### Payments
- `POST /api/payments/bkash/create` - Create bKash payment
- `POST /api/payments/sslcommerz/create` - Create SSLCommerz payment

### And many more...

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your values
4. Start the development server: `npm run dev`

## Production Deployment

This backend is optimized for Vercel deployment with serverless functions.

## Tech Stack

- Node.js
- Express.js
- MongoDB with Mongoose
- JWT Authentication
- Multer for file uploads
- Various payment gateway integrations
- Tesseract.js for OCR
- Node-cron for scheduled tasks
│   └── vite.config.js # Vite configuration
├── backend/           # Node.js/Express backend API
│   ├── config/        # Database configuration
│   ├── middleware/    # Custom middleware
│   ├── models/        # MongoDB models
│   ├── routes/        # API routes
│   ├── services/      # Business logic services
│   ├── uploads/       # File upload directory
│   ├── server.js      # Main server file
│   └── package.json   # Backend dependencies
└── package.json       # Root package.json for scripts

```

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- MongoDB
- NPM or Yarn

### Installation

1. Install dependencies for both frontend and backend:
   ```bash
   npm run install-deps
   ```

2. Set up environment variables:
   - Copy `backend/.env.example` to `backend/.env`
   - Update the environment variables as needed

### Development

To start both frontend and backend in development mode:
```bash
npm run dev
```

To start individual services:
- Frontend only: `npm run client`
- Backend only: `npm run server`

### Production Build

To build the frontend for production:
```bash
npm run build
```

To start in production mode:
```bash
npm start
```

## API Endpoints

The backend API runs on `http://localhost:5000` by default and provides endpoints for:
- Authentication (`/api/auth`)
- User management (`/api/users`)
- Medicine management (`/api/medicines`)
- Orders (`/api/orders`)
- Payments (`/api/payments`)
- And more...

## Frontend

The React frontend runs on `http://localhost:5173` by default and includes:
- User authentication
- Medicine browsing and searching
- Shopping cart functionality
- Order management
- Admin dashboard
- And more features...
