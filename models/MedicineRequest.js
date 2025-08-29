import mongoose from 'mongoose';

const medicineRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  medicineName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  prescriptionImage: {
    type: String, // URL to uploaded prescription image
    required: false // Making prescription optional
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminNote: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('MedicineRequest', medicineRequestSchema);
