import React, { useState } from 'react';
import { CheckCircle2, CreditCard, Lock, ShieldCheck, Smartphone, X } from 'lucide-react';

interface RazorpayModalProps {
  isOpen: boolean;
  amount: number;
  orderId: string;
  customerName: string;
  customerEmail: string;
  onSuccess: (payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    method: string;
  }) => void;
  onCancel: () => void;
}

export const RazorpayModal: React.FC<RazorpayModalProps> = ({
  isOpen,
  amount,
  orderId,
  customerName,
  customerEmail,
  onSuccess,
  onCancel,
}) => {
  const [channel, setChannel] = useState<'UPI' | 'CARD' | 'NETBANKING'>('UPI');
  const [upiId, setUpiId] = useState('patient@okaxis');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePayNow = async () => {
    setProcessing(true);
    setError(null);
    try {
      const authRes = await fetch('/api/payments/razorpay/sandbox-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, method: channel }),
      });

      if (!authRes.ok) {
        const errBody = await authRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Razorpay authorization failed.');
      }

      const authData = (await authRes.json()) as {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      };

      const verifyRes = await fetch('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authData,
          method: channel,
        }),
      });

      const verifyData = (await verifyRes.json()) as {
        verified?: boolean;
        error?: string;
      };

      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || 'Signature verification failed.');
      }

      onSuccess({
        ...authData,
        method: channel,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-300 font-medium">Razorpay Verified Checkout</p>
            <h3 className="text-base font-bold">MediQuick Pharmacy</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold font-mono tabular-nums">
              ₹{amount.toLocaleString('en-IN')}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="text-slate-400 hover:text-white"
              aria-label="Close payment"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-slate-600 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
            <span className="truncate">
              {customerName} · {customerEmail}
            </span>
            <span className="font-mono text-slate-500 shrink-0 ml-2">{orderId}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['UPI', 'CARD', 'NETBANKING'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setChannel(tab)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  channel === tab
                    ? 'bg-teal-50 border-teal-600 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                {tab === 'UPI' ? 'UPI / QR' : tab === 'CARD' ? 'Card' : 'NetBanking'}
              </button>
            ))}
          </div>

          {channel === 'UPI' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">UPI ID / VPA</label>
              <div className="relative">
                <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600"
                />
              </div>
            </div>
          )}

          {channel === 'CARD' && (
            <div className="space-y-2.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <CreditCard className="w-4 h-4 text-teal-600" />
                Saved Test Visa •••• 4242
              </div>
              <p>Secured with 256-bit TLS & HMAC-SHA256 signature verification.</p>
            </div>
          )}

          {channel === 'NETBANKING' && (
            <div className="space-y-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <p className="font-semibold text-slate-800">Instant Corporate & Retail NetBanking</p>
              <p>HDFC · ICICI · SBI · Axis Bank verified settlement.</p>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={processing}
            onClick={handlePayNow}
            className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {processing ? (
              'Verifying Signature...'
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Pay ₹{amount.toLocaleString('en-IN')} Securely
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
            <span>Cryptographic HMAC-SHA256 verification enforced by MediQuick API</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
          </div>
        </div>
      </div>
    </div>
  );
};
