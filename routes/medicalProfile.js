import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Get user's medical history and profile
router.get('/medical-history', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return medical profile (with defaults if not set)
    const medicalProfile = {
      allergies: user.medicalProfile?.allergies || [],
      pastDiseases: user.medicalProfile?.pastDiseases || [],
      currentMedications: user.medicalProfile?.currentMedications || [],
      bloodType: user.medicalProfile?.bloodType || '',
      emergencyContact: user.medicalProfile?.emergencyContact || {
        name: '',
        phone: '',
        relationship: ''
      },
      chronicConditions: user.medicalProfile?.chronicConditions || [],
      surgicalHistory: user.medicalProfile?.surgicalHistory || [],
      familyHistory: user.medicalProfile?.familyHistory || [],
      immunizations: user.medicalProfile?.immunizations || [],
      lastUpdated: user.medicalProfile?.lastUpdated || null
    };

    res.json(medicalProfile);
  } catch (error) {
    console.error('Error fetching medical history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user's medical history and profile
router.put('/medical-history', authenticateToken, async (req, res) => {
  try {
    const {
      allergies,
      pastDiseases,
      currentMedications,
      bloodType,
      emergencyContact,
      chronicConditions,
      surgicalHistory,
      familyHistory,
      immunizations
    } = req.body;

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update medical profile
    user.medicalProfile = {
      allergies: allergies || [],
      pastDiseases: pastDiseases || [],
      currentMedications: currentMedications || [],
      bloodType: bloodType || '',
      emergencyContact: emergencyContact || {},
      chronicConditions: chronicConditions || [],
      surgicalHistory: surgicalHistory || [],
      familyHistory: familyHistory || [],
      immunizations: immunizations || [],
      lastUpdated: new Date()
    };

    await user.save();

    res.json({
      message: 'Medical profile updated successfully',
      medicalProfile: user.medicalProfile
    });
  } catch (error) {
    console.error('Error updating medical history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add an allergy
router.post('/allergies', authenticateToken, async (req, res) => {
  try {
    const { allergyName, severity, reaction, notes } = req.body;
    
    if (!allergyName) {
      return res.status(400).json({ error: 'Allergy name is required' });
    }

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.medicalProfile) {
      user.medicalProfile = {};
    }

    if (!user.medicalProfile.allergies) {
      user.medicalProfile.allergies = [];
    }

    const newAllergy = {
      name: allergyName,
      severity: severity || 'mild',
      reaction: reaction || '',
      notes: notes || '',
      dateAdded: new Date()
    };

    user.medicalProfile.allergies.push(newAllergy);
    user.medicalProfile.lastUpdated = new Date();
    
    await user.save();

    res.status(201).json({
      message: 'Allergy added successfully',
      allergy: newAllergy
    });
  } catch (error) {
    console.error('Error adding allergy:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove an allergy
router.delete('/allergies/:allergyName', authenticateToken, async (req, res) => {
  try {
    const { allergyName } = req.params;
    
    const user = await User.findById(req.user.id);
    
    if (!user || !user.medicalProfile?.allergies) {
      return res.status(404).json({ error: 'User or allergies not found' });
    }

    user.medicalProfile.allergies = user.medicalProfile.allergies.filter(
      allergy => allergy.name.toLowerCase() !== allergyName.toLowerCase()
    );
    
    user.medicalProfile.lastUpdated = new Date();
    await user.save();

    res.json({ message: 'Allergy removed successfully' });
  } catch (error) {
    console.error('Error removing allergy:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add current medication
router.post('/medications', authenticateToken, async (req, res) => {
  try {
    const { medicationName, dosage, frequency, startDate, prescribedBy, notes } = req.body;
    
    if (!medicationName) {
      return res.status(400).json({ error: 'Medication name is required' });
    }

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.medicalProfile) {
      user.medicalProfile = {};
    }

    if (!user.medicalProfile.currentMedications) {
      user.medicalProfile.currentMedications = [];
    }

    const newMedication = {
      name: medicationName,
      dosage: dosage || '',
      frequency: frequency || '',
      startDate: startDate || new Date(),
      prescribedBy: prescribedBy || '',
      notes: notes || '',
      dateAdded: new Date()
    };

    user.medicalProfile.currentMedications.push(newMedication);
    user.medicalProfile.lastUpdated = new Date();
    
    await user.save();

    res.status(201).json({
      message: 'Medication added successfully',
      medication: newMedication
    });
  } catch (error) {
    console.error('Error adding medication:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove current medication
router.delete('/medications/:medicationName', authenticateToken, async (req, res) => {
  try {
    const { medicationName } = req.params;
    
    const user = await User.findById(req.user.id);
    
    if (!user || !user.medicalProfile?.currentMedications) {
      return res.status(404).json({ error: 'User or medications not found' });
    }

    user.medicalProfile.currentMedications = user.medicalProfile.currentMedications.filter(
      medication => medication.name.toLowerCase() !== medicationName.toLowerCase()
    );
    
    user.medicalProfile.lastUpdated = new Date();
    await user.save();

    res.json({ message: 'Medication removed successfully' });
  } catch (error) {
    console.error('Error removing medication:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get drug interaction warnings
router.post('/check-interactions', authenticateToken, async (req, res) => {
  try {
    const { medications } = req.body;
    
    if (!medications || !Array.isArray(medications)) {
      return res.status(400).json({ error: 'Medications array is required' });
    }

    // In production, this would use a drug interaction database
    const interactions = checkDrugInteractions(medications);

    res.json({
      interactions,
      checkedAt: new Date(),
      disclaimer: 'This is for informational purposes only. Consult your healthcare provider for professional advice.'
    });
  } catch (error) {
    console.error('Error checking drug interactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function for drug interaction checking
function checkDrugInteractions(medications) {
  const interactions = [];
  
  // Simplified interaction checking (in production, use a comprehensive database)
  const commonInteractions = {
    'warfarin': ['aspirin', 'ibuprofen', 'amoxicillin'],
    'metformin': ['alcohol', 'contrast dye'],
    'lisinopril': ['ibuprofen', 'potassium supplements'],
    'simvastatin': ['grapefruit', 'erythromycin'],
    'digoxin': ['amiodarone', 'verapamil']
  };

  for (let i = 0; i < medications.length; i++) {
    const med1 = medications[i].toLowerCase();
    
    for (let j = i + 1; j < medications.length; j++) {
      const med2 = medications[j].toLowerCase();
      
      // Check for known interactions
      if (commonInteractions[med1]?.includes(med2) || 
          commonInteractions[med2]?.includes(med1)) {
        interactions.push({
          medications: [medications[i], medications[j]],
          severity: 'moderate',
          description: 'Potential interaction detected. Monitor closely.',
          recommendation: 'Consult your healthcare provider about this combination.'
        });
      }
    }
    
    // Check specific drug combinations
    if (med1.includes('warfarin')) {
      medications.forEach(med => {
        if (med.toLowerCase().includes('aspirin') || 
            med.toLowerCase().includes('ibuprofen')) {
          interactions.push({
            medications: [medications[i], med],
            severity: 'high',
            description: 'Increased risk of bleeding',
            recommendation: 'Use alternative pain medication or consult healthcare provider.'
          });
        }
      });
    }
  }

  return interactions;
}

export default router;
