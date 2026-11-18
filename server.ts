import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Ephemeral server secret for Razorpay sandbox HMAC-SHA256 verification when live merchant keys are absent
const SANDBOX_HMAC_SECRET =
  process.env.RAZORPAY_KEY_SECRET ||
  crypto.createHash('sha256').update(`mediquick-rzp-${process.env.APP_URL || 'local'}`).digest('hex');

interface SandboxOrderRecord {
  orderId: string;
  amountPaise: number;
  currency: string;
  receipt: string;
  createdAt: string;
}

const pendingSandboxOrders = new Map<string, SandboxOrderRecord>();

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'MediQuick' });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      mapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
    });
  });

  app.post('/api/payments/razorpay/create-order', async (req, res) => {
    try {
      const { amount, currency = 'INR', receipt } = req.body as {
        amount?: number;
        currency?: string;
        receipt?: string;
      };

      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Invalid payment amount.' });
      }

      const amountPaise = Math.round(amount * 100);
      const safeReceipt = (receipt || `mq_${Date.now()}`).slice(0, 40);
      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      if (keyId && keySecret) {
        const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${authHeader}`,
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency,
            receipt: safeReceipt,
          }),
        });

        if (!rzpRes.ok) {
          const errText = await rzpRes.text();
          return res.status(502).json({ error: `Razorpay order creation failed: ${errText}` });
        }

        const rzpOrder = (await rzpRes.json()) as {
          id: string;
          amount: number;
          currency: string;
        };

        return res.json({
          mode: 'live',
          keyId,
          orderId: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
        });
      }

      const sandboxOrderId = `order_mq_${crypto.randomBytes(6).toString('hex')}`;
      pendingSandboxOrders.set(sandboxOrderId, {
        orderId: sandboxOrderId,
        amountPaise,
        currency,
        receipt: safeReceipt,
        createdAt: new Date().toISOString(),
      });

      return res.json({
        mode: 'sandbox',
        keyId: null,
        orderId: sandboxOrderId,
        amount: amountPaise,
        currency,
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to create Razorpay order.',
      });
    }
  });

  app.post('/api/payments/razorpay/sandbox-authorize', (req, res) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId || !pendingSandboxOrders.has(orderId)) {
      return res.status(404).json({ error: 'Razorpay sandbox order session not found.' });
    }

    const paymentId = `pay_mq_${crypto.randomBytes(6).toString('hex')}`;
    const signature = crypto
      .createHmac('sha256', SANDBOX_HMAC_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return res.json({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    });
  });

  app.post('/api/payments/razorpay/verify', (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, method } = req.body as {
        razorpay_order_id?: string;
        razorpay_payment_id?: string;
        razorpay_signature?: string;
        method?: string;
      };

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ verified: false, error: 'Missing Razorpay verification parameters.' });
      }

      const secret = process.env.RAZORPAY_KEY_SECRET || SANDBOX_HMAC_SECRET;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      const expectedBuf = Buffer.from(expected, 'utf8');
      const providedBuf = Buffer.from(razorpay_signature, 'utf8');

      const isValid =
        expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf);

      if (!isValid) {
        return res.status(400).json({
          verified: false,
          error: 'Cryptographic Razorpay signature mismatch.',
        });
      }

      pendingSandboxOrders.delete(razorpay_order_id);

      return res.json({
        verified: true,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        method: method || 'RAZORPAY',
        verifiedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        verified: false,
        error: error instanceof Error ? error.message : 'Payment verification error.',
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MediQuick server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
