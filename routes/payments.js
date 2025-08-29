import express from 'express';
import jwt from 'jsonwebtoken';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import CustomerPoint from '../models/CustomerPoint.js';
import RevenueAdjustment from '../models/RevenueAdjustment.js';
import paymentGatewayService from '../services/paymentGatewayService.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Helper function to process refund with revenue adjustments and customer points
const processRefundAdjustments = async (payment, refundAmount, supportTicketId = null, adminUserId) => {
  try {
    // Get the order to determine vendor and commission
    const order = await Order.findById(payment.orderId);
    if (!order) {
      console.error(`Order not found for payment ${payment._id}`);
      throw new Error('Order not found for payment');
    }
    
    console.log(`Processing refund adjustments for order: ${order._id}, vendorId: ${order.vendorId}`);
    
    if (!order.vendorId) {
      console.error(`VendorId missing for order ${order._id}`);
      throw new Error('Vendor information missing for this order');
    }
    
    const vendorCommissionPercentage = order.vendorCommissionPercentage || 15; // Default 15%
    
    // Create revenue adjustment for the refund
    const revenueAdjustment = await RevenueAdjustment.createRefundAdjustment(
      refundAmount,
      payment.orderId,
      payment._id,
      supportTicketId,
      order.vendorId,
      vendorCommissionPercentage,
      adminUserId,
      payment.userId // Add customerId
    );
    
    // Award customer points for the refund amount
    const customerPoints = await CustomerPoint.findOrCreateForCustomer(payment.userId);
    const pointsAwarded = customerPoints.currencyToPoints(refundAmount);
    
    await customerPoints.addPoints(
      pointsAwarded,
      `Refund compensation for payment ${payment.transactionId}`,
      payment.orderId,
      'refund'
    );
    
    return {
      revenueAdjustment,
      pointsAwarded,
      customerPoints: customerPoints.getBalance()
    };
  } catch (error) {
    console.error('Error processing refund adjustments:', error);
    throw error;
  }
};

