import express from 'express';
import CustomerPoint from '../models/CustomerPoint.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get customer points balance
router.get('/balance', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(req.user.id);
    
    // Expire old points before showing balance
    await customerPoints.expireOldPoints();
    
    const balance = customerPoints.getBalance();
    
    res.json({
      success: true,
      balance,
      pointConversionRate: customerPoints.pointConversionRate,
      pointExpiryDays: customerPoints.pointExpiryDays
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get customer points transaction history
router.get('/transactions', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(req.user.id);
    
    let transactions = customerPoints.transactions;
    
    // Filter by type if specified
    if (type) {
      transactions = transactions.filter(t => t.type === type);
    }
    
    // Sort by creation date (newest first)
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedTransactions = transactions.slice(skip, skip + parseInt(limit));
    
    res.json({
      success: true,
      transactions: paginatedTransactions,
      pagination: {
        total: transactions.length,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(transactions.length / parseInt(limit))
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

// Use points for purchase (to be called during order placement)
router.post('/use-points', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const { points, orderId, description } = req.body;
    
    if (!points || points <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid points amount'
      });
    }
    
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(req.user.id);
    
    // Check if customer has enough points
    if (customerPoints.availablePoints < points) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points',
        availablePoints: customerPoints.availablePoints
      });
    }
    
    // Use the points
    await customerPoints.usePoints(points, description || 'Points used for purchase', orderId);
    
    const discountAmount = customerPoints.pointsToCurrency(points);
    
    res.json({
      success: true,
      message: 'Points used successfully',
      pointsUsed: points,
      discountAmount,
      remainingPoints: customerPoints.availablePoints
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error'
    });
  }
});

// Calculate points discount for order
router.post('/calculate-discount', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const { points } = req.body;
    
    if (!points || points <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid points amount'
      });
    }
    
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(req.user.id);
    
    // Check if customer has enough points
    if (customerPoints.availablePoints < points) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points',
        availablePoints: customerPoints.availablePoints
      });
    }
    
    const discountAmount = customerPoints.pointsToCurrency(points);
    
    res.json({
      success: true,
      pointsToUse: points,
      discountAmount,
      availablePoints: customerPoints.availablePoints
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get customer points summary (Admin only)
router.get('/customer/:customerId', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const customerPoints = await CustomerPoint.findOne({ customerId })
      .populate('customerId', 'firstName lastName email');
    
    if (!customerPoints) {
      return res.status(404).json({
        success: false,
        message: 'Customer points not found'
      });
    }
    
    const balance = customerPoints.getBalance();
    
    res.json({
      success: true,
      customer: customerPoints.customerId,
      balance,
      pointConversionRate: customerPoints.pointConversionRate,
      recentTransactions: customerPoints.transactions
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get all customers points summary (Admin only)
router.get('/admin/summary', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'totalPoints', sortOrder = 'desc' } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    const customerPoints = await CustomerPoint.find({})
      .populate('customerId', 'firstName lastName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await CustomerPoint.countDocuments();
    
    // Calculate totals
    const totals = await CustomerPoint.aggregate([
      {
        $group: {
          _id: null,
          totalPointsIssued: { $sum: '$totalPoints' },
          totalPointsAvailable: { $sum: '$availablePoints' },
          totalPointsUsed: { $sum: '$usedPoints' },
          totalCustomers: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      success: true,
      customerPoints: customerPoints.map(cp => ({
        customerId: cp.customerId._id,
        customerName: `${cp.customerId.firstName} ${cp.customerId.lastName}`,
        customerEmail: cp.customerId.email,
        balance: cp.getBalance(),
        pointConversionRate: cp.pointConversionRate,
        lastActivity: cp.transactions.length > 0 
          ? cp.transactions[cp.transactions.length - 1].createdAt 
          : cp.createdAt
      })),
      totals: totals[0] || {
        totalPointsIssued: 0,
        totalPointsAvailable: 0,
        totalPointsUsed: 0,
        totalCustomers: 0
      },
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

// Manually add points to customer (Admin only)
router.post('/admin/add-points', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { customerId, points, description, type = 'earned' } = req.body;
    
    if (!customerId || !points || points <= 0 || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: customerId, points, description'
      });
    }
    
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(customerId);
    await customerPoints.addPoints(points, description, null, type);
    
    res.json({
      success: true,
      message: 'Points added successfully',
      pointsAdded: points,
      newBalance: customerPoints.getBalance()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Get points statistics (Admin only)
router.get('/admin/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter['transactions.createdAt'] = {};
      if (startDate) dateFilter['transactions.createdAt'].$gte = new Date(startDate);
      if (endDate) dateFilter['transactions.createdAt'].$lte = new Date(endDate);
    }
    
    // Get overall statistics
    const stats = await CustomerPoint.aggregate([
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          totalPointsIssued: { $sum: '$totalPoints' },
          totalPointsAvailable: { $sum: '$availablePoints' },
          totalPointsUsed: { $sum: '$usedPoints' },
          averagePointsPerCustomer: { $avg: '$totalPoints' }
        }
      }
    ]);
    
    // Get transaction statistics
    const transactionStats = await CustomerPoint.aggregate([
      { $unwind: '$transactions' },
      { $match: dateFilter },
      {
        $group: {
          _id: '$transactions.type',
          count: { $sum: 1 },
          totalPoints: { $sum: '$transactions.points' }
        }
      }
    ]);
    
    // Get top customers by points
    const topCustomers = await CustomerPoint.find({})
      .populate('customerId', 'firstName lastName email')
      .sort({ totalPoints: -1 })
      .limit(10);
    
    res.json({
      success: true,
      stats: stats[0] || {
        totalCustomers: 0,
        totalPointsIssued: 0,
        totalPointsAvailable: 0,
        totalPointsUsed: 0,
        averagePointsPerCustomer: 0
      },
      transactionStats,
      topCustomers: topCustomers.map(cp => ({
        customerId: cp.customerId._id,
        customerName: `${cp.customerId.firstName} ${cp.customerId.lastName}`,
        customerEmail: cp.customerId.email,
        points: cp.totalPoints,
        availablePoints: cp.availablePoints
      }))
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
