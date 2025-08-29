import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: false // Not required for vendor reviews
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  isVerified: {
    type: Boolean,
    default: true // Since it's from a verified purchase
  },
  helpfulVotes: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate reviews - one review per user per vendor per order
reviewSchema.index({ user: 1, order: 1, vendor: 1 }, { unique: true });

// Index for efficient queries
reviewSchema.index({ medicine: 1, rating: -1, createdAt: -1 });
reviewSchema.index({ vendor: 1, createdAt: -1 });
reviewSchema.index({ isActive: 1, createdAt: -1 });

export default mongoose.model('Review', reviewSchema);