// Get all payments (Admin only) with filters
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      status,
      vendorId,
      userId,
      startDate,
      endDate,
      paymentMethod,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;
    if (userId) filter.userId = userId;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const payments = await Payment.find(filter)
      .populate('userId', 'firstName lastName email phone')
      .populate('vendorId', 'firstName lastName email businessName')
      .populate('orderId', 'trackingId items total')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(filter);

    res.json({
      payments,
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

// Get payment statistics (Admin only) - NOW INCLUDES REFUND ADJUSTMENTS
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get original payment stats
    const paymentStats = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          originalMedzyRevenue: { $sum: '$medzyRevenue' },
          originalVendorEarnings: { $sum: '$vendorEarnings' },
          completedPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          failedPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get refund adjustments
    const adjustmentFilter = { status: 'processed', ...dateFilter };
    const adjustmentStats = await RevenueAdjustment.aggregate([
      { $match: adjustmentFilter },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: 1 },
          totalRefundAmount: { $sum: '$adjustmentAmount' },
          totalMedzyRevenueAdjustment: { $sum: '$medzyRevenueAdjustment' },
          totalVendorEarningsAdjustment: { $sum: '$vendorEarningsAdjustment' },
          totalPointsAwarded: { $sum: '$pointsCredited' }
        }
      }
    ]);

    const baseStats = paymentStats[0] || {
      totalPayments: 0,
      totalAmount: 0,
      originalMedzyRevenue: 0,
      originalVendorEarnings: 0,
      completedPayments: 0,
      pendingPayments: 0,
      failedPayments: 0
    };

    const adjustments = adjustmentStats[0] || {
      totalRefunds: 0,
      totalRefundAmount: 0,
      totalMedzyRevenueAdjustment: 0,
      totalVendorEarningsAdjustment: 0,
      totalPointsAwarded: 0
    };

    // Calculate final adjusted revenue
    const result = {
      totalPayments: baseStats.totalPayments,
      totalAmount: baseStats.totalAmount,
      totalRefundAmount: adjustments.totalRefundAmount,
      totalRefunds: adjustments.totalRefunds,
      // Adjusted revenue = Original revenue + adjustment (adjustment is negative)
      totalMedzyRevenue: baseStats.originalMedzyRevenue + adjustments.totalMedzyRevenueAdjustment,
      totalVendorEarnings: baseStats.originalVendorEarnings + adjustments.totalVendorEarningsAdjustment,
      originalMedzyRevenue: baseStats.originalMedzyRevenue,
      originalVendorEarnings: baseStats.originalVendorEarnings,
      completedPayments: baseStats.completedPayments,
      pendingPayments: baseStats.pendingPayments,
      failedPayments: baseStats.failedPayments,
      successRate: baseStats.totalPayments > 0 ? 
        ((baseStats.completedPayments / baseStats.totalPayments) * 100).toFixed(2) : '0.00',
      totalPointsAwarded: adjustments.totalPointsAwarded
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update payment status (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminNotes, refundDetails } = req.body;
    
    const updateData = { status };
    if (adminNotes) updateData.adminNotes = adminNotes;
    if (refundDetails && status === 'refunded') {
      updateData.refundDetails = {
        ...refundDetails,
        refundDate: new Date()
      };
    }

    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('userId vendorId orderId');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json({ message: 'Payment updated successfully', payment });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get revenue by vendor (Admin only)
router.get('/revenue/vendors', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get revenue by vendor including both pending and completed
    const revenueByVendor = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$vendorId',
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          vendorEarnings: { $sum: '$vendorEarnings' },
          medzyRevenue: { $sum: '$medzyRevenue' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          completedRevenue: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$medzyRevenue', 0] }
          },
          pendingRevenue: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$medzyRevenue', 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'vendor'
        }
      },
      {
        $unwind: '$vendor'
      },
      {
        $project: {
          vendorId: '$_id',
          vendorName: {
            $cond: {
              if: '$vendor.businessName',
              then: '$vendor.businessName',
              else: { $concat: ['$vendor.firstName', ' ', '$vendor.lastName'] }
            }
          },
          vendorEmail: '$vendor.email',
          totalOrders: 1,
          totalAmount: 1,
          vendorEarnings: 1,
          medzyRevenue: 1,
          completedOrders: 1,
          pendingOrders: 1,
          completedRevenue: 1,
          pendingRevenue: 1
        }
      },
      { $sort: { medzyRevenue: -1 } }
    ]);

    // Calculate totals
    const totals = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$medzyRevenue' },
          completedRevenue: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$medzyRevenue', 0] }
          },
          pendingRevenue: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$medzyRevenue', 0] }
          },
          totalVendorEarnings: { $sum: '$vendorEarnings' },
          completedVendorEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vendorEarnings', 0] }
          },
          pendingVendorEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$vendorEarnings', 0] }
          }
        }
      }
    ]);

    const summary = totals[0] || {
      totalRevenue: 0,
      completedRevenue: 0,
      pendingRevenue: 0,
      totalVendorEarnings: 0,
      completedVendorEarnings: 0,
      pendingVendorEarnings: 0
    };

    res.json({
      vendors: revenueByVendor,
      ...summary
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get vendor's own earnings
router.get('/vendor/earnings', authenticateToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { startDate, endDate } = req.query;
    
    const dateFilter = { vendorId };
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get all payments (completed and pending)
    const allEarnings = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalEarnings: { $sum: '$vendorEarnings' },
          medzyCommission: { $sum: '$medzyRevenue' },
          completedEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vendorEarnings', 0] }
          },
          pendingEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$vendorEarnings', 0] }
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    const monthlyEarnings = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          orders: { $sum: 1 },
          amount: { $sum: '$amount' },
          earnings: { $sum: '$vendorEarnings' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const result = allEarnings[0] || {
      totalOrders: 0,
      totalAmount: 0,
      totalEarnings: 0,
      medzyCommission: 0,
      completedEarnings: 0,
      pendingEarnings: 0,
      completedOrders: 0,
      pendingOrders: 0
    };

    res.json({
      ...result,
      monthlyEarnings
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get specific vendor's earnings by ID (for admin or specific vendor)
router.get('/vendor/earnings/:vendorId', authenticateToken, async (req, res) => {
  try {
    const vendorId = req.params.vendorId;
    const { startDate, endDate } = req.query;
    
    // Check if user is admin or the vendor themselves
    if (req.user.role !== 'admin' && req.user.id !== vendorId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const dateFilter = { vendorId };
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get all payments (completed and pending)
    const allEarnings = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalEarnings: { $sum: '$vendorEarnings' },
          medzyCommission: { $sum: '$medzyRevenue' },
          completedEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vendorEarnings', 0] }
          },
          pendingEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$vendorEarnings', 0] }
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    const monthlyEarnings = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          orders: { $sum: 1 },
          amount: { $sum: '$amount' },
          earnings: { $sum: '$vendorEarnings' },
          completedEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vendorEarnings', 0] }
          },
          pendingEarnings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$vendorEarnings', 0] }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const result = allEarnings[0] || {
      totalOrders: 0,
      totalAmount: 0,
      totalEarnings: 0,
      medzyCommission: 0,
      completedEarnings: 0,
      pendingEarnings: 0,
      completedOrders: 0,
      pendingOrders: 0
    };

    res.json({
      ...result,
      monthlyEarnings
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create payment (for order completion)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount, paymentMethod, paymentDetails } = req.body;

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId).populate('vendorId');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const payment = new Payment({
      userId: req.user.id,
      vendorId: order.vendorId._id,
      orderId,
      amount,
      paymentMethod,
      paymentDetails,
      status: 'pending'
    });

    await payment.save();

    // Update order status
    order.paymentStatus = 'paid';
    order.status = 'confirmed';
    await order.save();

    res.status(201).json({ message: 'Payment created successfully', payment });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's payment history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const query = { userId: req.user.id };
    if (status && status !== 'all') {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .populate('orderId', 'trackingId total items status paymentMethod')
      .populate('vendorId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Payment.countDocuments(query);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
});

// ================= Multi-Gateway Payment Integration =================

// Initialize payment (unified endpoint for all gateways)
router.post('/initialize', authenticateToken, async (req, res) => {
  try {
    const { 
      gateway, 
      amount, 
      currency = 'BDT', 
      description, 
      customerInfo, 
      shippingAddress, 
      cartItems 
    } = req.body;

    console.log('🔍 Payment initialization request received:', {
      gateway,
      amount,
      currency,
      customerName: customerInfo?.name,
      itemCount: cartItems?.length,
      userId: req.user.id
    });

    if (!gateway || !amount) {
      console.log('❌ Validation failed:', { gateway, amount });
      return res.status(400).json({
        success: false,
        message: 'Gateway and amount are required',
        received: { gateway, amount }
      });
    }

    if (amount <= 0) {
      console.log('❌ Invalid amount:', amount);
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0',
        received: { amount }
      });
    }

    console.log(`🚀 Initializing ${gateway} payment:`, {
      gateway,
      amount,
      currency,
      customerInfo: customerInfo?.name,
      itemCount: cartItems?.length
    });

    // Get user info
    const user = await User.findById(req.user.id);
    
    // Calculate totals
    const subtotal = amount;
    const deliveryFee = subtotal >= 500 ? 0 : 50; // Free delivery for orders above 500
    const total = subtotal + deliveryFee;
    
    // Create order first - fix the schema requirements
    const orderData = {
      customer: req.user.id,  // Use 'customer' not 'customerId'
      items: cartItems?.map(item => ({
        medicine: item.productId || item.medicine || item._id, // Map productId to medicine
        quantity: item.quantity || 1,
        price: item.price || 0,
        vendor: item.vendorId || item.vendor || req.user.id // Default to current user if no vendor
      })) || [],
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      total: total,
      paymentMethod: gateway,
      status: 'pending',
      paymentStatus: 'pending',
      shippingAddress,
      notes: description || `Payment via ${gateway}`
    };

    console.log('📦 Creating order with data:', {
      customer: orderData.customer,
      itemCount: orderData.items.length,
      subtotal: orderData.subtotal,
      total: orderData.total,
      paymentMethod: orderData.paymentMethod
    });
    
    const order = new Order(orderData);
    await order.save();
    console.log('📦 Order created successfully:', order._id);

    // Prepare customer data
    const customerData = {
      name: customerInfo?.name || `${user.firstName} ${user.lastName}`,
      email: customerInfo?.email || user.email,
      phone: customerInfo?.phone || user.phone || '01700000000',
      address: customerInfo?.address || shippingAddress?.address || 'Dhaka, Bangladesh',
      city: customerInfo?.city || shippingAddress?.city || 'Dhaka',
      postcode: customerInfo?.postcode || shippingAddress?.postalCode || '1000'
    };

    // Initialize payment via gateway service
    const paymentResponse = await paymentGatewayService.createPayment(gateway, {
      amount,
      currency,
      orderId: order._id.toString(),
      description: description || `Order #${order._id}`,
      customer: customerData
      // Let the payment gateway service generate its own dynamic URLs
    });

    console.log(`📨 ${gateway} payment response:`, {
      success: paymentResponse.success,
      hasRedirectUrl: !!(paymentResponse.data?.GatewayPageURL || paymentResponse.data?.redirectUrl),
      paymentId: paymentResponse.data?.paymentId,
      transactionId: paymentResponse.data?.transactionId
    });

    if (paymentResponse.success) {
      // Get vendor ID from cart items by fetching medicine details
      let vendorId = null;
      
      console.log('🛒 Cart items for vendorId lookup:', {
        cartItemsLength: cartItems?.length,
        firstItem: cartItems?.[0],
        hasVendorId: cartItems?.[0]?.vendorId,
        hasVendor: cartItems?.[0]?.vendor,
        fallbackUserId: req.user.id
      });

      if (cartItems && cartItems.length > 0) {
        // Get vendor ID from the first medicine in cart
        const firstMedicineId = cartItems[0].medicine || cartItems[0].productId;
        if (firstMedicineId) {
          const Medicine = (await import('../models/Medicine.js')).default;
          const medicine = await Medicine.findById(firstMedicineId);
          if (medicine && medicine.vendor) {
            vendorId = medicine.vendor;
            console.log('🔍 Found vendor from medicine record:', vendorId);
          }
        }
        
        // Fallback to cart item vendor info if available
        if (!vendorId) {
          vendorId = cartItems[0].vendorId || cartItems[0].vendor?._id;
        }
      }
      
      // If still no vendor found, find any pharmacy vendor as fallback
      if (!vendorId) {
        const User = (await import('../models/User.js')).default;
        const pharmacyVendor = await User.findOne({ role: 'pharmacy_vendor' });
        if (pharmacyVendor) {
          vendorId = pharmacyVendor._id;
          console.log('🏪 Using fallback pharmacy vendor:', vendorId);
        } else {
          // Last resort: use customer ID (this should be avoided)
          vendorId = req.user.id;
          console.log('⚠️ No vendor found, using customer ID as fallback:', vendorId);
        }
      }

      console.log('💰 Using vendorId for payment:', vendorId);

      // Create payment record with the SSL Commerce transaction ID
      const payment = new Payment({
        orderId: order._id,
        userId: req.user.id,
        vendorId: vendorId,
        amount,
        paymentMethod: gateway,
        status: 'pending',
        transactionId: paymentResponse.data.transactionId, // Store SSL Commerce transaction ID for callback lookup
        paymentDetails: {
          ...paymentResponse.data,
          customerInfo: customerData,
          gatewayData: paymentResponse.data,
          sslSessionKey: paymentResponse.data.sessionkey // Store session key for reference
        }
      });
      
      await payment.save();
      console.log('💳 Payment record created:', payment._id, 'with transaction ID:', payment.transactionId);

      // Return response with redirect URL for gateways that need it
      const responseData = {
        success: true,
        message: `${gateway} payment initialized successfully`,
        data: {
          paymentId: payment._id,
          orderId: order._id,
          amount,
          currency,
          gateway,
          ...paymentResponse.data
        }
      };

      // Add specific URLs for different gateways
      if (paymentResponse.data.GatewayPageURL) {
        responseData.redirectUrl = paymentResponse.data.GatewayPageURL;
        responseData.GatewayPageURL = paymentResponse.data.GatewayPageURL;
      }
      if (paymentResponse.data.redirectUrl) {
        responseData.redirectUrl = paymentResponse.data.redirectUrl;
      }
      if (paymentResponse.data.paymentUrl) {
        responseData.redirectUrl = paymentResponse.data.paymentUrl;
      }

      res.json(responseData);
    } else {
      // Delete the order if payment initialization failed
      await Order.findByIdAndDelete(order._id);
      
      res.status(400).json({
        success: false,
        message: paymentResponse.error || 'Failed to initialize payment'
      });
    }

  } catch (error) {
    console.error('Payment initialization error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: error.message
    });
  }
});

// Verify payment status (for callbacks and status checks)
router.get('/verify/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { gateway } = req.query;

    console.log('🔍 Verifying payment:', { transactionId, gateway });

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }

    // Find payment by transaction ID
    let payment = await Payment.findOne({
      $or: [
        { transactionId: transactionId },
        { 'paymentDetails.sessionkey': transactionId },
        { 'paymentDetails.sslSessionKey': transactionId },
        { 'paymentDetails.paymentId': transactionId }
      ]
    }).populate('orderId');

    if (!payment) {
      console.log('❌ Payment not found for transaction:', transactionId);
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
        status: 'unknown'
      });
    }

    console.log('✅ Payment found:', {
      paymentId: payment._id,
      status: payment.status,
      gateway: payment.paymentMethod,
      amount: payment.amount
    });

    // If payment is already completed, return the status
    if (payment.status === 'completed') {
      return res.json({
        success: true,
        status: 'VALID',
        message: 'Payment completed successfully',
        transactionId: payment._id,
        gateway: payment.paymentMethod,
        amount: payment.amount,
        orderId: payment.orderId,
        completedAt: payment.completedAt
      });
    }

    // If payment is failed, return failed status
    if (payment.status === 'failed') {
      return res.json({
        success: false,
        status: 'FAILED',
        message: 'Payment failed',
        transactionId: payment._id,
        gateway: payment.paymentMethod,
        failureReason: payment.failureReason
      });
    }

    // For pending payments, try to verify with the gateway
    if (gateway && payment.paymentMethod === gateway) {
      try {
        const verificationResult = await paymentGatewayService.verifyPayment(gateway, {
          paymentId: payment._id,
          transactionId,
          sessionkey: payment.paymentDetails?.sslSessionKey,
          ...payment.paymentDetails
        });

        if (verificationResult.success) {
          // Update payment status
          payment.status = 'completed';
          payment.completedAt = new Date();
          payment.verificationData = verificationResult.data;
          await payment.save();

          // Update order status
          if (payment.orderId) {
            payment.orderId.paymentStatus = 'paid';
            payment.orderId.status = 'confirmed';
            await payment.orderId.save();
          }

          return res.json({
            success: true,
            status: 'VALID',
            message: 'Payment verified and completed',
            transactionId: payment._id,
            gateway: payment.paymentMethod,
            amount: payment.amount,
            verificationData: verificationResult.data
          });
        }
      } catch (verifyError) {
        console.error('Gateway verification error:', verifyError);
      }
    }

    // Return current status
    res.json({
      success: payment.status === 'completed',
      status: payment.status.toUpperCase(),
      message: `Payment is ${payment.status}`,
      transactionId: payment._id,
      gateway: payment.paymentMethod,
      amount: payment.amount,
      createdAt: payment.createdAt
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
});

// Stripe payment initiation
router.post('/stripe/create', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Check if order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const user = await User.findById(req.user.id);
    const paymentResponse = await paymentGatewayService.createPayment('stripe', {
      amount,
      orderId,
      customer: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`
      }
    });
    
    if (paymentResponse.success) {
      // Create payment record
      const payment = new Payment({
        orderId,
        amount,
        paymentMethod: 'stripe',
        status: 'pending',
        userId: req.user.id,
        paymentDetails: {
          stripePaymentIntentId: paymentResponse.data.id,
          clientSecret: paymentResponse.data.client_secret
        }
      });
      
      await payment.save();
      
      res.json({
        success: true,
        message: 'Stripe payment created successfully',
        data: {
          paymentId: payment._id,
          clientSecret: paymentResponse.data.client_secret,
          stripe: paymentResponse.data
        }
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: paymentResponse.error 
      });
    }
  } catch (error) {
    console.error('Stripe payment creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment',
      error: error.message 
    });
  }
});

// SSLCommerz payment initiation
router.post('/sslcommerz/create', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Check if order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const user = await User.findById(req.user.id);
    const paymentResponse = await paymentGatewayService.createPayment('sslcommerz', {
      amount,
      orderId,
      customer: {
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone || '01700000000',
        address: user.address || 'Dhaka, Bangladesh'
      }
    });
    
    if (paymentResponse.success) {
      // Create payment record
      const payment = new Payment({
        orderId,
        amount,
        paymentMethod: 'sslcommerz',
        status: 'pending',
        userId: req.user.id,
        paymentDetails: {
          sslSessionKey: paymentResponse.data.sessionkey,
          gatewayPageURL: paymentResponse.data.GatewayPageURL
        }
      });
      
      await payment.save();
      
      res.json({
        success: true,
        message: 'SSLCommerz payment created successfully',
        data: {
          paymentId: payment._id,
          paymentUrl: paymentResponse.data.GatewayPageURL,
          sessionkey: paymentResponse.data.sessionkey
        }
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: paymentResponse.error 
      });
    }
  } catch (error) {
    console.error('SSLCommerz payment creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment',
      error: error.message 
    });
  }
});

// Nagad payment initiation (Demo)
router.post('/nagad/create', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Check if order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const paymentResponse = await paymentGatewayService.createPayment('nagad', {
      amount,
      orderId
    });
    
    if (paymentResponse.success) {
      // Create payment record
      const payment = new Payment({
        orderId,
        amount,
        paymentMethod: 'nagad',
        status: 'pending',
        userId: req.user.id,
        paymentDetails: {
          nagadPaymentId: paymentResponse.data.paymentId,
          paymentUrl: paymentResponse.data.paymentUrl
        }
      });
      
      await payment.save();
      
      res.json({
        success: true,
        message: 'Nagad payment created successfully (Demo)',
        data: {
          paymentId: payment._id,
          paymentUrl: paymentResponse.data.paymentUrl,
          nagadPaymentId: paymentResponse.data.paymentId
        }
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: paymentResponse.error 
      });
    }
  } catch (error) {
    console.error('Nagad payment creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment',
      error: error.message 
    });
  }
});

// Rocket payment initiation (Demo)
router.post('/rocket/create', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Check if order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const paymentResponse = await paymentGatewayService.createPayment('rocket', {
      amount,
      orderId
    });
    
    if (paymentResponse.success) {
      // Create payment record
      const payment = new Payment({
        orderId,
        amount,
        paymentMethod: 'rocket',
        status: 'pending',
        userId: req.user.id,
        paymentDetails: {
          rocketPaymentId: paymentResponse.data.paymentId,
          paymentUrl: paymentResponse.data.paymentUrl
        }
      });
      
      await payment.save();
      
      res.json({
        success: true,
        message: 'Rocket payment created successfully (Demo)',
        data: {
          paymentId: payment._id,
          paymentUrl: paymentResponse.data.paymentUrl,
          rocketPaymentId: paymentResponse.data.paymentId
        }
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: paymentResponse.error 
      });
    }
  } catch (error) {
    console.error('Rocket payment creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment',
      error: error.message 
    });
  }
});

// Dummy payment initiation (for testing)
router.post('/dummy/create', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Check if order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const paymentResponse = await paymentGatewayService.createPayment('dummy', {
      amount,
      orderId
    });
    
    if (paymentResponse.success) {
      // Create payment record
      const payment = new Payment({
        orderId,
        amount,
        paymentMethod: 'dummy',
        status: 'pending',
        userId: req.user.id,
        paymentDetails: {
          dummyPaymentId: paymentResponse.data.paymentId,
          paymentUrl: paymentResponse.data.paymentUrl
        }
      });
      
      await payment.save();
      
      res.json({
        success: true,
        message: 'Dummy payment created successfully (Test Mode)',
        data: {
          paymentId: payment._id,
          paymentUrl: paymentResponse.data.paymentUrl,
          dummyPaymentId: paymentResponse.data.paymentId,
          note: 'This is a test payment. Use any test data to complete.'
        }
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: paymentResponse.error 
      });
    }
  } catch (error) {
    console.error('Dummy payment creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment',
      error: error.message 
    });
  }
});

// Generic payment verification endpoint
router.post('/verify/:gateway', authenticateToken, async (req, res) => {
  try {
    const { gateway } = req.params;
    const { paymentId, ...verificationData } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Payment ID is required'
      });
    }

    // Find payment record
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Verify user owns this payment
    if (payment.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let verificationResult;

    switch (gateway) {
      case 'stripe':
        verificationResult = await paymentGatewayService.verifyPayment('stripe', {
          paymentIntentId: payment.paymentDetails.stripePaymentIntentId,
          ...verificationData
        });
        break;
      
      case 'sslcommerz':
        verificationResult = await paymentGatewayService.verifyPayment('sslcommerz', {
          sessionkey: payment.paymentDetails.sslSessionKey,
          ...verificationData
        });
        break;
      
      case 'nagad':
      case 'rocket':
      case 'dummy':
        // For demo gateways, auto-approve based on test data
        verificationResult = await paymentGatewayService.verifyPayment(gateway, {
          paymentId: payment._id,
          ...verificationData
        });
        break;
      
      default:
        return res.status(400).json({
          success: false,
          message: 'Unsupported payment gateway'
        });
    }

    if (verificationResult.success) {
      // Update payment status
      payment.status = 'completed';
      payment.completedAt = new Date();
      payment.verificationData = verificationResult.data;
      await payment.save();

      // Update order status
      const order = await Order.findById(payment.orderId);
      if (order) {
        order.paymentStatus = 'paid';
        order.status = 'confirmed';
        await order.save();
      }

      res.json({
        success: true,
        message: 'Payment verified successfully',
        data: {
          paymentId: payment._id,
          status: payment.status,
          verificationData: verificationResult.data
        }
      });
    } else {
      // Update payment status to failed
      payment.status = 'failed';
      payment.failureReason = verificationResult.error;
      await payment.save();

      res.status(400).json({
        success: false,
        message: verificationResult.error
      });
    }

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
});

// Get payment by ID (for success page)
router.get('/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findById(paymentId)
      .populate('orderId', 'tracking_id status')
      .populate('userId', 'firstName lastName email');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Check if payment belongs to user (unless admin)
    if (payment.userId._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(payment);
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ================= SSLCommerz Callback Routes =================

// SSLCommerz Success Callback
router.post('/sslcommerz/success', async (req, res) => {
  try {
    console.log('🎉 SSLCommerz Success Callback received:', req.body);
    console.log('📋 Request headers:', req.headers);
    console.log('🔍 Request method:', req.method);
    console.log('🌐 Request URL:', req.url);
    
    // Parse callback data (SSL Commerce sends form data)
    let callbackData = req.body;
    
    // Log all available data for debugging
    console.log('📊 Full callback data keys:', Object.keys(callbackData));
    console.log('📋 Callback data values:', callbackData);
    
    const { 
      tran_id, 
      status, 
      amount, 
      currency,
      bank_tran_id,
      card_type,
      card_no,
      card_issuer,
      card_brand,
      val_id,
      value_a: orderId, // Order ID stored in value_a
      value_b: frontendUrl, // Frontend URL stored in value_b
      gateway // This might be from our frontend
    } = callbackData;

    console.log('🔍 Extracted callback data:', {
      tran_id,
      status,
      amount,
      orderId,
      frontendUrl,
      hasData: Object.keys(callbackData).length > 0
    });

    // Check if this is a JSON API request from our frontend
    const isApiRequest = req.headers['content-type']?.includes('application/json');

    // If we don't have transaction data from SSL Commerce, 
    // this might be an empty callback or test environment issue
    if (!tran_id && Object.keys(callbackData).length === 0) {
      console.log('⚠️ Empty callback received - SSL Commerce sandbox might be having issues');
      const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${redirectUrl}/payment/failed/empty-callback?error=no_transaction_data`);
    }

    // For SSL Commerce, SUCCESS, VALID, or VALIDATED statuses are considered successful
    if (status === 'VALID' || status === 'SUCCESS' || status === 'VALIDATED' || gateway === 'sslcommerz') {
      // Find the payment record by transaction ID
      let payment = await Payment.findOne({
        transactionId: tran_id
      }).populate('orderId');

      if (payment) {
        // Update payment status
        payment.status = 'completed';
        payment.completedAt = new Date();
        payment.paymentDetails = {
          ...payment.paymentDetails,
          sslTransactionId: tran_id,
          sslBankTransactionId: bank_tran_id,
          sslCardType: card_type,
          sslCardNo: card_no,
          sslCardIssuer: card_issuer,
          sslCardBrand: card_brand,
          sslVerifyKey: val_id,
          gatewayResponse: JSON.stringify(req.body)
        };
        await payment.save();

        // Update order status if exists
        if (payment.orderId) {
          payment.orderId.status = 'confirmed';
          payment.orderId.paymentStatus = 'paid';
          await payment.orderId.save();
        }

        // Clear user's cart after successful payment
        await User.findByIdAndUpdate(payment.userId, { 
          $set: { cart: [] } 
        });

        console.log('✅ Payment completed successfully:', payment._id);
        console.log('🛒 User cart cleared after successful payment');
        
        // Return JSON for API requests, redirect for form submissions
        if (isApiRequest) {
          return res.json({
            success: true,
            message: 'Payment completed successfully',
            paymentId: payment._id,
            payment: payment
          });
        } else {
          // Redirect to frontend success page with transaction ID
          const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
          const redirectUrl = `${redirectFrontendUrl}/payment/success/${tran_id}?status=valid&amount=${amount}&orderId=${orderId}`;
          
          console.log('🔄 Redirecting to frontend success page:', redirectUrl);
          return res.redirect(redirectUrl);
        }
      } else {
        console.error('❌ Payment not found for transaction:', tran_id);
        if (isApiRequest) {
          return res.status(404).json({
            success: false,
            error: 'payment_not_found',
            message: 'Payment not found'
          });
        } else {
          const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
          res.redirect(`${redirectFrontendUrl}/payment/failed/payment-not-found?tranId=${tran_id}`);
        }
      }
    } else {
      console.error('❌ Invalid SSLCommerz transaction status:', status);
      if (isApiRequest) {
        return res.status(400).json({
          success: false,
          error: 'invalid_status',
          message: 'Invalid transaction status'
        });
      } else {
        const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${redirectFrontendUrl}/payment/failed/invalid-status?tranId=${tran_id}`);
      }
    }
  } catch (error) {
    console.error('SSLCommerz success callback error:', error);
    const isApiRequest = req.headers['content-type']?.includes('application/json');
    
    if (isApiRequest) {
      return res.status(500).json({
        success: false,
        error: 'callback_error',
        message: 'Payment callback processing failed'
      });
    } else {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/payment/failed/callback-error`);
    }
  }
});

