import express from 'express';
import cors from 'cors';

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Medsy Backend API - Simple Version!',
    status: 'working',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Health check passed!',
    server: 'running',
    timestamp: new Date().toISOString(),
    env_vars: {
      node_env: process.env.NODE_ENV,
      has_mongodb_uri: !!process.env.MONGODB_URI,
      has_jwt_secret: !!process.env.JWT_SECRET
    }
  });
});

// Test database connection separately
app.get('/api/test-db', async (req, res) => {
  try {
    const mongoose = await import('mongoose');
    
    if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: 'MONGODB_URI not found' });
    }
    
    await mongoose.default.connect(process.env.MONGODB_URI);
    res.json({ 
      message: 'Database connected successfully!',
      status: 'connected'
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Database connection failed',
      message: error.message 
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Export for Vercel
export default app;
