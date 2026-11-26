import {
  router,
  json,
  error,
  db,
  requireAuth,
  requireRole,
  roles,
  isRoleError,
} from '@appdeploy/sdk';

type ProductInput = {
  name?: string;
  category?: string;
  description?: string;
  price?: number;
  active?: boolean;
  featured?: boolean;
};
type ShopSettings = {
  serverName: string;
  serverAddress: string;
  upiId: string;
  payeeName: string;
  announcement: string;
  currency: string;
};
type OrderRecord = {
  edition?: 'Java' | 'Bedrock';
  minecraftName: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency?: string;
  status: string;
  utr?: string;
  createdAt: string;
  updatedAt: string;
};

const productCategories = ['Ranks', 'Kits', 'Coins', 'Crates', 'Keys', 'Custom Items'];

const defaultSettings: ShopSettings = {
  serverName: 'Kathmandu SMP',
  serverAddress: 'play.kathmandusmp.net',
  upiId: '',
  payeeName: 'Kathmandu SMP',
  announcement: 'Adventure starts here. Gear up for your next journey.',
  currency: 'KC',
};

async function getSettings() {
  const [saved] = await db.get<ShopSettings>('shop_settings', ['main']);
  if (saved) return saved;
  await db.tx.add('shop_settings', [{ id: 'main', ...defaultSettings }]);
  const [created] = await db.get<ShopSettings>('shop_settings', ['main'], {
    consistent: true,
  });
  return created || defaultSettings;
}

function safeError(err: unknown) {
  if (isRoleError(err)) return json({ error: err.code }, 403);
  return error(
    err instanceof Error ? err.message : 'Unexpected server error',
    400
  );
}