// SSLCommerz Success Callback (GET version for when POST fails due to JS errors)
router.get('/sslcommerz/success', async (req, res) => {
  try {
    console.log('🎉 SSLCommerz Success Callback (GET) received:', req.query);
    console.log('📋 Request headers:', req.headers);
    
    const { 
      tran_id, 
      status, 
      amount, 
      currency,
      bank_tran_id,
      card_type,
      val_id,
      value_a: orderId, // Order ID stored in value_a
      value_b: frontendUrl // Frontend URL stored in value_b
    } = req.query;

    if (status === 'VALID') {
      // Find the payment record by transaction ID
      const payment = await Payment.findOne({
        transactionId: tran_id
      }).populate('orderId');

      if (payment) {
        // Update payment status
        payment.status = 'completed';
        payment.completedAt = new Date();
        payment.paymentDetails = {
          ...payment.paymentDetails,
          sslTransactionId: tran_id,
          sslBankTransactionId: bank_tran_id,
          sslCardType: card_type,
          sslVerifyKey: val_id,
          gatewayResponse: JSON.stringify(req.query),
          receivedViaGet: true // Flag to indicate this came via GET
        };
        await payment.save();

        // Update order status if exists
        if (payment.orderId) {
          payment.orderId.status = 'confirmed';
          payment.orderId.paymentStatus = 'paid';
          await payment.orderId.save();
        }

        // Clear user's cart after successful payment
        await User.findByIdAndUpdate(payment.userId, { 
          $set: { cart: [] } 
        });

        console.log('✅ Payment completed successfully (via GET):', payment._id);
        console.log('🛒 User cart cleared after successful payment');
        
        // Redirect to frontend success page with transaction details
        const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${redirectFrontendUrl}/payment/success/${tran_id}?status=valid&amount=${amount}&orderId=${orderId}`;
        
        console.log('🔄 Redirecting to frontend success page (GET):', redirectUrl);
        res.redirect(redirectUrl);
      } else {
        console.error('❌ Payment not found for transaction (GET):', tran_id);
        const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${redirectFrontendUrl}/payment/failed/payment-not-found?tranId=${tran_id}`);
      }
    } else {
      console.error('❌ Invalid SSLCommerz transaction status (GET):', status);
      const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${redirectFrontendUrl}/payment/failed/invalid-status?tranId=${tran_id}`);
    }
  } catch (error) {
    console.error('SSLCommerz success callback (GET) error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/payment/failed/callback-error`);
  }
});

