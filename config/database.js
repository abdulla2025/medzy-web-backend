import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file from current backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectDB = async () => {
  try {
    // Set global mongoose options for better timeout handling
    mongoose.set('bufferCommands', false);
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Connection timeout options for production
      serverSelectionTimeoutMS: 10000, // 10 seconds (reduced from 30)
      socketTimeoutMS: 20000, // 20 seconds (reduced from 45)
      connectTimeoutMS: 10000, // 10 seconds
      maxPoolSize: 5, // Reduced from 10 to 5 for better resource management
      minPoolSize: 2,  // Reduced from 5 to 2
      maxIdleTimeMS: 15000, // Reduced from 30 to 15 seconds
      // Retry options
      retryWrites: true,
      retryReads: true,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('❌ MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

    mongoose.connection.on('timeout', () => {
      console.error('❌ MongoDB connection timeout');
    });

    // Handle app termination
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

export default connectDB;