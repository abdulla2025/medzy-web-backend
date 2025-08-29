import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, generateVerificationCode } from '../services/emailService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'medsy_secret_key_2024';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes (more reasonable for UX)

// Generate JWT token with session ID
const generateToken = (user, sessionId) => {
  return jwt.sign(
    { 
      id: user._id, 
      email: user.email, 
      role: user.role,
      emailVerified: user.emailVerified,
      sessionId: sessionId
    },
    JWT_SECRET,
    { expiresIn: '24h' } // 24 hours instead of 7 days (more secure)
  );
};

// Generate unique session ID
const generateSessionId = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Get session timeout based on user role and options
const getSessionTimeout = (user, options = {}) => {
  if (options.rememberMe) {
    return SESSION_TIMEOUTS.REMEMBER_ME;
  }
  
  if (user.role === 'admin') {
    return SESSION_TIMEOUTS.ADMIN_SESSION;
  }
  
  if (options.isMobile) {
    return SESSION_TIMEOUTS.MOBILE_SESSION;
  }
  
  return SESSION_TIMEOUTS.MAX_SESSION;
};

// Check if session is expired
const isSessionExpired = (user, sessionType = 'regular') => {
  if (!user.activeSession || !user.activeSession.lastActivity) {
    return true;
  }
  
  const now = Date.now();
  const lastActivity = new Date(user.activeSession.lastActivity).getTime();
  const loginTime = new Date(user.activeSession.loginTime).getTime();
  
  // Check inactivity timeout
  const inactivityTimeout = sessionType === 'admin' ? SESSION_TIMEOUTS.ADMIN_SESSION : SESSION_TIMEOUTS.INACTIVITY;
  const timeSinceLastActivity = now - lastActivity;
  
  if (timeSinceLastActivity > inactivityTimeout) {
    return true; // Session expired due to inactivity
  }
  
  // Check maximum session duration
  const maxSessionTimeout = getSessionTimeout(user, { rememberMe: user.activeSession.rememberMe });
  const timeSinceLogin = now - loginTime;
  
  if (timeSinceLogin > maxSessionTimeout) {
    return true; // Session expired due to maximum duration
  }
  
  return false;
};

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { email, phone, password, dateOfBirth, gender, firstName, lastName, role = 'customer' } = req.body;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });
    
    if (existingUser) {
      if (existingUser.emailVerified) {
        return res.status(400).json({ message: 'User already exists with this email or phone' });
      } else {
        // User exists but email not verified, update verification code and resend
        const verificationCode = generateVerificationCode();
        const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        existingUser.verificationCode = verificationCode;
        existingUser.verificationCodeExpires = verificationExpires;
        await existingUser.save();

        // Send verification email
        const emailResult = await sendVerificationEmail(email, verificationCode, existingUser.firstName);
        
        if (!emailResult.success) {
          console.error('Failed to send verification email:', emailResult.error);
          return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
        }

        return res.status(200).json({
          message: 'Account exists but not verified. New verification code sent to your email.',
          user: {
            id: existingUser._id,
            email: existingUser.email,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            role: existingUser.role,
            emailVerified: false
          },
          requiresVerification: true
        });
      }
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create new user (but not verified yet)
    const newUser = new User({
      email,
      phone,
      password,
      dateOfBirth,
      gender,
      firstName,
      lastName,
      role,
      isActive: true,
      emailVerified: false,
      verificationCode,
      verificationCodeExpires: verificationExpires
    });

    await newUser.save();

    // Send verification email
    const emailResult = await sendVerificationEmail(email, verificationCode, firstName);
    
    if (!emailResult.success) {
      console.error('Failed to send verification email:', emailResult.error);
      // Delete the user if email fails to send
      await User.findByIdAndDelete(newUser._id);
      return res.status(500).json({ message: 'Failed to send verification email. Please try again with a valid email address.' });
    }

    res.status(201).json({
      message: 'Account created successfully! Please check your email for verification code.',
      user: {
        id: newUser._id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        emailVerified: false
      },
      requiresVerification: true
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Sign in with automatic device switching
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const userAgent = req.headers['user-agent'] || 'Unknown Device';
    const clientIP = req.ip || req.connection.remoteAddress || 'Unknown IP';

    const user = await User.findOne({ email }).maxTimeMS(5000);
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Compare hashed password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(400).json({ message: 'Account has been deactivated' });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(403).json({ 
        message: 'Please verify your email address before signing in.',
        error: 'EMAIL_NOT_VERIFIED',
        userId: user._id
      });
    }

    // Automatic device switching: If user has existing session, log them out from old device
    let wasLoggedInElsewhere = false;
    if (user.activeSession && user.activeSession.sessionId) {
      // Check if the existing session is still valid (within last 24 hours)
      const sessionAge = Date.now() - new Date(user.activeSession.lastActivity).getTime();
      const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours

      if (sessionAge < maxSessionAge) {
        wasLoggedInElsewhere = true;
        console.log(`User ${email} switching devices: Old device (${user.activeSession.deviceInfo}) -> New device (${userAgent})`);
      }
    }

    // Generate new session (this automatically invalidates the old session)
    const sessionId = generateSessionId();
    const currentTime = new Date();

    // Update user with new session info (this will terminate any old session)
    user.activeSession = {
      sessionId: sessionId,
      deviceInfo: userAgent,
      lastActivity: currentTime,
      loginTime: currentTime,
      clientIP: clientIP
    };
    await user.save();

    const token = generateToken(user, sessionId);

    const responseMessage = wasLoggedInElsewhere 
      ? 'Login successful. You have been logged out from your previous device.'
      : 'Login successful';

    res.json({
      message: responseMessage,
      token,
      sessionId,
      wasLoggedInElsewhere,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('Sign in error:', error);
    
    // Handle specific timeout errors
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
      return res.status(503).json({ 
        message: 'Database temporarily unavailable', 
        error: 'Connection timeout' 
      });
    }
    
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Session validity check endpoint
router.get('/session-check', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('activeSession');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if session ID matches
    if (!req.user.sessionId || !user.activeSession?.sessionId || user.activeSession.sessionId !== req.user.sessionId) {
      return res.status(401).json({ message: 'Session invalid - logged in from another device' });
    }

    // Update last activity
    user.activeSession.lastActivity = new Date();
    await user.save();

    res.json({ 
      message: 'Session valid',
      lastActivity: user.activeSession.lastActivity 
    });
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Simplified session validation - only check if session ID matches (if present)
    if (req.user.sessionId && user.activeSession?.sessionId && user.activeSession.sessionId !== req.user.sessionId) {
      return res.status(401).json({ message: 'Invalid session. Please login again.' });
    }

    // Only update last activity if session exists (don't block response)
    if (user.activeSession?.sessionId) {
      user.activeSession.lastActivity = new Date();
      user.save().catch(err => console.log('Last activity update error:', err)); // Non-blocking
    }

    res.json({
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Logout - Fast and reliable
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Clear session immediately and synchronously for better UX
    const user = await User.findById(req.user.id);
    if (user) {
      user.activeSession = {
        sessionId: null,
        deviceInfo: null,
        lastActivity: null,
        loginTime: null
      };
      await user.save();
    }
    
    // Return success after clearing session
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success to frontend even if backend cleanup fails
    res.json({ message: 'Logout successful' });
  }
});

// Verify email with code
router.post('/verify-email', async (req, res) => {
  try {
    const { email, verificationCode } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    if (!user.verificationCode || user.verificationCode !== verificationCode) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    if (user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Verification code has expired' });
    }

    // Verify the email
    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();

    res.json({
      message: 'Email verified successfully! You can now sign in.',
      emailVerified: true
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Resend verification code
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.verificationCode = verificationCode;
    user.verificationCodeExpires = verificationExpires;
    await user.save();

    // Send verification email
    const emailResult = await sendVerificationEmail(email, verificationCode, user.firstName);
    
    if (!emailResult.success) {
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.json({
      message: 'Verification code sent successfully. Please check your email.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Forgot password - send reset email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal that user doesn't exist
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = resetExpires;
    await user.save();

    // Send password reset email
    const emailResult = await sendPasswordResetEmail(email, resetToken, user.firstName);
    
    if (!emailResult.success) {
      console.error('Failed to send password reset email:', emailResult.error);
    }

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Update password
    user.password = newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    
    // Clear any active sessions for security
    user.activeSession = {
      sessionId: null,
      deviceInfo: null,
      lastActivity: null,
      loginTime: null
    };

    await user.save();

    res.json({
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;