// SSLCommerz Fail Callback
router.post('/sslcommerz/fail', async (req, res) => {
  try {
    console.log('❌ SSLCommerz Fail Callback received:', req.body);
    
    const { 
      tran_id, 
      status, 
      failedreason,
      value_a: orderId,
      value_b: frontendUrl
    } = req.body;

    // Find the payment record by transaction ID
    const payment = await Payment.findOne({
      transactionId: tran_id
    });

    if (payment) {
      // Update payment status to failed
      payment.status = 'failed';
      payment.failureReason = failedreason || 'Payment failed';
      payment.paymentDetails = {
        ...payment.paymentDetails,
        gatewayResponse: JSON.stringify(req.body)
      };
      await payment.save();

      console.log('❌ Payment marked as failed:', payment._id);
    }

    // Redirect to frontend failure page with transaction details
    const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
    const tranIdForUrl = tran_id || 'unknown-transaction';
    const redirectUrl = `${redirectFrontendUrl}/payment/failed/${tranIdForUrl}?reason=${encodeURIComponent(failedreason || 'Payment failed')}&orderId=${orderId || 'unknown'}`;
    
    console.log('❌ Redirecting to frontend failure page:', redirectUrl);
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('SSLCommerz fail callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/payment/failed/callback-error`);
  }
});

// SSLCommerz Fail Callback (GET version)
router.get('/sslcommerz/fail', async (req, res) => {
  try {
    console.log('❌ SSLCommerz Fail Callback (GET) received:', req.query);
    
    const { tran_id, status, failedreason } = req.query;

    // Find the payment record by transaction ID
    const payment = await Payment.findOne({
      transactionId: tran_id
    });

    if (payment) {
      // Update payment status to failed
      payment.status = 'failed';
      payment.failureReason = failedreason || 'Payment failed';
      payment.paymentDetails = {
        ...payment.paymentDetails,
        gatewayResponse: JSON.stringify(req.query),
        receivedViaGet: true
      };
      await payment.save();

      console.log('❌ Payment marked as failed (GET):', payment._id);
    }

    // Redirect to frontend failure page with dynamic route
    const tranId = payment?.transactionId || tran_id || 'unknown';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/payment/failed/${tranId}`;
    
    console.log('❌ Redirecting to frontend failure page (GET):', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('SSLCommerz fail callback (GET) error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/failed/callback-error`);
  }
});

