import express from 'express';
import Dispute from '../models/Dispute.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Create dispute (Customer only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { transactionId, reason, description } = req.body;

    // Find the payment
    const payment = await Payment.findById(transactionId).populate('orderId');
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Verify user owns this payment
    if (payment.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Check if dispute already exists for this payment
    const existingDispute = await Dispute.findOne({ transactionId });
    if (existingDispute) {
      return res.status(400).json({ message: 'Dispute already exists for this payment' });
    }

    const dispute = new Dispute({
      transactionId,
      userId: req.user.id,
      vendorId: payment.vendorId,
      orderId: payment.orderId._id,
      reason,
      description,
      status: 'pending'
    });

    await dispute.save();

    res.status(201).json({ 
      message: 'Dispute raised successfully', 
      dispute,
      disputeId: dispute.disputeId 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all disputes (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      status,
      priority,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const disputes = await Dispute.find(filter)
      .populate('userId', 'firstName lastName email phone')
      .populate('vendorId', 'firstName lastName email businessName')
      .populate('transactionId', 'transactionId amount status paymentMethod')
      .populate('orderId', 'orderNumber items totalAmount')
      .populate('adminId', 'firstName lastName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Dispute.countDocuments(filter);

    res.json({
      disputes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get dispute statistics (Admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const stats = await Dispute.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalDisputes: { $sum: 1 },
          pendingDisputes: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          investigatingDisputes: {
            $sum: { $cond: [{ $eq: ['$status', 'investigating'] }, 1, 0] }
          },
          resolvedDisputes: {
            $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] }
          },
          rejectedDisputes: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          urgentDisputes: {
            $sum: { $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0] }
          },
          highPriorityDisputes: {
            $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalDisputes: 0,
      pendingDisputes: 0,
      investigatingDisputes: 0,
      resolvedDisputes: 0,
      rejectedDisputes: 0,
      urgentDisputes: 0,
      highPriorityDisputes: 0
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update dispute (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminResponse, priority, resolution } = req.body;

    const updateData = { adminId: req.user.id };
    
    if (status) updateData.status = status;
    if (adminResponse) updateData.adminResponse = adminResponse;
    if (priority) updateData.priority = priority;
    if (resolution) updateData.resolution = resolution;

    const dispute = await Dispute.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('userId vendorId transactionId orderId adminId');

    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    // If dispute is resolved with refund, update payment status
    if (status === 'resolved' && resolution && resolution.action === 'refund') {
      await Payment.findByIdAndUpdate(dispute.transactionId._id, {
        status: 'refunded',
        refundDetails: {
          refundAmount: resolution.amount,
          refundReason: resolution.details,
          refundDate: new Date()
        }
      });
    }

    res.json({ message: 'Dispute updated successfully', dispute });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's disputes
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const disputes = await Dispute.find({ userId: req.user.id })
      .populate('transactionId', 'transactionId amount status paymentMethod')
      .populate('orderId', 'orderNumber items totalAmount')
      .populate('vendorId', 'firstName lastName businessName')
      .sort({ createdAt: -1 });

    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's disputes
router.get('/vendor', authenticateToken, async (req, res) => {
  try {
    const disputes = await Dispute.find({ vendorId: req.user.id })
      .populate('userId', 'firstName lastName email phone')
      .populate('transactionId', 'transactionId amount status paymentMethod')
      .populate('orderId', 'orderNumber items totalAmount')
      .sort({ createdAt: -1 });

    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
