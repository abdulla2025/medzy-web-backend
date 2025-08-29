import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  genericName: {
    type: String,
    required: true,
    trim: true
  },
  manufacturer: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Suppository', 'Other'],
    default: 'Tablet'
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  stockQuantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  minStockLevel: {
    type: Number,
    required: true,
    min: 0,
    default: 10
  },
  expiryDate: {
    type: Date,
    required: true
  },
  batchNumber: {
    type: String,
    required: true,
    trim: true
  },
  prescriptionRequired: {
    type: Boolean,
    default: false
  },
  dosage: {
    type: String,
    required: true,
    trim: true
  },
  sideEffects: {
    type: String,
    trim: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true // Add index for better query performance
  },
  isActive: {
    type: Boolean,
    default: true
  },
  imageUrl: {
    type: String,
    default: null
  },
  tags: [{
    type: String,
    trim: true
  }],
  stockHistory: [{
    type: {
      type: String,
      enum: ['in', 'out', 'expired', 'damaged'],
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    reason: {
      type: String,
      trim: true
    },
    date: {
      type: Date,
      default: Date.now
    },
    previousStock: {
      type: Number,
      required: true
    },
    newStock: {
      type: Number,
      required: true
    }
  }]
}, {
  timestamps: true
});

// Index for better query performance
medicineSchema.index({ vendorId: 1, name: 1 });
medicineSchema.index({ category: 1 });
medicineSchema.index({ expiryDate: 1 });
medicineSchema.index({ stockQuantity: 1 });

// Virtual for checking if medicine is low on stock
medicineSchema.virtual('isLowStock').get(function() {
  return this.stockQuantity <= this.minStockLevel;
});

// Virtual for checking if medicine is expired
medicineSchema.virtual('isExpired').get(function() {
  return this.expiryDate < new Date();
});

// Virtual for checking if medicine is expiring soon (within 30 days)
medicineSchema.virtual('isExpiringSoon').get(function() {
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  return this.expiryDate <= thirtyDaysFromNow && this.expiryDate > new Date();
});

// Method to update stock
medicineSchema.methods.updateStock = function(quantity, type, reason = '') {
  const previousStock = this.stockQuantity;
  
  if (type === 'in') {
    this.stockQuantity += quantity;
  } else if (type === 'out') {
    this.stockQuantity = Math.max(0, this.stockQuantity - quantity);
  } else if (type === 'expired' || type === 'damaged') {
    this.stockQuantity = Math.max(0, this.stockQuantity - quantity);
  }
  
  // Add to stock history
  this.stockHistory.push({
    type,
    quantity,
    reason,
    previousStock,
    newStock: this.stockQuantity
  });
  
  return this.save();
};

export default mongoose.model('Medicine', medicineSchema);