// SSLCommerz Cancel Callback
router.post('/sslcommerz/cancel', async (req, res) => {
  try {
    console.log('🚫 SSLCommerz Cancel Callback received:', req.body);
    
    const { 
      tran_id,
      value_a: orderId,
      value_b: frontendUrl
    } = req.body;

    // Find the payment record by transaction ID
    const payment = await Payment.findOne({
      transactionId: tran_id
    });

    if (payment) {
      // Update payment status to cancelled
      payment.status = 'cancelled';
      payment.paymentDetails = {
        ...payment.paymentDetails,
        gatewayResponse: JSON.stringify(req.body)
      };
      await payment.save();

      console.log('🚫 Payment cancelled:', payment._id);
    }

    // Redirect to frontend with cancellation message
    const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${redirectFrontendUrl}/payment/cancelled/${tran_id}?orderId=${orderId}`;
    
    console.log('🚫 Redirecting to frontend cancelled page:', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('SSLCommerz cancel callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/payment/failed/callback-error`);
  }
});

// SSLCommerz Cancel Callback (GET version)
router.get('/sslcommerz/cancel', async (req, res) => {
  try {
    console.log('🚫 SSLCommerz Cancel Callback (GET) received:', req.query);
    
    const { tran_id } = req.query;

    // Find the payment record by transaction ID
    const payment = await Payment.findOne({
      transactionId: tran_id
    });

    if (payment) {
      // Update payment status to cancelled
      payment.status = 'cancelled';
      payment.paymentDetails = {
        ...payment.paymentDetails,
        gatewayResponse: JSON.stringify(req.query),
        receivedViaGet: true
      };
      await payment.save();

      console.log('🚫 Payment cancelled (GET):', payment._id);
    }

    // Redirect to frontend with cancellation message using dynamic route
    const tranId = payment?.transactionId || tran_id || 'unknown';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/payment/cancelled/${tranId}`;
    
    console.log('🚫 Redirecting to frontend cancelled page (GET):', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('SSLCommerz cancel callback (GET) error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/failed/callback-error`);
  }
});

