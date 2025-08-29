import express from 'express';
import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import Medicine from '../models/Medicine.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get reviews for a specific order (for checking existing reviews)
router.get('/order/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Convert string IDs to ObjectIds if needed
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    
    const reviews = await Review.find({
      order: orderObjectId,
      user: userObjectId,
      isActive: true
    })
    .populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'vendor', select: 'firstName lastName' },
      { path: 'medicine', select: 'name' }
    ]);

    res.json({ reviews });
  } catch (error) {
    console.error('❌ Error fetching vendor reviews for order:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Log all requests to reviews endpoints
router.use((req, res, next) => {
  next();
});

// Create a review for a vendor
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 POST /api/reviews - Creating vendor review');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    console.log('👤 User ID:', req.user?.id);
    console.log('👤 User role:', req.user?.role);
    
    const { orderId, vendorId, rating, title, comment } = req.body;

    console.log('🧾 Extracted fields:');
    console.log('  - orderId:', orderId);
    console.log('  - vendorId:', vendorId);
    console.log('  - rating:', rating);
    console.log('  - title:', title);
    console.log('  - comment:', comment);

    // Validate input
    if (!orderId || !vendorId || !rating || !title || !comment) {
      console.log('❌ Validation failed - missing required fields');
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (rating < 1 || rating > 5) {
      console.log('❌ Rating validation failed:', rating);
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    console.log('🔍 Looking up order...');
    // Check if order exists and belongs to user
    const order = await Order.findOne({ 
      _id: orderId, 
      customer: req.user.id
      // Remove status requirement - allow reviews for any order status
    }).populate('items.medicine items.vendor');

    console.log('📦 Order found:', order ? 'Yes' : 'No');
    if (order) {
      console.log('📦 Order details:');
      console.log('  - ID:', order._id);
      console.log('  - Status:', order.status);
      console.log('  - Customer:', order.customer);
      console.log('  - Items count:', order.items?.length);
      console.log('  - Items:', order.items?.map(item => ({
        medicine: item.medicine?.name,
        vendor: item.vendor ? {
          id: item.vendor._id,
          name: `${item.vendor.firstName} ${item.vendor.lastName}`
        } : null
      })));
    }

    if (!order) {
      console.log('❌ Order not found or does not belong to user');
      return res.status(404).json({ message: 'Order not found' });
    }

    console.log('🔍 Looking for vendor in order items...');
    console.log('🎯 Target vendor ID:', vendorId);
    
    // Check if vendor exists in the order
    const orderItem = order.items.find(item => {
      const itemVendorId = item.vendor?._id?.toString();
      console.log('  - Item vendor ID:', itemVendorId, 'Match:', itemVendorId === vendorId);
      return itemVendorId === vendorId;
    });

    console.log('📦 Order item found for vendor:', orderItem ? 'Yes' : 'No');
    if (orderItem) {
      console.log('📦 Order item details:');
      console.log('  - Medicine:', orderItem.medicine?.name);
      console.log('  - Vendor:', orderItem.vendor ? {
        id: orderItem.vendor._id,
        name: `${orderItem.vendor.firstName} ${orderItem.vendor.lastName}`
      } : null);
    }

    if (!orderItem) {
      console.log('❌ Vendor not found in this order');
      return res.status(400).json({ message: 'Vendor not found in this order' });
    }

    console.log('🔍 Checking for existing review...');
    // Check if review already exists for this vendor from this order
    const existingReview = await Review.findOne({
      user: req.user.id,
      order: orderId,
      vendor: vendorId
    });

    console.log('📝 Existing review found:', existingReview ? 'Yes' : 'No');
    if (existingReview) {
      console.log('📝 Existing review details:');
      console.log('  - ID:', existingReview._id);
      console.log('  - Rating:', existingReview.rating);
      console.log('  - Title:', existingReview.title);
    }

    if (existingReview) {
      console.log('❌ Review already exists for this vendor from this order');
      return res.status(400).json({ message: 'You have already reviewed this vendor from this order' });
    }

    console.log('✅ Creating new review...');
    // Create review
    const reviewData = {
      user: req.user.id,
      order: orderId,
      medicine: orderItem.medicine._id, // Keep medicine reference for the first medicine from this vendor
      vendor: vendorId,
      rating: parseInt(rating),
      title: title.trim(),
      comment: comment.trim()
    };

    console.log('📝 Review data to save:', JSON.stringify(reviewData, null, 2));
    console.log('📝 Field types:', {
      user: typeof reviewData.user,
      order: typeof reviewData.order,
      medicine: typeof reviewData.medicine,
      vendor: typeof reviewData.vendor,
      rating: typeof reviewData.rating
    });

    const review = new Review(reviewData);

    console.log('💾 Saving review to database...');
    await review.save();
    console.log('✅ Review saved successfully');

    console.log('🔍 Populating review data...');
    // Populate the review for response
    await review.populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'medicine', select: 'name' }
    ]);

    console.log('✅ Review creation completed successfully');
    res.status(201).json({
      message: 'Review created successfully',
      review
    });
  } catch (error) {
    console.error('❌ Error creating vendor review:', error);
    console.error('❌ Error stack:', error.stack);
    
    // Handle specific MongoDB duplicate key error
    if (error.code === 11000) {
      console.log('🔧 Attempting to fix duplicate key error...');
      
      // Try to drop the conflicting index and retry
      try {
        const collection = mongoose.connection.db.collection('reviews');
        console.log('🗑️ Dropping old conflicting index...');
        
        // Try to drop the old index that's causing the conflict
        try {
          await collection.dropIndex('userId_1_medicineId_1_orderId_1');
          console.log('✅ Old index dropped successfully');
        } catch (dropError) {
          console.log('ℹ️ Old index not found or already dropped');
        }
        
        // Also try other possible old index names
        try {
          await collection.dropIndex({ userId: 1, medicineId: 1, orderId: 1 });
          console.log('✅ Alternative old index dropped successfully');
        } catch (dropError) {
          console.log('ℹ️ Alternative old index not found');
        }
        
        return res.status(409).json({ 
          message: 'Database index conflict detected. Please try again.', 
          code: 'INDEX_CONFLICT',
          retry: true 
        });
        
      } catch (indexError) {
        console.error('❌ Error handling index conflict:', indexError);
        return res.status(500).json({ 
          message: 'Database configuration issue. Please contact support.',
          code: 'INDEX_ERROR'
        });
      }
    }
    
    res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get reviews for a specific order (for checking existing reviews)
router.get('/order/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log('🔍 Fetching vendor reviews for order:', orderId, 'by user:', req.user.id);
    
    const reviews = await Review.find({
      order: orderId,
      user: req.user.id,
      isActive: true
    })
    .populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'vendor', select: 'firstName lastName' },
      { path: 'medicine', select: 'name' }
    ])
    .sort({ createdAt: -1 });

    console.log('📝 Found', reviews.length, 'vendor reviews for order');
    res.json({ reviews });
  } catch (error) {
    console.error('❌ Error fetching order vendor reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get reviews for a medicine
router.get('/medicine/:medicineId', async (req, res) => {
  try {
    const { medicineId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({
      medicine: medicineId,
      isActive: true
    })
    .populate('user', 'firstName lastName')
    .populate('medicine', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await Review.countDocuments({
      medicine: medicineId,
      isActive: true
    });

    // Calculate rating statistics
    const ratingStats = await Review.aggregate([
      { $match: { medicine: new mongoose.Types.ObjectId(medicineId), isActive: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratings: {
            $push: '$rating'
          }
        }
      }
    ]);

    const stats = ratingStats[0] || { avgRating: 0, totalReviews: 0, ratings: [] };
    
    // Calculate rating distribution
    const distribution = [1, 2, 3, 4, 5].map(rating => ({
      rating,
      count: stats.ratings.filter(r => r === rating).length,
      percentage: stats.totalReviews > 0 ? (stats.ratings.filter(r => r === rating).length / stats.totalReviews * 100) : 0
    }));

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
        averageRating: Math.round(stats.avgRating * 10) / 10,
        totalReviews: stats.totalReviews,
        distribution
      }
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get reviews for vendor dashboard
router.get('/vendor/my-reviews', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({
      vendor: req.user.id,
      isActive: true
    })
    .populate('user', 'firstName lastName')
    .populate('medicine', 'name')
    .populate('order', 'trackingId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await Review.countDocuments({
      vendor: req.user.id,
      isActive: true
    });

    // Calculate vendor rating statistics
    const ratingStats = await Review.aggregate([
      { $match: { vendor: new mongoose.Types.ObjectId(req.user.id), isActive: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratings: {
            $push: '$rating'
          }
        }
      }
    ]);

    const stats = ratingStats[0] || { avgRating: 0, totalReviews: 0, ratings: [] };

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
        averageRating: Math.round(stats.avgRating * 10) / 10,
        totalReviews: stats.totalReviews
      }
    });
  } catch (error) {
    console.error('Error fetching vendor reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get all reviews for admin
router.get('/admin/all-reviews', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ isActive: true })
    .populate('user', 'firstName lastName email')
    .populate('medicine', 'name')
    .populate('vendor', 'firstName lastName email')
    .populate('order', 'trackingId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await Review.countDocuments({ isActive: true });

    // Calculate overall platform statistics
    const overallStats = await Review.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    const stats = overallStats[0] || { avgRating: 0, totalReviews: 0 };

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
        averageRating: Math.round(stats.avgRating * 10) / 10,
        totalReviews: stats.totalReviews
      }
    });
  } catch (error) {
    console.error('Error fetching all reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get recent reviews for homepage
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const reviews = await Review.find({ isActive: true })
    .populate('user', 'firstName lastName')
    .populate('medicine', 'name')
    .sort({ createdAt: -1 })
    .limit(limit);

    res.json({ reviews });
  } catch (error) {
    console.error('Error fetching recent reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update review (user can edit their own review)
router.put('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const { rating, title, comment } = req.body;

    const review = await Review.findOne({
      _id: req.params.reviewId,
      user: req.user.id
    });

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Update fields
    if (rating) review.rating = parseInt(rating);
    if (title) review.title = title.trim();
    if (comment) review.comment = comment.trim();

    await review.save();

    await review.populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'medicine', select: 'name' }
    ]);

    res.json({
      message: 'Review updated successfully',
      review
    });
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete review (soft delete)
router.delete('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const review = await Review.findOne({
      _id: req.params.reviewId,
      user: req.user.id
    });

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    review.isActive = false;
    await review.save();

    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Toggle review status
router.patch('/:reviewId/toggle-status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const review = await Review.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
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

// Get public vendor reviews (no authentication required)
router.get('/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const reviews = await Review.find({
      isActive: true,
      rating: { $gte: 1 } // Only show valid ratings
    })
      .populate([
        {
          path: 'user',
          select: 'firstName lastName'
        },
        {
          path: 'vendor',
          select: 'firstName lastName'
        },
        {
          path: 'medicine',
          select: 'name'
        }
      ])
      .sort({ createdAt: -1 })
      .limit(limit)
      .maxTimeMS(5000) // 5 second timeout
      .lean(); // Improve performance by returning plain JS objects

    res.json({
      reviews
    });

  } catch (error) {
    console.error('❌ Error fetching public vendor reviews:', error);
    
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

// Get reviews for a specific order (for checking existing reviews)
router.get('/order/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const reviews = await Review.find({
      order: orderId,
      user: req.user.id,
      isActive: true
    }).populate([
      { path: 'user', select: 'firstName lastName' },
      { path: 'vendor', select: 'firstName lastName' },
      { path: 'medicine', select: 'name' }
    ]);

    res.json({ reviews });
  } catch (error) {
    console.error('Error fetching order reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
