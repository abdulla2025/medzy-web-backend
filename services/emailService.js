import nodemailer from 'nodemailer';

// Email configuration
const createTransporter = () => {
  try {
    // Use Gmail configuration for all environments
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      debug: false, // Disable debug output
      logger: false // Disable logging
    });
    
    // Test the connection
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Gmail SMTP connection error');
      } else {
        console.log('✅ Gmail SMTP connection verified successfully');
      }
    });
    
    return transporter;
  } catch (error) {
    console.error('❌ Error creating Gmail transporter');
    throw error;
  }
};

// Generate verification code
export const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
};

// Send verification email
export const sendVerificationEmail = async (email, verificationCode, firstName) => {
  try {
    console.log(`Attempting to send verification email to: ${email}`);
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@medsy.com',
      to: email,
      subject: '💊 Medsy - Verify Your Email Address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%); padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">💊 Medsy</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Your Health, Our Priority</p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; margin-bottom: 20px;">Welcome to Medsy, ${firstName}! 🎉</h2>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
              Thank you for joining Medsy! To complete your registration and secure your account, please verify your email address using the code below:
            </p>
            
            <div style="background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); padding: 25px; border-radius: 10px; text-align: center; margin: 25px 0; border: 2px solid #e5e7eb;">
              <p style="color: #374151; font-size: 14px; margin-bottom: 10px; font-weight: 600;">Your Verification Code:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1f2937; background: white; padding: 15px; border-radius: 8px; display: inline-block; border: 2px solid #d1d5db;">
                ${verificationCode}
              </div>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              ⏰ This verification code will expire in <strong>15 minutes</strong> for your security.
            </p>
            
            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
              <p style="color: #92400e; font-size: 14px; margin: 0;">
                🔒 <strong>Security Note:</strong> Never share this code with anyone. Medsy will never ask for your verification code via phone or other methods.
              </p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <h3 style="color: #1f2937; margin-bottom: 15px;">🎯 What's Next?</h3>
              <ul style="color: #4b5563; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Complete your email verification</li>
                <li style="margin-bottom: 8px;">Set up your health profile</li>
                <li style="margin-bottom: 8px;">Explore Medsy's features</li>
                <li>Connect with healthcare providers</li>
              </ul>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px;">
            <p>Need help? Contact our support team at <a href="mailto:support@medsy.com" style="color: #3b82f6;">support@medsy.com</a></p>
            <p style="margin-top: 10px;">© 2025 Medsy. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully:', {
      messageId: info.messageId,
      to: email,
      previewUrl: nodemailer.getTestMessageUrl(info) // For Ethereal email testing
    });
    return { success: true, messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) };
  } catch (error) {
    console.error('Error sending verification email:', error);
    return { success: false, error: error.message };
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (email, resetToken, firstName) => {
  try {
    console.log(`Attempting to send password reset email to: ${email}`);
    const transporter = createTransporter();
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5174'}/reset-password?token=${resetToken}`;
    
    console.log('Reset URL generated:', resetUrl);
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@medsy.com',
      to: email,
      subject: '🔒 Medsy - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%); padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">💊 Medsy</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Your Health, Our Priority</p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; margin-bottom: 20px;">Password Reset Request 🔒</h2>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
              Hello ${firstName}, we received a request to reset your password for your Medsy account. If you made this request, click the button below to reset your password:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                🔑 Reset My Password
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              ⏰ This password reset link will expire in <strong>1 hour</strong> for your security.
            </p>
            
            <div style="background: #fee2e2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444; margin: 20px 0;">
              <p style="color: #dc2626; font-size: 14px; margin: 0;">
                🚨 <strong>Security Alert:</strong> If you didn't request a password reset, please ignore this email or contact our support team immediately.
              </p>
            </div>
            
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Alternative:</strong> If the button doesn't work, copy and paste this link into your browser:<br>
                <span style="word-break: break-all; color: #3b82f6;">${resetUrl}</span>
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px;">
            <p>Need help? Contact our support team at <a href="mailto:support@medsy.com" style="color: #3b82f6;">support@medsy.com</a></p>
            <p style="margin-top: 10px;">© 2025 Medsy. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent successfully:', {
      messageId: info.messageId,
      to: email,
      previewUrl: nodemailer.getTestMessageUrl(info) // For Ethereal email testing
    });
    return { success: true, messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message };
  }
};

// Generic send email function
export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    console.log(`Attempting to send email to: ${to}`);
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@medsy.com',
      to,
      subject,
      html: html || text,
      text
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${to}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    throw error;
  }
};

// Test email service on startup
console.log('🔧 Initializing Email Service...');
try {
  const testTransporter = createTransporter();
  console.log('📧 Email service initialized successfully');
} catch (error) {
  console.error('❌ Email service initialization failed:', error.message);
}
