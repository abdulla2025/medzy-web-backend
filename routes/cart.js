import express from 'express';
import User from '../models/User.js';
import Medicine from '../models/Medicine.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Add item to cart
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { medicineId, quantity = 1 } = req.body;
    
    if (!medicineId) {
      return res.status(400).json({ message: 'Medicine ID is required' });
    }

    // Check if medicine exists and is available
    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    if (!medicine.isActive) {
      return res.status(400).json({ message: 'Medicine is not available' });
    }

    if (medicine.stockQuantity < quantity) {
      return res.status(400).json({ 
        message: `Insufficient stock. Only ${medicine.stockQuantity} units available` 
      });
    }

    // Get user and update cart
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if item already exists in cart
    const existingItemIndex = user.cart.findIndex(
      item => item.medicine.toString() === medicineId
    );

    if (existingItemIndex > -1) {
      // Update quantity if item exists
      const newQuantity = user.cart[existingItemIndex].quantity + quantity;
      
      if (newQuantity > medicine.stockQuantity) {
        return res.status(400).json({ 
          message: `Cannot add more items. Maximum available: ${medicine.stockQuantity}` 
        });
      }
      
      user.cart[existingItemIndex].quantity = newQuantity;
    } else {
      // Add new item to cart
      user.cart.push({
        medicine: medicineId,
        quantity: quantity
      });
    }

    await user.save();

    res.json({ 
      message: 'Item added to cart successfully',
      cartItemCount: user.cart.length
    });

  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get cart items
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: 'cart.medicine',
      populate: {
        path: 'vendorId',
        select: 'firstName lastName email phone'
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Filter out items where medicine might have been deleted
    const validCartItems = user.cart.filter(item => item.medicine);

    // Calculate totals
    let subtotal = 0;
    const cartItems = validCartItems.map(item => {
      const itemTotal = item.medicine.price * item.quantity;
      subtotal += itemTotal;
      
      return {
        _id: item._id,
        medicine: {
          _id: item.medicine._id,
          name: item.medicine.name,
          genericName: item.medicine.genericName,
          price: item.medicine.price,
          stockQuantity: item.medicine.stockQuantity,
          isAvailable: item.medicine.stockQuantity > 0 && item.medicine.isActive,
          imageUrl: item.medicine.imageUrl,
          vendor: {
            name: `${item.medicine.vendorId.firstName} ${item.medicine.vendorId.lastName}`,
            email: item.medicine.vendorId.email,
            phone: item.medicine.vendorId.phone
          }
        },
        quantity: item.quantity,
        itemTotal,
        addedAt: item.addedAt
      };
    });

    const deliveryFee = subtotal > 500 ? 0 : 50; // Free delivery for orders above ৳500
    const total = subtotal + deliveryFee;

    res.json({
      items: cartItems,
      summary: {
        itemCount: cartItems.length,
        subtotal,
        deliveryFee,
        total
      }
    });

  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update cart item quantity
router.put('/update', authenticateToken, async (req, res) => {
  try {
    const { medicineId, quantity } = req.body;
    
    if (!medicineId || !quantity || quantity < 1) {
      return res.status(400).json({ message: 'Valid medicine ID and quantity are required' });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found' });
    }

    if (quantity > medicine.stockQuantity) {
      return res.status(400).json({ 
        message: `Insufficient stock. Only ${medicine.stockQuantity} units available` 
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const cartItemIndex = user.cart.findIndex(
      item => item.medicine.toString() === medicineId
    );

    if (cartItemIndex === -1) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }

    user.cart[cartItemIndex].quantity = quantity;
    await user.save();

    res.json({ message: 'Cart updated successfully' });

  } catch (error) {
    console.error('Error updating cart:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove item from cart
router.delete('/remove/:medicineId', authenticateToken, async (req, res) => {
  try {
    const { medicineId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.cart = user.cart.filter(
      item => item.medicine.toString() !== medicineId
    );

    await user.save();

    res.json({ 
      message: 'Item removed from cart successfully',
      cartItemCount: user.cart.length
    });

  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Clear entire cart
router.delete('/clear', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.cart = [];
    await user.save();

    res.json({ message: 'Cart cleared successfully' });

  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get cart item count
router.get('/count', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ count: user.cart.length });

  } catch (error) {
    console.error('Error fetching cart count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
