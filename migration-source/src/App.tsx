import { useEffect, useMemo, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Gem,
  Menu,
  Package,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Swords,
  UserRound,
  X,
  Zap,
} from 'lucide-react';

type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  active: boolean;
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
type Order = {
  id: string;
  edition?: 'Java' | 'Bedrock';
  minecraftName: string;
  productName: string;
  quantity: number;
  total: number;
  currency?: string;
  status: string;
  utr?: string;
  createdAt: string;
};
type StaffRole = { role: string; scopes: string[] } | null;

const productCategories = ['Ranks', 'Kits', 'Coins', 'Crates', 'Keys', 'Custom Items'];

const emptySettings: ShopSettings = {
  serverName: 'Kathmandu SMP',
  serverAddress: 'play.kathmandusmp.net',
  upiId: '8415801703@fam',
  payeeName: 'Salfhan Jamatia',
  announcement: 'Adventure starts here. Gear up for your next journey.',
  currency: 'INR',
};

const statusLabels: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  payment_submitted: 'Payment submitted',
  payment_verified: 'Payment verified',
  processing: 'Preparing delivery',
  delivered: 'Delivered',
  rejected: 'Payment rejected',
};

function money(value: number, currency = 'KC') {
  if (currency === 'KC') return `${new Intl.NumberFormat('en-IN').format(value)} KC`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

async function copyOrderId(orderId: string) {
  try {
    await navigator.clipboard.writeText(orderId);
  } catch {
    const field = document.createElement('textarea');
    field.value = orderId;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<ShopSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [minecraftName, setMinecraftName] = useState('');
  const [minecraftEdition, setMinecraftEdition] = useState<'Java' | 'Bedrock'>('Java');
  const [quantity, setQuantity] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [utr, setUtr] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletTransactions, setWalletTransactions] = useState<any[]>([]);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupRupees, setTopupRupees] = useState('100');
  const [topupUtr, setTopupUtr] = useState('');
  const [adminTopups, setAdminTopups] = useState<any[]>([]);
  const [trackingId, setTrackingId] = useState('');
  const [trackingName, setTrackingName] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [user, setUser] = useState<{
    userId: string;
    email?: string;
    name?: string;
  } | null>(null);
  const [staffRole, setStaffRole] = useState<StaffRole>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState('orders');
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [draftProduct, setDraftProduct] = useState({
    name: '',
    category: 'Ranks',
    description: '',
    price: '99',
  });
  const [draftSettings, setDraftSettings] =
    useState<ShopSettings>(emptySettings);
  const [inviteEmail, setInviteEmail] = useState('');
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadShop() {
    setLoading(true);
    try {
      const response = await api.get('/api/shop');
      setProducts((response.data.products || []) as Product[]);
      const next = {
        ...emptySettings,
        ...(response.data.settings || {}),
        upiId: response.data.settings?.upiId || emptySettings.upiId,
        payeeName: response.data.settings?.payeeName || emptySettings.payeeName,
      } as ShopSettings;
      setSettings(next);
      setDraftSettings(next);
    } catch {
      setNotice(
        'The shop is temporarily unavailable. Please refresh in a moment.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function restoreUser() {
    try {
      const current = await auth.getUser();
      setUser(
        current
          ? { userId: current.userId, email: current.email, name: current.name }
          : null
      );
      if (current) {
        void loadWallet();
        try {
          const response = await api.get('/api/admin/session');
          setStaffRole(response.data.role as StaffRole);
        } catch {
          setStaffRole(null);
        }
      } else {
        setStaffRole(null);
      }
    } catch {
      setNotice('Sign-in could not be restored. Please try again.');
    }
  }

  useEffect(() => {
    void loadShop();
    void restoreUser();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    }
  }, []);

  const categories = useMemo(() => ['All', ...productCategories], []);
  const [category, setCategory] = useState('All');
  const visibleProducts = products.filter(
    product =>
      product.active && (category === 'All' || product.category === category)
  );

  async function copyServerAddress() {
    try {
      await navigator.clipboard.writeText(settings.serverAddress);
      setNotice('Shared Java + Bedrock server address copied.');
    } catch {
      setNotice('Copy is unavailable in this browser. Select the server address to copy it.');
    }
  }

  async function signIn() {
    try {
      await auth.signInWithRedirect();
    } catch {
      setNotice(
        'Sign-in could not start. Check browser storage and try again.'
      );
    }
  }

  async function signOut() {
    try {
      await auth.signOut();
      setUser(null);
      setStaffRole(null);
      setWalletBalance(0);
      setWalletTransactions([]);
      setNotice('You have been signed out.');
    } catch {
      setNotice('Sign-out could not complete. Please try again.');
    }
  }

  async function loadWallet() {
    try { const response = await api.get('/api/wallet'); setWalletBalance(Number(response.data.balance || 0)); setWalletTransactions(response.data.transactions || []); } catch { setWalletBalance(0); }
  }
  async function submitTopup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try { const response = await api.post('/api/wallet/topups', { rupees: Number(topupRupees), utr: topupUtr.trim() }); setNotice(`Top-up submitted: ${response.data.coins} KC. Coins will be credited after UPI verification.`); setTopupOpen(false); setTopupUtr(''); await loadWallet(); }
    catch (error) { setNotice(errorMessage(error, 'Could not submit top-up.')); } finally { setBusy(false); }
  }
  async function loadAdminTopups() { try { const response = await api.get('/api/admin/wallet-topups'); setAdminTopups(response.data.items || []); } catch { setNotice('Could not load wallet top-ups.'); } }
  async function approveTopup(id: string) { try { await api.put(`/api/admin/wallet-topups/${id}/approve`, {}); await loadAdminTopups(); setNotice('Top-up approved and KC credited.'); } catch (error) { setNotice(errorMessage(error, 'Could not approve top-up.')); } }
  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { setNotice('Please sign in before purchasing with Kathamandian Coins.'); return; }
    if (!selected || !minecraftName.trim()) return;
    setBusy(true);
    try {
      const response = await api.post('/api/orders', {
        productId: selected.id,
        edition: minecraftEdition,
        minecraftName: minecraftName.trim(),
        quantity,
        promoCode: promoCode.trim(),
      });
      setActiveOrder(response.data.order as Order);
      setWalletBalance(Number(response.data.walletBalance ?? walletBalance));
      setPromoCode('');
      setUtr('');
      setSelected(null);
      setNotice('Order placed successfully. Kathamandian Coins were deducted from your wallet.');
      await loadWallet();
    } catch (error) {
      setNotice(
        errorMessage(error, 'Could not create your order. Please try again.')
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrder || !utr.trim()) return;
    setBusy(true);
    try {
      const response = await api.put(`/api/orders/${activeOrder.id}/payment`, {
        minecraftName: activeOrder.minecraftName,
        utr: utr.trim(),
      });
      setActiveOrder(response.data.order as Order);
      setNotice(
        'Payment reference submitted. The team will verify your UPI payment.'
      );
    } catch (error) {
      setNotice(errorMessage(error, 'Could not submit payment reference.'));
    } finally {
      setBusy(false);
    }
  }

  async function trackOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.get(
        `/api/orders/${encodeURIComponent(trackingId.trim())}`,
        {
          params: { minecraftName: trackingName.trim() },
        }
      );
      setTrackedOrder(response.data.order as Order);
      setNotice('');
    } catch (error) {
      setTrackedOrder(null);
      setNotice(
        errorMessage(
          error,
          'Order not found. Check the order ID and Minecraft username.'
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadAdminOrders() {
    try {
      const response = await api.get('/api/admin/orders');
      setAdminOrders((response.data.orders || []) as Order[]);
    } catch {
      setNotice('Could not load orders. Check your staff permissions.');
    }
  }

  async function updateOrder(order: Order, status: string) {
    try {
      await api.put(`/api/admin/orders/${order.id}`, { status });
      await loadAdminOrders();
      setNotice(`Order ${order.id} updated.`);
    } catch (error) {
      setNotice(errorMessage(error, 'Could not update order.'));
    }
  }

  async function loadAdminProducts() {
    try {
      const response = await api.get('/api/admin/products');
      setAdminProducts((response.data.items || []) as Product[]);
    } catch (error) {
      setNotice(errorMessage(error, 'Could not load the catalogue. Check owner permissions.'));
    }
  }

  function resetProductDraft() {
    setEditingProductId(null);
    setDraftProduct({ name: '', category: 'Ranks', description: '', price: '99' });
  }

  function editProduct(product: Product) {
    setEditingProductId(product.id);
    setDraftProduct({ name: product.name, category: product.category, description: product.description || '', price: String(product.price) });
    setAdminTab('products');
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { ...draftProduct, price: Number(draftProduct.price), active: true };
    try {
      if (editingProductId) {
        await api.put(`/api/admin/products/${editingProductId}`, payload);
        setNotice('Product changes saved.');
      } else {
        await api.post('/api/admin/products', payload);
        setNotice('Product added to the shop.');
      }
      resetProductDraft();
      await Promise.all([loadShop(), loadAdminProducts()]);
    } catch (error) {
      setNotice(errorMessage(error, 'Could not save product.'));
    }
  }

  async function toggleProduct(product: Product) {
    try {
      await api.put(`/api/admin/products/${product.id}`, { active: !product.active });
      await Promise.all([loadShop(), loadAdminProducts()]);
      setNotice(product.active ? 'Product hidden from the public shop.' : 'Product published to the shop.');
    } catch (error) {
      setNotice(errorMessage(error, 'Could not update product.'));
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/admin/products/${product.id}`);
      await Promise.all([loadShop(), loadAdminProducts()]);
      if (editingProductId === product.id) resetProductDraft();
      setNotice('Product deleted.');
    } catch (error) {
      setNotice(errorMessage(error, 'Could not delete product.'));
    }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.put('/api/admin/settings', draftSettings);
      await loadShop();
      setNotice('Shop settings saved.');
    } catch (error) {
      setNotice(errorMessage(error, 'Could not save settings.'));
    }
  }

  async function loadTeam() {
    try { const response = await api.get('/api/admin/team'); setTeamMembers(response.data.members || []); }
    catch (error) { setNotice(errorMessage(error, 'Could not load the team.')); }
  }

  async function inviteCoOwner(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await api.post('/api/admin/team/invite-co-owner', { email: coOwnerEmail.trim() });
      setCoOwnerEmail('');
      setNotice(response.data.emailed ? 'Co-Owner invitation sent by email.' : `Share this invite link: ${response.data.joinUrl}`);
    } catch (error) { setNotice(errorMessage(error, 'Only the Owner can invite a Co-Owner.')); }
  }

  async function inviteModerator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await api.post('/api/admin/team/invite', {
        email: inviteEmail.trim(),
        role: 'staff',
      });
      setInviteEmail('');
      setNotice(
        response.data.emailed
          ? 'Moderator invitation sent by email.'
          : `Share this invite link: ${response.data.joinUrl}`
      );
    } catch (error) {
      setNotice(errorMessage(error, 'Could not invite moderator.'));
    }
  }

  useEffect(() => {
    if (adminOpen && staffRole) {
      void loadAdminOrders();
      void loadAdminTopups();
      if (staffRole.role === 'owner' || staffRole.role === 'co-owner' || staffRole.role === 'admin') void loadAdminProducts();
      if (staffRole.role === 'owner' || staffRole.role === 'co-owner' || staffRole.role === 'admin') void loadTeam();
    }
  }, [adminOpen, staffRole]);

  return (
    <div className="site-shell">
      <div className="topline">
        <span className="online-dot" /> KATHMANDU SMP{' '}
        <span className="topline-divider">/</span> OFFICIAL PLAYER STORE{' '}
        <span className="topline-right">SURVIVE · BUILD · CONQUER</span>
      </div>
      <header className="header">
        <a className="brand" href="#top" aria-label="Kathmandu SMP home">
          <span className="brand-mark">
            <img className="brand-logo" src="/resources/kathmandu-shop-logo.png?v=3" alt="" />
          </span>
          <span>
            <strong>KATHMANDU</strong>
            <small>MINECRAFT SMP</small>
          </span>
        </a>
        <nav className="main-nav">
          <a href="#shop">Store</a>
          <a href="#how">How it works</a>
          <a href="#track">Track order</a>
        </nav>
        <div className="header-actions">
          {staffRole && (
            <button
              className="admin-trigger"
              onClick={() => setAdminOpen(true)}
            >
              <ShieldCheck size={16} /> {staffRole.role === 'owner' ? 'Owner Panel' : staffRole.role === 'co-owner' ? 'Co-Owner Panel' : staffRole.role === 'admin' ? 'Admin Panel' : 'Moderator Panel'}
            </button>
          )}
          {user ? (
            <>
              <span className="signed-user">
                <UserRound size={15} /> {user.name || user.email || 'Signed in'}
              </span>
              <button className="sign-in" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="sign-in" onClick={signIn}>
              Sign in / Create account <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-grid" />
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> THE OFFICIAL KATHMANDU SMP STORE
            </div>
            <h1>
              YOUR NEXT
              <br />
              <em>ADVENTURE</em>
              <br />
              STARTS HERE.
            </h1>
            <p>{settings.announcement}</p>
            <div className="hero-actions">
              <a className="primary-btn" href="#shop">
                Explore the store <ArrowRight size={17} />
              </a>
              <span className="server-address">
                <span className="online-dot" /> {settings.serverAddress}
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="sun-glow" />
            <div className="block-stack block-one" />
            <div className="block-stack block-two" />
            <div className="block-stack block-three" />
            <div className="floating-gem">
              <Gem size={86} strokeWidth={1.2} />
            </div>
            <div className="hero-coordinate">
              27°42' N<br />
              85°19' E
            </div>
            <div className="hero-stamp">
              EST.
              <br />
              <b> SMP</b>
              <br />
              2024
            </div>
          </div>
          <div className="hero-foot">
            <span>01 — EQUIP YOURSELF</span>
            <span>MADE FOR THE GRIND</span>
            <span>SCROLL TO EXPLORE ↓</span>
          </div>
        </section>

        <section className="ticker">
          <span>✦</span> RANK UP YOUR JOURNEY <b>✦</b> EXCLUSIVE SMP ITEMS{' '}
          <b>✦</b> FAIR PLAY. EPIC LOOT. <b>✦</b> RANK UP YOUR JOURNEY <b>✦</b>
        </section>

        <section className="server-connect">
          <div className="section-wrap server-connect-inner">
            <div>
              <div className="eyebrow dark"><span /> ONE SERVER · TWO EDITIONS</div>
              <h2>JOIN THE <em>WORLD.</em></h2>
              <p>Java and Bedrock players connect to the same Kathmandu SMP address. Choose your edition in Minecraft, then use this shared address.</p>
            </div>
            <div className="server-connect-card">
              <span className="server-connect-label">SHARED SERVER ADDRESS</span>
              <strong>{settings.serverAddress || 'Server address coming soon'}</strong>
              <button className="primary-btn" onClick={() => void copyServerAddress()} disabled={!settings.serverAddress}>
                <Copy size={16} /> Copy address
              </button>
              <div className="edition-instructions">
                <div><b>JAVA EDITION</b><span>Multiplayer → Add Server → enter the address above.</span></div>
                <div><b>BEDROCK EDITION</b><span>Play → Servers → Add Server → enter the same address.</span></div>
              </div>
              <small>If the server team gives you a custom port, enter that port in Minecraft too.</small>
            </div>
          </div>
        </section>

        {user && <section className="shop-section section-wrap" id="wallet"><div className="section-heading"><div><div className="eyebrow dark"><span /> PLAYER WALLET</div><h2>KATHAMANDIAN <em>COINS.</em></h2></div><p>Exchange rate: ₹1 = 5 KC</p></div><div className="wallet-card"><div><span>AVAILABLE BALANCE</span><strong>{money(walletBalance)}</strong></div><button className="primary-btn" onClick={() => setTopupOpen(true)}>Exchange INR for KC <ArrowRight size={16} /></button></div><h3>Recent wallet activity</h3>{walletTransactions.slice(0,5).map((item,index)=><div className="total-line" key={item.id || index}><span>{item.description}</span><strong>{item.amount > 0 ? '+' : ''}{money(item.amount)}</strong></div>)}</section>}
        <section className="shop-section section-wrap" id="shop">
          <div className="section-heading">
            <div>
              <div className="eyebrow dark">
                <span /> THE MARKETPLACE
              </div>
              <h2>
                THE <em>LOOT</em> ROOM.
              </h2>
            </div>
            <p>
              Hand-picked upgrades for your
              <br />
              next chapter on the server.
            </p>
          </div>
          <div className="category-row">
            <div className="category-tabs">
              {categories.map(item => (
                <button
                  key={item}
                  className={category === item ? 'category active' : 'category'}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <span className="item-count">
              {visibleProducts.length.toString().padStart(2, '0')} ITEMS
            </span>
          </div>
          {loading ? (
            <div className="empty-state">Loading the marketplace…</div>
          ) : visibleProducts.length === 0 ? (
            <div className="empty-state">
              <Package size={34} />
              <h3>The chests are being stocked.</h3>
              <p>
                New gear and ranks will appear here soon. Check back with the
                server team.
              </p>
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product, index) => (
                <article className="product-card" key={product.id}>
                  <div className={`product-art art-${index % 4}`}>
                    <span className="product-number">
                      ITEM / {(index + 1).toString().padStart(2, '0')}
                    </span>
                    <div className="item-glyph">
                      {product.category.toLowerCase().includes('rank') ? (
                        <Swords size={52} />
                      ) : product.category.toLowerCase().includes('coin') ? (
                        <Gem size={52} />
                      ) : (
                        <Package size={52} />
                      )}
                    </div>
                    <span className="art-label">{product.category}</span>
                  </div>
                  <div className="product-info">
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.description}</p>
                    </div>
                    <div className="product-buy">
                      <strong>{money(product.price)}</strong>
                      <button
                        aria-label={`Buy ${product.name}`}
                        onClick={() => {
                          setSelected(product);
                          setQuantity(1);
                        }}
                      >
                        <ShoppingCart size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="how-section" id="how">
          <div className="section-wrap">
            <div className="eyebrow">
              <span /> SIMPLE. SECURE. MANUAL.
            </div>
            <h2>
              FROM CHECKOUT
              <br />
              TO <em>IN-GAME.</em>
            </h2>
            <div className="steps-grid">
              <div className="step">
                <span>01</span>
                <ShoppingBag size={25} />
                <h3>Choose your loot</h3>
                <p>Pick a rank, kit or upgrade from the store.</p>
              </div>
              <div className="step">
                <span>02</span>
                <Zap size={25} />
                <h3>Exchange for KC</h3>
                <p>Top up your Kathamandian Coins wallet with UPI and submit your UTR.</p>
              </div>
              <div className="step">
                <span>03</span>
                <ShieldCheck size={25} />
                <h3>We verify</h3>
                <p>A moderator verifies your UPI top-up before KC is credited.</p>
              </div>
              <div className="step">
                <span>04</span>
                <Gem size={25} />
                <h3>Loot delivered</h3>
                <p>
                  Our team delivers your purchase in-game and updates your
                  order.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="track-section section-wrap" id="track">
          <div>
            <div className="eyebrow dark">
              <span /> YOUR ORDER, YOUR STATUS
            </div>
            <h2>
              THE DELIVERY
              <br />
              <em>BOARD.</em>
            </h2>
            <p>
              Already placed an order? Enter your order ID and Minecraft
              username to see its progress.
            </p>
          </div>
          <div className="track-card">
            <form onSubmit={trackOrder}>
              <label>ORDER ID</label>
              <input
                value={trackingId}
                onChange={event => setTrackingId(event.target.value)}
                placeholder="Paste your order ID"
                required
              />
              <label>MINECRAFT USERNAME</label>
              <input
                value={trackingName}
                onChange={event => setTrackingName(event.target.value)}
                placeholder="Your in-game name"
                required
              />
              <button className="primary-btn" disabled={busy}>
                Check order <ArrowRight size={16} />
              </button>
            </form>
            {trackedOrder && (
              <div className="tracked-result">
                <div className="tracked-order-id">
                  <span>ORDER ID</span>
                  <code>{trackedOrder.id}</code>
                  <button type="button" className="copy-btn" onClick={() => void copyOrderId(trackedOrder.id)}>
                    <Copy size={14} /> Copy full Order ID
                  </button>
                </div>
                <span className="status-pill">
                  {statusLabels[trackedOrder.status] || trackedOrder.status}
                </span>
                <strong>{trackedOrder.productName}</strong>
                <span>{trackedOrder.edition || 'Java'} edition · {trackedOrder.minecraftName}</span>
                <span>
                  {money(trackedOrder.total, trackedOrder.currency || 'INR')} · Qty {trackedOrder.quantity}
                </span>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="brand footer-brand">
          <span className="brand-mark">
            <img className="brand-logo" src="/resources/kathmandu-shop-logo.png?v=3" alt="" />
          </span>
          <span>
            <strong>KATHMANDU</strong>
            <small>MINECRAFT SMP</small>
          </span>
        </div>
        <p>Not just a server. Your world.</p>
        <span>© {new Date().getFullYear()} KATHMANDU SMP · PLAYER STORE</span>
      </footer>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}

      {topupOpen && user && <div className="modal-backdrop" onClick={() => setTopupOpen(false)}><div className="modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setTopupOpen(false)}><X size={19} /></button><div className="eyebrow dark"><span /> EXCHANGE SHOP</div><h2>GET <em>KATHAMANDIAN COINS.</em></h2><p className="modal-product">₹1 = 5 KC · UPI top-ups are credited after staff verification.</p><div className="upi-qr-panel"><strong>Pay ₹{Number(topupRupees) || 0}</strong><img src="/resources/upi-qr.png" alt="UPI payment QR code" /><p>Pay to {settings.payeeName} using the UPI ID below.</p></div><div className="upi-panel"><strong>{settings.upiId}</strong><small>{settings.payeeName}</small></div><form onSubmit={submitTopup}><label>AMOUNT IN INR</label><input type="number" min="1" max="10000" step="1" value={topupRupees} onChange={event => setTopupRupees(event.target.value)} required /><div className="total-line"><span>YOU RECEIVE</span><strong>{(Number(topupRupees) || 0) * 5} KC</strong></div><label>UPI TRANSACTION ID / UTR</label><input value={topupUtr} onChange={event => setTopupUtr(event.target.value)} minLength={6} maxLength={40} placeholder="Enter UTR after payment" required /><button className="primary-btn full" disabled={busy}>Submit top-up request <ArrowRight size={16} /></button></form></div></div>}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>
              <X size={19} />
            </button>
            <div className="eyebrow dark">
              <span /> SECURE CHECKOUT
            </div>
            <h2>
              LOCK IN YOUR <em>LOOT.</em>
            </h2>
            <p className="modal-product">
              {selected.name} · {money(selected.price)}
            </p>
            <form onSubmit={createOrder}>
              <label>PLAYER EDITION</label>
              <select
                value={minecraftEdition}
                onChange={event => {
                  setMinecraftEdition(event.target.value as 'Java' | 'Bedrock');
                  setMinecraftName('');
                }}
                required
              >
                <option value="Java">Java Edition</option>
                <option value="Bedrock">Bedrock Edition</option>
              </select>
              <label>{minecraftEdition === 'Java' ? 'JAVA USERNAME' : 'BEDROCK GAMERTAG'}</label>
              <input
                value={minecraftName}
                onChange={event => setMinecraftName(event.target.value)}
                placeholder={minecraftEdition === 'Java' ? '3–16 letters, numbers or underscores' : '3–16 characters; spaces, letters and numbers'}
                minLength={3}
                maxLength={16}
                pattern={minecraftEdition === 'Java' ? '[A-Za-z0-9_]{3,16}' : '[A-Za-z0-9 _-]{3,16}'}
                required
              />
              <label>QUANTITY</label>
              <div className="quantity-control">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  −
                </button>
                <strong>{quantity}</strong>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(10, quantity + 1))}
                >
                  +
                </button>
              </div>
              <label htmlFor="promo-code">PROMO CODE (OPTIONAL)</label>
              <input
                id="promo-code"
                value={promoCode}
                onChange={event => setPromoCode(event.target.value)}
                placeholder="Enter promo code"
                autoCapitalize="characters"
              />
              <small className="fine-print">Leave blank to pay the regular price.</small>
              <div className="total-line">
                <span>SUBTOTAL</span>
                <strong>{money(selected.price * quantity)}</strong>
              </div>
              {promoCode.trim().toUpperCase() === 'KATHMANDU10' && (
                <div className="total-line">
                  <span>10% DISCOUNT</span>
                  <strong>−{money(Math.round(selected.price * quantity * 0.1))}</strong>
                </div>
              )}
              <div className="total-line">
                <span>TOTAL</span>
                <strong>{money(promoCode.trim().toUpperCase() === 'KATHMANDU10' ? selected.price * quantity - Math.round(selected.price * quantity * 0.1) : selected.price * quantity)}</strong>
              </div>
              <button className="primary-btn full" disabled={busy}>
                Create order <ArrowRight size={16} />
              </button>
            </form>
            <small className="fine-print">Sign in is required. Your KC wallet is charged automatically when you place an order. Add KC from the wallet panel using UPI.</small>
          </div>
        </div>
      )}

      {activeOrder && (
        <div className="modal-backdrop">
          <div className="modal payment-modal">
            <button
              className="modal-close"
              onClick={() => setActiveOrder(null)}
            >
              <X size={19} />
            </button>
            <div className="order-id-display">
              <span>YOUR COMPLETE ORDER ID</span>
              <code>{activeOrder.id}</code>
              <button type="button" className="copy-btn" onClick={() => void copyOrderId(activeOrder.id)}>
                <Copy size={14} /> Copy full Order ID
              </button>
            </div>
            <h2>
              ORDER <em>CONFIRMED.</em>
            </h2>
            <p className="modal-product">
              {activeOrder.productName} · {money(activeOrder.total, activeOrder.currency || 'KC')}
            </p>
            <p className="modal-product">{activeOrder.edition || 'Java'} Edition · {activeOrder.minecraftName}</p>
            <div className="upi-panel"><span>PAYMENT STATUS</span><strong>Paid with Kathamandian Coins</strong><small>{money(activeOrder.total, activeOrder.currency || 'KC')} deducted from your wallet. Status: {statusLabels[activeOrder.status] || activeOrder.status}.</small></div>
          </div>
        </div>
      )}

      {adminOpen && (
        <div className="admin-overlay">
          <aside className="admin-panel">
            <div className="admin-head">
              <div>
                <div className="eyebrow dark">
                  <span /> CONTROL ROOM
                </div>
                <h2>
                  SHOP <em>{staffRole?.role === 'owner' ? 'OWNER.' : staffRole?.role === 'co-owner' ? 'CO-OWNER.' : staffRole?.role === 'admin' ? 'ADMIN.' : 'MODERATOR.'}</em>
                </h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setAdminOpen(false)}
              >
                <X />
              </button>
            </div>
            <div className="admin-tabs">
              {[
                'orders', 'wallet',                  ...(staffRole?.role === 'owner' || staffRole?.role === 'co-owner' || staffRole?.role === 'admin'
                  ? ['products', 'settings', 'team']
                  : []),
                ...(staffRole?.role === 'co-owner' ? ['co-owner'] : []),
              ].map(tab => (
                <button
                  className={adminTab === tab ? 'active' : ''}
                  key={tab}
                  onClick={() => setAdminTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            {adminTab === 'co-owner' && staffRole?.role === 'co-owner' && <div className="admin-content"><h3>Co-Owner Control Desk</h3><p className="muted">You can oversee orders, verify KC wallet top-ups, manage products, update shop settings and invite moderators. Only the Owner can appoint or replace Co-Owners.</p><div className="admin-order"><div><strong>{adminOrders.length} recent orders loaded</strong><span>Review delivery status in the Orders tab.</span></div><button className="text-action" onClick={() => setAdminTab('orders')}>Open orders</button></div><div className="admin-order"><div><strong>{adminTopups.length} pending KC top-ups</strong><span>Verify UTR references before crediting wallets.</span></div><button className="text-action" onClick={() => setAdminTab('wallet')}>Review top-ups</button></div><div className="admin-order"><div><strong>Shop and team controls</strong><span>Products, settings and moderator access are available in their tabs.</span></div><button className="text-action" onClick={() => setAdminTab('team')}>Manage team</button></div></div>}
            {adminTab === 'wallet' && <div className="admin-content"><h3>Pending KC top-ups</h3>{adminTopups.length === 0 ? <p className="muted">No pending top-ups.</p> : adminTopups.map(item => <div className="admin-order" key={item.id}><div><strong>{item.coins} KC · ₹{item.rupees}</strong><span>Customer: {item.userId}</span><span>UTR: {item.utr}</span></div><button className="primary-btn" onClick={() => void approveTopup(item.id)}>Verify & credit</button></div>)}</div>}
            {adminTab === 'orders' && (
              <div className="admin-content">
                <h3>Incoming orders</h3>
                {adminOrders.length === 0 ? (
                  <p className="muted">No orders yet.</p>
                ) : (
                  adminOrders.map(order => (
                    <div className="admin-order" key={order.id}>
                      <div>
                        <strong>{order.productName}</strong>
                        <span>{order.edition || 'Java'} Edition · {order.minecraftName}</span>
                        <span>{money(order.total, order.currency || 'INR')}</span>
                        <div className="admin-order-id">
                          <span>ORDER ID</span>
                          <code>{order.id}</code>
                          <button type="button" className="copy-btn" onClick={() => void copyOrderId(order.id)}>
                            <Copy size={13} /> Copy full ID
                          </button>
                          <small>UTR: {order.utr || 'Not submitted'}</small>
                        </div>
                      </div>
                      <select
                        value={order.status}
                        onChange={event =>
                          void updateOrder(order, event.target.value)
                        }
                      >
                        {Object.keys(statusLabels).map(status => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
              </div>
            )}
            {adminTab === 'products' && (
              <div className="admin-content">
                <h3>{editingProductId ? 'Edit product' : 'Add a product'}</h3>
                <form onSubmit={saveProduct}>
                  <label>PRODUCT NAME</label>
                  <input value={draftProduct.name} onChange={event => setDraftProduct({ ...draftProduct, name: event.target.value })} maxLength={80} required />
                  <label>CATEGORY</label>
                  <select value={draftProduct.category} onChange={event => setDraftProduct({ ...draftProduct, category: event.target.value })} required>
                    {productCategories.map(item => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <label>DESCRIPTION</label>
                  <textarea value={draftProduct.description} onChange={event => setDraftProduct({ ...draftProduct, description: event.target.value })} maxLength={500} placeholder="Explain what the player receives and any important conditions" required />
                  <label>PRICE (KATHAMANDIAN COINS)</label>
                  <input type="number" min="1" max="500000" step="1" value={draftProduct.price} onChange={event => setDraftProduct({ ...draftProduct, price: event.target.value })} required />
                  <small className="field-help">Enter the price in whole KC. Exchange rate: ₹1 = 5 KC.</small>
                  <button className="primary-btn full">{editingProductId ? 'Save changes' : 'Add product'} <ArrowRight size={16} /></button>
                  {editingProductId && <button type="button" className="text-action full" onClick={resetProductDraft}>Cancel editing</button>}
                </form>
                <h3 className="subhead">Manage catalogue ({adminProducts.length})</h3>
                {adminProducts.length === 0 ? <p className="muted">No products yet. Add your first listing above.</p> : adminProducts.map(product => (
                  <div className="admin-order product-admin-row" key={product.id}>
                    <div>
                      <strong>{product.name}</strong>
                      <span>{product.category} · {money(product.price)} · {product.active ? 'Published' : 'Hidden'}</span>
                      <small>{product.description}</small>
                    </div>
                    <div className="product-admin-actions">
                      <button className="text-action" onClick={() => editProduct(product)}>Edit</button>
                      <button className="text-action" onClick={() => void toggleProduct(product)}>{product.active ? 'Hide' : 'Publish'}</button>
                      <button className="text-action danger-action" onClick={() => void deleteProduct(product)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {adminTab === 'settings' && (
              <div className="admin-content">
                <h3>Store settings</h3>
                <form onSubmit={saveSettings}>
                  <label>SERVER NAME</label>
                  <input
                    value={draftSettings.serverName}
                    onChange={event =>
                      setDraftSettings({
                        ...draftSettings,
                        serverName: event.target.value,
                      })
                    }
                  />
                  <label>SERVER ADDRESS</label>
                  <input
                    value={draftSettings.serverAddress}
                    onChange={event =>
                      setDraftSettings({
                        ...draftSettings,
                        serverAddress: event.target.value,
                      })
                    }
                    placeholder="Your shared Java + Bedrock server address"
                  />
                  <small className="field-help">One address is displayed to both Java and Bedrock players. Update it here when your server address changes.</small>
                  <label>UPI ID / VPA</label>
                  <input
                    value={draftSettings.upiId}
                    onChange={event =>
                      setDraftSettings({
                        ...draftSettings,
                        upiId: event.target.value,
                      })
                    }
                    placeholder="yourname@bank"
                  />
                  <label>UPI PAYEE NAME</label>
                  <input
                    value={draftSettings.payeeName}
                    onChange={event =>
                      setDraftSettings({
                        ...draftSettings,
                        payeeName: event.target.value,
                      })
                    }
                  />
                  <label>STORE ANNOUNCEMENT</label>
                  <textarea
                    value={draftSettings.announcement}
                    onChange={event =>
                      setDraftSettings({
                        ...draftSettings,
                        announcement: event.target.value,
                      })
                    }
                  />
                  <button className="primary-btn full">
                    Save settings <Check size={16} />
                  </button>
                </form>
              </div>
            )}
            {adminTab === 'team' && (
              <div className="admin-content">
                <h3>Team members</h3>
                <p className="muted">Owner appoints Co-Owners. Co-Owners and Admins can invite moderators. Roles are enforced by the server.</p>
                {teamMembers.map(member => <div className="admin-order" key={member.userId}><div><strong>{member.name || member.email || member.userId}</strong><span>{member.email || 'No email shown'} · {member.role}</span></div></div>)}
                {staffRole?.role === 'owner' && <><h3 className="subhead">Appoint a Co-Owner</h3><form onSubmit={inviteCoOwner}><label>CO-OWNER EMAIL</label><input type="email" value={coOwnerEmail} onChange={event => setCoOwnerEmail(event.target.value)} placeholder="coowner@example.com" required /><button className="primary-btn full">Send Co-Owner invitation <ArrowRight size={16} /></button></form></>}
                <h3 className="subhead">Invite a moderator</h3>
                <p className="muted">
                  The invitee will receive a staff invitation by email. Staff
                  can verify payments and update deliveries, but cannot change
                  shop settings or products.
                </p>
                <form onSubmit={inviteModerator}>
                  <label>MODERATOR EMAIL</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={event => setInviteEmail(event.target.value)}
                    placeholder="moderator@example.com"
                    required
                  />
                  <button className="primary-btn full">
                    Send invitation <ArrowRight size={16} />
                  </button>
                </form>
              </div>
            )}
            <div className="admin-foot">
              <span>Signed in as {user?.email || user?.name || 'staff'}</span>
              <button
                onClick={async () => {
                  await auth.signOut();
                  setUser(null);
                  setStaffRole(null);
                  setAdminOpen(false);
                }}
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (
      error as { response?: { data?: { error?: string; message?: string } } }
    ).response;
    return response?.data?.error || response?.data?.message || fallback;
  }
  return fallback;
}

export default App;
