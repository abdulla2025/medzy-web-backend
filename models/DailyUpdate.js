import mongoose from 'mongoose';

const dailyUpdateSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 200
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxLength: 1000
  },
  category: {
    type: String,
    required: true,
    enum: ['blood_availability', 'website_improvements', 'medical_news'],
    default: 'medical_news'
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  tags: [{
    type: String,
    trim: true
  }],
  viewCount: {
    type: Number,
    default: 0
  },
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Index for efficient querying
dailyUpdateSchema.index({ category: 1, createdAt: -1 });
dailyUpdateSchema.index({ isActive: 1, createdAt: -1 });
dailyUpdateSchema.index({ priority: 1, createdAt: -1 });

// Virtual for like count
dailyUpdateSchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

// Ensure virtual fields are serialized
dailyUpdateSchema.set('toJSON', { virtuals: true });

export default mongoose.model('DailyUpdate', dailyUpdateSchema);
