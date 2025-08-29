import express from 'express';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/profile/:id - Fetch user profile
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is accessing their own profile or if admin
    if (req.user.id !== id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        message: 'Access denied. You can only view your own profile.' 
      });
    }

    const user = await User.findById(id).select('-password -verificationCode -passwordResetToken');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return profile data based on role
    const profileData = {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      profilePicture: user.profilePicture,
      address: user.address || null,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Add business info for vendors
    if (user.role === 'pharmacy_vendor') {
      profileData.businessInfo = user.businessInfo || null;
    }

    res.json({
      message: 'Profile fetched successfully',
      profile: profileData
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching profile',
      error: error.message 
    });
  }
});

// GET /api/profile - Fetch current user's profile
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationCode -passwordResetToken');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const profileData = {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      profilePicture: user.profilePicture,
      address: user.address || null,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Add business info for vendors
    if (user.role === 'pharmacy_vendor') {
      profileData.businessInfo = user.businessInfo || null;
    }

    res.json({
      message: 'Profile fetched successfully',
      profile: profileData
    });
  } catch (error) {
    console.error('Get current profile error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching profile',
      error: error.message 
    });
  }
});

// PUT /api/profile/:id - Update user profile
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is updating their own profile or if admin
    if (req.user.id !== id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        message: 'Access denied. You can only update your own profile.' 
      });
    }

    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      profilePicture,
      address,
      businessInfo
    } = req.body;

    // Validate required address fields (only if address is provided and not empty)
    if (address && (address.city || address.state || address.postalCode)) {
      if (!address.city || !address.state || !address.postalCode) {
        return res.status(400).json({
          message: 'If providing address information, city, state, and postal code are required'
        });
      }
    }

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update basic profile fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (gender) user.gender = gender;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;

    // Update address
    if (address) {
      user.address = {
        street: address.street || (user.address?.street) || '',
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || (user.address?.country) || 'Bangladesh',
        latitude: address.latitude || (user.address?.latitude) || null,
        longitude: address.longitude || (user.address?.longitude) || null
      };
    }

    // Update business info for vendors
    if (user.role === 'pharmacy_vendor' && businessInfo) {
      user.businessInfo = {
        pharmacyName: businessInfo.pharmacyName || (user.businessInfo?.pharmacyName) || '',
        licenseNumber: businessInfo.licenseNumber || (user.businessInfo?.licenseNumber) || '',
        businessType: businessInfo.businessType || (user.businessInfo?.businessType) || 'pharmacy',
        yearsInOperation: businessInfo.yearsInOperation || (user.businessInfo?.yearsInOperation) || null
      };
    }

    // Save updated user
    await user.save();

    // Return updated profile (excluding sensitive data)
    const updatedProfile = {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      profilePicture: user.profilePicture,
      address: user.address,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      updatedAt: user.updatedAt
    };

    if (user.role === 'pharmacy_vendor') {
      updatedProfile.businessInfo = user.businessInfo;
    }

    res.json({
      message: 'Profile updated successfully',
      profile: updatedProfile
    });
  } catch (error) {
    console.error('Update profile error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        message: `${field} already exists. Please use a different ${field}.`
      });
    }

    res.status(500).json({ 
      message: 'Server error while updating profile',
      error: error.message 
    });
  }
});

// PUT /api/profile - Update current user's profile
router.put('/', authenticateToken, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      profilePicture,
      address,
      businessInfo
    } = req.body;

    // Validate required address fields (only if address is provided and not empty)
    if (address && (address.city || address.state || address.postalCode)) {
      if (!address.city || !address.state || !address.postalCode) {
        return res.status(400).json({
          message: 'If providing address information, city, state, and postal code are required'
        });
      }
    }

    // Find user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update basic profile fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (gender) user.gender = gender;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;

    // Update address
    if (address) {
      user.address = {
        street: address.street || (user.address?.street) || '',
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || (user.address?.country) || 'Bangladesh',
        latitude: address.latitude || (user.address?.latitude) || null,
        longitude: address.longitude || (user.address?.longitude) || null
      };
    }

    // Update business info for vendors
    if (user.role === 'pharmacy_vendor' && businessInfo) {
      user.businessInfo = {
        pharmacyName: businessInfo.pharmacyName || (user.businessInfo?.pharmacyName) || '',
        licenseNumber: businessInfo.licenseNumber || (user.businessInfo?.licenseNumber) || '',
        businessType: businessInfo.businessType || (user.businessInfo?.businessType) || 'pharmacy',
        yearsInOperation: businessInfo.yearsInOperation || (user.businessInfo?.yearsInOperation) || null
      };
    }

    // Save updated user
    await user.save();

    // Return updated profile (excluding sensitive data)
    const updatedProfile = {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      profilePicture: user.profilePicture,
      address: user.address,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      updatedAt: user.updatedAt
    };

    if (user.role === 'pharmacy_vendor') {
      updatedProfile.businessInfo = user.businessInfo;
    }

    res.json({
      message: 'Profile updated successfully',
      profile: updatedProfile
    });
  } catch (error) {
    console.error('Update current profile error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        message: `${field} already exists. Please use a different ${field}.`
      });
    }

    res.status(500).json({ 
      message: 'Server error while updating profile',
      error: error.message 
    });
  }
});

// PUT /api/profile/change-password - Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'New password must be at least 6 characters long'
      });
    }

    // Find user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ 
      message: 'Server error while changing password',
      error: error.message 
    });
  }
});

export default router;
