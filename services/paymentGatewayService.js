import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SSLCommerzPayment = require('sslcommerz-lts');
import crypto from 'crypto';

class PaymentGatewayService {
  constructor() {
    // SSLCommerz Configuration
    this.sslcommerz = {
      store_id: process.env.SSLCOMMERZ_STORE_ID || 'test_store',
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || 'test_password',
      is_live: process.env.NODE_ENV === 'production' // true for live, false for sandbox
    };
  }

  // ================= STRIPE PAYMENT GATEWAY =================

  async createStripePaymentIntent(amount, currency = 'usd', orderId, customerInfo) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Stripe expects amount in cents
        currency: currency.toLowerCase(),
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          orderId: orderId,
          customerEmail: customerInfo.email,
          customerName: customerInfo.name
        }
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency
      };
    } catch (error) {
      console.error('Stripe payment intent creation error:', error);
      return {
        success: false,
        message: error.message || 'Failed to create payment intent'
      };
    }
  }

  async confirmStripePayment(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      
      return {
        success: paymentIntent.status === 'succeeded',
        status: paymentIntent.status,
        paymentMethod: paymentIntent.payment_method,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        created: new Date(paymentIntent.created * 1000)
      };
    } catch (error) {
      console.error('Stripe payment confirmation error:', error);
      return {
        success: false,
        message: error.message || 'Failed to confirm payment'
      };
    }
  }

  // ================= SSLCOMMERZ PAYMENT GATEWAY =================

  async createSSLCommerzPayment(amount, orderId, customerInfo, successUrl, failUrl, cancelUrl) {
    try {
      console.log('🔧 Creating SSLCommerz payment with credentials:', {
        store_id: this.sslcommerz.store_id,
        is_live: this.sslcommerz.is_live,
        amount,
        orderId
      });

      const tranId = `SSL_${orderId}_${Date.now()}`;
      
      // Use backend callback URLs for better transaction handling
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      
      const data = {
        total_amount: amount,
        currency: 'BDT',
        tran_id: tranId, // use unique tran_id for each api call
        // Backend callback URLs for proper transaction handling
        success_url: `${backendUrl}/api/payments/sslcommerz/success`,
        fail_url: `${backendUrl}/api/payments/sslcommerz/fail`,
        cancel_url: `${backendUrl}/api/payments/sslcommerz/cancel`,
        ipn_url: `${backendUrl}/api/payments/sslcommerz/ipn`,
        shipping_method: 'Courier',
        product_name: 'Medicine Order',
        product_category: 'Healthcare',
        product_profile: 'general',
        cus_name: customerInfo.name,
        cus_email: customerInfo.email,
        cus_add1: customerInfo.address || 'Dhaka',
        cus_add2: 'Dhaka',
        cus_city: customerInfo.city || 'Dhaka',
        cus_state: customerInfo.city || 'Dhaka',
        cus_postcode: customerInfo.postcode || '1000',
        cus_country: 'Bangladesh',
        cus_phone: customerInfo.phone,
        cus_fax: customerInfo.phone,
        ship_name: customerInfo.name,
        ship_add1: customerInfo.address || 'Dhaka',
        ship_add2: 'Dhaka',
        ship_city: customerInfo.city || 'Dhaka',
        ship_state: customerInfo.city || 'Dhaka',
        ship_postcode: customerInfo.postcode || '1000',
        ship_country: 'Bangladesh',
        // Add parameters to control redirect behavior and disable problematic features
        multi_card_name: 'mastercard,visacard,amexcard',
        value_a: orderId, // Store order ID for callback reference
        value_b: frontendUrl, // Store frontend URL for proper redirection
        value_c: 'medzy_payment',
        value_d: new Date().toISOString(),
        // Disable EMI to prevent API errors
        emi_option: 0,
        emi_max_inst_option: 0,
        emi_selected_inst: 0,
        emi_allow_only: 0,
        // Additional parameters for better compatibility
        store_passwd: this.sslcommerz.store_passwd,
        // Ensure smooth redirect behavior
        integration_check: 0,
      };

      // If using dummy credentials, return a demo response
      if (this.sslcommerz.store_id === 'test_store') {
        console.log('⚠️ Using SSLCommerz demo/test credentials - returning simulated response');
        return {
          success: true,
          data: {
            sessionkey: `DEMO_SSL_${Date.now()}`,
            GatewayPageURL: `${process.env.FRONTEND_URL}/payment/demo-sslcommerz?amount=${amount}&orderId=${orderId}`,
            transactionId: data.tran_id,
            isDemo: true
          }
        };
      }

      const sslcz = new SSLCommerzPayment(
        this.sslcommerz.store_id, 
        this.sslcommerz.store_passwd, 
        this.sslcommerz.is_live
      );

      console.log('🚀 Initializing SSLCommerz payment...');
      const apiResponse = await sslcz.init(data);
      console.log('📡 SSLCommerz API Response:', apiResponse);

      if (apiResponse?.GatewayPageURL) {
        return {
          success: true,
          data: {
            sessionkey: apiResponse.sessionkey,
            GatewayPageURL: apiResponse.GatewayPageURL,
            transactionId: tranId
          }
        };
      } else {
        console.error('❌ SSLCommerz API did not return GatewayPageURL:', apiResponse);
        return {
          success: false,
          error: 'Failed to initialize SSLCommerz payment - no GatewayPageURL received'
        };
      }
    } catch (error) {
      console.error('💥 SSLCommerz payment creation error:', error);
      return {
        success: false,
        error: error.message || 'SSLCommerz payment creation failed'
      };
    }
  }

  async validateSSLCommerzPayment(transactionId) {
    try {
      const sslcz = new SSLCommerzPayment(
        this.sslcommerz.store_id, 
        this.sslcommerz.store_passwd, 
        this.sslcommerz.is_live
      );

      const validation = await sslcz.validate({ tran_id: transactionId });

      return {
        success: validation.status === 'VALID',
        data: validation
      };
    } catch (error) {
      console.error('SSLCommerz validation error:', error);
      return {
        success: false,
        message: error.message || 'Payment validation failed'
      };
    }
  }

  // ================= NAGAD PAYMENT GATEWAY =================

  async createNagadPayment(amount, orderId, customerInfo) {
    try {
      // This is a simplified Nagad integration
      // In production, you'll need proper Nagad merchant credentials and API implementation
      
      const paymentData = {
        merchantId: this.nagad.merchantId,
        orderId: orderId,
        amount: amount,
        currency: 'BDT',
        challenge: this.generateRandomString(40)
      };

      // For demo purposes, we'll simulate a successful response
      // In production, you'll make actual API calls to Nagad
      return {
        success: true,
        paymentURL: `${this.nagad.baseURL}/checkout?orderId=${orderId}&amount=${amount}`,
        challengeHash: this.generateHash(paymentData.challenge),
        orderId: orderId
      };
    } catch (error) {
      console.error('Nagad payment creation error:', error);
      return {
        success: false,
        message: error.message || 'Nagad payment creation failed'
      };
    }
  }

  // ================= ROCKET PAYMENT GATEWAY =================

  async createRocketPayment(amount, orderId, customerInfo) {
    try {
      // This is a simplified Rocket integration
      // Rocket API implementation would go here
      
      const paymentData = {
        merchantId: this.rocket.merchantId,
        orderId: orderId,
        amount: amount,
        currency: 'BDT',
        customerPhone: customerInfo.phone
      };

      // For demo purposes, simulate a successful response
      return {
        success: true,
        paymentURL: `${this.rocket.baseURL}/payment?orderId=${orderId}&amount=${amount}`,
        transactionId: `RKT_${orderId}_${Date.now()}`,
        orderId: orderId
      };
    } catch (error) {
      console.error('Rocket payment creation error:', error);
      return {
        success: false,
        message: error.message || 'Rocket payment creation failed'
      };
    }
  }

  // ================= DUMMY PAYMENT FOR TESTING =================

  async createDummyPayment(amount, orderId, customerInfo, paymentMethod) {
    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Simulate 90% success rate
      const isSuccess = Math.random() > 0.1;
      
      if (isSuccess) {
        return {
          success: true,
          transactionId: `DUMMY_${paymentMethod.toUpperCase()}_${Date.now()}`,
          amount: amount,
          currency: 'BDT',
          paymentMethod: paymentMethod,
          status: 'completed',
          timestamp: new Date()
        };
      } else {
        return {
          success: false,
          message: 'Payment was declined by the bank',
          errorCode: 'DECLINED'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Dummy payment failed'
      };
    }
  }

  // ================= UTILITY FUNCTIONS =================

  generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
  }

  generateHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Main payment processor
  async processPayment(paymentMethod, amount, orderId, customerInfo) {
    console.log(`Processing ${paymentMethod} payment for order ${orderId}, amount: ${amount}`);

    switch (paymentMethod) {
      case 'stripe':
      case 'card':
        return await this.createStripePaymentIntent(amount, 'usd', orderId, customerInfo);
      
      case 'sslcommerz':
        return await this.createSSLCommerzPayment(amount, orderId, customerInfo);
      
      case 'nagad':
        return await this.createNagadPayment(amount, orderId, customerInfo);
      
      case 'rocket':
        return await this.createRocketPayment(amount, orderId, customerInfo);
      
      case 'bkash':
        // bKash is handled by the existing bKash service
        return { success: false, message: 'Use bKash service for bKash payments' };
      
      default:
        // For any other payment method, use dummy payment
        return await this.createDummyPayment(amount, orderId, customerInfo, paymentMethod);
    }
  }

  // ================= UNIFIED PAYMENT GATEWAY INTERFACE =================

  async createPayment(gateway, options) {
    try {
      const { amount, currency = 'BDT', orderId, description, customer, successUrl, failUrl, cancelUrl } = options;

      console.log(`🚀 Creating ${gateway} payment:`, {
        gateway,
        amount,
        currency,
        orderId,
        customerName: customer?.name
      });

      switch (gateway.toLowerCase()) {
        case 'sslcommerz':
          const sslResult = await this.createSSLCommerzPayment(amount, orderId, customer, successUrl, failUrl, cancelUrl);
          if (sslResult.success && sslResult.data) {
            return {
              success: true,
              data: {
                paymentId: sslResult.data.sessionkey,
                GatewayPageURL: sslResult.data.GatewayPageURL,
                redirectUrl: sslResult.data.GatewayPageURL,
                sessionkey: sslResult.data.sessionkey,
                transactionId: sslResult.data.transactionId,
                ...sslResult.data
              }
            };
          } else {
            return sslResult; // Return the error response as-is
          }

        default:
          throw new Error(`Unsupported payment gateway: ${gateway}. Only SSLCommerz is supported.`);
      }
    } catch (error) {
      console.error(`Error creating ${gateway} payment:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async verifyPayment(gateway, options) {
    try {
      switch (gateway.toLowerCase()) {
        case 'sslcommerz':
          // SSLCommerz verification logic would go here
          return { success: true, data: { status: 'verified' } };

        default:
          throw new Error(`Unsupported payment gateway: ${gateway}. Only SSLCommerz is supported.`);
      }
    } catch (error) {
      console.error(`Error verifying ${gateway} payment:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new PaymentGatewayService();
