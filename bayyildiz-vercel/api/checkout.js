export default function handler(req, res) {
  if (req.method === 'POST') {
    res.status(200).json({ 
      status: 'error', 
      message: 'Ödeme sistemi henüz entegre edilmedi (Backend).',
      paymentPageUrl: null
    });
  } else {
    res.status(405).json({ message: 'Method Not Allowed' });
  }
}
