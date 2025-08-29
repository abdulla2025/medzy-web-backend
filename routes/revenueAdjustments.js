import express from 'express';
import RevenueAdjustment from '../models/RevenueAdjustment.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get revenue summary
router.get('/summary', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const summary = await RevenueAdjustment.getRevenueSummary(startDate, endDate);
    
    res.json({
      success: true,
      summary
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get all revenue adjustments
router.get('/adjustments', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, startDate, endDate } = req.query;
    
    const filter = {};
    
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const adjustments = await RevenueAdjustment.find(filter)
      .populate('relatedOrderId', 'orderNumber totalAmount')
      .populate('relatedPaymentId', 'transactionId amount paymentMethod')
      .populate('relatedSupportId', 'ticketNumber issue')
      .populate('processedByUserId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await RevenueAdjustment.countDocuments(filter);
    
    res.json({
      success: true,
      adjustments,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get specific revenue adjustment
router.get('/adjustments/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const adjustment = await RevenueAdjustment.findById(req.params.id)
      .populate('relatedOrderId', 'orderNumber totalAmount customer')
      .populate('relatedPaymentId', 'transactionId amount paymentMethod status')
      .populate('relatedSupportId', 'ticketNumber issue status')
      .populate('processedByUserId', 'firstName lastName email');
    
    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: 'Revenue adjustment not found'
      });
    }
    
    res.json({
      success: true,
      adjustment
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Create manual revenue adjustment
router.post('/adjustments', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const {
      type,
      amount,
      description,
      relatedOrderId,
      relatedPaymentId,
      relatedSupportId,
      vendorId,
      vendorCommissionPercentage
    } = req.body;
    
    if (!type || !amount || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: type, amount, description'
      });
    }
    
    const adjustmentData = {
      type,
      amount: Math.abs(amount), // Ensure positive amount
      description,
      relatedOrderId: relatedOrderId || null,
      relatedPaymentId: relatedPaymentId || null,
      relatedSupportId: relatedSupportId || null,
      vendorId: vendorId || null,
      vendorCommissionPercentage: vendorCommissionPercentage || 0,
      processedByUserId: req.user.id,
      status: 'completed',
      processedAt: new Date()
    };
    
    // Calculate adjustments
    const calculations = RevenueAdjustment.calculateAdjustments(
      adjustmentData.amount,
      adjustmentData.vendorCommissionPercentage
    );
    
    Object.assign(adjustmentData, calculations);
    
    const adjustment = new RevenueAdjustment(adjustmentData);
    await adjustment.save();
    
    await adjustment.populate('relatedOrderId relatedPaymentId relatedSupportId processedByUserId');
    
    res.status(201).json({
      success: true,
      message: 'Revenue adjustment created successfully',
      adjustment
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Approve/reject revenue adjustment
router.patch('/adjustments/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status, approvalNotes } = req.body;
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "approved" or "rejected"'
      });
    }
    
    const adjustment = await RevenueAdjustment.findById(req.params.id);
    
    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: 'Revenue adjustment not found'
      });
    }
    
    if (adjustment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending adjustments can be approved or rejected'
      });
    }
    
    adjustment.status = status;
    adjustment.processedByUserId = req.user.id;
    adjustment.processedAt = new Date();
    
    if (approvalNotes) {
      adjustment.approvalNotes = approvalNotes;
    }
    
    await adjustment.save();
    
    res.json({
      success: true,
      message: `Revenue adjustment ${status} successfully`,
      adjustment
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get revenue statistics
router.get('/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { period = '30d', startDate, endDate } = req.query;
    
    let dateFilter = {};
    
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    } else {
      // Default period filter
      const now = new Date();
      const daysBack = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
      dateFilter.createdAt = { $gte: new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000)) };
    }
    
    // Get overall statistics
    const stats = await RevenueAdjustment.aggregate([
      { $match: { ...dateFilter, status: 'completed' } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalVendorAdjustment: { $sum: '$vendorAdjustment' },
          totalMedzyAdjustment: { $sum: '$medzyAdjustment' }
        }
      }
    ]);
    
    // Get trend data (daily breakdown)
    const trendData = await RevenueAdjustment.aggregate([
      { $match: { ...dateFilter, status: 'completed' } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            type: '$type'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);
    
    // Get pending adjustments
    const pendingAdjustments = await RevenueAdjustment.countDocuments({ status: 'pending' });
    
    // Calculate totals
    const totals = stats.reduce(
      (acc, stat) => {
        acc.totalCount += stat.count;
        acc.totalAmount += stat.totalAmount;
        acc.totalVendorAdjustment += stat.totalVendorAdjustment;
        acc.totalMedzyAdjustment += stat.totalMedzyAdjustment;
        return acc;
      },
      { totalCount: 0, totalAmount: 0, totalVendorAdjustment: 0, totalMedzyAdjustment: 0 }
    );
    
    res.json({
      success: true,
      stats: {
        byType: stats,
        totals,
        pendingAdjustments,
        trendData
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get vendor revenue adjustments
router.get('/vendor/:vendorId', authenticateToken, requireRole(['admin', 'vendor']), async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { page = 1, limit = 20, startDate, endDate } = req.query;
    
    // If user is a vendor, they can only see their own adjustments
    if (req.user.role === 'vendor' && req.user.id !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const filter = { vendorId };
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const adjustments = await RevenueAdjustment.find(filter)
      .populate('relatedOrderId', 'orderNumber totalAmount')
      .populate('relatedPaymentId', 'transactionId amount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await RevenueAdjustment.countDocuments(filter);
    
    // Calculate vendor totals
    const vendorTotals = await RevenueAdjustment.aggregate([
      { $match: { vendorId, status: 'completed' } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalVendorAdjustment: { $sum: '$vendorAdjustment' }
        }
      }
    ]);
    
    res.json({
      success: true,
      adjustments,
      vendorTotals,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

export default router;
