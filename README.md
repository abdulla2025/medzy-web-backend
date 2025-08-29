# Medzy - Medicine Management System

## Project Structure

```
project/
├── frontend/           # React.js frontend application
│   ├── src/           # Source code
│   ├── public/        # Static files
│   ├── package.json   # Frontend dependencies
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
