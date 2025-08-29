import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    default: () => `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: [
      'cash', 'cash_on_delivery', 'card', 'credit_card', 'debit_card', 
      'mobile_banking', 'bank_transfer', 'bkash', 'nagad', 'rocket', 
      'stripe', 'sslcommerz', 'online', 'dummy'
    ],
    required: true
  },
  vendorEarnings: {
    type: Number,
    required: true,
    default: function() {
      return this.amount * 0.85; // 85% to vendor
    }
  },
  medzyRevenue: {
    type: Number,
    required: true,
    default: function() {
      return this.amount * 0.15; // 15% to Medzy
    }
  },
  paymentDetails: {
    accountNumber: String,
    transactionHash: String,
    gatewayResponse: String,
    // SSLCommerz specific fields
    sslTransactionId: String,
    sslBankTransactionId: String,
    sslCardType: String,
    sslCardNo: String,
    sslCardIssuer: String,
    sslCardBrand: String,
    sslCardIssuerCountry: String,
    sslCurrencyAmount: String,
    sslVerifySign: String,
    sslVerifySignSha2: String,
    sslVerifyKey: String,
    sslStoreAmount: String,
    sslStoreID: String,
    customerMsisdn: String,
    paymentExecuteTime: Date
  },
  refundDetails: {
    refundAmount: Number,
    refundReason: String,
    refundDate: Date
  }
}, {
  timestamps: true
});

// Calculate earnings before saving
paymentSchema.pre('save', function(next) {
  if (this.isModified('amount')) {
    this.vendorEarnings = this.amount * 0.85;
    this.medzyRevenue = this.amount * 0.15;
  }
  next();
});

// Indexes for better query performance
paymentSchema.index({ userId: 1 });
paymentSchema.index({ vendorId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
