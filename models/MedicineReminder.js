import mongoose from 'mongoose';

const medicineReminderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  medicineName: {
    type: String,
    required: true,
    trim: true
  },
  dosage: {
    amount: {
      type: String,
      required: true
    },
    unit: {
      type: String,
      required: true,
      enum: ['mg', 'ml', 'tablet', 'capsule', 'drop', 'tsp', 'tbsp']
    }
  },
  frequency: {
    type: String,
    required: true,
    enum: ['once', 'twice', 'three_times', 'four_times', 'as_needed']
  },
  timing: [{
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night', 'before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'bedtime']
  }],
  aiGeneratedSchedule: {
    recommendations: [{
      time: String,
      reasoning: String,
      withFood: Boolean,
      specialInstructions: String
    }]
  },
  duration: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: Date,
    daysCount: Number,
    isIndefinite: {
      type: Boolean,
      default: false
    }
  },
  withFood: {
    type: String,
    enum: ['before', 'after', 'with', 'any'],
    default: 'any'
  },
  notes: String,
  active: {
    type: Boolean,
    default: true
  },
  reminderSettings: {
    pushNotification: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: false
    },
    sms: {
      type: Boolean,
      default: false
    },
    snoozeMinutes: {
      type: Number,
      default: 10
    },
    maxSnoozes: {
      type: Number,
      default: 3
    }
  },
  scheduledTimes: [{
    hour: Number,
    minute: Number,
    label: String
  }],
  adherenceHistory: [{
    scheduledTime: Date,
    takenTime: Date,
    status: {
      type: String,
      enum: ['taken', 'missed', 'snoozed', 'skipped']
    },
    notes: String,
    sideEffects: String
  }],
  nextReminders: [{
    scheduledTime: Date,
    notificationSent: {
      type: Boolean,
      default: false
    },
    cronJobId: String
  }]
}, {
  timestamps: true
});

// Index for efficient queries
medicineReminderSchema.index({ userId: 1, active: 1 });
medicineReminderSchema.index({ 'nextReminders.scheduledTime': 1 });

// Virtual for adherence rate
medicineReminderSchema.virtual('adherenceRate').get(function() {
  if (!this.adherenceHistory.length) return 0;
  
  const taken = this.adherenceHistory.filter(entry => entry.status === 'taken').length;
  return Math.round((taken / this.adherenceHistory.length) * 100);
});

// Method to generate AI recommendations
medicineReminderSchema.methods.generateAIRecommendations = function() {
  const recommendations = [];
  
  // AI logic based on medicine type, frequency, and timing
  const medicineType = this.medicineName.toLowerCase();
  
  // Common medicine patterns for AI recommendations
  const aiRules = {
    // Antibiotics
    antibiotic: {
      timing: ['morning', 'evening'],
      withFood: 'after',
      reasoning: 'Antibiotics are best taken with food to reduce stomach irritation and maintain consistent blood levels.'
    },
    // Pain medications
    pain: {
      timing: ['morning', 'afternoon', 'evening'],
      withFood: 'with',
      reasoning: 'Pain medications can cause stomach upset, so taking with food is recommended.'
    },
    // Blood pressure medications
    'blood pressure': {
      timing: ['morning'],
      withFood: 'before',
      reasoning: 'Blood pressure medications work best when taken in the morning on an empty stomach.'
    },
    // Diabetes medications
    diabetes: {
      timing: ['before_breakfast', 'before_dinner'],
      withFood: 'before',
      reasoning: 'Diabetes medications should be taken before meals to help control blood sugar spikes.'
    }
  };
  
  // Generate recommendations based on frequency
  switch(this.frequency) {
    case 'once':
      recommendations.push({
        time: 'morning',
        reasoning: 'Morning dosing helps maintain consistent medication levels throughout the day.',
        withFood: this.withFood === 'any' ? 'after' : this.withFood,
        specialInstructions: 'Take at the same time each day for best results.'
      });
      break;
      
    case 'twice':
      recommendations.push(
        {
          time: 'morning',
          reasoning: 'Morning dose provides medication coverage for the first half of the day.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Space doses 12 hours apart.'
        },
        {
          time: 'evening',
          reasoning: 'Evening dose maintains medication levels overnight.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with dinner or 2 hours after.'
        }
      );
      break;
      
    case 'three_times':
      recommendations.push(
        {
          time: 'morning',
          reasoning: 'Start the day with consistent medication levels.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with breakfast.'
        },
        {
          time: 'afternoon',
          reasoning: 'Midday dose maintains therapeutic levels.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with lunch.'
        },
        {
          time: 'evening',
          reasoning: 'Evening dose ensures coverage through the night.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with dinner.'
        }
      );
      break;
      
    case 'four_times':
      recommendations.push(
        {
          time: 'morning',
          reasoning: 'Early morning dose for consistent levels.',
          withFood: this.withFood === 'any' ? 'before' : this.withFood,
          specialInstructions: 'Take 30 minutes before breakfast.'
        },
        {
          time: 'afternoon',
          reasoning: 'Midday maintenance dose.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with lunch.'
        },
        {
          time: 'evening',
          reasoning: 'Evening dose for continued coverage.',
          withFood: this.withFood === 'any' ? 'after' : this.withFood,
          specialInstructions: 'Take with dinner.'
        },
        {
          time: 'bedtime',
          reasoning: 'Bedtime dose for overnight coverage.',
          withFood: 'any',
          specialInstructions: 'Take 1-2 hours before sleep.'
        }
      );
      break;
  }
  
  this.aiGeneratedSchedule = { recommendations };
  return recommendations;
};

// Method to calculate scheduled times
medicineReminderSchema.methods.calculateScheduledTimes = function() {
  const timeMap = {
    'morning': { hour: 8, minute: 0, label: 'Morning' },
    'afternoon': { hour: 14, minute: 0, label: 'Afternoon' },
    'evening': { hour: 18, minute: 0, label: 'Evening' },
    'night': { hour: 22, minute: 0, label: 'Night' },
    'before_breakfast': { hour: 7, minute: 30, label: 'Before Breakfast' },
    'after_breakfast': { hour: 9, minute: 0, label: 'After Breakfast' },
    'before_lunch': { hour: 11, minute: 30, label: 'Before Lunch' },
    'after_lunch': { hour: 13, minute: 30, label: 'After Lunch' },
    'before_dinner': { hour: 17, minute: 30, label: 'Before Dinner' },
    'after_dinner': { hour: 19, minute: 30, label: 'After Dinner' },
    'bedtime': { hour: 21, minute: 30, label: 'Bedtime' }
  };
  
  this.scheduledTimes = this.timing.map(time => timeMap[time] || timeMap['morning']);
  return this.scheduledTimes;
};

// Method to get next reminder times
medicineReminderSchema.methods.getNextReminderTimes = function(days = 7) {
  const reminders = [];
  const now = new Date();
  
  for (let day = 0; day < days; day++) {
    const currentDate = new Date(now);
    currentDate.setDate(now.getDate() + day);
    
    this.scheduledTimes.forEach(schedule => {
      const reminderTime = new Date(currentDate);
      reminderTime.setHours(schedule.hour, schedule.minute, 0, 0);
      
      // Only add future reminders
      if (reminderTime > now) {
        reminders.push({
          scheduledTime: reminderTime,
          notificationSent: false,
          cronJobId: null
        });
      }
    });
  }
  
  this.nextReminders = reminders.sort((a, b) => a.scheduledTime - b.scheduledTime);
  return this.nextReminders;
};

export default mongoose.model('MedicineReminder', medicineReminderSchema);