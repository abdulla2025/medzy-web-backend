import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const addressSchema = new mongoose.Schema({
  street: {
    type: String,
    default: ''
  },
  city: {
    type: String,
    default: ''
  },
  state: {
    type: String,
    default: ''
  },
  postalCode: {
    type: String,
    default: ''
  },
  country: {
    type: String,
    default: 'Bangladesh'
  },
  latitude: {
    type: Number,
    default: null
  },
  longitude: {
    type: Number,
    default: null
  },
  // GeoJSON Point for MongoDB geospatial queries
  coordinates: {
    type: [Number], // [longitude, latitude]
    default: null
  },
  address: {
    type: String,
    default: ''
  }
}, { _id: false });

const businessInfoSchema = new mongoose.Schema({
  pharmacyName: {
    type: String,
    default: ''
  },
  licenseNumber: {
    type: String,
    default: ''
  },
  businessType: {
    type: String,
    enum: ['pharmacy', 'medical_store', 'hospital', 'clinic', 'other'],
    default: 'pharmacy'
  },
  yearsInOperation: {
    type: Number,
    default: null
  }
}, { _id: false });

const cartItemSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    required: true,
    enum: ['male', 'female', 'other']
  },
  role: {
    type: String,
    required: true,
    enum: ['admin', 'customer', 'pharmacy_vendor'],
    default: 'customer'
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  profilePicture: {
    type: String,
    default: null
  },
  address: {
    type: addressSchema,
    required: false,
    default: null
  },
  businessInfo: {
    type: businessInfoSchema,
    required: false,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verificationCode: {
    type: String,
    default: null
  },
  verificationCodeExpires: {
    type: Date,
    default: null
  },
  passwordResetToken: {
    type: String,
    default: null
  },
  passwordResetExpires: {
    type: Date,
    default: null
  },
  cart: [cartItemSchema],
  activeSession: {
    sessionId: {
      type: String,
      default: null
    },
    deviceInfo: {
      type: String,
      default: null
    },
    clientIP: {
      type: String,
      default: null
    },
    lastActivity: {
      type: Date,
      default: null
    },
    loginTime: {
      type: Date,
      default: null
    }
  },
  medicalProfile: {
    allergies: [{
      name: {
        type: String,
        required: true
      },
      severity: {
        type: String,
        enum: ['mild', 'moderate', 'severe', 'anaphylactic'],
        default: 'moderate'
      },
      reaction: {
        type: String,
        default: ''
      },
      diagnosedDate: {
        type: Date,
        default: Date.now
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    pastDiseases: [{
      name: {
        type: String,
        required: true
      },
      diagnosedDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['resolved', 'ongoing', 'monitored'],
        default: 'resolved'
      },
      severity: {
        type: String,
        enum: ['mild', 'moderate', 'severe'],
        default: 'moderate'
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    currentMedications: [{
      name: {
        type: String,
        required: true
      },
      dosage: {
        type: String,
        required: true
      },
      frequency: {
        type: String,
        required: true
      },
      startDate: {
        type: Date,
        default: Date.now
      },
      endDate: {
        type: Date,
        default: null
      },
      prescribedBy: {
        type: String,
        default: ''
      },
      purpose: {
        type: String,
        default: ''
      },
      sideEffects: [{
        type: String
      }],
      notes: {
        type: String,
        default: ''
      }
    }],
    chronicConditions: [{
      name: {
        type: String,
        required: true
      },
      diagnosedDate: {
        type: Date,
        default: Date.now
      },
      severity: {
        type: String,
        enum: ['mild', 'moderate', 'severe'],
        default: 'moderate'
      },
      managementPlan: {
        type: String,
        default: ''
      },
      lastReviewDate: {
        type: Date,
        default: Date.now
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    surgicalHistory: [{
      procedure: {
        type: String,
        required: true
      },
      date: {
        type: Date,
        required: true
      },
      surgeon: {
        type: String,
        default: ''
      },
      hospital: {
        type: String,
        default: ''
      },
      complications: {
        type: String,
        default: ''
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    familyHistory: [{
      relationship: {
        type: String,
        required: true
      },
      condition: {
        type: String,
        required: true
      },
      ageAtDiagnosis: {
        type: Number,
        default: null
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    immunizations: [{
      vaccine: {
        type: String,
        required: true
      },
      date: {
        type: Date,
        required: true
      },
      boosterDue: {
        type: Date,
        default: null
      },
      provider: {
        type: String,
        default: ''
      },
      lotNumber: {
        type: String,
        default: ''
      },
      notes: {
        type: String,
        default: ''
      }
    }],
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
      default: ''
    },
    emergencyContact: {
      name: {
        type: String,
        default: ''
      },
      phone: {
        type: String,
        default: ''
      },
      relationship: {
        type: String,
        default: ''
      },
      address: {
        type: String,
        default: ''
      }
    },
    lifestyleFactors: {
      smokingStatus: {
        type: String,
        enum: ['never', 'former', 'current', 'unknown'],
        default: 'unknown'
      },
      alcoholConsumption: {
        type: String,
        enum: ['never', 'occasionally', 'regularly', 'heavily', 'unknown'],
        default: 'unknown'
      },
      exerciseFrequency: {
        type: String,
        enum: ['none', 'rarely', 'occasionally', 'regularly', 'daily', 'unknown'],
        default: 'unknown'
      },
      dietType: {
        type: String,
        enum: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other', 'unknown'],
        default: 'unknown'
      },
      sleepHours: {
        type: Number,
        min: 0,
        max: 24,
        default: null
      },
      stressLevel: {
        type: String,
        enum: ['low', 'moderate', 'high', 'unknown'],
        default: 'unknown'
      }
    },
    riskFactors: [{
      factor: {
        type: String,
        required: true
      },
      level: {
        type: String,
        enum: ['low', 'moderate', 'high'],
        default: 'moderate'
      },
      source: {
        type: String,
        default: 'user_reported'
      },
      lastAssessed: {
        type: Date,
        default: Date.now
      }
    }],
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  notificationPreferences: {
    push: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    },
    adherenceReports: {
      type: Boolean,
      default: true
    },
    reminderTime: {
      type: Number, // Minutes before scheduled time
      default: 0
    },
    quietHours: {
      start: {
        type: String,
        default: '22:00' // 10 PM
      },
      end: {
        type: String,
        default: '07:00' // 7 AM
      }
    }
  },
  fcmToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});


// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);