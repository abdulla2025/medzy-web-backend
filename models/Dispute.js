import mongoose from 'mongoose';

const disputeSchema = new mongoose.Schema({
  disputeId: {
    type: String,
    required: true,
    unique: true,
    default: () => `DISPUTE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true
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
  reason: {
    type: String,
    required: true,
    maxLength: 1000
  },
  description: {
    type: String,
    maxLength: 2000
  },
  status: {
    type: String,
    enum: ['pending', 'investigating', 'resolved', 'rejected'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  adminResponse: {
    type: String,
    maxLength: 2000
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolution: {
    action: {
      type: String,
      enum: ['refund', 'replacement', 'compensation', 'no_action']
    },
    amount: Number,
    details: String
  },
  attachments: [{
    fileName: String,
    fileUrl: String,
    uploadDate: Date
  }]
}, {
  timestamps: true
});

// Indexes for better performance
disputeSchema.index({ userId: 1 });
disputeSchema.index({ vendorId: 1 });
disputeSchema.index({ status: 1 });
disputeSchema.index({ priority: 1 });
disputeSchema.index({ createdAt: -1 });

const Dispute = mongoose.model('Dispute', disputeSchema);
export default Dispute;