// SSLCommerz IPN (Instant Payment Notification)
router.post('/sslcommerz/ipn', async (req, res) => {
  try {
    console.log('📡 SSLCommerz IPN received:', req.body);
    
    const { tran_id, status, val_id } = req.body;

    // Validate the IPN with SSLCommerz
    const validation = await paymentGatewayService.verifyPayment('sslcommerz', {
      transactionId: tran_id,
      validationId: val_id
    });

    if (validation.success && status === 'VALID') {
      // Find and update payment
      const payment = await Payment.findOne({
        transactionId: tran_id
      }).populate('orderId');

      if (payment && payment.status !== 'completed') {
        payment.status = 'completed';
        payment.paymentDetails = {
          ...payment.paymentDetails,
          ipnData: JSON.stringify(req.body)
        };
        await payment.save();

        // Update order if exists
        if (payment.orderId) {
          payment.orderId.status = 'confirmed';
          payment.orderId.paymentStatus = 'paid';
          await payment.orderId.save();
        }

        console.log('✅ IPN processed successfully for payment:', payment._id);
      }
    }

    // Always respond with 200 to acknowledge IPN
    res.status(200).send('IPN received');
  } catch (error) {
    console.error('SSLCommerz IPN error:', error);
    res.status(500).send('IPN processing failed');
  }
});

