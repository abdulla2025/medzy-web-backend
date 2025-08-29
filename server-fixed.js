import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';

// Import routes
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

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
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
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads
app.use('/uploads', express.static(uploadsDir));

// Connect to MongoDB
let dbConnected = false;
const connectDB = async () => {
  if (dbConnected) return;
  
  try {
    const mongoose = await import('mongoose');
    await mongoose.default.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
    dbConnected = true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    // Don't throw error, let routes handle database issues
  }
};

// Initialize database connection
connectDB();

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Medsy Backend Server is running!', 
    timestamp: new Date(),
    dbConnected,
    env: process.env.NODE_ENV
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Medsy Backend API - Welcome!',
    version: '1.0.0',
    endpoints: ['/api/health', '/api/auth', '/api/medicines', '/api/orders']
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Export for Vercel
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Access your app at: http://localhost:${PORT}`);
  });
}
