import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import commissionRoutes from './routes/commissions.js';
import paymentRoutes from './routes/payments.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/comeeti';

let isInitialized = false;

export async function initApp() {
  if (isInitialized) return;

  try {
    // Connect to MongoDB (cold start on Vercel, once on local)
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected successfully');

    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/commissions', commissionRoutes);
    app.use('/api/payments', paymentRoutes);

    // Health check
    app.get('/api/health', (req, res) => {
      res.json({ status: 'OK', message: 'Server is running' });
    });

    // Handle MongoDB connection errors
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
    });

    isInitialized = true;
  } catch (error) {
    console.error('❌ Error initializing app:', error);
    // Avoid killing the process on Vercel; throw so the function can respond with 500
    throw error;
  }
}

// Local development server (not used on Vercel)
async function startLocalServer() {
  try {
    await initApp();

    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ API available at http://localhost:${PORT}/api`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please stop the other process or use a different port.`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('❌ Error starting local server:', error);
    process.exit(1);
  }
}

// Only start the HTTP server when running locally
if (!process.env.VERCEL) {
  startLocalServer();
}

// Export the Express app for Vercel Serverless Functions
export default app;