export const handler = router({
  'GET /api/shop': [
    async () => {
      const [catalogue, settings] = await Promise.all([db.list('shop_products', { limit: 100 }), getSettings()]);
      if (settings.currency !== 'KC') {
        const legacy = catalogue.items.filter(item => !item.currency);
        if (legacy.length) await db.transact(legacy.map(item => db.tx.update('shop_products', [{ id: item.id, record: { price: Math.round(Number(item.price) * 5), currency: 'KC' }, if: { currency: undefined } }], { patch: true })));
        const [updated] = await db.tx.update('shop_settings', [{ id: 'main', record: { currency: 'KC' } }], { patch: true });
        if (!updated) await db.tx.add('shop_settings', [{ id: 'main', ...settings, currency: 'KC' }]);
        catalogue.items.forEach(item => { if (!item.currency) { item.price = Math.round(Number(item.price) * 5); item.currency = 'KC'; } });
        settings.currency = 'KC';
      }
      return json({ products: catalogue.items.filter(item => item.active === true), settings });
    },
  ],

  'POST /api/orders': [
    requireAuth(),
    async ctx => {
      const body = ctx.body as {
        productId?: string;
        edition?: 'Java' | 'Bedrock';
        minecraftName?: string;
        quantity?: number;
        promoCode?: string;
      };
      const validEdition = body.edition === 'Java' || body.edition === 'Bedrock';
      const validMinecraftName = body.edition === 'Java'
        ? /^[A-Za-z0-9_]{3,16}$/.test(body.minecraftName || '')
        : body.edition === 'Bedrock'
          ? /^[A-Za-z0-9 _-]{3,16}$/.test(body.minecraftName || '')
          : false;
      if (!body.productId || !validEdition || !validMinecraftName) {
        return error(
          'Choose Java or Bedrock and enter a valid edition-specific Minecraft name.',
          400
        );
      }
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return error('Quantity must be between 1 and 10.', 400);
      }
      const [product] = await db.get<
        ProductInput & { name: string; price: number; active: boolean }
      >('shop_products', [body.productId]);
      if (!product || !product.active)
        return error('This product is no longer available.', 404);
      const subtotal = Number(product.price) * quantity;
      const promoCode = (body.promoCode || '').trim().toUpperCase();
      if (promoCode && promoCode !== 'KATHMANDU10') {
        return error('Invalid promo code. Please check the code or leave it blank.', 400);
      }
      const discountAmount = promoCode === 'KATHMANDU10' ? Math.round(subtotal * 0.1) : 0;
      const total = subtotal - discountAmount;
      const userId = ctx.user!.userId;
      let [wallet] = await db.get<{ balance: number }>('kc_wallets', [userId]);
      if (!wallet) { await db.tx.add('kc_wallets', [{ id: userId, balance: 0, createdAt: new Date().toISOString() }]); [wallet] = await db.get<{ balance: number }>('kc_wallets', [userId], { consistent: true }); }
      if (!wallet || Number(wallet.balance) < total) return error('Not enough Kathamandian Coins. Please top up your wallet first.', 402);
      const now = new Date().toISOString();
      const order: OrderRecord = {
        edition: body.edition,
        minecraftName: body.minecraftName.trim(),
        productId: body.productId,
        productName: product.name,
        quantity,
        unitPrice: Number(product.price),
        total,
        currency: 'KC',
        promoCode: promoCode || undefined,
        discountAmount,
        status: 'payment_verified',
        createdAt: now,
        updatedAt: now,
      };
      const walletUpdate = db.tx.update('kc_wallets', [{ id: userId, record: { balance: Number(wallet.balance) - total, updatedAt: now }, if: { balance: Number(wallet.balance) } }], { patch: true });
      const orderAdd = db.tx.add('shop_orders', [order as unknown as Record<string, unknown>]);
      const ledgerAdd = db.tx.add('kc_transactions', [{ userId, kind: 'purchase', amount: -total, balanceAfter: Number(wallet.balance) - total, description: `Purchase: ${product.name}`, createdAt: now }]);
      const [updated, ids] = await db.transact([walletUpdate, orderAdd, ledgerAdd]);
      const id = ids[0];
      if (!updated[0] || !id) return error('Wallet changed. Refresh and try again.', 409);
      return json({ order: { ...order, id }, walletBalance: Number(wallet.balance) - total }, 201);
    },
  ],

  'PUT /api/orders/:id/payment': [
    async ctx => {
      const body = ctx.body as { minecraftName?: string; utr?: string };
      if (
        !body.minecraftName ||
        !body.utr ||
        body.utr.trim().length < 6 ||
        body.utr.trim().length > 40
      ) {
        return error(
          'Enter the Minecraft username and a valid UTR/reference.',
          400
        );
      }
      const [order] = await db.get<OrderRecord>('shop_orders', [ctx.params.id]);
      if (
        !order ||
        order.minecraftName.toLowerCase() !==
          body.minecraftName.trim().toLowerCase()
      ) {
        return error('Order not found for that Minecraft username.', 404);
      }
      if (order.status !== 'awaiting_payment')
        return error(
          'This order is not accepting a new payment reference.',
          409
        );
      const [updated] = await db.tx.update(
        'shop_orders',
        [
          {
            id: ctx.params.id,
            record: {
              utr: body.utr.trim(),
              status: 'payment_submitted',
              updatedAt: new Date().toISOString(),
            },
            if: {
              status: 'awaiting_payment',
              minecraftName: order.minecraftName,
            },
          },
        ],
        { patch: true }
      );
      if (!updated) return error('Order changed. Refresh and try again.', 409);
      return json({
        order: {
          ...order,
          id: ctx.params.id,
          utr: body.utr.trim(),
          status: 'payment_submitted',
        },
      });
    },
  ],

  'GET /api/wallet': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      let [wallet] = await db.get<{ balance: number }>('kc_wallets', [userId]);
      if (!wallet) { await db.tx.add('kc_wallets', [{ id: userId, balance: 0, createdAt: new Date().toISOString() }]); [wallet] = await db.get<{ balance: number }>('kc_wallets', [userId], { consistent: true }); }
      const ledger = await db.list('kc_transactions', { limit: 100 });
      return json({ balance: Number(wallet?.balance || 0), transactions: ledger.items.filter(item => item.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    },
  ],
  'POST /api/wallet/topups': [
    requireAuth(),
    async ctx => {
      const body = ctx.body as { rupees?: number; utr?: string };
      const rupees = Number(body.rupees); const utr = (body.utr || '').trim();
      if (!Number.isInteger(rupees) || rupees < 1 || rupees > 10000) return error('Enter a whole-rupee top-up amount from ₹1 to ₹10,000.', 400);
      if (utr.length < 6 || utr.length > 40) return error('Enter a valid UTR/reference after paying.', 400);
      const userId = ctx.user!.userId; const now = new Date().toISOString();
      await db.tx.add('kc_wallets', [{ id: userId, balance: 0, createdAt: now }]);
      const [id] = await db.add('kc_topups', [{ userId, rupees, coins: rupees * 5, utr, status: 'pending', createdAt: now }]);
      if (!id) return error('Could not submit your top-up request. Try again.', 503);
      return json({ id, rupees, coins: rupees * 5, status: 'pending' }, 201);
    },
  ],

  'GET /api/orders/:id': [
    async ctx => {
      const minecraftName = ctx.query.minecraftName || '';
      const [order] = await db.get<OrderRecord>('shop_orders', [ctx.params.id]);
      if (
        !order ||
        order.minecraftName.toLowerCase() !== minecraftName.trim().toLowerCase()
      ) {
        return error(
          'Order not found. Check the order ID and Minecraft username.',
          404
        );
      }
      return json({
        order: {
          id: ctx.params.id,
          minecraftName: order.minecraftName,
          edition: order.edition || 'Java',
          productName: order.productName,
          quantity: order.quantity,
          total: order.total,
          currency: order.currency || 'INR',
          status: order.status,
          createdAt: order.createdAt,
        },
      });
    },
  ],

  'GET /api/admin/session': [
    requireAuth(),
    async ctx => {
      await roles.configure({ roles: ['owner', 'co-owner', 'admin', 'staff'] });
      return json({ role: await roles.get(ctx.user!.userId) });
    },
  ],

  'GET /api/admin/team': [
    requireAuth(), requireRole('admin'),
    async () => json(await roles.list()),
  ],

  'POST /api/admin/team/invite-co-owner': [
    requireAuth(), requireRole('owner'),
    async ctx => {
      const body = ctx.body as { email?: string };
      if (!body.email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(body.email)) return error('Enter a valid co-owner email.', 400);
      try {
        const invite = await roles.invite({ email: body.email.trim(), role: 'co-owner', joinPath: '#/join' });
        return json({ emailed: invite.emailed, joinUrl: invite.emailed ? null : invite.joinUrl });
      } catch (err) { return safeError(err); }
    },
  ],

  'GET /api/admin/orders': [
    requireAuth(),
    requireRole('staff'),
    async () => {
      const result = await db.list<OrderRecord>('shop_orders', { limit: 100 });
      return json({
        orders: result.items.sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
      });
    },
  ],

  'PUT /api/admin/orders/:id': [
    requireAuth(),
    requireRole('staff'),
    async ctx => {
      const body = ctx.body as { status?: string };
      const allowed = [
        'awaiting_payment',
        'payment_submitted',
        'payment_verified',
        'processing',
        'delivered',
        'rejected',
      ];
      if (!body.status || !allowed.includes(body.status))
        return error('Invalid order status.', 400);
      const [updated] = await db.tx.update(
        'shop_orders',
        [
          {
            id: ctx.params.id,
            record: {
              status: body.status,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
        { patch: true }
      );
      if (!updated) return error('Order not found.', 404);
      return json({ updated: true });
    },
  ],

  'GET /api/admin/wallet-topups': [
    requireAuth(), requireRole('staff'),
    async () => { const result = await db.list('kc_topups', { limit: 100 }); return json({ items: result.items.filter(item => item.status === 'pending').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) }); },
  ],
  'PUT /api/admin/wallet-topups/:id/approve': [
    requireAuth(), requireRole('staff'),
    async ctx => {
      const [topup] = await db.get<{ userId: string; coins: number; status: string }>('kc_topups', [ctx.params.id]);
      if (!topup || topup.status !== 'pending') return error('Top-up is not pending or was already reviewed.', 409);
      const [wallet] = await db.get<{ balance: number }>('kc_wallets', [topup.userId]);
      if (!wallet) return error('Customer wallet not found.', 404);
      const now = new Date().toISOString();
      const topupUpdate = db.tx.update('kc_topups', [{ id: ctx.params.id, record: { status: 'approved', approvedAt: now }, if: { status: 'pending' } }], { patch: true });
      const walletUpdate = db.tx.update('kc_wallets', [{ id: topup.userId, record: { balance: Number(wallet.balance) + Number(topup.coins), updatedAt: now }, if: { balance: Number(wallet.balance) } }], { patch: true });
      const ledgerAdd = db.tx.add('kc_transactions', [{ userId: topup.userId, kind: 'topup', amount: Number(topup.coins), balanceAfter: Number(wallet.balance) + Number(topup.coins), description: `Approved UPI top-up ${topup.coins} KC`, createdAt: now }]);
      const [topupResult, walletResult] = await db.transact([topupUpdate, walletUpdate, ledgerAdd]);
      if (!topupResult[0] || !walletResult[0]) return error('Wallet or request changed. Refresh and review again.', 409);
      return json({ approved: true });
    },
  ],
  'GET /api/admin/products': [
    requireAuth(),
    requireRole('admin'),
    async () => json(await db.list('shop_products', { limit: 100 })),
  ],

  'POST /api/admin/products': [
    requireAuth(),
    requireRole('admin'),
    async ctx => {
      const body = ctx.body as ProductInput;
      const name = body.name?.trim() || '';
      const category = body.category?.trim() || '';
      const price = Number(body.price);
      if (
        !name ||
        !productCategories.includes(category) ||
        !(body.description || '').trim() ||
        !Number.isFinite(price) ||
        !Number.isInteger(price) ||
        price < 1 ||
        price > 500000
      ) {
        return error(
          'Enter a product name, description, one of the six supported categories and a whole KC price between 1 and 500,000.',
          400
        );
      }
      const [id] = await db.add('shop_products', [
        {
          name,
          category,
          description: (body.description || '').trim().slice(0, 500),
          price,
          currency: 'KC',
          active: body.active !== false,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (!id) return error('Could not save product.', 503);
      return json({ id, created: true }, 201);
    },
  ],

  'PUT /api/admin/products/:id': [
    requireAuth(),
    requireRole('admin'),
    async ctx => {
      const body = ctx.body as ProductInput;
      const patch: Record<string, unknown> = {};
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (typeof body.name === 'string' && body.name.trim())
        patch.name = body.name.trim();
      if (typeof body.category === 'string') {
        if (!productCategories.includes(body.category.trim())) return error('Choose one of the six supported categories.', 400);
        patch.category = body.category.trim();
      }
      if (typeof body.description === 'string') {
        if (!body.description.trim()) return error('A product description is required.', 400);
        patch.description = body.description.trim().slice(0, 500);
      }
      if (
        body.price !== undefined &&
        Number.isFinite(Number(body.price)) &&
        Number.isInteger(Number(body.price)) &&
        Number(body.price) >= 1 &&
        Number(body.price) <= 500000
      ) { patch.price = Number(body.price); patch.currency = 'KC'; }
      else if (body.price !== undefined)
        return error('Price must be a whole KC amount between 1 and 500,000.', 400);
      if (Object.keys(patch).length === 0)
        return error('No valid product changes supplied.', 400);
      const [updated] = await db.tx.update(
        'shop_products',
        [{ id: ctx.params.id, record: patch }],
        { patch: true }
      );
      if (!updated) return error('Product not found.', 404);
      return json({ updated: true });
    },
  ],

  'DELETE /api/admin/products/:id': [
    requireAuth(),
    requireRole('admin'),
    async ctx => {
      const [deleted] = await db.delete('shop_products', [ctx.params.id]);
      return json({ deleted: deleted === true });
    },
  ],

  'PUT /api/admin/settings': [
    requireAuth(),
    requireRole('admin'),
    async ctx => {
      const body = ctx.body as Partial<ShopSettings>;
      const patch: Record<string, unknown> = {};
      for (const key of [
        'serverName',
        'serverAddress',
        'upiId',
        'payeeName',
        'announcement',
      ] as const) {
        if (typeof body[key] === 'string')
          patch[key] = body[key]!.trim().slice(0, 240);
      }
      const [updated] = await db.tx.update(
        'shop_settings',
        [{ id: 'main', record: patch }],
        { patch: true }
      );
      if (!updated) {
        const [created] = await db.tx.add('shop_settings', [
          { id: 'main', ...defaultSettings, ...patch },
        ]);
        if (!created) return error('Could not save store settings.', 503);
      }
      return json({ saved: true });
    },
  ],

  'POST /api/admin/team/invite': [
    requireAuth(),
    requireRole('admin'),
    async ctx => {
      const body = ctx.body as { email?: string; role?: string };
      if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
        return error('Enter a valid moderator email.', 400);
      try {
        const invite = await roles.invite({
          email: body.email.trim(),
          role: 'staff',
          joinPath: '#/join',
        });
        return json({
          emailed: invite.emailed,
          joinUrl: invite.emailed ? null : invite.joinUrl,
        });
      } catch (err) {
        return safeError(err);
      }
    },
  ],
});
