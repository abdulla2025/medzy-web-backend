// Minimal server.js for debugging
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(cors());
app.use(express.json());

// Simple health check without database
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    message: 'Medsy Backend Server is running!', 
    timestamp: new Date(),
    env: process.env.NODE_ENV,
    port: PORT
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Medsy Backend API - Welcome!' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// For Vercel deployment
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
