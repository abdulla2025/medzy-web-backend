import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import MedicineReminder from '../models/MedicineReminder.js';
import notificationService from '../services/notificationService.js';
import mongoose from 'mongoose';

const router = express.Router();

// Get all medicine reminders for a user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { userId: req.user.id };
    
    // Optional filters
    if (req.query.active !== undefined) {
      filter.active = req.query.active === 'true';
    }

    const reminders = await MedicineReminder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email');

    const total = await MedicineReminder.countDocuments(filter);
    
    res.json({
      reminders,
      pagination: {
        page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching medicine reminders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new medicine reminder
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      medicineName,
      dosage,
      frequency,
      timing,
      duration,
      withFood,
      notes,
      reminderSettings
    } = req.body;

    // Validation
    if (!medicineName || !dosage || !dosage.amount || !dosage.unit || !frequency) {
      return res.status(400).json({
        error: 'Medicine name, dosage amount, dosage unit, and frequency are required'
      });
    }

    // Create new reminder
    const reminderData = {
      userId: req.user.id,
      medicineName: medicineName.trim(),
      dosage: {
        amount: dosage.amount,
        unit: dosage.unit
      },
      frequency,
      timing: timing && timing.length > 0 ? timing : ['morning'], // Default to morning
      duration: {
        startDate: duration?.startDate || new Date(),
        endDate: duration?.endDate,
        daysCount: duration?.daysCount,
        isIndefinite: duration?.isIndefinite || false
      },
      withFood: withFood || 'any',
      notes: notes || '',
      reminderSettings: {
        pushNotification: reminderSettings?.pushNotification !== false,
        email: reminderSettings?.email || false,
        sms: reminderSettings?.sms || false,
        snoozeMinutes: reminderSettings?.snoozeMinutes || 10,
        maxSnoozes: reminderSettings?.maxSnoozes || 3
      }
    };

    const newReminder = new MedicineReminder(reminderData);

    // Generate AI recommendations
    newReminder.generateAIRecommendations();
    
    // Calculate scheduled times
    newReminder.calculateScheduledTimes();
    
    // Generate next week's reminders
    newReminder.getNextReminderTimes(7);

    // Save to database
    await newReminder.save();

    // Schedule notifications
    await notificationService.scheduleReminders(newReminder);

    res.status(201).json({
      message: 'Medicine reminder created successfully',
      reminder: newReminder,
      aiRecommendations: newReminder.aiGeneratedSchedule.recommendations
    });
  } catch (error) {
    console.error('Error creating medicine reminder:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.message 
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a medicine reminder
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Update fields
    const allowedUpdates = [
      'medicineName', 'dosage', 'frequency', 'timing', 'duration', 
      'withFood', 'notes', 'active', 'reminderSettings'
    ];

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        reminder[field] = req.body[field];
      }
    });

    // Regenerate AI recommendations if timing or frequency changed
    if (req.body.timing || req.body.frequency) {
      reminder.generateAIRecommendations();
      reminder.calculateScheduledTimes();
      reminder.getNextReminderTimes(7);
    }

    await reminder.save();

    // Update scheduled notifications
    await notificationService.scheduleReminders(reminder);

    res.json({
      message: 'Medicine reminder updated successfully',
      reminder,
      aiRecommendations: reminder.aiGeneratedSchedule.recommendations
    });
  } catch (error) {
    console.error('Error updating medicine reminder:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.message 
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a medicine reminder
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOneAndDelete({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Cancel scheduled notifications
    await notificationService.cancelReminders(reminderId);

    res.json({ 
      message: 'Medicine reminder deleted successfully',
      deletedReminder: {
        id: reminder._id,
        medicineName: reminder.medicineName
      }
    });
  } catch (error) {
    console.error('Error deleting medicine reminder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark reminder as taken
router.post('/:id/taken', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Add to adherence history
    const adherenceEntry = {
      scheduledTime: req.body.scheduledTime ? new Date(req.body.scheduledTime) : new Date(),
      takenTime: new Date(),
      status: 'taken',
      notes: req.body.notes || '',
      sideEffects: req.body.sideEffects || ''
    };

    reminder.adherenceHistory.push(adherenceEntry);

    // Update next reminders - mark the current one as completed
    const currentTime = new Date();
    reminder.nextReminders.forEach(nr => {
      if (!nr.notificationSent && 
          Math.abs(nr.scheduledTime.getTime() - currentTime.getTime()) < 30 * 60000) { // Within 30 minutes
        nr.notificationSent = true;
      }
    });

    await reminder.save();

    res.json({
      message: 'Medication marked as taken',
      adherenceRate: reminder.adherenceRate,
      nextReminders: reminder.nextReminders.filter(nr => !nr.notificationSent).slice(0, 3)
    });
  } catch (error) {
    console.error('Error marking medication as taken:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get upcoming reminders for today
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const reminders = await MedicineReminder.find({
      userId: req.user.id,
      active: true
    }).populate('userId', 'name');

    const todaysReminders = [];

    reminders.forEach(reminder => {
      // Get today's scheduled times
      const todaysSchedule = reminder.nextReminders.filter(nr => {
        const scheduledDate = new Date(nr.scheduledTime);
        return scheduledDate >= today && scheduledDate < tomorrow;
      });

      if (todaysSchedule.length > 0) {
        todaysReminders.push({
          _id: reminder._id,
          medicineName: reminder.medicineName,
          dosage: reminder.dosage,
          withFood: reminder.withFood,
          notes: reminder.notes,
          adherenceRate: reminder.adherenceRate,
          todaysSchedule: todaysSchedule.map(schedule => ({
            scheduledTime: schedule.scheduledTime,
            notificationSent: schedule.notificationSent,
            timeLabel: new Date(schedule.scheduledTime).toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })
          }))
        });
      }
    });

    res.json({
      reminders: todaysReminders,
      date: today.toDateString(),
      totalScheduled: todaysReminders.reduce((sum, r) => sum + r.todaysSchedule.length, 0)
    });
  } catch (error) {
    console.error('Error fetching today\'s reminders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Snooze a reminder
router.post('/:id/snooze', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;
    const snoozeMinutes = req.body.snoozeMinutes || 10;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Add to adherence history
    const adherenceEntry = {
      scheduledTime: req.body.scheduledTime ? new Date(req.body.scheduledTime) : new Date(),
      takenTime: null,
      status: 'snoozed',
      notes: `Snoozed for ${snoozeMinutes} minutes`
    };

    reminder.adherenceHistory.push(adherenceEntry);

    // Create a new snoozed reminder
    const snoozeTime = new Date();
    snoozeTime.setMinutes(snoozeTime.getMinutes() + snoozeMinutes);

    reminder.nextReminders.push({
      scheduledTime: snoozeTime,
      notificationSent: false,
      cronJobId: null
    });

    await reminder.save();

    res.json({
      message: `Reminder snoozed for ${snoozeMinutes} minutes`,
      snoozeUntil: snoozeTime.toISOString()
    });
  } catch (error) {
    console.error('Error snoozing reminder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Skip a reminder
router.post('/:id/skip', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Add to adherence history
    const adherenceEntry = {
      scheduledTime: req.body.scheduledTime ? new Date(req.body.scheduledTime) : new Date(),
      takenTime: null,
      status: 'skipped',
      notes: req.body.reason || 'Manually skipped'
    };

    reminder.adherenceHistory.push(adherenceEntry);
    await reminder.save();

    res.json({
      message: 'Reminder skipped',
      adherenceRate: reminder.adherenceRate
    });
  } catch (error) {
    console.error('Error skipping reminder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get adherence report
router.get('/adherence', authenticateToken, async (req, res) => {
  try {
    const period = req.query.period || 'weekly'; // daily, weekly, monthly
    const reminders = await MedicineReminder.find({
      userId: req.user.id,
      active: true
    });

    let startDate = new Date();
    switch (period) {
      case 'daily':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    let totalScheduled = 0;
    let totalTaken = 0;
    let totalMissed = 0;
    const medicationDetails = [];

    reminders.forEach(reminder => {
      const relevantHistory = reminder.adherenceHistory.filter(
        entry => entry.scheduledTime >= startDate
      );

      const taken = relevantHistory.filter(entry => entry.status === 'taken').length;
      const missed = relevantHistory.filter(entry => entry.status === 'missed').length;
      const total = relevantHistory.length;

      totalScheduled += total;
      totalTaken += taken;
      totalMissed += missed;

      if (total > 0) {
        medicationDetails.push({
          medicationId: reminder._id,
          medicineName: reminder.medicineName,
          dosage: reminder.dosage,
          scheduled: total,
          taken,
          missed,
          adherenceRate: Math.round((taken / total) * 100)
        });
      }
    });

    const overallAdherenceRate = totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : 0;

    res.json({
      period,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      summary: {
        totalScheduled,
        totalTaken,
        totalMissed,
        overallAdherenceRate
      },
      medications: medicationDetails,
      insights: generateAdherenceInsights(overallAdherenceRate, medicationDetails)
    });
  } catch (error) {
    console.error('Error generating adherence report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI recommendations for a specific reminder
router.get('/:id/ai-recommendations', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Regenerate AI recommendations
    const recommendations = reminder.generateAIRecommendations();
    await reminder.save();

    res.json({
      medicineName: reminder.medicineName,
      currentSchedule: {
        frequency: reminder.frequency,
        timing: reminder.timing,
        withFood: reminder.withFood
      },
      aiRecommendations: recommendations,
      adherenceRate: reminder.adherenceRate
    });
  } catch (error) {
    console.error('Error getting AI recommendations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update notification preferences for a reminder
router.put('/:id/notifications', authenticateToken, async (req, res) => {
  try {
    const reminderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ error: 'Invalid reminder ID' });
    }

    const reminder = await MedicineReminder.findOne({
      _id: reminderId,
      userId: req.user.id
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Medicine reminder not found' });
    }

    // Update notification settings
    const { pushNotification, email, sms, snoozeMinutes, maxSnoozes } = req.body;

    if (pushNotification !== undefined) reminder.reminderSettings.pushNotification = pushNotification;
    if (email !== undefined) reminder.reminderSettings.email = email;
    if (sms !== undefined) reminder.reminderSettings.sms = sms;
    if (snoozeMinutes !== undefined) reminder.reminderSettings.snoozeMinutes = snoozeMinutes;
    if (maxSnoozes !== undefined) reminder.reminderSettings.maxSnoozes = maxSnoozes;

    await reminder.save();

    // Update scheduled notifications
    await notificationService.scheduleReminders(reminder);

    res.json({
      message: 'Notification preferences updated',
      reminderSettings: reminder.reminderSettings
    });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to generate adherence insights
function generateAdherenceInsights(overallRate, medications) {
  const insights = [];

  if (overallRate >= 90) {
    insights.push({
      type: 'success',
      message: 'Excellent adherence! You\'re doing great with your medication routine.',
      icon: '🎉'
    });
  } else if (overallRate >= 80) {
    insights.push({
      type: 'warning',
      message: 'Good adherence, but there\'s room for improvement. Consider setting more frequent reminders.',
      icon: '⚠️'
    });
  } else if (overallRate >= 60) {
    insights.push({
      type: 'alert',
      message: 'Your adherence rate could be better. This may affect your treatment effectiveness.',
      icon: '🚨'
    });
  } else {
    insights.push({
      type: 'critical',
      message: 'Poor adherence detected. Please consult your healthcare provider immediately.',
      icon: '🆘'
    });
  }

  // Find medications with low adherence
  const lowAdherenceMeds = medications.filter(med => med.adherenceRate < 70);
  if (lowAdherenceMeds.length > 0) {
    insights.push({
      type: 'tip',
      message: `Focus on improving adherence for: ${lowAdherenceMeds.map(med => med.medicineName).join(', ')}`,
      icon: '💡'
    });
  }

  // General tips
  insights.push({
    type: 'tip',
    message: 'Try setting your medications next to something you use daily, like your toothbrush or coffee maker.',
    icon: '💡'
  });

  return insights;
}

export default router;
