document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initMobileMenu();
    initModals();

    // Fetch admin info
    fetch('/api/me').then(r => r.json()).then(me => {
        const el = document.querySelector('.admin-name');
        if (el && me.username) el.innerText = me.username;
    }).catch(() => {});

    // Load default tab
    loadDashboard();
});

// ========== Toast System ==========
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3000);
}

// ========== Formatters ==========
function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString();
}

function formatNumber(n) {
    return Number(n || 0).toLocaleString();
}

// ========== Tab Navigation ==========
function initTabs() {
    const sidebarItems = document.querySelectorAll('.sidebar-item:not(.logout-item)');
    const tabContents = document.querySelectorAll('.tab-content');

    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active state in sidebar
            sidebarItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Hide all tabs
            tabContents.forEach(tab => tab.classList.remove('active'));

            // Show selected tab
            const targetId = item.getAttribute('data-target');
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.add('active');

            // Call appropriate load function
            if (targetId === 'tab-dashboard') loadDashboard();
            if (targetId === 'tab-products') loadProducts();
            if (targetId === 'tab-users') loadUsers();
            if (targetId === 'tab-logs') loadLogs();

            // Close sidebar on mobile
            document.body.classList.remove('sidebar-open');
        });
    });
}

// ========== Mobile Menu ==========
function initMobileMenu() {
    const hamburger = document.getElementById('hamburger-btn');
    const overlay = document.querySelector('.sidebar-overlay');

    if (hamburger) {
        hamburger.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-open');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            document.body.classList.remove('sidebar-open');
        });
    }
}

