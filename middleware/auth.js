import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'medsy_secret_key_2024';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    
    // Ensure user.id is properly set and is a valid ObjectId
    const userId = user.id || user._id;
    
    // Validate that the user ID is a valid ObjectId and not a role string
    if (!userId || !mongoose.Types.ObjectId.isValid(userId) || 
        userId === 'customer' || userId === 'admin' || userId === 'vendor') {
      console.error('Invalid user ID in token:', userId);
      return res.status(403).json({ message: 'Invalid user token data' });
    }
    
    req.user = {
      ...user,
      id: userId
    };
    
    next();
  });
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
};

export const requireAdmin = requireRole(['admin']);