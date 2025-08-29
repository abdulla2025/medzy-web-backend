import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import connectDB from './config/database.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import profileRoutes from './routes/profile.js';
import supportRoutes from './routes/support.js';
import medicineRoutes from './routes/medicines.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import medicineRequestRoutes from './routes/medicineRequests.js';
import dailyUpdateRoutes from './routes/dailyUpdates.js';
import donationRoutes from './routes/donations.js';
import reviewRoutes from './routes/reviews.js';
import serviceReviewRoutes from './routes/serviceReviews.js';
import paymentRoutes from './routes/payments.js';
import disputeRoutes from './routes/disputes.js';
import smartDoctorRoutes from './routes/smartDoctor.js';
import medicineReminderRoutes from './routes/medicineReminders.js';
import medicalProfileRoutes from './routes/medicalProfile.js';
import customerPointRoutes from './routes/customerPoints.js';
import revenueAdjustmentRoutes from './routes/revenueAdjustments.js';

// Load .env file from current backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Make upload middleware available globally
app.locals.upload = upload;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For SSL Commerce form data

// Connect to MongoDB
connectDB();

// Set global mongoose query timeout for all operations
import mongoose from 'mongoose';
mongoose.set('maxTimeMS', 8000); // 8 second global timeout for all queries

// Initialize email service
import './services/emailService.js';

// Initialize notification service (includes cron jobs)
import './services/notificationService.js';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/medicine-requests', medicineRequestRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/daily-updates', dailyUpdateRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/service-reviews', serviceReviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/smart-doctor', smartDoctorRoutes);
app.use('/api/medicine-reminders', medicineReminderRoutes);
app.use('/api/medical-profile', medicalProfileRoutes);
app.use('/api/customer-points', customerPointRoutes);
app.use('/api/revenue-adjustments', revenueAdjustmentRoutes);

// Enhanced health check with database diagnostics
app.get('/api/health', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    // Test a simple database query with timeout
    let dbTestResult = 'unknown';
    try {
      const testQuery = await mongoose.connection.db.admin().ping();
      dbTestResult = testQuery.ok === 1 ? 'responsive' : 'unresponsive';
    } catch (dbError) {
      dbTestResult = `error: ${dbError.message}`;
    }
    
    res.json({ 
      message: 'Medsy Backend Server is running!',
      status: 'healthy',
      timestamp: new Date(),
      database: dbStates[dbState] || 'unknown',
      databaseTest: dbTestResult,
      environment: process.env.NODE_ENV || 'development',
      version: '2.1.0',
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      routes_status: {
        auth: true,
        users: true,
        medicines: true,
        orders: true,
        payments: true,
        reviews: true,
        serviceReviews: true
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date()
    });
  }
});

// Enhanced server startup with port conflict handling
const startServer = async () => {
  try {
    const server = app.listen(PORT, () => {
      console.log(`[0] Server running on port ${PORT}`);
    });

    // Handle port already in use error
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`❌ Port ${PORT} is already in use. Please:`);
        console.log(`   1. Kill the process using port ${PORT}: netstat -ano | findstr :${PORT}`);
        console.log(`   2. Or change the PORT in .env file`);
        console.log(`   3. Or run: taskkill /F /PID <process_id>`);
        
        // Try to find an alternative port
        const alternativePort = PORT + 1;
        console.log(`🔄 Trying alternative port ${alternativePort}...`);
        
        const altServer = app.listen(alternativePort, () => {
          console.log(`[0] Server running on alternative port ${alternativePort}`);
          console.log(`🌐 Access your app at: http://localhost:${alternativePort}`);
        });

        altServer.on('error', (altError) => {
          if (altError.code === 'EADDRINUSE') {
            console.log(`❌ Port ${alternativePort} is also in use.`);
            console.log(`Please manually kill the processes or change the PORT in .env`);
            process.exit(1);
          } else {
            console.error('Server error:', altError);
            process.exit(1);
          }
        });
      } else {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        console.log('Process terminated');
      });
    });

    process.on('SIGINT', () => {
      console.log('\nSIGINT received. Shutting down gracefully...');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();