declare module 'razorpay' {
  interface RazorpayOptions { key_id: string; key_secret: string; }
  interface RazorpayOrderOptions { amount: number; currency: string; receipt?: string; notes?: Record<string, string>; }
  class Razorpay {
    constructor(options: RazorpayOptions);
    orders: { create(options: RazorpayOrderOptions): Promise<Record<string, unknown>>; fetch(id: string): Promise<Record<string, unknown>>; };
    payments: { fetch(id: string): Promise<Record<string, unknown>>; };
    refunds: { create(paymentId: string, options: Record<string, unknown>): Promise<Record<string, unknown>>; };
  }
  export = Razorpay;
}
