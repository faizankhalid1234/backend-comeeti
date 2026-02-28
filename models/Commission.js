import mongoose from 'mongoose';

const commissionSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  monthlyContribution: {
    type: Number,
    required: true
  },
  totalInstallments: {
    type: Number,
    required: true,
    default: 10
  },
  installmentAmount: {
    type: Number,
    required: true
  },
  duration: {
    value: {
      type: Number,
      required: true
    },
    unit: {
      type: String,
      enum: ['days', 'months', 'years'],
      default: 'months'
    }
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Each member: { name, phone }. Backward compat: old data may be plain strings (name only).
  members: [{ type: mongoose.Schema.Types.Mixed }],
  payments: [{
    installmentNumber: Number,
    amount: Number,
    payerName: String,
    payerPhone: String,
    paidDate: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

commissionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (this.duration && this.duration.value && this.duration.unit) {
    const endDate = new Date(this.startDate);
    if (this.duration.unit === 'days') {
      endDate.setDate(endDate.getDate() + this.duration.value);
    } else if (this.duration.unit === 'years') {
      endDate.setMonth(endDate.getMonth() + (this.duration.value * 12));
    } else {
      // months
      endDate.setMonth(endDate.getMonth() + this.duration.value);
    }
    this.endDate = endDate;
  }
  next();
});

export default mongoose.model('Commission', commissionSchema);
