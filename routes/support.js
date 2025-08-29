import express from 'express';
import Support from '../models/Support.js';
import CustomerPoint from '../models/CustomerPoint.js';
import RevenueAdjustment from '../models/RevenueAdjustment.js';
import { authenticateToken, requireAdmin, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Submit support ticket (Customer only)
router.post('/', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const { 
      type, 
      subject, 
      message, 
      priority = 'medium',
      category = 'general',
      relatedPaymentId,
      relatedOrderId,
      requestedRefundAmount,
      refundReason
    } = req.body;

    const ticketData = {
      customerId: req.user.id,
      type,
      subject,
      message,
      status: 'open',
      priority,
      category
    };

    // Add payment-related fields if provided
    if (relatedPaymentId) ticketData.relatedPaymentId = relatedPaymentId;
    if (relatedOrderId) ticketData.relatedOrderId = relatedOrderId;
    if (requestedRefundAmount) ticketData.requestedRefundAmount = requestedRefundAmount;
    if (refundReason) ticketData.refundReason = refundReason;

    const ticket = new Support(ticketData);
    await ticket.save();

    // Populate the ticket for response
    await ticket.populate('relatedPaymentId', 'transactionId amount status paymentMethod');
    await ticket.populate('relatedOrderId', 'orderNumber totalAmount');

    res.status(201).json({
      message: 'Support ticket created successfully',
      ticket: {
        id: ticket._id,
        customerId: ticket.customerId,
        type: ticket.type,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        relatedPayment: ticket.relatedPaymentId,
        relatedOrder: ticket.relatedOrderId,
        requestedRefundAmount: ticket.requestedRefundAmount,
        refundReason: ticket.refundReason,
        createdAt: ticket.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all support tickets (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📋 Fetching support tickets for admin');
    
    const { 
      status, 
      type, 
      priority, 
      category,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const tickets = await Support.find(filter)
      .populate('customerId', 'firstName lastName email phone')
      .populate('relatedPaymentId', 'transactionId amount status paymentMethod createdAt')
      .populate('relatedOrderId', 'orderNumber totalAmount status')
      .populate('respondedBy', 'firstName lastName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Support.countDocuments(filter);

    console.log(`📊 Found ${tickets.length} support tickets`);

    const ticketList = tickets.map(ticket => {
      // Handle cases where customerId might be null (deleted user)
      const customer = ticket.customerId;
      
      return {
        id: ticket._id,
        customerId: customer ? customer._id : null,
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : 'Deleted User',
        customerEmail: customer ? customer.email : 'N/A',
        customerPhone: customer ? customer.phone : 'N/A',
        type: ticket.type,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        relatedPayment: ticket.relatedPaymentId,
        relatedOrder: ticket.relatedOrderId,
        requestedRefundAmount: ticket.requestedRefundAmount,
        refundReason: ticket.refundReason,
        adminResponse: ticket.adminResponse,
        respondedBy: ticket.respondedBy,
        respondedAt: ticket.respondedAt,
        resolutionAction: ticket.resolutionAction,
        resolutionAmount: ticket.resolutionAmount,
        resolutionDetails: ticket.resolutionDetails,
        resolutionDate: ticket.resolutionDate,
        internalNotes: ticket.internalNotes,
        createdAt: ticket.createdAt
      };
    });

    console.log('✅ Support tickets processed successfully');
    res.json({
      tickets: ticketList,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching support tickets:', error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's own tickets (Customer only)
router.get('/my-tickets', authenticateToken, requireRole(['customer']), async (req, res) => {
  try {
    const tickets = await Support.find({ customerId: req.user.id })
      .populate('relatedPaymentId', 'transactionId amount status paymentMethod')
      .populate('relatedOrderId', 'orderNumber totalAmount status')
      .sort({ createdAt: -1 });

    const userTickets = tickets.map(ticket => ({
      id: ticket._id,
      type: ticket.type,
      subject: ticket.subject,
      message: ticket.message,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      relatedPayment: ticket.relatedPaymentId,
      relatedOrder: ticket.relatedOrderId,
      requestedRefundAmount: ticket.requestedRefundAmount,
      refundReason: ticket.refundReason,
      adminResponse: ticket.adminResponse,
      respondedAt: ticket.respondedAt,
      resolutionAction: ticket.resolutionAction,
      resolutionAmount: ticket.resolutionAmount,
      resolutionDetails: ticket.resolutionDetails,
      resolutionDate: ticket.resolutionDate,
      createdAt: ticket.createdAt
    }));

    res.json(userTickets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update ticket status and respond (Admin only)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { 
      status, 
      adminResponse, 
      priority,
      resolutionAction,
      resolutionAmount,
      resolutionDetails,
      internalNote
    } = req.body;

    const updateData = {};
    
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (resolutionAction) updateData.resolutionAction = resolutionAction;
    if (resolutionAmount) updateData.resolutionAmount = resolutionAmount;
    if (resolutionDetails) updateData.resolutionDetails = resolutionDetails;
    
    if (adminResponse) {
      updateData.adminResponse = adminResponse;
      updateData.respondedBy = req.user.id;
      updateData.respondedAt = new Date();
    }

    if (status === 'resolved' && resolutionAction) {
      updateData.resolutionDate = new Date();
    }

    // Find and update the ticket
    const ticket = await Support.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Support ticket not found' });
    }

    // Add internal note if provided
    if (internalNote) {
      if (!ticket.internalNotes) ticket.internalNotes = [];
      ticket.internalNotes.push({
        note: internalNote,
        addedBy: req.user.id,
        addedAt: new Date()
      });
    }

    // Update the ticket
    Object.assign(ticket, updateData);
    await ticket.save();

    // If resolution involves refund, process it
    if (resolutionAction === 'refund_approved' && ticket.relatedPaymentId) {
      try {
        // Import Payment model
        const Payment = (await import('../models/Payment.js')).default;
        
        const payment = await Payment.findById(ticket.relatedPaymentId);
        if (payment && payment.paymentMethod === 'bkash') {
          // For bKash payments, we'll need to process through the refund endpoint
          // For now, we'll just mark it as requiring manual processing
          ticket.internalNotes.push({
            note: `Refund approved for amount ${resolutionAmount || ticket.requestedRefundAmount}. Manual processing required for bKash payment.`,
            addedBy: req.user.id,
            addedAt: new Date()
          });
          await ticket.save();
        }
      } catch (refundError) {
        console.error('Error processing refund:', refundError);
      }
    }

    res.json({
      message: 'Support ticket updated successfully',
      ticket: {
        id: ticket._id,
        status: ticket.status,
        priority: ticket.priority,
        adminResponse: ticket.adminResponse,
        respondedAt: ticket.respondedAt,
        resolutionAction: ticket.resolutionAction,
        resolutionAmount: ticket.resolutionAmount,
        resolutionDetails: ticket.resolutionDetails,
        resolutionDate: ticket.resolutionDate
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get support statistics (Admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const total = await Support.countDocuments();
    const open = await Support.countDocuments({ status: 'open' });
    const inProgress = await Support.countDocuments({ status: 'in_progress' });
    const resolved = await Support.countDocuments({ status: 'resolved' });
    const closed = await Support.countDocuments({ status: 'closed' });
    
    // Type statistics
    const complaints = await Support.countDocuments({ type: 'complaint' });
    const helpRequests = await Support.countDocuments({ type: 'help' });
    const suggestions = await Support.countDocuments({ type: 'suggestion' });
    const paymentIssues = await Support.countDocuments({ type: 'payment_issue' });
    
    // Priority statistics
    const urgent = await Support.countDocuments({ priority: 'urgent' });
    const high = await Support.countDocuments({ priority: 'high' });
    const medium = await Support.countDocuments({ priority: 'medium' });
    const low = await Support.countDocuments({ priority: 'low' });
    
    // Category statistics
    const payment = await Support.countDocuments({ category: 'payment' });
    const refund = await Support.countDocuments({ category: 'refund' });
    const billing = await Support.countDocuments({ category: 'billing' });
    const order = await Support.countDocuments({ category: 'order' });
    const technical = await Support.countDocuments({ category: 'technical' });
    const general = await Support.countDocuments({ category: 'general' });

    // Resolution statistics
    const refundApproved = await Support.countDocuments({ resolutionAction: 'refund_approved' });
    const refundRejected = await Support.countDocuments({ resolutionAction: 'refund_rejected' });
    const partialRefund = await Support.countDocuments({ resolutionAction: 'partial_refund' });
    const replacement = await Support.countDocuments({ resolutionAction: 'replacement' });
    
    const stats = { 
      total, 
      open, 
      inProgress, 
      resolved, 
      closed, 
      complaints, 
      helpRequests, 
      suggestions,
      paymentIssues,
      urgent,
      high,
      medium,
      low,
      payment,
      refund,
      billing,
      order,
      technical,
      general,
      refundApproved,
      refundRejected,
      partialRefund,
      replacement
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get ticket details by ID (Admin only)
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const ticket = await Support.findById(req.params.id)
      .populate('customerId', 'firstName lastName email phone')
      .populate('relatedPaymentId', 'transactionId amount status paymentMethod createdAt paymentDetails')
      .populate('relatedOrderId', 'orderNumber totalAmount status items')
      .populate('respondedBy', 'firstName lastName email')
      .populate('internalNotes.addedBy', 'firstName lastName email');

    if (!ticket) {
      return res.status(404).json({ message: 'Support ticket not found' });
    }

    res.json({
      success: true,
      ticket: {
        id: ticket._id,
        customer: ticket.customerId,
        type: ticket.type,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        relatedPayment: ticket.relatedPaymentId,
        relatedOrder: ticket.relatedOrderId,
        requestedRefundAmount: ticket.requestedRefundAmount,
        refundReason: ticket.refundReason,
        adminResponse: ticket.adminResponse,
        respondedBy: ticket.respondedBy,
        respondedAt: ticket.respondedAt,
        resolutionAction: ticket.resolutionAction,
        resolutionAmount: ticket.resolutionAmount,
        resolutionDetails: ticket.resolutionDetails,
        resolutionDate: ticket.resolutionDate,
        internalNotes: ticket.internalNotes,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Process refund from support ticket (Admin only)
router.post('/:id/process-refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { amount, reason, refundMethod = 'original' } = req.body;
    
    const ticket = await Support.findById(req.params.id)
      .populate('relatedPaymentId');

    if (!ticket) {
      return res.status(404).json({ message: 'Support ticket not found' });
    }

    if (!ticket.relatedPaymentId) {
      return res.status(400).json({ message: 'No payment associated with this ticket' });
    }

    const payment = ticket.relatedPaymentId;

    // Process refund based on payment method
    if (payment.paymentMethod === 'bkash' && payment.paymentDetails.bkashPaymentID) {
      // Process bKash refund
      const BkashService = (await import('../services/bkashService.js')).default;
      const bkashService = new BkashService();

      const refundResult = await bkashService.refundTransaction({
        paymentID: payment.paymentDetails.bkashPaymentID,
        amount: amount || ticket.requestedRefundAmount || payment.amount,
        trxID: payment.paymentDetails.bkashTransactionID,
        sku: 'MEDZY_SUPPORT_REFUND'
      });

      if (refundResult.success) {
        // Update payment
        const Payment = (await import('../models/Payment.js')).default;
        await Payment.findByIdAndUpdate(payment._id, {
          status: 'refunded',
          refundDetails: {
            refundAmount: amount || ticket.requestedRefundAmount || payment.amount,
            refundReason: reason || ticket.refundReason || 'Support ticket refund',
            refundDate: new Date(),
            refundTrxID: refundResult.refundTrxID,
            refundMethod: 'bkash',
            processedBy: req.user.id,
            supportTicketId: ticket._id
          }
        });

        // Update ticket
        ticket.resolutionAction = 'refund_approved';
        ticket.resolutionAmount = amount || ticket.requestedRefundAmount || payment.amount;
        ticket.resolutionDetails = `Refund processed via bKash. Transaction ID: ${refundResult.refundTrxID}`;
        ticket.resolutionDate = new Date();
        ticket.status = 'resolved';
        await ticket.save();

        res.json({
          success: true,
          message: 'Refund processed successfully',
          refundTrxID: refundResult.refundTrxID,
          amount: refundResult.amount
        });
      } else {
        res.status(400).json({
          success: false,
          message: refundResult.message || 'Refund failed'
        });
      }
    } else {
      // Manual refund for other payment methods
      const Payment = (await import('../models/Payment.js')).default;
      await Payment.findByIdAndUpdate(payment._id, {
        status: 'refunded',
        refundDetails: {
          refundAmount: amount || ticket.requestedRefundAmount || payment.amount,
          refundReason: reason || ticket.refundReason || 'Support ticket refund',
          refundDate: new Date(),
          refundMethod: 'manual',
          processedBy: req.user.id,
          supportTicketId: ticket._id,
          isManualRefund: true
        }
      });

      // Update ticket
      ticket.resolutionAction = 'refund_approved';
      ticket.resolutionAmount = amount || ticket.requestedRefundAmount || payment.amount;
      ticket.resolutionDetails = `Manual refund processed for ${payment.paymentMethod} payment`;
      ticket.resolutionDate = new Date();
      ticket.status = 'resolved';
      await ticket.save();

      res.json({
        success: true,
        message: 'Manual refund processed successfully',
        amount: amount || ticket.requestedRefundAmount || payment.amount
      });
    }
  } catch (error) {
    console.error('Error processing refund from support:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Process refund with revenue adjustments and customer points (Admin only)
router.post('/:ticketId/process-refund-with-adjustments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { amount, reason } = req.body;

    const ticket = await Support.findById(ticketId)
      .populate('relatedPaymentId')
      .populate('relatedOrderId');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (!ticket.relatedPaymentId) {
      return res.status(400).json({
        success: false,
        message: 'No payment associated with this ticket'
      });
    }

    const payment = ticket.relatedPaymentId;
    const refundAmount = amount || ticket.requestedRefundAmount || payment.amount;

    // Helper function to process refund with adjustments
    const processRefundWithAdjustments = async (payment, refundAmount, supportTicketId, adminUserId) => {
      try {
        // Get the order to determine vendor and commission
        const Order = (await import('../models/Order.js')).default;
        const order = await Order.findById(payment.orderId);
        const vendorCommissionPercentage = order?.vendorCommissionPercentage || 15;
        
        // Create revenue adjustment for the refund
        const revenueAdjustment = await RevenueAdjustment.createRefundAdjustment(
          refundAmount,
          payment.orderId,
          payment._id,
          supportTicketId,
          order?.vendorId,
          vendorCommissionPercentage,
          adminUserId
        );
        
        // Award customer points for the refund amount
        const customerPoints = await CustomerPoint.findOrCreateForCustomer(payment.userId);
        const pointsAwarded = customerPoints.currencyToPoints(refundAmount);
        
        await customerPoints.addPoints(
          pointsAwarded,
          `Refund compensation for support ticket #${supportTicketId}`,
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

    // Process refund based on payment method
    if (payment.paymentMethod === 'bkash' && payment.paymentDetails?.bkashPaymentID) {
      // bKash refund
      const BkashService = (await import('../services/bkashService.js')).default;
      const bkashService = new BkashService();

      const refundResult = await bkashService.refundTransaction({
        paymentID: payment.paymentDetails.bkashPaymentID,
        amount: refundAmount.toFixed(2),
        trxID: payment.paymentDetails.bkashTransactionID,
        sku: 'MEDZY_REFUND'
      });

      if (refundResult.success) {
        // Update payment
        payment.status = 'refunded';
        payment.refundDetails = {
          refundAmount,
          refundReason: reason || ticket.refundReason || 'Support ticket refund',
          refundDate: new Date(),
          refundTrxID: refundResult.refundTrxID,
          refundMethod: 'bkash',
          processedBy: req.user.id,
          supportTicketId: ticket._id
        };
        await payment.save();

        // Process revenue adjustments and customer points
        const adjustments = await processRefundWithAdjustments(
          payment, 
          refundAmount, 
          ticket._id, 
          req.user.id
        );

        // Update ticket
        ticket.resolutionAction = 'refund_approved';
        ticket.resolutionAmount = refundAmount;
        ticket.resolutionDetails = `bKash refund processed. TrxID: ${refundResult.refundTrxID}. Points awarded: ${adjustments.pointsAwarded}`;
        ticket.resolutionDate = new Date();
        ticket.status = 'resolved';
        await ticket.save();

        res.json({
          success: true,
          message: 'bKash refund processed successfully with adjustments',
          data: {
            refundTrxID: refundResult.refundTrxID,
            amount: refundResult.amount,
            adjustments: {
              revenueAdjustmentId: adjustments.revenueAdjustment._id,
              pointsAwarded: adjustments.pointsAwarded,
              customerPointBalance: adjustments.customerPoints
            }
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: refundResult.message || 'bKash refund failed'
        });
      }
    } else {
      // Manual refund for other payment methods
      const Payment = (await import('../models/Payment.js')).default;
      
      // Update payment
      payment.status = 'refunded';
      payment.refundDetails = {
        refundAmount,
        refundReason: reason || ticket.refundReason || 'Support ticket refund',
        refundDate: new Date(),
        refundMethod: 'manual',
        processedBy: req.user.id,
        supportTicketId: ticket._id,
        isManualRefund: true
      };
      await payment.save();

      // Process revenue adjustments and customer points
      const adjustments = await processRefundWithAdjustments(
        payment, 
        refundAmount, 
        ticket._id, 
        req.user.id
      );

      // Update ticket
      ticket.resolutionAction = 'refund_approved';
      ticket.resolutionAmount = refundAmount;
      ticket.resolutionDetails = `Manual refund processed for ${payment.paymentMethod} payment. Points awarded: ${adjustments.pointsAwarded}`;
      ticket.resolutionDate = new Date();
      ticket.status = 'resolved';
      await ticket.save();

      res.json({
        success: true,
        message: 'Manual refund processed successfully with adjustments',
        data: {
          amount: refundAmount,
          adjustments: {
            revenueAdjustmentId: adjustments.revenueAdjustment._id,
            pointsAwarded: adjustments.pointsAwarded,
            customerPointBalance: adjustments.customerPoints
          }
        }
      });
    }
  } catch (error) {
    console.error('Error processing refund with adjustments:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during refund processing', 
      error: error.message 
    });
  }
});

export default router;