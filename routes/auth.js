import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import PendingUser from '../models/PendingUser.js';
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

// Sign up - Step 1: Collect data and send verification email (don't save to MongoDB yet)
router.post('/signup', async (req, res) => {
  try {
    const { email, phone, password, dateOfBirth, gender, firstName, lastName, role = 'customer' } = req.body;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    // Check if user already exists and is verified
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });
    
    if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ message: 'User already exists with this email or phone' });
    }

    // If user exists but not verified, we'll allow re-registration (overwrite)
    if (existingUser && !existingUser.emailVerified) {
      // Delete the unverified user record
      await User.findByIdAndDelete(existingUser._id);
      console.log(`🗑️ Deleted unverified user record for ${email}`);
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    console.log(`📧 Generated verification code for ${email}: ${verificationCode}`);
    console.log(`⏰ Verification code expires at: ${verificationExpires}`);

    // Store registration data temporarily in session/memory (not in main User collection)
    // We'll create a temporary collection for pending registrations
    
    // Remove any existing pending registration for this email
    await PendingUser.findOneAndDelete({ email });
    
    // Create pending registration record
    const pendingUser = new PendingUser({
      email,
      phone,
      password, // Will be hashed by the schema
      dateOfBirth,
      gender,
      firstName,
      lastName,
      role,
      verificationCode,
      verificationCodeExpires: verificationExpires,
      createdAt: new Date()
    });

    await pendingUser.save();
    console.log(`📝 Saved pending registration for ${email}`);

    // Send verification email
    console.log(`📤 Attempting to send verification email to: ${email}`);
    const emailResult = await sendVerificationEmail(email, verificationCode, firstName);
    
    if (!emailResult.success) {
      console.error('❌ Failed to send verification email:', emailResult.error);
      // Delete the pending user if email fails to send
      await PendingUser.findByIdAndDelete(pendingUser._id);
      return res.status(500).json({ message: 'Failed to send verification email. Please try again with a valid email address.' });
    }

    console.log(`✅ Verification email sent successfully to: ${email}`);

    res.status(200).json({
      message: 'Verification code sent to your email. Please verify to complete registration.',
      requiresVerification: true,
      email: email // Don't send sensitive data
    });
  } catch (error) {
    console.error('Signup error:', error);
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
// Verify email with code - Step 2: Create actual user account after verification
router.post('/verify-email', async (req, res) => {
  try {
    const { email, verificationCode } = req.body;

    // First, check if this is a pending user registration
    const pendingUser = await PendingUser.findOne({ email });
    
    if (pendingUser) {
      // This is a new registration - verify code and create actual user
      console.log(`📧 Verifying pending registration for ${email}`);
      
      if (!pendingUser.verificationCode || pendingUser.verificationCode !== verificationCode) {
        return res.status(400).json({ message: 'Invalid verification code' });
      }

      if (pendingUser.verificationCodeExpires < new Date()) {
        // Clean up expired pending registration
        await PendingUser.findByIdAndDelete(pendingUser._id);
        return res.status(400).json({ message: 'Verification code has expired. Please register again.' });
      }

      // Verification successful - create the actual user account
      console.log(`✅ Creating verified user account for ${email}`);
      
      const newUser = new User({
        email: pendingUser.email,
        phone: pendingUser.phone,
        password: pendingUser.password, // Already hashed by PendingUser schema
        dateOfBirth: pendingUser.dateOfBirth,
        gender: pendingUser.gender,
        firstName: pendingUser.firstName,
        lastName: pendingUser.lastName,
        role: pendingUser.role,
        isActive: true,
        emailVerified: true, // Already verified!
        verificationCode: null,
        verificationCodeExpires: null
      });

      await newUser.save();
      console.log(`✅ User account created successfully for ${email}`);

      // Clean up the pending registration
      await PendingUser.findByIdAndDelete(pendingUser._id);
      console.log(`🗑️ Cleaned up pending registration for ${email}`);

      res.json({
        message: 'Email verified successfully! Your account has been created. You can now sign in.',
        emailVerified: true,
        accountCreated: true
      });
      return;
    }

    // If not a pending user, check if it's an existing user (old flow compatibility)
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No pending registration or user found for this email' });
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

    // Verify the email (old flow)
    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();

    res.json({
      message: 'Email verified successfully! You can now sign in.',
      emailVerified: true
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Resend verification code
// Resend verification code
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    // First, check if this is a pending user registration
    const pendingUser = await PendingUser.findOne({ email });
    
    if (pendingUser) {
      // This is a pending registration - update verification code
      console.log(`📧 Resending verification code for pending registration: ${email}`);
      
      const verificationCode = generateVerificationCode();
      const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      
      pendingUser.verificationCode = verificationCode;
      pendingUser.verificationCodeExpires = verificationExpires;
      await pendingUser.save();

      // Send verification email
      const emailResult = await sendVerificationEmail(email, verificationCode, pendingUser.firstName);
      
      if (!emailResult.success) {
        console.error('Failed to resend verification email:', emailResult.error);
        return res.status(500).json({ message: 'Failed to resend verification email. Please try again.' });
      }

      res.json({
        message: 'Verification code sent to your email',
        verificationCodeSentAt: new Date()
      });
      return;
    }

    // If not a pending user, check existing users (old flow compatibility)
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No pending registration or user found for this email' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Generate new verification code for existing user
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    console.log(`📧 Resending verification code for existing user ${email}: ${verificationCode}`);
    
    user.verificationCode = verificationCode;
    user.verificationCodeExpires = verificationExpires;
    await user.save();

    // Send verification email
    const emailResult = await sendVerificationEmail(email, verificationCode, user.firstName);
    
    if (!emailResult.success) {
      console.error('Failed to resend verification email:', emailResult.error);
      return res.status(500).json({ message: 'Failed to resend verification email. Please try again.' });
    }

    res.json({
      message: 'Verification code sent to your email',
      verificationCodeSentAt: new Date()
    });
  } catch (error) {
    console.error('Resend verification error:', error);
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