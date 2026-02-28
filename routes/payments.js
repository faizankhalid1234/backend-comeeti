import express from 'express';
import Commission from '../models/Commission.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';

const router = express.Router();

// Add payment
router.post('/:commissionId', authenticateToken, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.commissionId);
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }

    const { installmentNumber, amount, payerName, payerPhone } = req.body;
    const phoneNorm = payerPhone ? normalizePhone(payerPhone) : '';

    const payment = {
      installmentNumber,
      amount: amount || commission.installmentAmount,
      payerName: payerName || 'Unknown',
      payerPhone: phoneNorm || undefined,
      paidDate: new Date(),
      status: 'pending'
    };

    commission.payments.push(payment);
    await commission.save();
    
    await commission.populate('createdBy', 'name phone');
    await commission.populate('payments.approvedBy', 'name');
    
    res.json(commission);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Approve payment (Admin only)
router.put('/:commissionId/:paymentIndex/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.commissionId);
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }

    const paymentIndex = parseInt(req.params.paymentIndex);
    if (paymentIndex < 0 || paymentIndex >= commission.payments.length) {
      return res.status(400).json({ message: 'Invalid payment index' });
    }

    commission.payments[paymentIndex].status = 'approved';
    commission.payments[paymentIndex].approvedBy = req.user.userId;
    commission.payments[paymentIndex].approvedAt = new Date();

    // Check if all payments are approved
    const allApproved = commission.payments.every(p => p.status === 'approved');
    if (allApproved && commission.payments.length === commission.totalInstallments) {
      commission.status = 'completed';
    }

    await commission.save();
    await commission.populate('createdBy', 'name phone');
    await commission.populate('payments.approvedBy', 'name');
    
    res.json(commission);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reject payment (Admin only)
router.put('/:commissionId/:paymentIndex/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.commissionId);
    if (!commission) {
      return res.status(404).json({ message: 'Commission not found' });
    }

    const paymentIndex = parseInt(req.params.paymentIndex);
    if (paymentIndex < 0 || paymentIndex >= commission.payments.length) {
      return res.status(400).json({ message: 'Invalid payment index' });
    }

    commission.payments[paymentIndex].status = 'rejected';
    await commission.save();
    
    await commission.populate('createdBy', 'name phone');
    await commission.populate('payments.approvedBy', 'name');
    
    res.json(commission);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