// ========== Modal System ==========
function initModals() {
    const overlay = document.getElementById('balance-modal-overlay');
    const modal = document.getElementById('balance-modal');
    const closeBtns = [document.getElementById('close-modal-btn'), document.getElementById('cancel-modal-btn')];

    function closeModal() {
        if (modal) modal.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
        setTimeout(() => {
            if (modal) modal.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
        }, 300);
    }

    closeBtns.forEach(btn => {
        if (btn) btn.addEventListener('click', closeModal);
    });

    if (overlay) overlay.addEventListener('click', closeModal);

    const confirmBtn = document.getElementById('confirm-balance-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            const userId = document.getElementById('modal-user-id').value;
            const amount = parseFloat(document.getElementById('modal-amount').value);
            const reason = document.getElementById('modal-reason').value;

            if (isNaN(amount) || !reason.trim()) {
                showToast('Amount and reason are required', 'error');
                return;
            }

            try {
                const res = await fetch(`/api/users/${userId}/balance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount, reason })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to update balance');

                showToast('Balance updated successfully', 'success');
                closeModal();
                loadUsers();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }
}

function openBalanceModal(userId, username, currentBalance) {
    document.getElementById('modal-user-id').value = userId;
    document.getElementById('modal-username').innerText = username;
    document.getElementById('modal-current-balance').innerText = formatNumber(currentBalance);
    document.getElementById('modal-amount').value = '';
    document.getElementById('modal-reason').value = '';

    const modal = document.getElementById('balance-modal');
    const overlay = document.getElementById('balance-modal-overlay');

    modal.style.display = 'block';
    overlay.style.display = 'block';

    // Trigger reflow for animation
    void modal.offsetWidth;

    modal.classList.add('show');
    overlay.classList.add('show');
}

// Make globally accessible (no ES module export)
window.openBalanceModal = openBalanceModal;

let salesChartInstance = null;

// ========== Dashboard ==========
async function loadDashboard() {
    try {
        // Fetch Users stats
        const usersRes = await fetch('/api/users');
        if (usersRes.ok) {
            const users = await usersRes.json();
            const statUsers = document.getElementById('stat-users');
            const statBalance = document.getElementById('stat-balance');
            if (statUsers) statUsers.innerText = formatNumber(users.length);
            const totalBalance = users.reduce((sum, u) => sum + (Number(u.balance_npr) || 0), 0);
            if (statBalance) statBalance.innerText = formatNumber(totalBalance);
        }

        // Fetch Products stats
        const prodRes = await fetch('/api/products');
        if (prodRes.ok) {
            const products = await prodRes.json();
            const statProducts = document.getElementById('stat-products');
            if (statProducts) statProducts.innerText = formatNumber(products.length);
        }

        // Fetch Settings
        const setRes = await fetch('/api/settings');
        if (setRes.ok) {
            const settings = await setRes.json();
            const rateInput = document.getElementById('setting-rate');
            const channelInput = document.getElementById('setting-channel');
            const liveSalesInput = document.getElementById('setting-live-sales');
            if (rateInput) rateInput.value = settings.usdt_to_npr_rate || '';
            if (channelInput) channelInput.value = settings.notification_channel_id || '';
            if (liveSalesInput) liveSalesInput.value = settings.live_sales_channel_id || '';
        }

        // Fetch Analytics
        const analyticsRes = await fetch('/api/analytics');
        if (analyticsRes.ok) {
            const data = await analyticsRes.json();
            
            const statSales = document.getElementById('stat-sales');
            const statDeposits = document.getElementById('stat-deposits');
            if (statSales) statSales.innerText = formatNumber(data.totalSales);
            if (statDeposits) statDeposits.innerText = formatNumber(data.totalDeposits);
            
            const topList = document.getElementById('popular-products-list');
            if (topList) {
                topList.innerHTML = '';
                if (!data.popularProducts || data.popularProducts.length === 0) {
                    topList.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 1rem;">No sales recorded yet.</div>';
                } else {
                    data.popularProducts.forEach((p, idx) => {
                        const item = document.createElement('div');
                        item.className = 'glass-card';
                        item.style.padding = '0.75rem 1rem';
                        item.style.display = 'flex';
                        item.style.justifyContent = 'space-between';
                        item.style.alignItems = 'center';
                        item.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-weight: 700; color: var(--primary); font-size: 1.125rem;">#${idx + 1}</span>
                                <span style="font-weight: 500; font-size: 0.875rem;">${p.name}</span>
                            </div>
                            <span class="badge in-stock" style="font-size: 0.75rem;">${p.qty} sold</span>
                        `;
                        topList.appendChild(item);
                    });
                }
            }
            
            const ctx = document.getElementById('salesChart');
            if (ctx && window.Chart) {
                if (salesChartInstance) {
                    salesChartInstance.destroy();
                }
                salesChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.charts.labels,
                        datasets: [
                            {
                                label: 'Sales (NPR)',
                                data: data.charts.sales,
                                borderColor: '#7c3aed',
                                backgroundColor: 'rgba(124, 58, 237, 0.1)',
                                borderWidth: 3,
                                tension: 0.3,
                                fill: true
                            },
                            {
                                label: 'Deposits (NPR)',
                                data: data.charts.deposits,
                                borderColor: '#10b981',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                borderWidth: 3,
                                tension: 0.3,
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                labels: { color: '#1e1b4b', font: { family: 'Outfit', weight: '600' } }
                            }
                        },
                        scales: {
                            x: {
                                grid: { color: 'rgba(139, 92, 246, 0.08)' },
                                ticks: { color: '#6b7280' }
                            },
                            y: {
                                grid: { color: 'rgba(139, 92, 246, 0.08)' },
                                ticks: { color: '#6b7280' }
                            }
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Dashboard load error:', err);
        showToast('Failed to load dashboard data', 'error');
    }

    // Setup Settings Save
    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const rate = parseFloat(document.getElementById('setting-rate').value);
            const channelId = document.getElementById('setting-channel').value;
            const liveSalesId = document.getElementById('setting-live-sales').value;

            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        usdt_to_npr_rate: rate, 
                        notification_channel_id: channelId,
                        live_sales_channel_id: liveSalesId
                    })
                });
                if (!res.ok) throw new Error('Failed to save settings');
                showToast('Settings saved successfully', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    }
}

