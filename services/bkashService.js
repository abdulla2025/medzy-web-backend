import { BkashGateway } from 'bkash-payment-gateway';
import crypto from 'crypto';

class BkashService {
  constructor() {
    // bKash Configuration using the official library
    const bkashConfig = {
      baseURL: process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
      key: process.env.BKASH_APP_KEY || 'your_app_key',
      username: process.env.BKASH_USERNAME || 'your_username',
      password: process.env.BKASH_PASSWORD || 'your_password',
      secret: process.env.BKASH_APP_SECRET || 'your_app_secret',
    };
    
    if (!bkashConfig.key || !bkashConfig.secret || !bkashConfig.username || !bkashConfig.password) {
      console.warn('bKash credentials are not properly configured in environment variables');
    }
    
    this.bkash = new BkashGateway(bkashConfig);
    this.webhookSecret = process.env.BKASH_WEBHOOK_SECRET;
  }

  // Create payment using the official library
  async createPayment(amount, orderId, customerInfo) {
    try {
      const paymentRequest = {
        amount: parseFloat(amount),
        orderID: orderId,
        intent: 'sale'
      };

      console.log('Creating bKash payment with request:', paymentRequest);
      
      const result = await this.bkash.createPayment(paymentRequest);
      
      console.log('bKash payment creation result:', result);

      if (result && result.paymentID) {
        return {
          success: true,
          paymentID: result.paymentID,
          bkashURL: result.bkashURL,
          amount: result.amount,
          intent: result.intent,
          currency: result.currency,
          paymentCreateTime: result.paymentCreateTime,
          transactionStatus: result.transactionStatus,
          merchantInvoiceNumber: result.merchantInvoiceNumber
        };
      } else {
        console.error('Invalid response from bKash:', result);
        return {
          success: false,
          message: result?.errorMessage || 'Failed to create payment',
          errorCode: result?.errorCode
        };
      }
    } catch (error) {
      console.error('bKash payment creation error:', error);
      return {
        success: false,
        message: error.message || 'Payment creation failed',
        error: error
      };
    }
  }

  // Execute payment using the official library
  async executePayment(paymentID) {
    try {
      console.log('Executing bKash payment with ID:', paymentID);
      
      const result = await this.bkash.executePayment(paymentID);
      
      console.log('bKash payment execution result:', result);

      if (result && result.transactionStatus === 'Completed') {
        return {
          success: true,
          paymentID: result.paymentID,
          trxID: result.trxID,
          transactionStatus: result.transactionStatus,
          amount: result.amount,
          currency: result.currency,
          intent: result.intent,
          paymentExecuteTime: result.paymentExecuteTime,
          merchantInvoiceNumber: result.merchantInvoiceNumber,
          customerMsisdn: result.customerMsisdn
        };
      } else {
        return {
          success: false,
          message: result?.errorMessage || 'Payment execution failed',
          errorCode: result?.errorCode,
          transactionStatus: result?.transactionStatus
        };
      }
    } catch (error) {
      console.error('bKash payment execution error:', error);
      return {
        success: false,
        message: error.message || 'Payment execution failed',
        error: error
      };
    }
  }

  // Query payment status using the official library
  async queryPayment(paymentID) {
    try {
      console.log('Querying bKash payment with ID:', paymentID);
      
      const result = await this.bkash.queryPayment(paymentID);
      
      console.log('bKash payment query result:', result);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('bKash payment query error:', error);
      return {
        success: false,
        message: error.message || 'Payment query failed',
        error: error
      };
    }
  }

  // Search transaction using the official library
  async searchTransaction(transactionID) {
    try {
      console.log('Searching bKash transaction with ID:', transactionID);
      
      const result = await this.bkash.searchTransaction(transactionID);
      
      console.log('bKash transaction search result:', result);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('bKash transaction search error:', error);
      return {
        success: false,
        message: error.message || 'Transaction search failed',
        error: error
      };
    }
  }

  // Refund transaction using the official library
  async refundTransaction(refundData) {
    try {
      const { paymentID, amount, trxID, sku } = refundData;
      
      console.log('Refunding bKash transaction:', refundData);
      
      const refundRequest = {
        paymentID,
        amount: parseFloat(amount).toFixed(2),
        trxID,
        sku: sku || 'DEFAULT_SKU'
      };
      
      const result = await this.bkash.refundTransaction(refundRequest);
      
      console.log('bKash refund result:', result);

      if (result && result.transactionStatus === 'Completed') {
        return {
          success: true,
          refundTrxID: result.refundTrxID,
          transactionStatus: result.transactionStatus,
          amount: result.amount,
          currency: result.currency,
          charge: result.charge
        };
      } else {
        return {
          success: false,
          message: result?.errorMessage || 'Refund failed',
          errorCode: result?.errorCode
        };
      }
    } catch (error) {
      console.error('bKash refund error:', error);
      return {
        success: false,
        message: error.message || 'Refund failed',
        error: error
      };
    }
  }

  // Check refund status using the official library
  async checkRefundStatus(paymentID, trxID) {
    try {
      console.log('Checking bKash refund status for payment:', paymentID, 'trxID:', trxID);
      
      const result = await this.bkash.refundStatus(trxID, paymentID);
      
      console.log('bKash refund status result:', result);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('bKash refund status check error:', error);
      return {
        success: false,
        message: error.message || 'Refund status check failed',
        error: error
      };
    }
  }

  // Verify webhook signature for security
  verifyWebhookSignature(payload, signature) {
    if (!this.webhookSecret) {
      console.warn('Webhook secret not configured, skipping signature verification');
      return true; // Allow if no secret configured (for development)
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('Webhook signature verification error:', error);
      return false;
    }
  }
}

export default new BkashService();
