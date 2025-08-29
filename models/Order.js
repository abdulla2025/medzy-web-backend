import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Primary vendor for the order
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: [
      'cash_on_delivery', 'cash', 'card', 'credit_card', 'debit_card',
      'mobile_banking', 'bank_transfer', 'bkash', 'nagad', 'rocket',
      'stripe', 'sslcommerz', 'online', 'dummy'
    ],
    required: true
  },
  // SSL payment details
  sslPaymentDetails: {
    transactionId: String,
    sessionKey: String,
    bankTransactionId: String,
    cardType: String,
    cardIssuer: String,
    paymentExecuteTime: Date,
    verifySign: String
  },
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String, required: true }
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  deliveryFee: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  notes: {
    type: String,
    trim: true
  },
  estimatedDelivery: {
    type: Date
  },
  trackingId: {
    type: String,
    unique: true,
    sparse: true
  },
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      trim: true
    }
  }]
}, {
  timestamps: true
});

// Generate tracking ID before saving
orderSchema.pre('save', function(next) {
  if (this.isNew && !this.trackingId) {
    // Generate unique tracking ID with timestamp and random string
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    this.trackingId = `MED${timestamp}${random}`;
  }
  next();
});

// Add status to history when status changes
orderSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date()
    });
  }
  next();
});

// Indexes for better query performance
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// trackingId index is already created by unique: true in schema

export default mongoose.model('Order', orderSchema);