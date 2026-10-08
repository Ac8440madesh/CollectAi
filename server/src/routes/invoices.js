import { Router } from 'express';
import multer from 'multer';
import { query, pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceIdParam,
  paginationQuery,
} from '../schemas/resources.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2_000_000 } });

const router = Router();
router.use(requireAuth);

/**
 * GET /api/invoices
 * List with optional ?status=&search= filters. Includes client name.
 */
router.get('/', validate({ query: paginationQuery }), async (req, res, next) => {
  try {
    const { page, limit, status, search } = req.query;
    const offset = (page - 1) * limit;

    let where = 'where i.user_id = $1';
    const params = [req.user.id];
    if (status) {
      params.push(status);
      where += ` and i.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` and (i.invoice_no ilike $${params.length} or c.name ilike $${params.length})`;
    }

    const countRes = await query(
      `select count(*) from invoices i join clients c on c.id = i.client_id ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await query(
      `select i.*, c.name as client_name
       from invoices i
       join clients c on c.id = i.client_id
       ${where}
       order by i.due_date asc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({ data: dataRes.rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/invoices
 * Creates one invoice; verifies the client belongs to the user.
 */
router.post('/', validate({ body: createInvoiceSchema }), async (req, res, next) => {
  try {
    const { client_id, invoice_no, amount, currency, issue_date, due_date, status, paid_amount } =
      req.body;

    // Ensure the client is owned by this user.
    const clientCheck = await query(
      'select 1 from clients where id = $1 and user_id = $2',
      [client_id, req.user.id],
    );
    if (clientCheck.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Client not found');
    }

    const result = await query(
      `insert into invoices
         (user_id, client_id, invoice_no, amount, currency, issue_date, due_date, status, paid_amount)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [req.user.id, client_id, invoice_no, amount, currency, issue_date, due_date, status, paid_amount],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Duplicate invoice_no per user → unique constraint
    if (err.code === '23505') {
      return next(new AppError(409, 'DUPLICATE', 'An invoice with this number already exists'));
    }
    next(err);
  }
});

/**
 * PUT /api/invoices/:id
 */
router.put('/:id', validate({ params: invoiceIdParam, body: updateInvoiceSchema }), async (req, res, next) => {
  try {
    const fields = req.body;
    if (Object.keys(fields).length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No fields to update');
    }

    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const values = keys.map((k) => fields[k] ?? null);

    const result = await query(
      `update invoices set ${sets.join(', ')}
       where id = $1 and user_id = $2
       returning *`,
      [req.params.id, req.user.id, ...values],
    );

    if (result.rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/invoices/import
 * CSV import via multer. Expected columns: client_name, invoice_no, amount,
 * issue_date, due_date. Client is looked up by name (must already exist for
 * this user).
 */
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'No CSV file uploaded');

    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new AppError(400, 'VALIDATION_ERROR', 'CSV has no data rows');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const required = ['client_name', 'invoice_no', 'amount', 'issue_date', 'due_date'];
    for (const r of required) {
      if (!headers.includes(r)) {
        throw new AppError(400, 'VALIDATION_ERROR', `Missing required CSV column: ${r}`);
      }
    }

    // Pre-fetch this user's clients keyed by lowercase name.
    const clientsRes = await query(
      'select id, lower(name) as lname from clients where user_id = $1',
      [req.user.id],
    );
    const clientMap = Object.fromEntries(clientsRes.rows.map((r) => [r.lname, r.id]));

    const created = [];
    const errors = [];
    const db = await pool.connect();
    try {
      await db.query('begin');
      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const row = Object.fromEntries(headers.map((h, j) => [h, cols[j]]));

        const clientId = clientMap[row.client_name?.toLowerCase()];
        if (!clientId) {
          errors.push({ row: i + 1, error: `Unknown client: ${row.client_name}` });
          continue;
        }

        const parsed = createInvoiceSchema.safeParse({
          client_id: clientId,
          invoice_no: row.invoice_no,
          amount: row.amount,
          issue_date: row.issue_date,
          due_date: row.due_date,
        });
        if (!parsed.success) {
          errors.push({ row: i + 1, error: parsed.error.issues[0].message });
          continue;
        }

        const v = parsed.data;
        const ins = await db.query(
          `insert into invoices
             (user_id, client_id, invoice_no, amount, currency, issue_date, due_date, status, paid_amount)
           values ($1, $2, $3, $4, 'INR', $5, $6, 'pending', 0)
           on conflict (user_id, invoice_no) do nothing
           returning id`,
          [req.user.id, clientId, v.invoice_no, v.amount, v.issue_date, v.due_date],
        );
        if (ins.rowCount > 0) created.push(v.invoice_no);
      }
      await db.query('commit');
    } catch (err) {
      await db.query('rollback').catch(() => {});
      throw err;
    } finally {
      db.release();
    }

    res.json({ imported: created.length, invoices: created, errors });
  } catch (err) {
    next(err);
  }
});

export default router;
