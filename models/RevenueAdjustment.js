import mongoose from 'mongoose';

const revenueAdjustmentSchema = new mongoose.Schema({
  adjustmentId: {
    type: String,
    required: true,
    unique: true,
    default: () => `REV_ADJ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  type: {
    type: String,
    enum: ['refund', 'chargeback', 'discount', 'compensation', 'correction'],
    required: true
  },
  relatedPaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true
  },
  relatedSupportTicketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Support',
    required: false
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Financial adjustments
  originalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  adjustmentAmount: {
    type: Number,
    required: true,
    min: 0
  },
  originalVendorEarnings: {
    type: Number,
    required: true,
    min: 0
  },
  originalMedzyRevenue: {
    type: Number,
    required: true,
    min: 0
  },
  adjustedVendorEarnings: {
    type: Number,
    required: true
  },
  adjustedMedzyRevenue: {
    type: Number,
    required: true
  },
  vendorEarningsAdjustment: {
    type: Number,
    required: true
  },
  medzyRevenueAdjustment: {
    type: Number,
    required: true
  },
  // Points credited to customer
  pointsCredited: {
    type: Number,
    default: 0,
    min: 0
  },
  pointConversionRate: {
    type: Number,
    default: 1,
    min: 0.1
  },
  // Administrative details
  reason: {
    type: String,
    required: true,
    maxLength: 1000
  },
  adminNotes: {
    type: String,
    maxLength: 2000
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processed', 'reversed'],
    default: 'processed'
  },
  // Audit trail
  reversalDetails: {
    reversedAt: Date,
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reversalReason: String
  }
}, {
  timestamps: true
});

// Method to calculate revenue adjustments
revenueAdjustmentSchema.statics.calculateAdjustments = function(originalAmount, adjustmentAmount, vendorSharePercent = 0.85) {
  const medzySharePercent = 1 - vendorSharePercent;
  
  const originalVendorEarnings = originalAmount * vendorSharePercent;
  const originalMedzyRevenue = originalAmount * medzySharePercent;
  
  const vendorEarningsAdjustment = -(adjustmentAmount * vendorSharePercent);
  const medzyRevenueAdjustment = -(adjustmentAmount * medzySharePercent);
  
  return {
    originalVendorEarnings,
    originalMedzyRevenue,
    adjustedVendorEarnings: originalVendorEarnings + vendorEarningsAdjustment,
    adjustedMedzyRevenue: originalMedzyRevenue + medzyRevenueAdjustment,
    vendorEarningsAdjustment,
    medzyRevenueAdjustment
  };
};

// Method to create refund adjustment
revenueAdjustmentSchema.statics.createRefundAdjustment = async function(
  refundAmount, 
  orderId, 
  paymentId, 
  supportTicketId, 
  vendorId, 
  vendorCommissionPercentage, 
  adminUserId,
  customerId
) {
  // Get payment to validate data
  const Payment = (await import('./Payment.js')).default;
  const payment = await Payment.findById(paymentId);
  
  if (!payment) {
    throw new Error('Payment not found');
  }

  // Calculate adjustments based on vendor commission
  const vendorSharePercent = vendorCommissionPercentage / 100;
  const medzySharePercent = 1 - vendorSharePercent;
  
  const originalVendorEarnings = payment.amount * vendorSharePercent;
  const originalMedzyRevenue = payment.amount * medzySharePercent;
  
  const vendorEarningsAdjustment = -(refundAmount * vendorSharePercent);
  const medzyRevenueAdjustment = -(refundAmount * medzySharePercent);
  
  const adjustedVendorEarnings = originalVendorEarnings + vendorEarningsAdjustment;
  const adjustedMedzyRevenue = originalMedzyRevenue + medzyRevenueAdjustment;
  
  // Calculate points (default: 1 BDT = 10 points)
  const pointsCredited = Math.floor(refundAmount * 10);
  
  const adjustment = new this({
    type: 'refund',
    relatedPaymentId: paymentId,
    relatedSupportTicketId: supportTicketId,
    customerId: customerId,
    vendorId: vendorId,
    originalAmount: payment.amount,
    adjustmentAmount: refundAmount,
    originalVendorEarnings,
    originalMedzyRevenue,
    adjustedVendorEarnings,
    adjustedMedzyRevenue,
    vendorEarningsAdjustment,
    medzyRevenueAdjustment,
    pointsCredited,
    pointConversionRate: 10, // 1 BDT = 10 points
    reason: `Refund adjustment for payment ${payment.transactionId}`,
    adminNotes: `Processed refund of ${refundAmount} BDT. Support ticket: ${supportTicketId || 'N/A'}`,
    processedBy: adminUserId,
    status: 'processed'
  });
  
  await adjustment.save();
  return adjustment;
};

// Method to get revenue summary
revenueAdjustmentSchema.statics.getRevenueSummary = async function(dateRange = {}) {
  const matchStage = { status: 'processed' };
  
  if (dateRange.startDate) {
    matchStage.createdAt = { $gte: new Date(dateRange.startDate) };
  }
  if (dateRange.endDate) {
    if (matchStage.createdAt) {
      matchStage.createdAt.$lte = new Date(dateRange.endDate);
    } else {
      matchStage.createdAt = { $lte: new Date(dateRange.endDate) };
    }
  }
  
  const summary = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalAdjustments: { $sum: 1 },
        totalAdjustmentAmount: { $sum: '$adjustmentAmount' },
        totalVendorEarningsAdjustment: { $sum: '$vendorEarningsAdjustment' },
        totalMedzyRevenueAdjustment: { $sum: '$medzyRevenueAdjustment' },
        totalPointsCredited: { $sum: '$pointsCredited' },
        refundCount: {
          $sum: { $cond: [{ $eq: ['$type', 'refund'] }, 1, 0] }
        },
        chargebackCount: {
          $sum: { $cond: [{ $eq: ['$type', 'chargeback'] }, 1, 0] }
        }
      }
    }
  ]);
  
  return summary[0] || {
    totalAdjustments: 0,
    totalAdjustmentAmount: 0,
    totalVendorEarningsAdjustment: 0,
    totalMedzyRevenueAdjustment: 0,
    totalPointsCredited: 0,
    refundCount: 0,
    chargebackCount: 0
  };
};

// Indexes for better query performance
revenueAdjustmentSchema.index({ relatedPaymentId: 1 });
revenueAdjustmentSchema.index({ customerId: 1 });
revenueAdjustmentSchema.index({ vendorId: 1 });
revenueAdjustmentSchema.index({ type: 1, status: 1 });
revenueAdjustmentSchema.index({ createdAt: -1 });
revenueAdjustmentSchema.index({ processedBy: 1 });

export default mongoose.model('RevenueAdjustment', revenueAdjustmentSchema);