// Process SSLCommerz success for sandbox (when frontend callback is used)
router.post('/process-success', authenticateToken, async (req, res) => {
  try {
    console.log('🎉 Processing SSLCommerz sandbox success for user:', req.user.id);
    console.log('📋 Request body:', req.body);
    
    const { gateway, status, sandbox, tranId } = req.body;

    if (gateway === 'sslcommerz' && status === 'success') {
      // Find the payment by transaction ID if provided, otherwise find the most recent pending payment
      let payment;
      
      if (tranId) {
        payment = await Payment.findOne({
          userId: req.user.id,
          paymentMethod: 'sslcommerz',
          transactionId: tranId,
          status: 'pending'
        }).populate('orderId');
        console.log('🔍 Looking for payment with tranId:', tranId);
      }
      
      if (!payment) {
        // Fallback: Find the most recent pending SSLCommerz payment for this user
        payment = await Payment.findOne({
          userId: req.user.id,
          paymentMethod: 'sslcommerz',
          status: 'pending'
        }).populate('orderId').sort({ createdAt: -1 });
        console.log('🔍 Fallback: Found most recent pending payment');
      }

      if (payment) {
        // Update payment status
        payment.status = 'completed';
        payment.paymentDetails = {
          ...payment.paymentDetails,
          sandbox: true,
          processedAt: new Date(),
          tranId: tranId || payment.transactionId,
          gatewayResponse: JSON.stringify(req.body)
        };
        await payment.save();

        // Update order status if exists
        if (payment.orderId) {
          payment.orderId.status = 'confirmed';
          payment.orderId.paymentStatus = 'paid';
          await payment.orderId.save();
        }

        // Clear user's cart after successful payment
        await User.findByIdAndUpdate(req.user.id, { 
          $set: { cart: [] } 
        });

        console.log('✅ SSLCommerz sandbox payment completed successfully:', payment._id);
        console.log('💰 Vendor earnings: ৳', payment.vendorEarnings);
        console.log('🏢 Medzy revenue: ৳', payment.medzyRevenue);
        console.log('🛒 User cart cleared after successful payment');
        
        return res.json({
          success: true,
          message: 'Payment completed successfully',
          payment: payment
        });
      } else {
        console.error('❌ No pending SSLCommerz payment found for user:', req.user.id);
        return res.status(404).json({
          success: false,
          error: 'payment_not_found',
          message: 'No pending payment found'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: 'Invalid payment processing request'
      });
    }
  } catch (error) {
    console.error('SSLCommerz success processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'processing_error',
      message: 'Payment processing failed'
    });
  }
});

// Process SSLCommerz failure for sandbox (when frontend callback is used)
router.post('/process-failure', authenticateToken, async (req, res) => {
  try {
    console.log('❌ Processing SSLCommerz sandbox failure for user:', req.user.id);
    console.log('📋 Request body:', req.body);
    
    const { gateway, status, sandbox } = req.body;

    if (gateway === 'sslcommerz' && status === 'failed') {
      // Find the most recent pending SSLCommerz payment for this user
      const payment = await Payment.findOne({
        userId: req.user.id,
        paymentMethod: 'sslcommerz',
        status: 'pending'
      }).populate('orderId').sort({ createdAt: -1 });

      if (payment) {
        // Update payment status
        payment.status = 'failed';
        payment.paymentDetails = {
          ...payment.paymentDetails,
          sandbox: true,
          failedAt: new Date(),
          gatewayResponse: JSON.stringify(req.body)
        };
        await payment.save();

        // Update order status if exists
        if (payment.orderId) {
          payment.orderId.status = 'cancelled';
          payment.orderId.paymentStatus = 'failed';
          await payment.orderId.save();
        }

        console.log('❌ SSLCommerz sandbox payment failed:', payment._id);
        
        return res.json({
          success: true,
          message: 'Payment failure processed',
          payment: payment
        });
      } else {
        console.error('❌ No pending SSLCommerz payment found for user:', req.user.id);
        return res.status(404).json({
          success: false,
          error: 'payment_not_found',
          message: 'No pending payment found'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: 'Invalid payment processing request'
      });
    }
  } catch (error) {
    console.error('SSLCommerz failure processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'processing_error',
      message: 'Payment failure processing failed'
    });
  }
});

// ================= TEST ENDPOINT FOR SSL COMMERCE CALLBACKS =================

