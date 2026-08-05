import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody, AppError } from '../../utils/helpers';
import * as productsService from './products.service';
import * as productsImport from './products.import';

export const productsRouter = Router();

productsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const variantSchema = z.object({
  size: z.string().max(40).nullable().optional(),
  colour: z.string().max(40).nullable().optional(),
  sku: z.string().min(1).max(80).optional(),
  barcode: z.string().max(80).nullable().optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
  salePrice: z.number().min(0).nullable().optional(),
  currentStock: z.number().int().min(0).optional(),
});

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().min(1).max(80).optional(),
  barcode: z.string().max(80).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  purchasePrice: z.number().min(0).optional(),
  salePrice: z.number().min(0),
  lowStockLimit: z.number().int().positive().nullable().optional(),
  supplierId: z.number().int().nullable().optional(),
  imagePath: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  variants: z.array(variantSchema).optional(),
  openingStock: z.number().int().min(0).optional(),
  needsVariants: z.boolean().optional(),
});

const updateProductSchema = createProductSchema.partial().omit({ variants: true });

const stockAdjustSchema = z.object({
  variantId: z.number().int().optional(),
  quantity: z.number().int().positive(),
  direction: z.enum(['add', 'reduce', 'damage', 'discard_damaged']),
  note: z.string().max(500).optional(),
});

const commitImportSchema = z.object({
  products: z.array(
    z.object({
      name: z.string().min(1),
      category: z.string().min(1),
      salePrice: z.number().min(0).optional().default(0),
      purchasePrice: z.number().min(0).optional().default(0),
      totalStock: z.number().int().min(0),
      needsVariants: z.boolean().optional(),
      mergeIntoProductId: z.number().int().positive().optional(),
      action: z.enum(['create', 'merge']).optional().default('create'),
      variants: z
        .array(
          z.object({
            size: z.string().nullable(),
            colour: z.string().nullable(),
            stock: z.number().int().min(0),
          }),
        )
        .optional()
        .default([]),
    }),
  ),
});

productsRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await productsService.listProductCategories();
    res.json(categories);
  }),
);

productsRouter.post(
  '/categories',
  validateBody(z.object({ name: z.string().min(1).max(120) })),
  asyncHandler(async (req, res) => {
    const category = await productsService.createProductCategory(req.body.name);
    res.status(201).json(category);
  }),
);

productsRouter.get(
  '/import/template',
  asyncHandler(async (_req, res) => {
    const buffer = productsImport.buildImportTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="usman-mall-products-template.xlsx"');
    res.send(buffer);
  }),
);

productsRouter.post(
  '/import/preview',
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve, reject) => {
      upload.single('file')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (!req.file) throw new AppError(400, 'Upload an Excel or CSV file');
    const preview = await productsImport.previewImportBuffer(req.file.buffer);
    res.json(preview);
  }),
);

productsRouter.post(
  '/import/commit',
  validateBody(commitImportSchema),
  asyncHandler(async (req, res) => {
    const result = await productsImport.commitImport(req.body.products);
    res.status(201).json(result);
  }),
);

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined;
    const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId), 10) : undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const search = req.query.search ? String(req.query.search) : undefined;
    const stockStatusRaw = req.query.stockStatus ? String(req.query.stockStatus) : 'all';
    const allowedStatuses = ['all', 'in_stock', 'out_of_stock', 'low_stock', 'damaged'] as const;
    const stockStatus = (allowedStatuses as readonly string[]).includes(stockStatusRaw)
      ? (stockStatusRaw as (typeof allowedStatuses)[number])
      : 'all';

    const result = await productsService.listProducts({
      page,
      pageSize,
      categoryId,
      activeOnly,
      search,
      stockStatus,
    });
    res.json(result);
  }),
);

productsRouter.post(
  '/',
  validateBody(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await productsService.createProduct(req.body);
    res.status(201).json(product);
  }),
);

productsRouter.get(
  '/by-barcode/:barcode',
  asyncHandler(async (req, res) => {
    const result = await productsService.getProductByBarcode(param(req.params.barcode));
    res.json(result);
  }),
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await productsService.getProduct(parseInt(param(req.params.id), 10));
    res.json(product);
  }),
);

productsRouter.patch(
  '/:id',
  validateBody(updateProductSchema),
  asyncHandler(async (req, res) => {
    const product = await productsService.updateProduct(parseInt(param(req.params.id), 10), req.body);
    res.json(product);
  }),
);

productsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await productsService.deleteProduct(parseInt(param(req.params.id), 10));
    res.json(result);
  }),
);

productsRouter.post(
  '/:id/variants',
  validateBody(
    variantSchema.extend({ openingStock: z.number().int().min(0).optional() }),
  ),
  asyncHandler(async (req, res) => {
    const variant = await productsService.createProductVariant(
      parseInt(param(req.params.id), 10),
      req.body,
    );
    res.status(201).json(variant);
  }),
);

productsRouter.patch(
  '/:productId/variants/:variantId',
  validateBody(variantSchema.partial()),
  asyncHandler(async (req, res) => {
    const variant = await productsService.updateProductVariant(
      parseInt(param(req.params.productId), 10),
      parseInt(param(req.params.variantId), 10),
      req.body,
    );
    res.json(variant);
  }),
);

productsRouter.post(
  '/:id/stock-adjust',
  validateBody(stockAdjustSchema),
  asyncHandler(async (req, res) => {
    const result = await productsService.manualStockAdjustment(
      parseInt(param(req.params.id), 10),
      req.body,
    );
    res.json(result);
  }),
);

productsRouter.get(
  '/:id/stock-movements',
  asyncHandler(async (req, res) => {
    const variantId = req.query.variantId ? parseInt(String(req.query.variantId), 10) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined;

    const result = await productsService.listStockMovements(parseInt(param(req.params.id), 10), {
      variantId,
      page,
      pageSize,
    });
    res.json(result);
  }),
);
