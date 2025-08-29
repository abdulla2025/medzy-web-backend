import mongoose from 'mongoose';

const customerPointSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  totalPoints: {
    type: Number,
    default: 0,
    min: 0
  },
  availablePoints: {
    type: Number,
    default: 0,
    min: 0
  },
  usedPoints: {
    type: Number,
    default: 0,
    min: 0
  },
  // Point transaction history
  transactions: [{
    type: {
      type: String,
      enum: ['earned', 'used', 'expired', 'refund_credit', 'refund'],
      required: true
    },
    points: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    relatedPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: false
    },
    relatedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: false
    },
    relatedRefundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: false
    },
    expiryDate: {
      type: Date,
      required: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Point configuration
  pointConversionRate: {
    type: Number,
    default: 1, // 1 BDT = 1 Point
    min: 0.1
  },
  // Expiry settings
  pointExpiryDays: {
    type: Number,
    default: 365 // Points expire after 1 year
  }
}, {
  timestamps: true
});

// Method to add points
customerPointSchema.methods.addPoints = function(points, description, relatedId = null, type = 'earned') {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + this.pointExpiryDays);
  
  this.transactions.push({
    type: type,
    points: points,
    description: description,
    relatedPaymentId: type === 'refund_credit' ? relatedId : null,
    relatedRefundId: type === 'refund_credit' ? relatedId : null,
    expiryDate: expiryDate,
    isActive: true
  });
  
  this.totalPoints += points;
  this.availablePoints += points;
  
  return this.save();
};

// Method to use points
customerPointSchema.methods.usePoints = function(points, description, orderId = null) {
  if (this.availablePoints < points) {
    throw new Error('Insufficient points');
  }
  
  this.transactions.push({
    type: 'used',
    points: points,
    description: description,
    relatedOrderId: orderId,
    isActive: true
  });
  
  this.availablePoints -= points;
  this.usedPoints += points;
  
  return this.save();
};

// Method to get point balance
customerPointSchema.methods.getBalance = function() {
  return {
    totalPoints: this.totalPoints,
    availablePoints: this.availablePoints,
    usedPoints: this.usedPoints
  };
};

// Method to convert points to currency
customerPointSchema.methods.pointsToCurrency = function(points) {
  return points * this.pointConversionRate;
};

// Method to convert currency to points
customerPointSchema.methods.currencyToPoints = function(amount) {
  return Math.floor(amount / this.pointConversionRate);
};

// Static method to find or create customer points
customerPointSchema.statics.findOrCreateForCustomer = async function(customerId) {
  let customerPoints = await this.findOne({ customerId });
  
  if (!customerPoints) {
    customerPoints = new this({ customerId });
    await customerPoints.save();
  }
  
  return customerPoints;
};

// Method to expire old points
customerPointSchema.methods.expireOldPoints = function() {
  const now = new Date();
  let expiredPoints = 0;
  
  this.transactions.forEach(transaction => {
    if (transaction.type === 'earned' && 
        transaction.isActive && 
        transaction.expiryDate && 
        transaction.expiryDate < now) {
      transaction.isActive = false;
      expiredPoints += transaction.points;
      
      // Add expiry transaction
      this.transactions.push({
        type: 'expired',
        points: transaction.points,
        description: `Points expired from transaction: ${transaction.description}`,
        isActive: true
      });
    }
  });
  
  if (expiredPoints > 0) {
    this.availablePoints = Math.max(0, this.availablePoints - expiredPoints);
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Indexes for better query performance
customerPointSchema.index({ 'transactions.createdAt': -1 });
customerPointSchema.index({ 'transactions.type': 1 });
customerPointSchema.index({ 'transactions.isActive': 1 });

export default mongoose.model('CustomerPoint', customerPointSchema);
