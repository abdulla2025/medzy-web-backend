import mongoose from 'mongoose';

const supportSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['complaint', 'help', 'suggestion', 'payment_issue']
  },
  subject: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['general', 'payment', 'order', 'technical', 'refund', 'billing'],
    default: 'general'
  },
  // Payment-related fields
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
  requestedRefundAmount: {
    type: Number,
    required: false
  },
  refundReason: {
    type: String,
    required: false
  },
  // Admin response fields
  adminResponse: {
    type: String,
    default: ''
  },
  respondedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  respondedAt: {
    type: Date
  },
  // Resolution details
  resolutionAction: {
    type: String,
    enum: ['none', 'refund_approved', 'refund_rejected', 'partial_refund', 'replacement', 'store_credit'],
    default: 'none'
  },
  resolutionAmount: {
    type: Number,
    required: false
  },
  resolutionDetails: {
    type: String,
    required: false
  },
  resolutionDate: {
    type: Date,
    required: false
  },
  // Internal notes for admin
  internalNotes: [{
    note: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Attachments
  attachments: [{
    filename: String,
    path: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for better query performance
supportSchema.index({ customerId: 1, status: 1 });
supportSchema.index({ type: 1, status: 1 });
supportSchema.index({ relatedPaymentId: 1 });
supportSchema.index({ createdAt: -1 });

export default mongoose.model('Support', supportSchema);