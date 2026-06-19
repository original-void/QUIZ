const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected ✅'))
.catch(err => console.log(err));

// Payment schema
const PaymentSchema = new mongoose.Schema({
  phone: String,
  amount: Number,
  checkoutId: String,
  paid: { type: Boolean, default: false },
  date: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', PaymentSchema);

// Get M-Pesa sandbox token
async function getToken() {
  const auth = Buffer.from(
    process.env.MPESA_CONSUMER_KEY + ':' + process.env.MPESA_CONSUMER_SECRET
  ).toString('base64');
  
  const res = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: 'Basic ' + auth } }
  );
  return res.data.access_token;
}

// Generate password
function generatePassword(shortcode, passkey, timestamp) {
  return Buffer.from(shortcode + passkey + timestamp).toString('base64');
}

// Serve quiz page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Send STK Push
app.post('/pay', async (req, res) => {
  try {
    const { phone } = req.body;
    const amount = 1; // Sandbox: use 1 Ksh
    
    const token = await getToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = generatePassword(process.env.MPESA_SHORTCODE, process.env.MPESA_PASSKEY, timestamp);
    
    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL + '/callback',
        AccountReference: 'GBCQuizTest',
        TransactionDesc: 'GBC Quiz Test Payment'
      },
      { headers: { Authorization: 'Bearer ' + token } }
    );
    
    await new Payment({
      phone,
      amount,
      checkoutId: response.data.CheckoutRequestID
    }).save();
    
    res.json({ success: true, data: response.data });
  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.errorMessage || err.message });
  }
});

// 2. M-Pesa Callback
app.post('/callback', async (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    console.log('Callback:', callbackData);
    
    if(callbackData.ResultCode === 0) {
      await Payment.updateOne({ checkoutId: callbackData.CheckoutRequestID }, { paid: true });
      console.log('Payment success ✅');
    }
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.log(err);
    res.json({ ResultCode: 1, ResultDesc: 'Failed' });
  }
});

// 3. Check payment status
app.get('/check-status/:phone', async (req, res) => {
  try {
    const payment = await Payment.findOne({ phone: req.params.phone }).sort({ date: -1 });
    res.json({ paid: payment?.paid || false });
  } catch (err) {
    res.json({ paid: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT} - SANDBOX`));
