import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

// Normalize phone: accept any format (spaces, +92, 0, dashes) → digits only, consistent for PK
function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits.length) return '';
  // Pakistan: 12 digits with 92 → use last 10; 11 digits with leading 0 → use last 10; else use as-is (min 10)
  if (digits.length === 12 && digits.startsWith('92')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// Find user by phone (any stored format: normalized, 0xxx, 92xxx) to avoid duplicate signups
function getPhoneVariants(normalizedPhone) {
  if (!normalizedPhone || normalizedPhone.length < 10) return [normalizedPhone];
  if (normalizedPhone.length === 10) return [normalizedPhone, '0' + normalizedPhone, '92' + normalizedPhone];
  return [normalizedPhone];
}

// Register (signup is always as member; admin is set manually in DB if needed)
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const phoneNorm = normalizePhone(phone);
    if (!phoneNorm || phoneNorm.length < 10) {
      return res.status(400).json({ message: 'Enter a valid phone number (at least 10 digits)' });
    }

    const existingUser = await User.findOne({ phone: { $in: getPhoneVariants(phoneNorm) } });
    if (existingUser) {
      return res.status(400).json({ message: 'This phone number is already registered' });
    }

    const user = new User({ name, phone: phoneNorm, password, role: 'user' });
    await user.save();

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'secret');
    
    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'This phone number is already registered' });
    }
    res.status(500).json({ message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const phoneNorm = normalizePhone(phone);
    if (!phoneNorm) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = await User.findOne({ phone: phoneNorm });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'secret');
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
