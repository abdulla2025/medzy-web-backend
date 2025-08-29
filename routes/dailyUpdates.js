import express from 'express';
import DailyUpdate from '../models/DailyUpdate.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all daily updates with filtering
router.get('/', async (req, res) => {
  try {
    console.log('📝 GET /api/daily-updates called with query:', req.query);
    
    const { 
      category, 
      priority, 
      page = 1, 
      limit = 10,
      isActive = 'true',
      search
    } = req.query;

    // Build filter object
    const filter = { isActive: isActive === 'true' };
    
    if (category && category !== 'all') {
      filter.category = category;
    }
    
    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    console.log('🔍 Using filter:', filter);

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Get updates with pagination
    const updates = await DailyUpdate.find(filter)
      .populate('author', 'name email role')
      .sort({ createdAt: -1 }) // Sort by newest first
      .skip(skip)
      .limit(limitNumber);

    // Get total count for pagination
    const totalUpdates = await DailyUpdate.countDocuments(filter);

    console.log('📊 Found', updates.length, 'updates, total:', totalUpdates);

    res.json({
      updates,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalUpdates / limitNumber),
        totalItems: totalUpdates,
        itemsPerPage: limitNumber
      }
    });
  } catch (error) {
    console.error('❌ Error fetching daily updates:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single daily update
router.get('/:id', async (req, res) => {
  try {
    const update = await DailyUpdate.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1 } }, // Increment view count
      { new: true }
    ).populate('author', 'name email role');

    if (!update) {
      return res.status(404).json({ message: 'Daily update not found' });
    }

    res.json(update);
  } catch (error) {
    console.error('Error fetching daily update:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new daily update (Admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('📝 POST /api/daily-updates called by user:', req.user.email, 'role:', req.user.role);
    console.log('📝 Request body:', req.body);
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      console.log('❌ Access denied - not admin');
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { title, content, category, priority, tags } = req.body;

    // Validate required fields
    if (!title || !content || !category) {
      console.log('❌ Validation failed - missing required fields');
      return res.status(400).json({ 
        message: 'Title, content, and category are required' 
      });
    }

    const dailyUpdate = new DailyUpdate({
      title,
      content,
      category,
      priority: priority || 'medium',
      tags: tags || [],
      author: req.user.id
    });

    console.log('💾 Saving daily update:', dailyUpdate);
    await dailyUpdate.save();
    await dailyUpdate.populate('author', 'name email role');

    console.log('✅ Daily update created successfully:', dailyUpdate._id);
    res.status(201).json(dailyUpdate);
  } catch (error) {
    console.error('❌ Error creating daily update:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update daily update (Admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { title, content, category, priority, tags, isActive } = req.body;

    const update = await DailyUpdate.findByIdAndUpdate(
      req.params.id,
      {
        title,
        content,
        category,
        priority,
        tags,
        isActive
      },
      { new: true, runValidators: true }
    ).populate('author', 'name email role');

    if (!update) {
      return res.status(404).json({ message: 'Daily update not found' });
    }

    res.json(update);
  } catch (error) {
    console.error('Error updating daily update:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle like on daily update
router.post('/:id/like', authenticateToken, async (req, res) => {
  try {
    const update = await DailyUpdate.findById(req.params.id);

    if (!update) {
      return res.status(404).json({ message: 'Daily update not found' });
    }

    const existingLike = update.likes.find(
      like => like.user.toString() === req.user.id
    );

    if (existingLike) {
      // Remove like
      update.likes = update.likes.filter(
        like => like.user.toString() !== req.user.id
      );
    } else {
      // Add like
      update.likes.push({ user: req.user.id });
    }

    await update.save();
    res.json({ 
      message: existingLike ? 'Like removed' : 'Like added',
      likeCount: update.likes.length 
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete daily update (Admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const update = await DailyUpdate.findByIdAndDelete(req.params.id);

    if (!update) {
      return res.status(404).json({ message: 'Daily update not found' });
    }

    res.json({ message: 'Daily update deleted successfully' });
  } catch (error) {
    console.error('Error deleting daily update:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get statistics for admin dashboard
router.get('/admin/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const stats = await Promise.all([
      DailyUpdate.countDocuments({ isActive: true }),
      DailyUpdate.countDocuments({ category: 'blood_availability', isActive: true }),
      DailyUpdate.countDocuments({ category: 'website_improvements', isActive: true }),
      DailyUpdate.countDocuments({ category: 'medical_news', isActive: true }),
      DailyUpdate.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, totalViews: { $sum: '$viewCount' } } }
      ])
    ]);

    res.json({
      totalUpdates: stats[0],
      bloodAvailability: stats[1],
      websiteImprovements: stats[2],
      medicalNews: stats[3],
      totalViews: stats[4][0]?.totalViews || 0
    });
  } catch (error) {
    console.error('Error fetching daily update stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
