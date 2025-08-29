import express from 'express';
import mongoose from 'mongoose';
import Medicine from '../models/Medicine.js';
import Review from '../models/Review.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all active medicines (public route for browsing)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get all active, non-expired medicines
    const query = { 
      isActive: true,
      expiryDate: { $gt: new Date() },
      stockQuantity: { $gt: 0 }
    };

    const medicines = await Medicine.find(query)
      .populate('vendorId', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Medicine.countDocuments(query);

    res.json({
      success: true,
      medicines,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all medicines for a vendor
router.get('/vendor-medicines', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching medicines for vendor:', req.user);
    
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied. Only pharmacy vendors can access this route.' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const category = req.query.category || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    // Build query
    let query = { vendorId: new mongoose.Types.ObjectId(req.user.id), isActive: true };
    
    console.log('Query for medicines:', query);
    console.log('User ID type:', typeof req.user.id, 'Value:', req.user.id);
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category) {
      query.category = category;
    }

    const medicines = await Medicine.find(query)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit);

    const total = await Medicine.countDocuments(query);

    console.log('Found medicines:', medicines.length, 'Total:', total);

    // Get statistics
    const stats = await Medicine.aggregate([
      { $match: { vendorId: new mongoose.Types.ObjectId(req.user.id), isActive: true } },
      {
        $group: {
          _id: null,
          totalMedicines: { $sum: 1 },
          totalStock: { $sum: '$stockQuantity' },
          lowStockCount: {
            $sum: {
              $cond: [{ $lte: ['$stockQuantity', '$minStockLevel'] }, 1, 0]
            }
          },
          expiredCount: {
            $sum: {
              $cond: [{ $lt: ['$expiryDate', new Date()] }, 1, 0]
            }
          },
          expiringSoonCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lte: ['$expiryDate', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)] },
                    { $gt: ['$expiryDate', new Date()] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    res.json({
      medicines,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      },
      stats: stats[0] || {
        totalMedicines: 0,
        totalStock: 0,
        lowStockCount: 0,
        expiredCount: 0,
        expiringSoonCount: 0
      }
    });
  } catch (error) {
    console.error('Error fetching vendor medicines:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Public route for customers to search medicines with GPS/location support
router.get('/search', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const category = req.query.category || '';
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || Number.MAX_VALUE;
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
    const inStockOnly = req.query.inStockOnly === 'true';
    const prescriptionFilter = req.query.prescriptionFilter;
    const minRating = parseFloat(req.query.minRating) || 0;
    
    // GPS/Location parameters
    const latitude = parseFloat(req.query.latitude);
    const longitude = parseFloat(req.query.longitude);
    const maxDistance = parseFloat(req.query.maxDistance) || 50; // Default 50km

    // Build query for active medicines only
    let query = { 
      isActive: true,
      expiryDate: { $gt: new Date() } // Only show non-expired medicines
    };
    
    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
        { tags: { $elemMatch: { $regex: search, $options: 'i' } } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Filter by category
    if (category && category !== 'all') {
      query.category = category;
    }

    // Filter by price range
    if (minPrice > 0 || maxPrice < Number.MAX_VALUE) {
      query.price = { $gte: minPrice, $lte: maxPrice };
    }

    // Filter by stock availability
    if (inStockOnly) {
      query.stockQuantity = { $gt: 0 };
    }

    // Filter by prescription requirement
    if (prescriptionFilter && prescriptionFilter !== 'all') {
      query.prescriptionRequired = prescriptionFilter === 'required';
    }

    // Execute query with population of vendor details including location
    let medicines = await Medicine.find(query)
      .populate({
        path: 'vendorId',
        select: 'firstName lastName email phone businessInfo address',
        populate: {
          path: 'businessInfo',
          select: 'businessName businessAddress businessPhone'
        }
      })
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .select('-stockHistory'); // Exclude stock history for customer view

    const total = await Medicine.countDocuments(query);

    // Get vendor ratings for all vendors in this batch
    const vendorIds = medicines.map(m => m.vendorId?._id).filter(Boolean);
    const vendorRatings = await Review.aggregate([
      { $match: { vendor: { $in: vendorIds }, isActive: true } },
      {
        $group: {
          _id: '$vendor',
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    // Create a map for quick lookup
    const ratingsMap = vendorRatings.reduce((acc, rating) => {
      acc[rating._id.toString()] = {
        averageRating: Math.round(rating.averageRating * 10) / 10,
        totalReviews: rating.totalReviews
      };
      return acc;
    }, {});

    // Add location-based filtering and distance calculation if GPS coordinates provided
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude)) {
      console.log(`🌍 GPS Search: lat=${latitude}, lon=${longitude}, maxDistance=${maxDistance}km`);
      console.log(`📍 Total medicines before location filter: ${medicines.length}`);
      
      medicines = medicines.filter(medicine => {
        if (!medicine.vendorId?.address?.coordinates) {
          console.log(`❌ No coordinates for vendor: ${medicine.vendorId?.businessInfo?.businessName || medicine.vendorId?.firstName}`);
          return false;
        }
        
        const [vendorLon, vendorLat] = medicine.vendorId.address.coordinates;
        const distance = calculateDistance(latitude, longitude, vendorLat, vendorLon);
        
        console.log(`📏 Distance to ${medicine.vendorId?.businessInfo?.businessName || medicine.vendorId?.firstName}: ${distance.toFixed(2)}km`);
        
        return distance <= maxDistance;
      }).map(medicine => {
        const [vendorLon, vendorLat] = medicine.vendorId.address.coordinates;
        const distance = calculateDistance(latitude, longitude, vendorLat, vendorLon);
        
        return {
          ...medicine.toObject(),
          distance: Math.round(distance * 10) / 10 // Round to 1 decimal place
        };
      });

      console.log(`📍 Medicines found within ${maxDistance}km: ${medicines.length}`);
      
      // Sort by distance if location-based search
      if (sortBy === 'distance') {
        medicines.sort((a, b) => {
          const distanceA = a.distance || Infinity;
          const distanceB = b.distance || Infinity;
          return sortOrder === 1 ? distanceA - distanceB : distanceB - distanceA;
        });
      }
    }

    // Calculate statistics
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.json({
      medicines: medicines.map(medicine => {
        const medicineObj = medicine.toObject ? medicine.toObject() : medicine;
        
        return {
          _id: medicineObj._id,
          name: medicineObj.name,
          genericName: medicineObj.genericName,
          manufacturer: medicineObj.manufacturer,
          category: medicineObj.category,
          description: medicineObj.description,
          price: medicineObj.price,
          stockQuantity: medicineObj.stockQuantity,
          stock: medicineObj.stockQuantity, // Alias for compatibility
          isAvailable: medicineObj.stockQuantity > 0,
          isLowStock: medicineObj.stockQuantity <= medicineObj.minStockLevel,
          expiryDate: medicineObj.expiryDate,
          prescriptionRequired: medicineObj.prescriptionRequired,
          dosage: medicineObj.dosage,
          strength: medicineObj.dosage, // Alias for strength
          form: medicineObj.category, // Use category as form
          imageUrl: medicineObj.imageUrl,
          tags: medicineObj.tags,
          rating: medicineObj.rating || 0,
          distance: medicineObj.distance,
          pharmacy: medicineObj.vendorId ? {
            _id: medicineObj.vendorId._id,
            name: medicineObj.vendorId.businessInfo?.businessName || 
                  `${medicineObj.vendorId.firstName} ${medicineObj.vendorId.lastName}`,
            address: medicineObj.vendorId.businessInfo?.businessAddress || 
                    (medicineObj.vendorId.address?.street && medicineObj.vendorId.address?.city 
                      ? `${medicineObj.vendorId.address.street}, ${medicineObj.vendorId.address.city}` 
                      : medicineObj.vendorId.address?.street || medicineObj.vendorId.address?.city || 'Address not available'),
            phone: medicineObj.vendorId.businessInfo?.businessPhone || 
                   medicineObj.vendorId.phone,
            email: medicineObj.vendorId.email,
            location: medicineObj.vendorId.address?.coordinates ? {
              type: 'Point',
              coordinates: medicineObj.vendorId.address.coordinates
            } : null,
            // Add vendor rating information
            rating: ratingsMap[medicineObj.vendorId._id.toString()]?.averageRating || 0,
            totalReviews: ratingsMap[medicineObj.vendorId._id.toString()]?.totalReviews || 0
          } : null,
          vendor: medicineObj.vendorId ? {
            id: medicineObj.vendorId._id,
            name: `${medicineObj.vendorId.firstName} ${medicineObj.vendorId.lastName}`,
            email: medicineObj.vendorId.email,
            phone: medicineObj.vendorId.phone
          } : {
            id: null,
            name: 'Unknown Vendor',
            email: null,
            phone: null
          }
        };
      }),
      totalMedicines: total,
      totalPages,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage,
        hasPreviousPage
      },
      filters: {
        search,
        category,
        minPrice,
        maxPrice,
        inStockOnly,
        prescriptionFilter,
        minRating,
        latitude,
        longitude,
        maxDistance,
        sortBy,
        sortOrder: sortOrder === 1 ? 'asc' : 'desc'
      }
    });
  } catch (error) {
    console.error('Error searching medicines:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return distance;
}

// Get featured/popular medicines
router.get('/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    const featuredMedicines = await Medicine.find({ 
      isActive: true,
      stockQuantity: { $gt: 0 },
      expiryDate: { $gt: new Date() }
    })
    .populate('vendorId', 'firstName lastName')
    .sort({ createdAt: -1 }) // Show newest medicines first
    .limit(limit)
    .select('-stockHistory');

    res.json(featuredMedicines.map(medicine => ({
      _id: medicine._id,
      name: medicine.name,
      genericName: medicine.genericName,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      description: medicine.description,
      price: medicine.price,
      stockQuantity: medicine.stockQuantity,
      isAvailable: medicine.stockQuantity > 0,
      prescriptionRequired: medicine.prescriptionRequired,
      dosage: medicine.dosage,
      imageUrl: medicine.imageUrl,
      vendor: {
        name: `${medicine.vendorId.firstName} ${medicine.vendorId.lastName}`
      }
    })));
  } catch (error) {
    console.error('Error fetching featured medicines:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get medicine details by ID (public route)
router.get('/public/:id', async (req, res) => {
  try {
    const medicine = await Medicine.findOne({ 
      _id: req.params.id, 
      isActive: true,
      expiryDate: { $gt: new Date() }
    })
    .populate('vendorId', 'firstName lastName email phone')
    .select('-stockHistory');
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found or not available' });
    }

    res.json({
      _id: medicine._id,
      name: medicine.name,
      genericName: medicine.genericName,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      description: medicine.description,
      price: medicine.price,
      stockQuantity: medicine.stockQuantity,
      isAvailable: medicine.stockQuantity > 0,
      isLowStock: medicine.stockQuantity <= medicine.minStockLevel,
      expiryDate: medicine.expiryDate,
      prescriptionRequired: medicine.prescriptionRequired,
      dosage: medicine.dosage,
      sideEffects: medicine.sideEffects,
      imageUrl: medicine.imageUrl,
      tags: medicine.tags,
      vendor: medicine.vendorId ? {
        id: medicine.vendorId._id,
        name: `${medicine.vendorId.firstName} ${medicine.vendorId.lastName}`,
        email: medicine.vendorId.email,
        phone: medicine.vendorId.phone
      } : {
        id: null,
        name: 'Unknown Vendor',
        email: null,
        phone: null
      }
    });
  } catch (error) {
    console.error('Error fetching medicine details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get medicine categories (public route)
router.get('/categories', async (req, res) => {
  try {
    // Get categories from active medicines
    const categories = await Medicine.distinct('category', { 
      isActive: true,
      expiryDate: { $gt: new Date() }
    });
    
    // Add default categories if not present
    const defaultCategories = [
      'Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 
      'Drops', 'Inhaler', 'Suppository', 'Cream', 'Gel', 'Other'
    ];
    
    const allCategories = [...new Set([...categories, ...defaultCategories])];
    
    res.json({
      success: true,
      categories: allCategories.sort()
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get medicine categories (legacy endpoint)
router.get('/data/categories', (req, res) => {
  const categories = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Suppository', 'Other'];
  res.json(categories);
});

// Get a specific medicine by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    // Check if user has permission to view this medicine
    if (req.user.role === 'pharmacy_vendor' && medicine.vendorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(medicine);
  } catch (error) {
    console.error('Error fetching medicine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a new medicine
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('Creating medicine with user:', req.user);
    
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied. Only pharmacy vendors can add medicines.' });
    }

    const {
      name,
      genericName,
      manufacturer,
      category,
      description,
      price,
      stockQuantity,
      minStockLevel,
      expiryDate,
      batchNumber,
      prescriptionRequired,
      dosage,
      sideEffects,
      imageUrl,
      tags
    } = req.body;

    // Validate required fields
    if (!name || !genericName || !manufacturer || !description || !price || !expiryDate || !batchNumber || !dosage) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    // Check if medicine with same name and batch number already exists for this vendor
    const existingMedicine = await Medicine.findOne({
      vendorId: new mongoose.Types.ObjectId(req.user.id),
      name: name.trim(),
      batchNumber: batchNumber.trim()
    });

    if (existingMedicine) {
      return res.status(400).json({ message: 'Medicine with this name and batch number already exists' });
    }

    console.log('Creating medicine with vendorId:', req.user.id);

    const medicine = new Medicine({
      name: name.trim(),
      genericName: genericName.trim(),
      manufacturer: manufacturer.trim(),
      category,
      description: description.trim(),
      price: parseFloat(price),
      stockQuantity: parseInt(stockQuantity) || 0,
      minStockLevel: parseInt(minStockLevel) || 10,
      expiryDate: new Date(expiryDate),
      batchNumber: batchNumber.trim(),
      prescriptionRequired: Boolean(prescriptionRequired),
      dosage: dosage.trim(),
      sideEffects: sideEffects?.trim() || '',
      vendorId: new mongoose.Types.ObjectId(req.user.id), // Ensure proper ObjectId
      imageUrl: imageUrl || null,
      tags: tags || []
    });

    // Add initial stock entry if stock quantity > 0
    if (parseInt(stockQuantity) > 0) {
      medicine.stockHistory.push({
        type: 'in',
        quantity: parseInt(stockQuantity),
        reason: 'Initial stock',
        previousStock: 0,
        newStock: parseInt(stockQuantity)
      });
    }

    const savedMedicine = await medicine.save();
    console.log('Medicine created successfully:', savedMedicine._id);
    
    res.status(201).json(savedMedicine);
  } catch (error) {
    console.error('Error creating medicine:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Update a medicine
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied. Only pharmacy vendors can update medicines.' });
    }

    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    if (medicine.vendorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only update your own medicines.' });
    }

    const {
      name,
      genericName,
      manufacturer,
      category,
      description,
      price,
      minStockLevel,
      expiryDate,
      batchNumber,
      prescriptionRequired,
      dosage,
      sideEffects,
      imageUrl,
      tags,
      isActive
    } = req.body;

    // Update fields
    if (name) medicine.name = name.trim();
    if (genericName) medicine.genericName = genericName.trim();
    if (manufacturer) medicine.manufacturer = manufacturer.trim();
    if (category) medicine.category = category;
    if (description) medicine.description = description.trim();
    if (price !== undefined) medicine.price = parseFloat(price);
    if (minStockLevel !== undefined) medicine.minStockLevel = parseInt(minStockLevel);
    if (expiryDate) medicine.expiryDate = new Date(expiryDate);
    if (batchNumber) medicine.batchNumber = batchNumber.trim();
    if (prescriptionRequired !== undefined) medicine.prescriptionRequired = Boolean(prescriptionRequired);
    if (dosage) medicine.dosage = dosage.trim();
    if (sideEffects !== undefined) medicine.sideEffects = sideEffects?.trim() || '';
    if (imageUrl !== undefined) medicine.imageUrl = imageUrl || null;
    if (tags) medicine.tags = tags;
    if (isActive !== undefined) medicine.isActive = Boolean(isActive);

    const updatedMedicine = await medicine.save();
    res.json(updatedMedicine);
  } catch (error) {
    console.error('Error updating medicine:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update stock (stock in/out)
router.patch('/:id/stock', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied. Only pharmacy vendors can update stock.' });
    }

    const { quantity, type, reason } = req.body;

    if (!quantity || !type || !['in', 'out', 'expired', 'damaged'].includes(type)) {
      return res.status(400).json({ message: 'Invalid quantity or type. Type must be: in, out, expired, or damaged' });
    }

    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    if (medicine.vendorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only update stock for your own medicines.' });
    }

    const parsedQuantity = parseInt(quantity);
    if (parsedQuantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive number' });
    }

    // Check if there's enough stock for out/expired/damaged operations
    if ((type === 'out' || type === 'expired' || type === 'damaged') && medicine.stockQuantity < parsedQuantity) {
      return res.status(400).json({ message: 'Insufficient stock quantity' });
    }

    await medicine.updateStock(parsedQuantity, type, reason || '');
    
    res.json({
      message: 'Stock updated successfully',
      medicine
    });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete a medicine (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy_vendor') {
      return res.status(403).json({ message: 'Access denied. Only pharmacy vendors can delete medicines.' });
    }

    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    if (medicine.vendorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only delete your own medicines.' });
    }

    medicine.isActive = false;
    await medicine.save();
    
    res.json({ message: 'Medicine deleted successfully' });
  } catch (error) {
    console.error('Error deleting medicine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
