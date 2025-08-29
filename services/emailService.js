import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Generate verification code
export const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
};

// Email configuration
const createTransporter = () => {
  try {
    // Check if email credentials are properly configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Email credentials not configured in .env file');
      throw new Error('Missing email credentials');
    }

    // Use Gmail configuration for all environments
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // Use TLS
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      },
      debug: false, // Disable debug output
      logger: false // Disable logging
    });

    console.log('🔧 Initializing Email Service...');
    console.log(`📧 Using email: ${process.env.EMAIL_USER}`);
    
    // Verify SMTP connection configuration
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Gmail SMTP connection failed:', error.message);
        console.log('💡 Make sure you are using a Gmail App Password (not regular password)');
        console.log('💡 To create App Password: Gmail Settings > Security > 2-Step Verification > App Passwords');
      } else {
        console.log('✅ Gmail SMTP connection verified successfully');
      }
    });

    return transporter;
  } catch (error) {
    console.error('❌ Error creating email transporter:', error.message);
    throw error;
  }
};

// Initialize transporter
let transporter;
try {
  transporter = createTransporter();
  console.log('📧 Email service initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize email service:', error.message);
}

// Send verification email
export const sendVerificationEmail = async (email, verificationCode, firstName = 'User') => {
  try {
    if (!transporter) {
      console.error('❌ Email transporter not initialized');
      return { success: false, error: 'Email service not available' };
    }

    console.log(`Attempting to send verification email to: ${email}`);
    
    // Verify connection before sending
    await transporter.verify();
    console.log('✅ Gmail SMTP connection verified successfully');

    const mailOptions = {
      from: {
        name: 'Medzy Healthcare',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Verify Your Medzy Account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Account</title>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              background-color: #f4f4f4; 
              margin: 0; 
              padding: 20px; 
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white; 
              padding: 40px; 
              border-radius: 10px; 
              box-shadow: 0 5px 15px rgba(0,0,0,0.1); 
            }
            .header { 
              text-align: center; 
              margin-bottom: 30px; 
            }
            .logo { 
              font-size: 28px; 
              font-weight: bold; 
              color: #10B981; 
              margin-bottom: 10px; 
            }
            .verification-code { 
              background: #f8f9fa; 
              border: 2px solid #10B981; 
              border-radius: 8px; 
              padding: 20px; 
              text-align: center; 
              font-size: 32px; 
              font-weight: bold; 
              letter-spacing: 8px; 
              color: #10B981; 
              margin: 20px 0; 
              font-family: 'Courier New', monospace; 
            }
            .footer { 
              text-align: center; 
              margin-top: 30px; 
              padding-top: 20px; 
              border-top: 1px solid #eee; 
              color: #666; 
              font-size: 14px; 
            }
            .warning { 
              background-color: #fff3cd; 
              border-left: 4px solid #ffc107; 
              padding: 12px; 
              margin: 20px 0; 
              border-radius: 4px; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🏥 Medzy</div>
              <h2>Welcome to Medzy Healthcare!</h2>
              <p>Hi ${firstName}, thank you for joining our healthcare platform.</p>
            </div>
            
            <p>To complete your registration, please enter the following verification code:</p>
            
            <div class="verification-code">${verificationCode}</div>
            
            <div class="warning">
              <strong>⏰ Important:</strong> This code will expire in 15 minutes for your security.
            </div>
            
            <p>If you didn't create an account with us, please ignore this email.</p>
            
            <div class="footer">
              <p>
                <strong>Medzy Healthcare</strong><br>
                Your trusted online pharmacy and healthcare companion
              </p>
              <p style="font-size: 12px; color: #999;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Welcome to Medzy Healthcare!
      
Hi ${firstName},

Thank you for joining our healthcare platform. To complete your registration, please enter the following verification code:

${verificationCode}

This code will expire in 15 minutes for your security.

If you didn't create an account with us, please ignore this email.

Best regards,
Medzy Healthcare Team`
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully:', {
      messageId: result.messageId,
      to: email,
      service: 'Gmail'
    });
    
    return { 
      success: true, 
      messageId: result.messageId,
      service: 'Gmail',
      emailSent: true
    };
    
  } catch (error) {
    console.error('❌ Error sending verification email:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to send email'
    };
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (email, resetToken, firstName = 'User') => {
  try {
    if (!transporter) {
      return { success: false, error: 'Email service not available' };
    }

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: {
        name: 'Medzy Healthcare',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Reset Your Medzy Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              background-color: #f4f4f4; 
              margin: 0; 
              padding: 20px; 
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white; 
              padding: 40px; 
              border-radius: 10px; 
              box-shadow: 0 5px 15px rgba(0,0,0,0.1); 
            }
            .header { 
              text-align: center; 
              margin-bottom: 30px; 
            }
            .logo { 
              font-size: 28px; 
              font-weight: bold; 
              color: #10B981; 
              margin-bottom: 10px; 
            }
            .reset-button { 
              display: inline-block; 
              background-color: #10B981; 
              color: white; 
              padding: 15px 30px; 
              text-decoration: none; 
              border-radius: 5px; 
              margin: 20px 0; 
              font-weight: bold; 
            }
            .footer { 
              text-align: center; 
              margin-top: 30px; 
              padding-top: 20px; 
              border-top: 1px solid #eee; 
              color: #666; 
              font-size: 14px; 
            }
            .warning { 
              background-color: #fff3cd; 
              border-left: 4px solid #ffc107; 
              padding: 12px; 
              margin: 20px 0; 
              border-radius: 4px; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🏥 Medzy</div>
              <h2>Password Reset Request</h2>
              <p>Hi ${firstName},</p>
            </div>
            
            <p>We received a request to reset your password for your Medzy account.</p>
            
            <div style="text-align: center;">
              <a href="${resetUrl}" class="reset-button">Reset Your Password</a>
            </div>
            
            <div class="warning">
              <strong>⏰ Important:</strong> This link will expire in 1 hour for your security.
            </div>
            
            <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
            
            <div class="footer">
              <p>
                <strong>Medzy Healthcare</strong><br>
                Your trusted online pharmacy and healthcare companion
              </p>
              <p style="font-size: 12px; color: #999;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Password Reset Request
      
Hi ${firstName},

We received a request to reset your password for your Medzy account.

Please click the following link to reset your password:
${resetUrl}

This link will expire in 1 hour for your security.

If you didn't request this password reset, please ignore this email.

Best regards,
Medzy Healthcare Team`
    };

    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message };
  }
};

// Generic send email function
export const sendEmail = async (emailOptions) => {
  try {
    if (!transporter) {
      console.error('❌ Email transporter not initialized');
      return { success: false, error: 'Email service not available' };
    }

    // Verify connection before sending
    await transporter.verify();

    const result = await transporter.sendMail(emailOptions);
    console.log('Email sent successfully:', {
      messageId: result.messageId,
      to: emailOptions.to
    });
    
    return { 
      success: true, 
      messageId: result.messageId
    };
    
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to send email'
    };
  }
};

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  generateVerificationCode,
  sendEmail
};
