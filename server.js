/* ============================================================
   RG PROPERTIES — BACKEND
   - Serves index.html + admin.html
   - POST /api/enquiries          → public (form + Book Now)
   - POST /api/admin/login        → admin login
   - GET  /api/enquiries          → admin: list with filters
   - PATCH /api/enquiries/:id     → admin: update workflow status
   - DELETE /api/enquiries/:id    → admin: delete
   ============================================================ */

require('dotenv').config();
const path     = require('path');
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 5000;

/* ---------- Middleware ---------- */
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));   // serves index.html + admin.html

/* ---------- MongoDB ---------- */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });

/* ---------- Schema ---------- */
const enquirySchema = new mongoose.Schema({
  // contact
  name:  { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },

  // interest
  interest: {
    type: String,
    enum: ['buy', 'sell', 'rent'],
    required: true
  },
  property_type: {
    type: String,
    enum: ['plots', 'villa', 'apartment', 'house', 'commercial'],
    required: true
  },
  location:  { type: String, required: true, trim: true },
  area:      { type: Number, required: true, min: 1 },
  area_unit: { type: String, enum: ['sqft', 'Gajj'], default: 'sqft' },
  made_by:   { type: String, enum: ['builder', 'owner', 'both'], required: true },

  // NEW — property lifecycle status
  property_status: {
    type: String,
    enum: ['new_property', 'under_construction', 'resale', 'pre_released'],
    required: true
  },

  message: { type: String, default: '' },

  // NEW — where the enquiry came from
  source: {
    type: String,
    enum: ['form', 'book_now'],
    default: 'form',
    index: true
  },

  // NEW — property snapshot when source === 'book_now'
  property_id:         { type: Number,  default: null },
  property_title:      { type: String,  default: '' },
  property_location:   { type: String,  default: '' },
  property_price:      { type: Number,  default: null },
  property_category:   { type: String,  default: '' },
  property_type_label: { type: String,  default: '' },
  property_badge:      { type: String,  default: '' },

  // admin workflow
  status: {
    type: String,
    enum: ['new', 'contacted', 'closed'],
    default: 'new',
    index: true
  }
}, { timestamps: true });

const Enquiry = mongoose.model('Enquiry', enquirySchema);

/* ---------- Allowed values ---------- */
const ALLOWED_INTERESTS = ['buy', 'sell', 'rent'];
const ALLOWED_TYPES     = ['plots', 'villa', 'apartment', 'house', 'commercial'];
const ALLOWED_MADE_BY   = ['builder', 'owner', 'both'];
const ALLOWED_STATUSES  = ['new_property', 'under_construction', 'resale', 'pre_released'];
const ALLOWED_SOURCES   = ['form', 'book_now'];
const ALLOWED_WORKFLOW  = ['new', 'contacted', 'closed'];

