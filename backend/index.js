require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic();

const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || 'omran2026';
const HOUSEHOLD_SIZE = parseInt(process.env.HOUSEHOLD_SIZE || '5', 10);

function requireManager(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${MANAGER_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Parse receipt with Claude Vision
async function parseReceipt(imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `Analyze this receipt image and extract the data as JSON. Determine the category from: Groceries, Hardware, Cleaning, Tools, Fuel, Maintenance, Food & Dining, Other.

If the category is Groceries, extract detailed item data:
{
  "store": "store name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "category": "Groceries",
  "items": [
    { "name": "item name", "quantity": 1, "unit": "kg/L/pcs/etc", "unit_price": 0.00, "line_total": 0.00 }
  ],
  "notes": "any relevant notes"
}

For non-grocery receipts:
{
  "store": "store name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "category": "category",
  "items": ["item description - SAR price"],
  "notes": "any relevant notes"
}

Currency is SAR. If the date is not visible, use today's date. Return ONLY valid JSON, no markdown.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

// POST /api/receipts — upload and parse receipt
app.post('/api/receipts', upload.single('image'), async (req, res) => {
  try {
    const { worker, authorizer } = req.body;
    if (!worker || !authorizer) {
      return res.status(400).json({ error: 'Worker and authorizer are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Upload image to Supabase Storage
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName);
    const imageUrl = urlData.publicUrl;

    // Parse receipt with Claude
    const parsed = await parseReceipt(req.file.buffer, req.file.mimetype);

    // Save receipt to DB
    const { data: receipt, error: insertError } = await supabase
      .from('receipts')
      .insert({
        worker,
        authorizer,
        store: parsed.store,
        date: parsed.date,
        total: parsed.total,
        category: parsed.category,
        items: parsed.items,
        notes: parsed.notes,
        image_url: imageUrl,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    // If grocery, save individual items
    if (parsed.category === 'Groceries' && Array.isArray(parsed.items)) {
      const groceryItems = parsed.items
        .filter(item => typeof item === 'object' && item.name)
        .map(item => ({
          receipt_id: receipt.id,
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          unit_price: item.unit_price || 0,
          line_total: item.line_total || 0,
          purchased_at: parsed.date,
        }));
      if (groceryItems.length > 0) {
        const { error: itemsError } = await supabase.from('grocery_items').insert(groceryItems);
        if (itemsError) console.error('Error saving grocery items:', itemsError);
      }
    }

    res.json({ success: true, receipt });
  } catch (err) {
    console.error('Error processing receipt:', err);
    res.status(500).json({ error: err.message || 'Failed to process receipt' });
  }
});

// GET /api/receipts — manager only
app.get('/api/receipts', requireManager, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('receipts')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groceries/items — aggregated grocery inventory, manager only
app.get('/api/groceries/items', requireManager, async (req, res) => {
  try {
    const { data, error } = await supabase.from('grocery_items').select('*');
    if (error) throw error;

    // Aggregate by item name (case-insensitive)
    const map = {};
    for (const item of data) {
      const key = item.name.toLowerCase().trim();
      if (!map[key]) {
        map[key] = {
          name: item.name,
          total_quantity: 0,
          unit: item.unit,
          total_spent: 0,
          purchase_count: 0,
          last_bought: item.purchased_at,
        };
      }
      map[key].total_quantity += Number(item.quantity) || 0;
      map[key].total_spent += Number(item.line_total) || 0;
      map[key].purchase_count += 1;
      if (item.purchased_at > map[key].last_bought) {
        map[key].last_bought = item.purchased_at;
      }
    }

    const inventory = Object.values(map).map(i => ({
      ...i,
      avg_unit_price: i.total_quantity > 0 ? +(i.total_spent / i.total_quantity).toFixed(2) : 0,
      total_spent: +i.total_spent.toFixed(2),
    }));

    inventory.sort((a, b) => b.total_spent - a.total_spent);
    res.json({ inventory, household_size: HOUSEHOLD_SIZE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/receipts/:id/rescan — re-process receipt image with Claude
app.post('/api/receipts/:id/rescan', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: receipt, error: fetchErr } = await supabase.from('receipts').select('*').eq('id', id).single();
    if (fetchErr || !receipt) return res.status(404).json({ error: 'Receipt not found' });

    // Download image from Supabase Storage
    const imageUrl = receipt.image_url;
    const fileName = imageUrl.split('/').pop();
    const { data: fileData, error: dlErr } = await supabase.storage.from('receipts').download(fileName);
    if (dlErr) throw dlErr;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const mimeType = fileData.type || 'image/jpeg';

    // Re-parse with Claude
    const parsed = await parseReceipt(buffer, mimeType);

    // Update receipt
    const { data: updated, error: updateErr } = await supabase
      .from('receipts')
      .update({
        store: parsed.store,
        date: parsed.date,
        total: parsed.total,
        category: parsed.category,
        items: parsed.items,
        notes: parsed.notes,
      })
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // Update grocery items if applicable
    await supabase.from('grocery_items').delete().eq('receipt_id', id);
    if (parsed.category === 'Groceries' && Array.isArray(parsed.items)) {
      const groceryItems = parsed.items
        .filter(item => typeof item === 'object' && item.name)
        .map(item => ({
          receipt_id: id,
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          unit_price: item.unit_price || 0,
          line_total: item.line_total || 0,
          purchased_at: parsed.date,
        }));
      if (groceryItems.length > 0) {
        await supabase.from('grocery_items').insert(groceryItems);
      }
    }

    res.json({ success: true, receipt: updated });
  } catch (err) {
    console.error('Error rescanning receipt:', err);
    res.status(500).json({ error: err.message || 'Failed to rescan receipt' });
  }
});

// PATCH /api/receipts/:id — edit receipt fields (manager only)
app.patch('/api/receipts/:id', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['store', 'date', 'total', 'category', 'items', 'notes', 'worker', 'authorizer'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const { data, error } = await supabase.from('receipts').update(updates).eq('id', id).select().single();
    if (error) throw error;

    // If category or items changed and it's grocery, rebuild grocery_items
    if (updates.category || updates.items) {
      await supabase.from('grocery_items').delete().eq('receipt_id', id);
      if (data.category === 'Groceries' && Array.isArray(data.items)) {
        const groceryItems = data.items
          .filter(item => typeof item === 'object' && item.name)
          .map(item => ({
            receipt_id: id,
            name: item.name,
            quantity: item.quantity || 1,
            unit: item.unit || 'pcs',
            unit_price: item.unit_price || 0,
            line_total: item.line_total || 0,
            purchased_at: data.date,
          }));
        if (groceryItems.length > 0) {
          await supabase.from('grocery_items').insert(groceryItems);
        }
      }
    }

    res.json({ success: true, receipt: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/receipts/:id — delete receipt (manager only)
app.delete('/api/receipts/:id', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    // Get receipt to find image
    const { data: receipt } = await supabase.from('receipts').select('image_url').eq('id', id).single();

    // Delete grocery items (cascade should handle this, but be explicit)
    await supabase.from('grocery_items').delete().eq('receipt_id', id);

    // Delete receipt
    const { error } = await supabase.from('receipts').delete().eq('id', id);
    if (error) throw error;

    // Delete image from storage
    if (receipt?.image_url) {
      const fileName = receipt.image_url.split('/').pop();
      await supabase.storage.from('receipts').remove([fileName]);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