// Test SSL Commerce Success Callback (for development/testing)
router.post('/test-sslcommerz-success/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    console.log('🧪 Testing SSL Commerce success callback for transaction:', transactionId);
    
    // Find the payment record
    const payment = await Payment.findOne({ transactionId }).populate('orderId');
    
    if (!payment) {
      return res.json({
        success: false,
        error: 'Payment not found',
        transactionId
      });
    }
    
    // Simulate SSL Commerce success callback data
    const simulatedCallbackData = {
      tran_id: transactionId,
      status: 'VALID',
      amount: payment.amount.toString(),
      currency: 'BDT',
      bank_tran_id: `TEST_BANK_${Date.now()}`,
      card_type: 'TEST-CARD',
      card_no: '****1234',
      card_issuer: 'Test Bank',
      card_brand: 'VISA',
      val_id: `VAL_${Date.now()}`,
      value_a: payment.orderId?._id?.toString() || '',
      value_b: process.env.FRONTEND_URL || 'http://localhost:5173'
    };
    
    // Update payment status
    payment.status = 'completed';
    payment.completedAt = new Date();
    payment.paymentDetails = {
      ...payment.paymentDetails,
      sslTransactionId: transactionId,
      sslBankTransactionId: simulatedCallbackData.bank_tran_id,
      sslCardType: simulatedCallbackData.card_type,
      sslCardNo: simulatedCallbackData.card_no,
      sslCardIssuer: simulatedCallbackData.card_issuer,
      sslCardBrand: simulatedCallbackData.card_brand,
      sslVerifyKey: simulatedCallbackData.val_id,
      gatewayResponse: JSON.stringify(simulatedCallbackData)
    };
    await payment.save();

    // Update order status if exists
    if (payment.orderId) {
      payment.orderId.status = 'confirmed';
      payment.orderId.paymentStatus = 'paid';
      await payment.orderId.save();
    }

    // Clear user's cart after successful payment
    await User.findByIdAndUpdate(payment.userId, { 
      $set: { cart: [] } 
    });

    console.log('✅ Test payment completed successfully:', payment._id);
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/payment/success/${transactionId}?status=valid&amount=${payment.amount}&orderId=${payment.orderId?._id || ''}&test=true`;
    
    return res.json({
      success: true,
      message: 'Test payment completed successfully',
      paymentId: payment._id,
      redirectUrl,
      callbackData: simulatedCallbackData
    });
    
  } catch (error) {
    console.error('Test SSL Commerce callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'test_callback_error',
      message: error.message
    });
  }
});

// ================= END TEST ENDPOINTS =================

// ================= BKASH REFUND ENDPOINTS =================

// Process bKash refund (Admin only)
router.post('/bkash/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentID, amount, trxID, reason, supportTicketId } = req.body;

    if (!paymentID || !amount || !trxID) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: paymentID, amount, trxID'
      });
    }

    // Import bKash service
    const BkashService = (await import('../services/bkashService.js')).default;
    const bkashService = new BkashService();

    // Find the payment first
    const payment = await Payment.findOne({
      $or: [
        { 'paymentDetails.bkashPaymentID': paymentID },
        { 'paymentDetails.bkashTransactionID': trxID }
      ]
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Process refund through bKash
    const refundResult = await bkashService.refundTransaction({
      paymentID,
      amount: parseFloat(amount).toFixed(2),
      trxID,
      sku: 'MEDZY_REFUND'
    });

    if (refundResult.success) {
      // Update payment status in database
      payment.status = 'refunded';
      payment.refundDetails = {
        refundAmount: amount,
        refundReason: reason || 'Admin initiated refund',
        refundDate: new Date(),
        refundTrxID: refundResult.refundTrxID,
        refundMethod: 'bkash',
        processedBy: req.user.id,
        supportTicketId: supportTicketId || null
      };
      await payment.save();

      // Process revenue adjustments and customer points
      try {
        const adjustments = await processRefundAdjustments(
          payment, 
          parseFloat(amount), 
          supportTicketId, 
          req.user.id
        );

        res.json({
          success: true,
          message: 'Refund processed successfully',
          data: {
            refundTrxID: refundResult.refundTrxID,
            amount: refundResult.amount,
            currency: refundResult.currency,
            transactionStatus: refundResult.transactionStatus,
            adjustments: {
              revenueAdjustmentId: adjustments.revenueAdjustment._id,
              pointsAwarded: adjustments.pointsAwarded,
              customerPointBalance: adjustments.customerPoints
            }
          }
        });
      } catch (adjustmentError) {
        console.error('Refund processed but adjustments failed:', adjustmentError);
        res.json({
          success: true,
          message: 'Refund processed successfully, but some adjustments failed',
          warning: 'Revenue adjustments and customer points may need manual processing',
          data: {
            refundTrxID: refundResult.refundTrxID,
            amount: refundResult.amount,
            currency: refundResult.currency,
            transactionStatus: refundResult.transactionStatus
          }
        });
      }
    } else {
      res.status(400).json({
        success: false,
        message: refundResult.message || 'Refund failed',
        error: refundResult.error
      });
    }
  } catch (error) {
    console.error('bKash refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during refund process',
      error: error.message
    });
  }
});

// Check bKash refund status (Admin only)
router.get('/bkash/refund-status/:paymentID/:trxID', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentID, trxID } = req.params;

    // Import bKash service
    const BkashService = (await import('../services/bkashService.js')).default;
    const bkashService = new BkashService();

    // Check refund status
    const statusResult = await bkashService.checkRefundStatus(paymentID, trxID);

    if (statusResult.success) {
      res.json({
        success: true,
        message: 'Refund status retrieved successfully',
        data: statusResult.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: statusResult.message || 'Failed to check refund status',
        error: statusResult.error
      });
    }
  } catch (error) {
    console.error('bKash refund status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during refund status check',
      error: error.message
    });
  }
});

// Get payment details for refund (Admin only)
router.get('/:paymentId/refund-details', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId)
      .populate('userId', 'firstName lastName email phone')
      .populate('orderId', 'orderNumber items totalAmount')
      .populate('vendorId', 'firstName lastName email businessName');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if payment is eligible for refund
    const isRefundable = ['completed', 'settled'].includes(payment.status) && 
                        payment.paymentMethod === 'bkash' &&
                        payment.paymentDetails.bkashPaymentID;

    res.json({
      success: true,
      payment: {
        _id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        createdAt: payment.createdAt,
        customer: payment.userId,
        order: payment.orderId,
        vendor: payment.vendorId,
        paymentDetails: payment.paymentDetails,
        refundDetails: payment.refundDetails,
        isRefundable
      }
    });
  } catch (error) {
    console.error('Error fetching payment refund details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Process manual refund (Admin only) - for non-bKash payments
router.post('/:paymentId/manual-refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason, refundMethod, supportTicketId } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Validate refund amount
    if (!amount || amount <= 0 || amount > payment.amount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid refund amount'
      });
    }

    // Update payment with manual refund
    payment.status = 'refunded';
    payment.refundDetails = {
      refundAmount: amount,
      refundReason: reason || 'Manual refund by admin',
      refundDate: new Date(),
      refundMethod: refundMethod || 'manual',
      processedBy: req.user.id,
      isManualRefund: true,
      supportTicketId: supportTicketId || null
    };
    await payment.save();

    // Process revenue adjustments and customer points
    try {
      const adjustments = await processRefundAdjustments(
        payment, 
        parseFloat(amount), 
        supportTicketId, 
        req.user.id
      );

      res.json({
        success: true,
        message: 'Manual refund processed successfully',
        refundDetails: payment.refundDetails,
        adjustments: {
          revenueAdjustmentId: adjustments.revenueAdjustment._id,
          pointsAwarded: adjustments.pointsAwarded,
          customerPointBalance: adjustments.customerPoints
        }
      });
    } catch (adjustmentError) {
      console.error('Manual refund processed but adjustments failed:', adjustmentError);
      res.json({
        success: true,
        message: 'Manual refund processed successfully, but some adjustments failed',
        warning: 'Revenue adjustments and customer points may need manual processing',
        refundDetails: payment.refundDetails
      });
    }
  } catch (error) {
    console.error('Manual refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during manual refund',
      error: error.message
    });
  }
});

// Get refund history for a payment (Admin only)
router.get('/:paymentId/refund-history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId)
      .populate('refundDetails.processedBy', 'firstName lastName email');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      refundHistory: payment.refundDetails ? [payment.refundDetails] : []
    });
  } catch (error) {
    console.error('Error fetching refund history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// ================= END BKASH REFUND ENDPOINTS =================

export default router;
