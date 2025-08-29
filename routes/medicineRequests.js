import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import MedicineRequest from '../models/MedicineRequest.js';

const router = express.Router();

// Submit a new medicine request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { medicineName, quantity, reason, prescriptionImage } = req.body;
    
    const request = new MedicineRequest({
      userId: req.user.id,
      medicineName,
      quantity,
      reason,
      prescriptionImage
    });

    await request.save();
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: 'Error creating request' });
  }
});

// Get user's own requests
router.get('/my-requests', authenticateToken, async (req, res) => {
  try {
    const requests = await MedicineRequest.find({ userId: req.user.id });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching requests' });
  }
});

// Admin: Get all requests
router.get('/all', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const requests = await MedicineRequest.find().populate('userId', 'name email');
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching requests' });
  }
});

// Admin: Update request status
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const { status, adminNote } = req.body;
    const request = await MedicineRequest.findByIdAndUpdate(
      req.params.id,
      { status, adminNote },
      { new: true }
    );
    
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }
    
    res.json(request);
  } catch (error) {
    res.status(500).json({ message: 'Error updating request' });
  }
});

export default router;
