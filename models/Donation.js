import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  medicineName: {
    type: String,
    required: true,
    trim: true
  },
  genericName: {
    type: String,
    trim: true
  },
  brand: {
    type: String,
    trim: true
  },
  dosage: {
    type: String,
    required: true,
    trim: true
  },
  form: {
    type: String,
    enum: ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'other'],
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    enum: ['pieces', 'bottles', 'tubes', 'vials', 'boxes', 'strips'],
    required: true
  },
  expiryDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(date) {
        return date > new Date();
      },
      message: 'Expiry date must be in the future'
    }
  },
  manufacturingDate: {
    type: Date,
    required: true
  },
  batchNumber: {
    type: String,
    trim: true
  },
  manufacturer: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    maxLength: 500
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxLength: 300
  },
  condition: {
    type: String,
    enum: ['excellent', 'good', 'fair'],
    required: true
  },
  unopened: {
    type: Boolean,
    required: true,
    default: true
  },
  donorContact: {
    phone: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    preferredContactMethod: {
      type: String,
      enum: ['phone', 'email', 'both'],
      default: 'both'
    }
  },
  pickupLocation: {
    address: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    postalCode: {
      type: String,
      required: true
    },
    additionalInfo: {
      type: String,
      trim: true
    }
  },
  availability: {
    availableDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    availableTime: {
      from: {
        type: String,
        required: true
      },
      to: {
        type: String,
        required: true
      }
    }
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'claimed', 'completed'],
    default: 'pending'
  },
  adminReview: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    comments: {
      type: String,
      trim: true
    },
    rejectionReason: {
      type: String,
      trim: true
    }
  },
  claims: [{
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requestedQuantity: {
      type: Number,
      required: true,
      min: 1
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    contact: {
      phone: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true
      }
    },
    pickupPreference: {
      type: String,
      enum: ['pickup', 'delivery'],
      default: 'pickup'
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed'],
      default: 'pending'
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    message: {
      type: String,
      trim: true
    }
  }],
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
donationSchema.index({ status: 1, isActive: 1 });
donationSchema.index({ donor: 1, status: 1 });
donationSchema.index({ medicineName: 'text', genericName: 'text', brand: 'text' });
donationSchema.index({ 'pickupLocation.city': 1, status: 1 });
donationSchema.index({ expiryDate: 1 });
donationSchema.index({ createdAt: -1 });

// Virtual for available quantity (total - claimed)
donationSchema.virtual('availableQuantity').get(function() {
  const claimedQuantity = this.claims
    .filter(claim => claim.status === 'approved' || claim.status === 'completed')
    .reduce((total, claim) => total + claim.requestedQuantity, 0);
  
  return Math.max(0, this.quantity - claimedQuantity);
});

// Virtual for days until expiry
donationSchema.virtual('daysUntilExpiry').get(function() {
  const now = new Date();
  const expiry = new Date(this.expiryDate);
  const diffTime = expiry - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Pre-save middleware to set priority based on expiry date
donationSchema.pre('save', function(next) {
  const daysUntilExpiry = this.daysUntilExpiry;
  
  if (daysUntilExpiry <= 30) {
    this.priority = 'high';
  } else if (daysUntilExpiry <= 90) {
    this.priority = 'normal';
  } else {
    this.priority = 'low';
  }
  
  next();
});

// Static method to find available donations
donationSchema.statics.findAvailable = function(filters = {}) {
  const query = {
    status: 'approved',
    isActive: true,
    expiryDate: { $gt: new Date() },
    ...filters
  };
  
  return this.find(query)
    .populate('donor', 'firstName lastName')
    .sort({ priority: -1, createdAt: -1 });
};

// Instance method to check if donation can be claimed
donationSchema.methods.canBeClaimed = function(requestedQuantity) {
  return this.availableQuantity >= requestedQuantity && 
         this.status === 'approved' && 
         this.isActive &&
         new Date(this.expiryDate) > new Date();
};

const Donation = mongoose.model('Donation', donationSchema);

export default Donation;
