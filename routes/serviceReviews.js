import express from 'express';
import mongoose from 'mongoose';
import ServiceReview from '../models/ServiceReview.js';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get service review for a specific order (for checking existing reviews)
router.get('/order/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log('🔍 Fetching service review for order:', orderId, 'by user:', req.user.id);
    
    const review = await ServiceReview.findOne({
      order: orderId,
      user: req.user.id,
      isActive: true
    })
    .populate([
      { path: 'user', select: 'firstName lastName' }
    ]);

    console.log('📝 Service review found:', review ? 'Yes' : 'No');
    res.json({ review });
  } catch (error) {
    console.error('❌ Error fetching service review for order:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Debug endpoint to check service review data
router.get('/debug/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check if order exists
    const order = await Order.findOne({ 
      _id: orderId, 
      customer: req.user.id
    });

    // Check if service review exists
    const existingServiceReview = await ServiceReview.findOne({
      user: req.user.id,
      order: orderId
    });

    // Check if vendor review exists
    const existingVendorReview = await Review.findOne({
      user: req.user.id,
      order: orderId
    });

    res.json({
      orderId,
      userId: req.user.id,
      order: order ? {
        id: order._id,
        status: order.status,
        customer: order.customer
      } : null,
      hasServiceReview: !!existingServiceReview,
      hasVendorReview: !!existingVendorReview,
      serviceReview: existingServiceReview,
      vendorReview: existingVendorReview
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a service review for a delivered order
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('📝 Service review request received:', {
      userId: req.user.id,
      orderId: req.body.orderId,
      ratingsKeys: Object.keys(req.body.ratings || {}),
      feedbackKeys: Object.keys(req.body.feedback || {})
    });

    const { 
      orderId, 
      ratings, 
      feedback, 
      deliveryPersonRating, 
      deliveryPersonName, 
      wouldRecommend 
    } = req.body;

    // Validate input
    if (!orderId || !ratings || !feedback?.overallFeedback || wouldRecommend === undefined) {
      console.log('❌ Missing required fields:', {
        orderId: !!orderId,
        ratings: !!ratings,
        overallFeedback: !!feedback?.overallFeedback,
        wouldRecommend: wouldRecommend !== undefined
      });
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate ratings
    const requiredRatings = ['deliverySpeed', 'deliveryQuality', 'customerService', 'appExperience', 'packaging', 'overallSatisfaction'];
    for (const rating of requiredRatings) {
      if (!ratings[rating] || ratings[rating] < 1 || ratings[rating] > 5) {
        console.log('❌ Invalid rating:', rating, ratings[rating]);
        return res.status(400).json({ message: `Invalid ${rating} rating` });
      }
    }

    // Check if order exists and belongs to user
    const order = await Order.findOne({ 
      _id: orderId, 
      customer: req.user.id
    });

    if (!order) {
      console.log('❌ Order not found:', orderId, 'for user:', req.user.id);
      return res.status(404).json({ message: 'Order not found' });
    }

    console.log('✅ Order found:', order._id, 'status:', order.status);

    // Check if service review already exists
    const existingReview = await ServiceReview.findOne({
      user: req.user.id,
      order: orderId
    });

    if (existingReview) {
      console.log('❌ Review already exists for order:', orderId);
      return res.status(400).json({ message: 'You have already reviewed this order service' });
    }

    // Create service review
    const serviceReview = new ServiceReview({
      user: req.user.id,
      order: orderId,
      ratings,
      feedback,
      deliveryPersonRating,
      deliveryPersonName,
      wouldRecommend
    });

    console.log('💾 Saving service review:', {
      user: req.user.id,
      order: orderId,
      overallSatisfaction: ratings.overallSatisfaction
    });

    await serviceReview.save();

    // Populate the review for response
    await serviceReview.populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'order', select: 'trackingId' }
    ]);

    console.log('✅ Service review created successfully');

    res.status(201).json({
      message: 'Service review created successfully',
      review: serviceReview
    });
  } catch (error) {
    console.error('❌ Error creating service review:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Get public service reviews for homepage
router.get('/public', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await ServiceReview.find({
      isActive: true,
      isPublic: true
    })
    .populate('user', 'firstName lastName')
    .populate('order', 'trackingId createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .maxTimeMS(5000) // 5 second timeout
    .lean(); // Improve performance

    const total = await ServiceReview.countDocuments({
      isActive: true,
      isPublic: true
    }).maxTimeMS(3000); // 3 second timeout

    // Calculate overall service statistics
    const stats = await ServiceReview.aggregate([
      { $match: { isActive: true, isPublic: true } },
      {
        $group: {
          _id: null,
          avgDeliverySpeed: { $avg: '$ratings.deliverySpeed' },
          avgDeliveryQuality: { $avg: '$ratings.deliveryQuality' },
          avgCustomerService: { $avg: '$ratings.customerService' },
          avgAppExperience: { $avg: '$ratings.appExperience' },
          avgPackaging: { $avg: '$ratings.packaging' },
          avgOverallSatisfaction: { $avg: '$ratings.overallSatisfaction' },
          avgOverallRating: { $avg: '$averageRating' },
          totalReviews: { $sum: 1 },
          recommendationRate: { $avg: { $cond: ['$wouldRecommend', 1, 0] } }
        }
      }
    ], { maxTimeMS: 5000 }); // 5 second timeout for aggregation

    const serviceStats = stats[0] || {
      avgDeliverySpeed: 0,
      avgDeliveryQuality: 0,
      avgCustomerService: 0,
      avgAppExperience: 0,
      avgPackaging: 0,
      avgOverallSatisfaction: 0,
      avgOverallRating: 0,
      totalReviews: 0,
      recommendationRate: 0
    };

    res.json({
      reviews,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      },
      stats: {
        ...serviceStats,
        avgDeliverySpeed: Math.round(serviceStats.avgDeliverySpeed * 10) / 10,
        avgDeliveryQuality: Math.round(serviceStats.avgDeliveryQuality * 10) / 10,
        avgCustomerService: Math.round(serviceStats.avgCustomerService * 10) / 10,
        avgAppExperience: Math.round(serviceStats.avgAppExperience * 10) / 10,
        avgPackaging: Math.round(serviceStats.avgPackaging * 10) / 10,
        avgOverallSatisfaction: Math.round(serviceStats.avgOverallSatisfaction * 10) / 10,
        avgOverallRating: Math.round(serviceStats.avgOverallRating * 10) / 10,
        recommendationRate: Math.round(serviceStats.recommendationRate * 100)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching public service reviews:', error);
    
    // Handle specific timeout errors
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
      return res.status(503).json({ 
        message: 'Database temporarily unavailable', 
        error: 'Connection timeout' 
      });
    }
    
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Get user's own service reviews
router.get('/my-reviews', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await ServiceReview.find({
      user: req.user.id
    })
    .populate('order', 'trackingId createdAt total')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await ServiceReview.countDocuments({
      user: req.user.id
    });

    res.json({
      reviews,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching user service reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Get all service reviews
router.get('/admin/all-reviews', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || 'all';

    let query = {};
    if (search) {
      query.$or = [
        { 'feedback.overallFeedback': { $regex: search, $options: 'i' } },
        { 'feedback.suggestions': { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== 'all') {
      query.isActive = status === 'active';
    }

    const reviews = await ServiceReview.find(query)
    .populate('user', 'firstName lastName email')
    .populate('order', 'trackingId createdAt total')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await ServiceReview.countDocuments(query);

    // Calculate overall platform service statistics
    const overallStats = await ServiceReview.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          avgOverallSatisfaction: { $avg: '$ratings.overallSatisfaction' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    const stats = overallStats.length > 0 ? {
      averageRating: Math.round(overallStats[0].avgOverallSatisfaction * 10) / 10,
      totalReviews: overallStats[0].totalReviews
    } : {
      averageRating: 0,
      totalReviews: 0
    };

    res.json({
      reviews,
      stats,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching admin service reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Get all service reviews (legacy endpoint)
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    let query = {};
    if (search) {
      query.$or = [
        { 'feedback.overallFeedback': { $regex: search, $options: 'i' } },
        { 'feedback.suggestions': { $regex: search, $options: 'i' } }
      ];
    }

    const reviews = await ServiceReview.find(query)
    .populate('user', 'firstName lastName email')
    .populate('order', 'trackingId createdAt total')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await ServiceReview.countDocuments(query);

    // Calculate overall platform service statistics
    const overallStats = await ServiceReview.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          avgOverallRating: { $avg: '$averageRating' },
          totalReviews: { $sum: 1 },
          recommendationRate: { $avg: { $cond: ['$wouldRecommend', 1, 0] } },
          avgDeliverySpeed: { $avg: '$ratings.deliverySpeed' },
          avgCustomerService: { $avg: '$ratings.customerService' }
        }
      }
    ]);

    const stats = overallStats[0] || {
      avgOverallRating: 0,
      totalReviews: 0,
      recommendationRate: 0,
      avgDeliverySpeed: 0,
      avgCustomerService: 0
    };

    res.json({
      reviews,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      },
      stats: {
        avgOverallRating: Math.round(stats.avgOverallRating * 10) / 10,
        totalReviews: stats.totalReviews,
        recommendationRate: Math.round(stats.recommendationRate * 100),
        avgDeliverySpeed: Math.round(stats.avgDeliverySpeed * 10) / 10,
        avgCustomerService: Math.round(stats.avgCustomerService * 10) / 10
      }
    });
  } catch (error) {
    console.error('Error fetching all service reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update service review (user can edit their own review)
router.put('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const { ratings, feedback, deliveryPersonRating, deliveryPersonName, wouldRecommend } = req.body;

    const review = await ServiceReview.findOne({
      _id: req.params.reviewId,
      user: req.user.id
    });

    if (!review) {
      return res.status(404).json({ message: 'Service review not found' });
    }

    // Update fields
    if (ratings) review.ratings = { ...review.ratings, ...ratings };
    if (feedback) review.feedback = { ...review.feedback, ...feedback };
    if (deliveryPersonRating) review.deliveryPersonRating = deliveryPersonRating;
    if (deliveryPersonName) review.deliveryPersonName = deliveryPersonName;
    if (wouldRecommend !== undefined) review.wouldRecommend = wouldRecommend;

    await review.save();

    await review.populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'order', select: 'trackingId' }
    ]);

    res.json({
      message: 'Service review updated successfully',
      review
    });
  } catch (error) {
    console.error('Error updating service review:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Toggle review visibility
router.patch('/:reviewId/toggle-visibility', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const review = await ServiceReview.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Service review not found' });
    }

    review.isPublic = !review.isPublic;
    await review.save();

    res.json({
      message: `Review ${review.isPublic ? 'made public' : 'made private'} successfully`,
      review
    });
  } catch (error) {
    console.error('Error toggling review visibility:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Toggle review status
router.patch('/:reviewId/toggle-status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const review = await ServiceReview.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Service review not found' });
    }

    review.isActive = !review.isActive;
    await review.save();

    res.json({
      message: `Review ${review.isActive ? 'activated' : 'deactivated'} successfully`,
      review
    });
  } catch (error) {
    console.error('Error toggling review status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