// ========== Products ==========
async function saveProductOrder(orderIds) {
    try {
        const res = await fetch('/api/products/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: orderIds })
        });
        if (!res.ok) throw new Error('Failed to save product order');
        showToast('Order updated', 'success');
        loadProducts();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadProducts() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 2rem;">Loading products...</div>';

    try {
        const res = await fetch('/api/products');
        if (!res.ok) throw new Error('Failed to fetch products');
        const products = await res.json();

        grid.innerHTML = '';
        if (products.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color: var(--text-secondary); padding: 2rem;">No products found.</div>';
            return;
        }

        products.forEach(p => {
            const card = document.createElement('div');
            card.className = 'glass-card product-card';

            const custom = p.custom || {};
            const isHidden = p.hidden === true;
            const displayName = custom.name || p.name || 'Unnamed';
            const stockCount = p.stock != null ? p.stock : 0;
            const stockBadge = stockCount > 0
                ? '<span class="badge in-stock">In Stock (' + stockCount + ')</span>'
                : '<span class="badge out-of-stock">Out of Stock</span>';
            const hiddenBadge = isHidden ? '<span class="badge hidden">Hidden</span>' : '<span class="badge visible">Visible</span>';

            card.innerHTML = `
                <div class="product-header">
                    <div>
                        <div class="product-id">ID: ${p.id}</div>
                        <div class="product-name">${displayName}</div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                            ${stockBadge}
                            ${hiddenBadge}
                        </div>
                        <div style="display:flex; gap:4px;">
                            <button class="btn-secondary move-up-btn" style="padding: 4px 8px; font-size: 0.75rem;" title="Move Up">▲</button>
                            <button class="btn-secondary move-down-btn" style="padding: 4px 8px; font-size: 0.75rem;" title="Move Down">▼</button>
                        </div>
                    </div>
                </div>

                <div class="form-group mt-3">
                    <label>Custom Name</label>
                    <input type="text" class="input-field prod-name" value="${custom.name || ''}" placeholder="${p.name || 'Product name'}">
                </div>

                <div class="form-group mt-3">
                    <label>Custom Description</label>
                    <textarea class="textarea-field prod-desc" placeholder="${p.description || 'No description'}">${custom.description || ''}</textarea>
                </div>

                <div class="form-group mt-3">
                    <label>Custom Price (NPR)</label>
                    <input type="number" class="input-field prod-price" value="${custom.price || ''}" step="0.01" placeholder="Auto from USDT">
                </div>

                <div class="flex-between mt-3 mb-3">
                    <label>Hide Product</label>
                    <label class="toggle-switch">
                        <input type="checkbox" class="prod-hidden" ${isHidden ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <button class="btn-primary w-100 save-prod-btn">Save Changes</button>
            `;

            card.querySelector('.move-up-btn').addEventListener('click', async () => {
                const idx = products.indexOf(p);
                if (idx > 0) {
                    products.splice(idx, 1);
                    products.splice(idx - 1, 0, p);
                    await saveProductOrder(products.map(item => String(item.id)));
                }
            });

            card.querySelector('.move-down-btn').addEventListener('click', async () => {
                const idx = products.indexOf(p);
                if (idx < products.length - 1) {
                    products.splice(idx, 1);
                    products.splice(idx + 1, 0, p);
                    await saveProductOrder(products.map(item => String(item.id)));
                }
            });

            card.querySelector('.save-prod-btn').addEventListener('click', async () => {
                const nameVal = card.querySelector('.prod-name').value.trim();
                const descVal = card.querySelector('.prod-desc').value.trim();
                const priceVal = card.querySelector('.prod-price').value;
                const hiddenVal = card.querySelector('.prod-hidden').checked;

                const body = {
                    product_id: String(p.id),
                    name: nameVal || null,
                    description: descVal || null,
                    price: priceVal ? parseFloat(priceVal) : null,
                    hidden: hiddenVal
                };

                try {
                    const res = await fetch('/api/product', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (!res.ok) throw new Error('Failed to update product');
                    showToast('Product updated', 'success');
                    loadProducts();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });

            grid.appendChild(card);
        });
    } catch (err) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--danger); padding: 2rem;">${err.message}</div>`;
        showToast('Failed to load products', 'error');
    }
}

// ========== Users ==========
let allUsers = [];

async function loadUsers() {
    const list = document.getElementById('users-list');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading users...</div>';

    try {
        const res = await fetch('/api/users');
        if (!res.ok) throw new Error('Failed to fetch users');
        allUsers = await res.json();
        renderUsers(allUsers);
    } catch (err) {
        list.innerHTML = `<div style="text-align:center; color: var(--danger); padding: 2rem;">${err.message}</div>`;
        showToast('Failed to load users', 'error');
    }

    // Setup Search
    const searchInput = document.getElementById('user-search');
    if (searchInput) {
        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allUsers.filter(u =>
                (u.id && u.id.toLowerCase().includes(query)) ||
                (u.username && u.username.toLowerCase().includes(query))
            );
            renderUsers(filtered);
        };
    }
}

