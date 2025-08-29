import express from 'express';
import Donation from '../models/Donation.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Submit a new donation
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const donationData = {
      ...req.body,
      donor: req.user.id
    };

    // Validate expiry date
    const expiryDate = new Date(donationData.expiryDate);
    const now = new Date();
    if (expiryDate <= now) {
      return res.status(400).json({
        success: false,
        message: 'Expiry date must be in the future'
      });
    }

    // Validate manufacturing date
    const manufacturingDate = new Date(donationData.manufacturingDate);
    if (manufacturingDate >= expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Manufacturing date must be before expiry date'
      });
    }

    const donation = new Donation(donationData);
    await donation.save();

    await donation.populate('donor', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Donation submitted successfully. It will be reviewed by admin.',
      data: donation
    });

  } catch (error) {
    console.error('Error submitting donation:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting donation',
      error: error.message
    });
  }
});

// Get user's donations
router.get('/my-donations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const query = { donor: req.user.id };
    if (status && status !== 'all') {
      query.status = status;
    }

    const donations = await Donation.find(query)
      .populate('donor', 'firstName lastName')
      .populate('claims.requester', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Donation.countDocuments(query);

    res.json({
      success: true,
      data: {
        donations,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Error fetching user donations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donations',
      error: error.message
    });
  }
});

// Browse available donations (verified users only)
router.get('/browse', authenticateToken, async (req, res) => {
  try {
    // Check if user is verified - first check token, then database if needed
    let isVerified = req.user.emailVerified;
    
    if (isVerified === undefined) {
      // Fallback: fetch from database if not in token (for backward compatibility)
      const user = await User.findById(req.user.id);
      isVerified = user?.emailVerified || false;
    }
    
    if (!isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Only verified users can browse donations'
      });
    }

    const { 
      page = 1, 
      limit = 12, 
      search, 
      city, 
      form, 
      priority,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (page - 1) * limit;
    const query = {
      status: 'approved',
      isActive: true,
      expiryDate: { $gt: new Date() }
    };

    // Add search filter
    if (search) {
      query.$or = [
        { medicineName: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
      ];
    }

    // Add city filter
    if (city) {
      query['pickupLocation.city'] = { $regex: city, $options: 'i' };
    }

    // Add form filter
    if (form && form !== 'all') {
      query.form = form;
    }

    // Add priority filter
    if (priority && priority !== 'all') {
      query.priority = priority;
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const donations = await Donation.find(query)
      .populate('donor', 'firstName lastName')
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Donation.countDocuments(query);

    // Get available cities for filter
    const cities = await Donation.distinct('pickupLocation.city', {
      status: 'approved',
      isActive: true,
      expiryDate: { $gt: new Date() }
    });

    res.json({
      success: true,
      data: {
        donations,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        },
        filters: {
          cities: cities.sort()
        }
      }
    });

  } catch (error) {
    console.error('Error browsing donations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donations',
      error: error.message
    });
  }
});

// Request a donation
router.post('/:id/request', authenticateToken, async (req, res) => {
  try {
    // Check if user is verified - first check token, then database if needed
    let isVerified = req.user.emailVerified;
    
    if (isVerified === undefined) {
      // Fallback: fetch from database if not in token (for backward compatibility)
      const user = await User.findById(req.user.id);
      isVerified = user?.emailVerified || false;
    }
    
    if (!isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Only verified users can request donations'
      });
    }

    const donation = await Donation.findById(req.params.id);
    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    // Check if donation is available
    if (donation.status !== 'approved' || !donation.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This donation is not available'
      });
    }

    // Check if user is trying to request their own donation
    if (donation.donor.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot request your own donation'
      });
    }

    const { requestedQuantity, reason, urgency, contact, pickupPreference, message } = req.body;

    // Validate requested quantity
    if (!requestedQuantity || requestedQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid requested quantity'
      });
    }

    if (!donation.canBeClaimed(requestedQuantity)) {
      return res.status(400).json({
        success: false,
        message: 'Requested quantity exceeds available quantity'
      });
    }

    // Check if user has already requested this donation
    const existingRequest = donation.claims.find(
      claim => claim.requester.toString() === req.user.id && claim.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You have already requested this donation'
      });
    }

    // Add the claim
    const newClaim = {
      requester: req.user.id,
      requestedQuantity,
      reason,
      urgency: urgency || 'medium',
      contact,
      pickupPreference: pickupPreference || 'pickup',
      message: message || ''
    };

    donation.claims.push(newClaim);
    await donation.save();

    await donation.populate([
      { path: 'donor', select: 'firstName lastName email' },
      { path: 'claims.requester', select: 'firstName lastName email' }
    ]);

    res.json({
      success: true,
      message: 'Request submitted successfully. The donor will be notified.',
      data: donation
    });

  } catch (error) {
    console.error('Error requesting donation:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting request',
      error: error.message
    });
  }
});

// Get donation details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate('donor', 'firstName lastName email phone')
      .populate('claims.requester', 'firstName lastName email phone');

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    // Check if user can view this donation
    const canView = donation.donor._id.toString() === req.user.id || 
                   donation.status === 'approved' ||
                   req.user.role === 'admin';

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: donation
    });

  } catch (error) {
    console.error('Error fetching donation:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donation',
      error: error.message
    });
  }
});

// Admin routes
// Get all donations for admin review
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const { page = 1, limit = 10, status, search } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { medicineName: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
      ];
    }

    const donations = await Donation.find(query)
      .populate('donor', 'firstName lastName email phone')
      .populate('adminReview.reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Donation.countDocuments(query);

    // Get status counts
    const statusCounts = await Donation.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        donations,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        },
        statusCounts: statusCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Error fetching donations for admin:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donations',
      error: error.message
    });
  }
});

// Admin approve/reject donation
router.patch('/admin/:id/review', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const { status, comments, rejectionReason } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be approved or rejected.'
      });
    }

    const donation = await Donation.findById(req.params.id);
    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    if (donation.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Donation has already been reviewed'
      });
    }

    donation.status = status;
    donation.adminReview = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      comments: comments || '',
      rejectionReason: status === 'rejected' ? rejectionReason : undefined
    };

    await donation.save();

    await donation.populate([
      { path: 'donor', select: 'firstName lastName email' },
      { path: 'adminReview.reviewedBy', select: 'firstName lastName' }
    ]);

    res.json({
      success: true,
      message: `Donation ${status} successfully`,
      data: donation
    });

  } catch (error) {
    console.error('Error reviewing donation:', error);
    res.status(500).json({
      success: false,
      message: 'Error reviewing donation',
      error: error.message
    });
  }
});

export default router;
