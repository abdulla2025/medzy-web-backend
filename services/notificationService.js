import cron from 'node-cron';
import MedicineReminder from '../models/MedicineReminder.js';
import { sendEmail } from './emailService.js';
import User from '../models/User.js';

class NotificationService {
  constructor() {
    this.scheduledJobs = new Map();
    this.pushNotificationService = null; // Will be initialized with Firebase or similar
    this.smsService = null; // Will be initialized with Twilio or similar
    
    // Start the main cron job that checks for pending reminders every minute
    this.startReminderChecker();
  }

  // Initialize push notification service (Firebase, OneSignal, etc.)
  initializePushService(config) {
    // This would initialize Firebase Admin SDK or other push service
    console.log('Push notification service initialized');
  }

  // Initialize SMS service (Twilio, etc.)
  initializeSMSService(config) {
    // This would initialize Twilio or other SMS service
    console.log('SMS service initialized');
  }

  // Main cron job that runs every minute to check for pending reminders
  startReminderChecker() {
    cron.schedule('* * * * *', async () => {
      try {
        await this.checkAndSendReminders();
      } catch (error) {
        console.error('Error in reminder checker:', error);
      }
    });

    console.log('Medicine reminder checker started - running every minute');
  }

  // Check for reminders that need to be sent
  async checkAndSendReminders() {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60000); // 5 minutes buffer

