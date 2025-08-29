import mongoose from 'mongoose';

const serviceReviewSchema = new mongoose.Schema({
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
  // Service aspects ratings (1-5 scale)
  ratings: {
    deliverySpeed: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    deliveryQuality: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    customerService: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    appExperience: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    packaging: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    overallSatisfaction: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    }
  },
  // Written feedback
  feedback: {
    deliveryFeedback: {
      type: String,
      trim: true,
      maxlength: 300
    },
    customerServiceFeedback: {
      type: String,
      trim: true,
      maxlength: 300
    },
    appFeedback: {
      type: String,
      trim: true,
      maxlength: 300
    },
    overallFeedback: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    suggestions: {
      type: String,
      trim: true,
      maxlength: 400
    }
  },
  // Additional service metrics
  deliveryPersonRating: {
    type: Number,
    min: 1,
    max: 5
  },
  deliveryPersonName: {
    type: String,
    trim: true
  },
  wouldRecommend: {
    type: Boolean,
    required: true
  },
  // Admin fields
  isPublic: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  adminNotes: {
    type: String,
    trim: true
  },
  // Calculated average rating
  averageRating: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Pre-save middleware to calculate average rating
serviceReviewSchema.pre('save', function(next) {
  const ratings = this.ratings;
  const sum = ratings.deliverySpeed + ratings.deliveryQuality + 
              ratings.customerService + ratings.appExperience + 
              ratings.packaging + ratings.overallSatisfaction;
  this.averageRating = Math.round((sum / 6) * 10) / 10; // Round to 1 decimal
  next();
});

// Compound index to prevent duplicate reviews
serviceReviewSchema.index({ user: 1, order: 1 }, { unique: true });

// Index for efficient queries
serviceReviewSchema.index({ isActive: 1, isPublic: 1, createdAt: -1 });
serviceReviewSchema.index({ averageRating: -1, createdAt: -1 });

export default mongoose.model('ServiceReview', serviceReviewSchema);