/* ---------- Admin auth ---------- */
function signToken() {
  return jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ============================================================
   PUBLIC — create enquiry (form or Book Now)
   ============================================================ */
app.post('/api/enquiries', async (req, res) => {
  try {
    const b = req.body || {};

    // Required-field validation
    if (!b.name)  return res.status(400).json({ error: 'Name is required' });
    if (!b.phone) return res.status(400).json({ error: 'Phone is required' });
    if (!b.email || !b.email.includes('@'))
      return res.status(400).json({ error: 'Valid email is required' });

    if (!ALLOWED_INTERESTS.includes(b.interest))
      return res.status(400).json({ error: 'Invalid interest' });

    if (!ALLOWED_TYPES.includes(b.property_type))
      return res.status(400).json({ error: 'Invalid property_type' });

    if (!b.location)
      return res.status(400).json({ error: 'Location is required' });

    if (!b.area || Number(b.area) <= 0)
      return res.status(400).json({ error: 'Valid area is required' });

    if (!ALLOWED_MADE_BY.includes(b.made_by))
      return res.status(400).json({ error: 'Invalid made_by' });

    if (!ALLOWED_STATUSES.includes(b.property_status)) {
      return res.status(400).json({
        error: `Invalid property_status. Allowed: ${ALLOWED_STATUSES.join(', ')}`
      });
    }

    const source = b.source || 'form';
    if (!ALLOWED_SOURCES.includes(source))
      return res.status(400).json({ error: 'Invalid source' });

    // Build payload
    const payload = {
      name: b.name, phone: b.phone, email: b.email,
      interest: b.interest,
      property_type: b.property_type,
      location: b.location,
      area: Number(b.area),
      area_unit: b.area_unit || 'sqft',
      made_by: b.made_by,
      property_status: b.property_status,
      message: b.message || '',
      source
    };

    // Attach property snapshot when Book Now
    if (source === 'book_now') {
      payload.property_id         = b.property_id ?? null;
      payload.property_title      = b.property_title || '';
      payload.property_location   = b.property_location || '';
      payload.property_price      = b.property_price != null ? Number(b.property_price) : null;
      payload.property_category   = b.property_category || '';
      payload.property_type_label = b.property_type_label || '';
      payload.property_badge      = b.property_badge || '';
    }

    const saved = await Enquiry.create(payload);
    console.log(`📥 [${source}] ${saved.name} → ${saved.property_status}`);

    res.status(201).json({
      ok: true,
      message: 'Enquiry received',
      enquiry: {
        id: saved._id,
        source: saved.source,
        property_status: saved.property_status,
        property_title: saved.property_title,
        createdAt: saved.createdAt
      }
    });
  } catch (err) {
    console.error('❌ Enquiry error:', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

/* ============================================================
   ADMIN — login
   ============================================================ */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Incorrect password' });
  res.json({ ok: true, token: signToken() });
});

/* ============================================================
   ADMIN — list enquiries (filters: source, property_status, status, q)
   ============================================================ */
app.get('/api/enquiries', requireAdmin, async (req, res) => {
  try {
    const { source, property_status, status, q } = req.query;
    const filter = {};
    if (source)          filter.source = source;
    if (property_status) filter.property_status = property_status;
    if (status)          filter.status = status;
    if (q) {
      filter.$or = [
        { name:             { $regex: q, $options: 'i' } },
        { email:            { $regex: q, $options: 'i' } },
        { phone:            { $regex: q, $options: 'i' } },
        { location:         { $regex: q, $options: 'i' } },
        { property_title:   { $regex: q, $options: 'i' } }
      ];
    }

    const list = await Enquiry.find(filter).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   ADMIN — dashboard summary
   ============================================================ */
app.get('/api/enquiries/stats', requireAdmin, async (_req, res) => {
  try {
    const [total, bookNow, form] = await Promise.all([
      Enquiry.countDocuments(),
      Enquiry.countDocuments({ source: 'book_now' }),
      Enquiry.countDocuments({ source: 'form' })
    ]);

    const byStatusRaw = await Enquiry.aggregate([
      { $group: { _id: '$property_status', count: { $sum: 1 } } }
    ]);
    const byWorkflowRaw = await Enquiry.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const byStatus = {
      new_property: 0, under_construction: 0, resale: 0, pre_released: 0
    };
    byStatusRaw.forEach(r => { if (r._id in byStatus) byStatus[r._id] = r.count; });

    const byWorkflow = { new: 0, contacted: 0, closed: 0 };
    byWorkflowRaw.forEach(r => { if (r._id in byWorkflow) byWorkflow[r._id] = r.count; });

    res.json({ total, bookNow, form, byStatus, byWorkflow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   ADMIN — update workflow status
   ============================================================ */
app.patch('/api/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!ALLOWED_WORKFLOW.includes(status))
      return res.status(400).json({ error: 'Invalid workflow status' });

    const updated = await Enquiry.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, enquiry: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   ADMIN — delete
   ============================================================ */
app.delete('/api/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- SPA fallback ---------- */
app.get('/',       (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin',  (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

/* ---------- Boot ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running → http://localhost:${PORT}`);
  console.log(`   Site  : http://localhost:${PORT}/`);
  console.log(`   Admin : http://localhost:${PORT}/admin`);
});