function renderUsers(users) {
    const list = document.getElementById('users-list');
    if (!list) return;
    list.innerHTML = '';

    if (users.length === 0) {
        list.innerHTML = '<div style="text-align:center; color: var(--text-secondary); padding: 2rem;">No users found.</div>';
        return;
    }

    users.forEach(u => {
        const card = document.createElement('div');
        card.className = 'glass-card user-card';

        const historyArr = u.purchase_history || [];
        const historyCount = historyArr.length;

        let historyHTML = '<div class="user-history" style="display:none;">';
        if (historyCount > 0) {
            historyArr.forEach(ph => {
                historyHTML += `<div class="history-item">
                    <span><strong>${ph.product || ph.item_name || 'Unknown'}</strong> — Qty: ${ph.quantity || 1} — ${ph.price || 0} NPR</span>
                    <span class="log-time">${formatDate(ph.date)}</span>
                </div>`;
            });
        } else {
            historyHTML += '<div class="history-item" style="color: var(--text-secondary);">No purchases yet.</div>';
        }
        historyHTML += '</div>';

        const lastClaim = u.last_daily_claim ? formatDate(new Date(u.last_daily_claim).toISOString()) : 'Never';

        card.innerHTML = `
            <div class="user-card-header">
                <div class="user-info">
                    <h3>${u.username || 'Unknown'} <span class="user-id">(${u.id})</span></h3>
                    <div class="user-stats">
                        <span>Balance: <b>${formatNumber(u.balance_npr)}</b> NPR</span>
                        <span>Points: <b>${u.loyalty_points || 0}</b></span>
                        <span>Purchases: <b>${historyCount}</b></span>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn-secondary toggle-history-btn">View History</button>
                    <button class="btn-primary adjust-balance-btn">Adjust Balance</button>
                </div>
            </div>
            ${historyHTML}
        `;

        card.querySelector('.toggle-history-btn').addEventListener('click', (e) => {
            const histDiv = card.querySelector('.user-history');
            if (histDiv.style.display === 'none') {
                histDiv.style.display = 'block';
                e.target.innerText = 'Hide History';
            } else {
                histDiv.style.display = 'none';
                e.target.innerText = 'View History';
            }
        });

        card.querySelector('.adjust-balance-btn').addEventListener('click', () => {
            openBalanceModal(u.id, u.username || u.id, u.balance_npr || 0);
        });

        list.appendChild(card);
    });
}

// ========== Logs ==========
let allLogs = [];

async function loadLogs() {
    const feed = document.getElementById('logs-feed');
    if (!feed) return;
    feed.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading logs...</div>';

    try {
        const res = await fetch('/api/logs');
        if (!res.ok) throw new Error('Failed to fetch logs');
        allLogs = await res.json();
        renderLogs(allLogs);
    } catch (err) {
        feed.innerHTML = `<div style="text-align:center; color: var(--danger); padding: 2rem;">${err.message}</div>`;
        showToast('Failed to load logs', 'error');
    }

    // Setup Filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filterType = btn.getAttribute('data-filter');
            if (filterType === 'all') {
                renderLogs(allLogs);
            } else {
                renderLogs(allLogs.filter(l => l.action === filterType));
            }
        };
    });
}

function renderLogs(logs) {
    const feed = document.getElementById('logs-feed');
    if (!feed) return;
    feed.innerHTML = '';

    if (logs.length === 0) {
        feed.innerHTML = '<div style="text-align:center; color: var(--text-secondary); padding: 2rem;">No logs found.</div>';
        return;
    }

    logs.forEach(log => {
        const entry = document.createElement('div');

        // Determine type class for colored left border
        let typeClass = 'type-other';
        if (log.action === 'balance_adjust') typeClass = 'type-balance';
        else if (log.action === 'product_update') typeClass = 'type-product';
        else if (log.action === 'settings_update') typeClass = 'type-settings';

        entry.className = `log-entry ${typeClass}`;

        // Build description based on action type
        let actionText = log.action || 'Unknown action';
        let detailsText = '';

        if (log.action === 'balance_adjust') {
            const sign = log.amount >= 0 ? '+' : '';
            actionText = `Balance Adjustment`;
            detailsText = `User: ${log.username || log.targetUser_id || 'Unknown'} (${log.targetUser_id || ''}) — ${sign}${log.amount} NPR → New balance: ${formatNumber(log.newBalance)} NPR`;
            if (log.reason) detailsText += ` — Reason: ${log.reason}`;
        } else if (log.action === 'product_update') {
            actionText = `Product Updated`;
            detailsText = `Product ID: ${log.product_id || 'Unknown'}`;
            if (log.changes) {
                if (log.changes.hidden !== undefined) detailsText += ` — Hidden: ${log.changes.hidden}`;
                if (log.changes.custom && typeof log.changes.custom === 'object') {
                    if (log.changes.custom.name) detailsText += ` — Name: ${log.changes.custom.name}`;
                    if (log.changes.custom.price) detailsText += ` — Price: ${log.changes.custom.price} NPR`;
                }
            }
        } else if (log.action === 'settings_update') {
            actionText = `Settings Changed`;
            const details = log.details || {};
            const parts = [];
            if (details.usdt_to_npr_rate !== undefined) parts.push(`Rate: ${details.usdt_to_npr_rate}`);
            if (details.notification_channel_id !== undefined) parts.push(`Channel: ${details.notification_channel_id}`);
            detailsText = parts.join(' — ') || 'Settings updated';
        }

        entry.innerHTML = `
            <div class="log-time">${formatDate(log.timestamp)}</div>
            <div class="log-action">${actionText}</div>
            <div class="log-details">${detailsText}</div>
        `;

        feed.appendChild(entry);
    });
}
