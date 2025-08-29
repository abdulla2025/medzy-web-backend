import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const pendingUserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    required: true,
    enum: ['male', 'female', 'other']
  },
  role: {
    type: String,
    required: true,
    enum: ['customer', 'pharmacy_vendor', 'admin'],
    default: 'customer'
  },
  verificationCode: {
    type: String,
    required: true
  },
  verificationCodeExpires: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '24h' // Automatically delete after 24 hours if not verified
  }
});

// Hash password before saving
pendingUserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
pendingUserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const PendingUser = mongoose.model('PendingUser', pendingUserSchema);

export default PendingUser;
