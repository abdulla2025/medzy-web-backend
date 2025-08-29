import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';

// Import routes one by one to isolate any issues
let authRoutes, userRoutes, medicineRoutes, orderRoutes, paymentRoutes, reviewRoutes, serviceReviewRoutes;

try {
  const modules = await Promise.all([
    import('./routes/auth.js'),
    import('./routes/users.js'),
    import('./routes/medicines.js'),
    import('./routes/orders.js'),
    import('./routes/payments.js'),
    import('./routes/reviews.js'),
    import('./routes/serviceReviews.js')
  ]);
  
  [authRoutes, userRoutes, medicineRoutes, orderRoutes, paymentRoutes, reviewRoutes, serviceReviewRoutes] = modules.map(m => m.default);
} catch (error) {
  console.error('Error importing routes:', error);
  // Routes will be undefined, we'll handle this gracefully
}

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection state
let dbConnected = false;

// Connect to MongoDB
const connectDB = async () => {
  if (dbConnected) return true;
  
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
    dbConnected = true;
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    return false;
  }
};

// Initialize database connection
connectDB();

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (err) {
    console.log('Note: Could not create uploads directory on serverless environment');
  }
}

// Configure multer
const storage = multer.memoryStorage(); // Use memory storage for serverless
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

app.locals.upload = upload;

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://medzy-web.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Root route
app.get('/', (req, res) => {
  const routeStatus = {
    auth: !!authRoutes,
    users: !!userRoutes,
    medicines: !!medicineRoutes,
    orders: !!orderRoutes,
    payments: !!paymentRoutes,
    reviews: !!reviewRoutes,
    serviceReviews: !!serviceReviewRoutes
  };

  res.json({ 
    message: 'Medsy Backend API - Full Production!',
    version: '2.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    routes_loaded: routeStatus,
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      medicines: '/api/medicines/*',
      orders: '/api/orders/*',
      payments: '/api/payments/*',
      reviews: '/api/reviews/*',
      serviceReviews: '/api/service-reviews/*'
    }
  });
});

// Health check
app.get('/api/health', async (req, res) => {
  const dbStatus = await connectDB();
  
  res.json({ 
    message: 'Medsy Backend Server is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: dbStatus ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV,
    version: '2.1.0',
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    routes_status: {
      auth: !!authRoutes,
      users: !!userRoutes,
      medicines: !!medicineRoutes,
      orders: !!orderRoutes,
      payments: !!paymentRoutes,
      reviews: !!reviewRoutes,
      serviceReviews: !!serviceReviewRoutes
    }
  });
});

// Debug endpoint for route testing
app.get('/api/debug/routes', (req, res) => {
  res.json({
    message: 'Route debugging information',
    routes_loaded: {
      auth: !!authRoutes,
      users: !!userRoutes,
      medicines: !!medicineRoutes,
      orders: !!orderRoutes,
      payments: !!paymentRoutes,
      reviews: !!reviewRoutes,
      serviceReviews: !!serviceReviewRoutes
    },
    env_vars: {
      JWT_SECRET: !!process.env.JWT_SECRET,
      MONGODB_URI: !!process.env.MONGODB_URI,
      FRONTEND_URL: process.env.FRONTEND_URL,
      NODE_ENV: process.env.NODE_ENV
    }
  });
});

// Add routes if they loaded successfully
if (authRoutes) {
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} else {
  app.get('/api/auth/status', (req, res) => {
    res.status(503).json({ error: 'Auth routes not available' });
  });
}

if (userRoutes) {
  app.use('/api/users', userRoutes);
  console.log('✅ User routes loaded');
}

if (medicineRoutes) {
  app.use('/api/medicines', medicineRoutes);
  console.log('✅ Medicine routes loaded');
} else {
  // Fallback medicine route
  app.get('/api/medicines', async (req, res) => {
    try {
      await connectDB();
      res.json({ 
        message: 'Medicine endpoint working (fallback)',
        medicines: [],
        note: 'Full medicine routes not loaded'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

if (orderRoutes) {
  app.use('/api/orders', orderRoutes);
  console.log('✅ Order routes loaded');
}

if (paymentRoutes) {
  app.use('/api/payments', paymentRoutes);
  console.log('✅ Payment routes loaded');
}

// Add review routes
if (reviewRoutes) {
  app.use('/api/reviews', reviewRoutes);
  console.log('✅ Review routes loaded');
}

if (serviceReviewRoutes) {
  app.use('/api/service-reviews', serviceReviewRoutes);
  console.log('✅ Service review routes loaded');
}

// Debug endpoint to test data availability
app.get('/api/debug/data-check', async (req, res) => {
  try {
    await connectDB();
    
    const Medicine = (await import('./models/Medicine.js')).default;
    const Review = (await import('./models/Review.js')).default;
    const User = (await import('./models/User.js')).default;
    
    const medicineCount = await Medicine.countDocuments({ isActive: true });
    const reviewCount = await Review.countDocuments({});
    const userCount = await User.countDocuments({});
    
    // Get sample data
    const sampleMedicines = await Medicine.find({ isActive: true }).limit(3);
    const sampleReviews = await Review.find({}).populate('user', 'firstName lastName').limit(3);
    
    res.json({
      message: 'Data availability check',
      counts: {
        medicines: medicineCount,
        reviews: reviewCount,
        users: userCount
      },
      samples: {
        medicines: sampleMedicines,
        reviews: sampleReviews
      },
      database_connected: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Data check error:', error);
    res.status(500).json({ 
      error: 'Database connection or data access issue',
      message: error.message,
      database_connected: false
    });
  }
});

// Fallback test routes for missing modules
app.get('/api/test/auth', (req, res) => {
  res.json({ message: 'Auth test endpoint working', routes_loaded: !!authRoutes });
});

app.get('/api/test/medicines', (req, res) => {
  res.json({ 
    message: 'Medicine test endpoint working', 
    routes_loaded: !!medicineRoutes,
    sample_medicines: [
      { id: 1, name: 'Paracetamol', price: 10 },
      { id: 2, name: 'Aspirin', price: 15 }
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    available_endpoints: [
      '/',
      '/api/health',
      '/api/auth/*',
      '/api/medicines/*',
      '/api/orders/*',
      '/api/payments/*'
    ]
  });
});

// Export for Vercel
export default app;