    try {
      // Find all active reminders with upcoming notifications
      const reminders = await MedicineReminder.find({
        active: true,
        'nextReminders.scheduledTime': {
          $gte: now,
          $lte: fiveMinutesFromNow
        },
        'nextReminders.notificationSent': false
      }).populate('userId', 'name email phone notificationPreferences');

      for (const reminder of reminders) {
        // Process each pending reminder
        const pendingReminders = reminder.nextReminders.filter(
          nr => nr.scheduledTime >= now && 
                nr.scheduledTime <= fiveMinutesFromNow && 
                !nr.notificationSent
        );

        for (const pendingReminder of pendingReminders) {
          await this.sendReminderNotification(reminder, pendingReminder);
          
          // Mark as sent
          pendingReminder.notificationSent = true;
          await reminder.save();
        }
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  // Send reminder notification through multiple channels
  async sendReminderNotification(reminder, pendingReminder) {
    const user = reminder.userId;
    const scheduledTime = pendingReminder.scheduledTime;
    
    console.log(`Sending reminder for ${reminder.medicineName} to ${user.name} at ${scheduledTime}`);

    // Prepare notification content
    const notificationData = {
      title: '💊 Medicine Reminder',
      body: `Time to take your ${reminder.medicineName} (${reminder.dosage.amount} ${reminder.dosage.unit})`,
      data: {
        reminderId: reminder._id.toString(),
        medicineName: reminder.medicineName,
        dosage: `${reminder.dosage.amount} ${reminder.dosage.unit}`,
        withFood: reminder.withFood,
        notes: reminder.notes,
        scheduledTime: scheduledTime.toISOString()
      }
    };

    const promises = [];

    // Send push notification
    if (reminder.reminderSettings.pushNotification && user.notificationPreferences?.push !== false) {
      promises.push(this.sendPushNotification(user, notificationData));
    }

    // Send email notification
    if (reminder.reminderSettings.email && user.notificationPreferences?.email !== false && user.email) {
      promises.push(this.sendEmailReminder(user, reminder, scheduledTime));
    }

    // Send SMS notification
    if (reminder.reminderSettings.sms && user.notificationPreferences?.sms !== false && user.phone) {
      promises.push(this.sendSMSReminder(user, reminder, scheduledTime));
    }

    // Execute all notifications concurrently
    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  }

  // Send push notification
  async sendPushNotification(user, notificationData) {
    try {
      // In production, this would use Firebase Admin SDK or similar
      console.log('📱 Push notification sent:', {
        userId: user._id,
        title: notificationData.title,
        body: notificationData.body
      });

      // Example Firebase implementation:
      /*
      if (this.pushNotificationService && user.fcmToken) {
        const message = {
          notification: {
            title: notificationData.title,
            body: notificationData.body
          },
          data: notificationData.data,
          token: user.fcmToken
        };
        
        await this.pushNotificationService.send(message);
      }
      */
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  // Send email reminder
  async sendEmailReminder(user, reminder, scheduledTime) {
    try {
      const emailContent = {
        to: user.email,
        subject: `Medicine Reminder: ${reminder.medicineName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">💊 Medicine Reminder</h2>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #334155;">Time to take your medication!</h3>
              
              <div style="margin: 10px 0;">
                <strong>Medicine:</strong> ${reminder.medicineName}
              </div>
              
              <div style="margin: 10px 0;">
                <strong>Dosage:</strong> ${reminder.dosage.amount} ${reminder.dosage.unit}
              </div>
              
              <div style="margin: 10px 0;">
                <strong>Scheduled Time:</strong> ${scheduledTime.toLocaleString()}
              </div>
              
              ${reminder.withFood !== 'any' ? `
                <div style="margin: 10px 0;">
                  <strong>Food Instructions:</strong> Take ${reminder.withFood} meal
                </div>
              ` : ''}
              
              ${reminder.notes ? `
                <div style="margin: 10px 0;">
                  <strong>Notes:</strong> ${reminder.notes}
                </div>
              ` : ''}
            </div>
            
            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
              <p style="margin: 0; color: #92400e;">
                <strong>Remember:</strong> Consistency is key to effective treatment. 
                Take your medication at the same time every day for best results.
              </p>
            </div>
            
            <div style="margin: 30px 0; text-align: center;">
              <p style="color: #6b7280; font-size: 14px;">
                This is an automated reminder from MedzyClean. 
                Log in to your account to mark this medication as taken.
              </p>
            </div>
          </div>
        `
      };

      await sendEmail(emailContent);
      console.log('📧 Email reminder sent to:', user.email);
    } catch (error) {
      console.error('Error sending email reminder:', error);
    }
  }

  // Send SMS reminder
  async sendSMSReminder(user, reminder, scheduledTime) {
    try {
      const message = `💊 MedzyClean Reminder: Time to take your ${reminder.medicineName} (${reminder.dosage.amount} ${reminder.dosage.unit}). ${reminder.withFood !== 'any' ? `Take ${reminder.withFood} meal.` : ''} Scheduled: ${scheduledTime.toLocaleTimeString()}`;

      // In production, this would use Twilio or similar
      console.log('📱 SMS reminder sent:', {
        phone: user.phone,
        message: message
      });

      // Example Twilio implementation:
      /*
      if (this.smsService) {
        await this.smsService.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: user.phone
        });
      }
      */
    } catch (error) {
      console.error('Error sending SMS reminder:', error);
    }
  }

  // Schedule reminders for a specific reminder
  async scheduleReminders(reminder) {
    try {
      // Generate next week's reminders
      reminder.calculateScheduledTimes();
      reminder.getNextReminderTimes(7);
      
      await reminder.save();
      
      console.log(`Scheduled ${reminder.nextReminders.length} reminders for ${reminder.medicineName}`);
    } catch (error) {
      console.error('Error scheduling reminders:', error);
    }
  }

  // Cancel reminders for a specific reminder
  async cancelReminders(reminderId) {
    try {
      // Cancel any scheduled cron jobs
      if (this.scheduledJobs.has(reminderId)) {
        const job = this.scheduledJobs.get(reminderId);
        job.stop();
        this.scheduledJobs.delete(reminderId);
      }

      console.log(`Cancelled reminders for reminder ID: ${reminderId}`);
    } catch (error) {
      console.error('Error cancelling reminders:', error);
    }
  }

  // Send adherence report (daily/weekly)
  async sendAdherenceReport(userId, period = 'weekly') {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const reminders = await MedicineReminder.find({ userId, active: true });
      
      let reportData = {
        period,
        totalReminders: 0,
        takenCount: 0,
        missedCount: 0,
        adherenceRate: 0,
        medications: []
      };

      const startDate = new Date();
      if (period === 'weekly') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setDate(startDate.getDate() - 1);
      }

      reminders.forEach(reminder => {
        const recentHistory = reminder.adherenceHistory.filter(
          entry => entry.scheduledTime >= startDate
        );

        const taken = recentHistory.filter(entry => entry.status === 'taken').length;
        const total = recentHistory.length;
        
        reportData.totalReminders += total;
        reportData.takenCount += taken;
        reportData.missedCount += (total - taken);

        if (total > 0) {
          reportData.medications.push({
            name: reminder.medicineName,
            adherenceRate: Math.round((taken / total) * 100),
            taken,
            total
          });
        }
      });

      reportData.adherenceRate = reportData.totalReminders > 0 
        ? Math.round((reportData.takenCount / reportData.totalReminders) * 100)
        : 0;

      // Send adherence report email
      if (user.email) {
        await this.sendAdherenceReportEmail(user, reportData);
      }

      return reportData;
    } catch (error) {
      console.error('Error sending adherence report:', error);
    }
  }

  // Send adherence report email
  async sendAdherenceReportEmail(user, reportData) {
    try {
      const emailContent = {
        to: user.email,
        subject: `Your ${reportData.period} Medication Adherence Report`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">📊 Your Medication Adherence Report</h2>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #334155;">${reportData.period.charAt(0).toUpperCase() + reportData.period.slice(1)} Summary</h3>
              
              <div style="display: flex; justify-content: space-between; margin: 15px 0;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #059669;">${reportData.adherenceRate}%</div>
                  <div style="color: #6b7280;">Overall Adherence</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #0891b2;">${reportData.takenCount}</div>
                  <div style="color: #6b7280;">Taken</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${reportData.missedCount}</div>
                  <div style="color: #6b7280;">Missed</div>
                </div>
              </div>
            </div>
            
            <div style="margin: 20px 0;">
              <h3 style="color: #334155;">Medication Breakdown</h3>
              ${reportData.medications.map(med => `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 15px; margin: 10px 0; border-radius: 8px;">
                  <div style="display: flex; justify-content: between;">
                    <strong>${med.name}</strong>
                    <span style="color: ${med.adherenceRate >= 80 ? '#059669' : med.adherenceRate >= 60 ? '#d97706' : '#dc2626'}">
                      ${med.adherenceRate}% (${med.taken}/${med.total})
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
            
            <div style="background: ${reportData.adherenceRate >= 80 ? '#d1fae5' : '#fef3c7'}; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: ${reportData.adherenceRate >= 80 ? '#065f46' : '#92400e'};">
                ${reportData.adherenceRate >= 80 
                  ? '🎉 Excellent work! Your adherence rate is great. Keep up the consistent medication routine.'
                  : reportData.adherenceRate >= 60
                  ? '⚠️ Your adherence could be improved. Consider setting more frequent reminders or talking to your healthcare provider.'
                  : '🚨 Your adherence rate is concerning. Please consult with your healthcare provider about your medication routine.'
                }
              </p>
            </div>
          </div>
        `
      };

      await sendEmail(emailContent);
      console.log('📧 Adherence report sent to:', user.email);
    } catch (error) {
      console.error('Error sending adherence report email:', error);
    }
  }

  // Send missed medication alert
  async sendMissedMedicationAlert(reminder, missedTime) {
    try {
      const user = await User.findById(reminder.userId);
      if (!user) return;

      const alertData = {
        title: '⚠️ Missed Medication Alert',
        body: `You missed your ${reminder.medicineName} at ${missedTime.toLocaleTimeString()}`,
        data: {
          reminderId: reminder._id.toString(),
          medicineName: reminder.medicineName,
          missedTime: missedTime.toISOString()
        }
      };

      // Send push notification
      if (user.notificationPreferences?.push !== false) {
        await this.sendPushNotification(user, alertData);
      }

      console.log('⚠️ Missed medication alert sent for:', reminder.medicineName);
    } catch (error) {
      console.error('Error sending missed medication alert:', error);
    }
  }

  // Start daily adherence report cron job
  startDailyReports() {
    // Send daily reports at 9 PM
    cron.schedule('0 21 * * *', async () => {
      try {
        console.log('Sending daily adherence reports...');
        
        const users = await User.find({ 
          'notificationPreferences.adherenceReports': { $ne: false } 
        });

        for (const user of users) {
          await this.sendAdherenceReport(user._id, 'daily');
        }
      } catch (error) {
        console.error('Error sending daily reports:', error);
      }
    });
  }

  // Start weekly adherence report cron job
  startWeeklyReports() {
    // Send weekly reports every Sunday at 9 PM
    cron.schedule('0 21 * * 0', async () => {
      try {
        console.log('Sending weekly adherence reports...');
        
        const users = await User.find({ 
          'notificationPreferences.adherenceReports': { $ne: false } 
        });

        for (const user of users) {
          await this.sendAdherenceReport(user._id, 'weekly');
        }
      } catch (error) {
        console.error('Error sending weekly reports:', error);
      }
    });
  }
}

// Create singleton instance
const notificationService = new NotificationService();

// Start additional cron jobs
notificationService.startDailyReports();
notificationService.startWeeklyReports();

export default notificationService;
