import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();

// Basic middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Medsy Backend API - Production Ready!',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      medicines: '/api/medicines/*',
      orders: '/api/orders/*',
      payments: '/api/payments/*'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Medsy Backend Server is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// Test database endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const connected = await connectDB();
    if (connected) {
      // Test a simple query
      const collections = await mongoose.connection.db.listCollections().toArray();
      res.json({ 
        message: 'Database connection successful!',
        status: 'connected',
        collections: collections.map(c => c.name),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ 
        error: 'Database connection failed',
        status: 'disconnected'
      });
    }
  } catch (error) {
    res.status(500).json({ 
      error: 'Database test failed',
      message: error.message,
      status: 'error'
    });
  }
});

// Basic auth test route (without importing auth routes yet)
app.post('/api/auth/test', async (req, res) => {
  try {
    await connectDB();
    res.json({ 
      message: 'Auth endpoint working!',
      received: req.body,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Auth test failed',
      message: error.message
    });
  }
});

// Basic medicine test route
app.get('/api/medicines/test', async (req, res) => {
  try {
    await connectDB();
    res.json({ 
      message: 'Medicines endpoint working!',
      sample: [
        { id: 1, name: 'Paracetamol', price: 10 },
        { id: 2, name: 'Aspirin', price: 15 }
      ],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Medicines test failed',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Export for Vercel
export default app;
