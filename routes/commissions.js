import express from 'express';
import mongoose from 'mongoose';
import Commission from '../models/Commission.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';

const router = express.Router();

const DEFAULT_MEMBER_PASSWORD = '12345678';

// Ensure members array is [{ name, phone, turnNumber }]; normalize phones. Sort by turnNumber so order = turn 1,2,3...
function normalizeMembers(members, totalInstallments) {
  if (!Array.isArray(members)) return [];
  const list = members.map((m, idx) => {
    if (typeof m === 'string') return { name: m.trim(), phone: '', turnNumber: idx + 1 };
    const name = (m && m.name && String(m.name).trim()) || '';
    const phone = normalizePhone(m && m.phone);
    const turnNumber = Math.max(1, Math.min(totalInstallments || members.length, parseInt(m && m.turnNumber, 10) || idx + 1));
    return { name, phone, turnNumber };
  });
  list.sort((a, b) => (a.turnNumber || 0) - (b.turnNumber || 0));
  return list;
}

// Find user by phone (normalized or common stored formats: 0xxx, 92xxx) so we never create duplicates
async function findUserByPhone(normalizedPhone) {
  if (!normalizedPhone || normalizedPhone.length < 10) return null;
  const variants = [normalizedPhone];
  if (normalizedPhone.length === 10) {
    variants.push('0' + normalizedPhone);
    variants.push('92' + normalizedPhone);
  }
  return User.findOne({ phone: { $in: variants } });
}

// Create user account for each member added by admin (password 12345678). Never throw – create as many records as possible.
async function syncUsersForMembers(members) {
  const seen = new Set();
  for (const m of members) {
    const phone = normalizePhone(m && m.phone) || '';
    if (!phone || phone.length < 10 || seen.has(phone)) continue;
    seen.add(phone);
    try {
      const existing = await findUserByPhone(phone);
      if (existing) continue;
      await new User({
        name: (m && m.name) || 'Member',
        phone,
        password: DEFAULT_MEMBER_PASSWORD,
        role: 'user',
      }).save();
    } catch (err) {
      // Duplicate or any error: skip this member, continue with rest so others get a record in DB
      if (err.code !== 11000) console.error('Member user create skip:', phone, err.message);
    }
  }
}

// Get all commissions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const commissions = await Commission.find()
      .populate('createdBy', 'name phone')
      .populate('payments.approvedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(commissions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single commission
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.id)
      .populate('createdBy', 'name phone')
      .populate('payments.approvedBy', 'name');
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }
    res.json(commission);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create commission
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { customerName, monthlyContribution, amount, totalInstallments, duration, members: rawMembers } = req.body;
    const members = normalizeMembers(rawMembers || [], totalInstallments);

    if (members.length !== totalInstallments) {
      return res.status(400).json({
        message: `Number of members (${members.length}) must match number of installments (${totalInstallments})`,
      });
    }

    const turns = members.map((m) => m.turnNumber);
    if (new Set(turns).size !== members.length || turns.some((t) => t < 1 || t > totalInstallments)) {
      return res.status(400).json({
        message: 'Each member must have a unique committee number (1 to ' + totalInstallments + ').',
      });
    }

    const invalid = members.find((m) => !m.name || !m.phone || m.phone.length < 10);
    if (invalid) {
      return res.status(400).json({
        message: 'Each member must have name and a valid phone number (at least 10 digits).',
      });
    }

    const phoneSet = new Set();
    const dup = members.find((m) => {
      if (phoneSet.has(m.phone)) return true;
      phoneSet.add(m.phone);
      return false;
    });
    if (dup) {
      return res.status(400).json({
        message: 'Each member must have a unique phone number. Duplicate phone in list.',
      });
    }

    const monthlyContrib = monthlyContribution || (amount / totalInstallments);
    const totalMonthlyCollection = monthlyContrib * totalInstallments;
    const installmentAmount = monthlyContrib;

    const commission = new Commission({
      customerName,
      monthlyContribution: monthlyContrib,
      amount: amount || totalMonthlyCollection,
      totalInstallments,
      installmentAmount,
      duration,
      members,
      createdBy: req.user.userId,
    });

    await commission.save();
    try {
      await syncUsersForMembers(members);
    } catch (syncErr) {
      console.error('Sync member accounts (non-fatal):', syncErr.message);
    }
    await commission.populate('createdBy', 'name phone');

    res.status(201).json(commission);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'One of these phone numbers is already registered. Use unique phone numbers for each member.',
      });
    }
    const status = error.message && (error.message.includes('phone') || error.message.includes('registered')) ? 400 : 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
});

// Update commission
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.id);
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }

    const { members: rawMembers, totalInstallments, monthlyContribution, amount } = req.body;

    if (monthlyContribution !== undefined) {
      commission.monthlyContribution = monthlyContribution;
      commission.installmentAmount = monthlyContribution;
      if (totalInstallments) {
        commission.amount = monthlyContribution * totalInstallments;
      }
    } else if (amount && totalInstallments) {
      commission.installmentAmount = amount / totalInstallments;
      commission.monthlyContribution = commission.installmentAmount;
    }

    if (rawMembers && Array.isArray(rawMembers)) {
      const total = totalInstallments || commission.totalInstallments;
      const members = normalizeMembers(rawMembers, total);
      if (members.length !== total) {
        return res.status(400).json({
          message: `Number of members (${members.length}) must match number of installments (${total}).`,
        });
      }
      const turns = members.map((m) => m.turnNumber);
      if (new Set(turns).size !== members.length || turns.some((t) => t < 1 || t > total)) {
        return res.status(400).json({
          message: 'Each member must have a unique committee number (1 to ' + total + ').',
        });
      }
      const invalid = members.find(
        (m) => !m.name || (m.phone && m.phone.length > 0 && normalizePhone(m.phone).length < 10)
      );
      if (invalid) {
        return res.status(400).json({
          message: 'Each member must have name and a valid phone number (at least 10 digits) when provided.',
        });
      }
      const phoneSet = new Set();
      const dup = members.find((m) => {
        const p = normalizePhone(m && m.phone);
        if (!p || p.length < 10) return false;
        if (phoneSet.has(p)) return true;
        phoneSet.add(p);
        return false;
      });
      if (dup) {
        return res.status(400).json({
          message: 'Each member must have a unique phone number. Duplicate phone in list.',
        });
      }
      commission.members = members;
      await syncUsersForMembers(members);
    }
    const bodyRest = { ...req.body };
    delete bodyRest.members;
    Object.assign(commission, bodyRest);

    await commission.save();
    await commission.populate('createdBy', 'name phone');
    await commission.populate('payments.approvedBy', 'name');

    res.json(commission);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'One of these phone numbers is already registered. Use unique phone numbers for each member.',
      });
    }
    const status = error.message && (error.message.includes('phone') || error.message.includes('registered')) ? 400 : 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
});

// Delete commission
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid commission ID' });
    }
    const commission = await Commission.findByIdAndDelete(id);
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }
    res.json({ message: 'Commission deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete commission' });
  }
});

export default router;
