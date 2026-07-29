function initApp() {
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

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
            if (targetId === 'tab-settings') loadSettings();

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

    // Setup Add Local Product Modal
    const addLocalBtn = document.getElementById('add-local-product-btn');
    const localOverlay = document.getElementById('local-product-modal-overlay');
    const localModal = document.getElementById('local-product-modal');
    const closeLocalBtns = [document.getElementById('close-local-modal-btn'), document.getElementById('cancel-local-modal-btn')];
    const confirmLocalBtn = document.getElementById('confirm-local-product-btn');

    function openLocalModal() {
        document.getElementById('local-modal-name').value = '';
        document.getElementById('local-modal-desc').value = '';
        document.getElementById('local-modal-price').value = '';
        document.getElementById('local-modal-stock').value = '';
        if (localOverlay) {
            localOverlay.style.display = 'block';
            localOverlay.offsetHeight;
            localOverlay.classList.add('show');
        }
        if (localModal) {
            localModal.style.display = 'block';
            localModal.offsetHeight;
            localModal.classList.add('show');
        }
    }

    function closeLocalModal() {
        if (localModal) localModal.classList.remove('show');
        if (localOverlay) localOverlay.classList.remove('show');
        setTimeout(() => {
            if (localModal) localModal.style.display = 'none';
            if (localOverlay) localOverlay.style.display = 'none';
        }, 300);
    }

    if (addLocalBtn) addLocalBtn.onclick = openLocalModal;
    closeLocalBtns.forEach(btn => { if (btn) btn.onclick = closeLocalModal; });
    if (localOverlay) localOverlay.onclick = closeLocalModal;

    if (confirmLocalBtn) {
        confirmLocalBtn.onclick = async () => {
            const name = document.getElementById('local-modal-name').value.trim();
            const desc = document.getElementById('local-modal-desc').value.trim();
            const price = parseFloat(document.getElementById('local-modal-price').value);
            const stockVal = document.getElementById('local-modal-stock').value;
            const stockLines = stockVal.split('\n').map(l => l.trim()).filter(Boolean);
            const infiniteVal = document.getElementById('local-modal-infinite').checked;

            if (!name || isNaN(price)) {
                showToast('Product name and price are required', 'error');
                return;
            }

            try {
                const res = await fetch('/api/products/local', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, description: desc, price, stockLines, infinite_stock: infiniteVal })
                });
                if (!res.ok) throw new Error('Failed to create local product');
                showToast('Local product created successfully', 'success');
                closeLocalModal();
                loadProducts();
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
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
                    const totalQtySold = data.popularProducts.reduce((sum, p) => sum + p.qty, 0);
                    data.popularProducts.forEach((p, idx) => {
                        const percentage = totalQtySold > 0 ? Math.round((p.qty / totalQtySold) * 100) : 0;
                        const item = document.createElement('div');
                        item.className = 'glass-card';
                        item.style.padding = '1rem';
                        item.style.display = 'flex';
                        item.style.flexDirection = 'column';
                        item.style.gap = '8px';
                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-weight: 700; color: var(--primary); font-size: 1.125rem;">#${idx + 1}</span>
                                    <span style="font-weight: 500;">${p.name}</span>
                                </div>
                                <span class="badge in-stock" style="font-size: 0.75rem;">${p.qty} sold (${percentage}%)</span>
                            </div>
                            <div style="background: rgba(255, 255, 255, 0.08); height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
                                <div style="background: linear-gradient(90deg, var(--primary), #a78bfa); height: 100%; width: ${percentage}%; border-radius: 4px;"></div>
                            </div>
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
}

// ========== Settings ==========
async function loadSettings() {
    try {
        const setRes = await fetch('/api/settings');
        if (setRes.ok) {
            const settings = await setRes.json();
            const rateInput = document.getElementById('setting-rate');
            const channelInput = document.getElementById('setting-channel');
            const liveSalesInput = document.getElementById('setting-live-sales');
            const availableProductsInput = document.getElementById('setting-available-products');
            const backupChannelInput = document.getElementById('setting-backup-channel');
            const earnInput = document.getElementById('setting-loyalty-earn');
            const redeemInput = document.getElementById('setting-loyalty-redeem');
            const themeColorInput = document.getElementById('setting-theme-color');
            const themeColorPicker = document.getElementById('setting-theme-color-picker');
            const menuBannerInput = document.getElementById('setting-menu-banner');
            const menuThumbnailInput = document.getElementById('setting-menu-thumbnail');

            if (rateInput) rateInput.value = settings.usdt_to_npr_rate || '';
            if (channelInput) channelInput.value = settings.notification_channel_id || '';
            if (liveSalesInput) liveSalesInput.value = settings.live_sales_channel_id || '';
            if (availableProductsInput) availableProductsInput.value = settings.available_products_channel_id || '';
            if (backupChannelInput) backupChannelInput.value = settings.backup_channel_id || '';
            if (earnInput) earnInput.value = settings.loyalty_earn_rate || '';
            if (redeemInput) redeemInput.value = settings.loyalty_redeem_rate || '';
            
            if (themeColorInput) {
                themeColorInput.value = settings.shop_theme_color || '#8b5cf6';
                if (themeColorPicker) {
                    themeColorPicker.value = settings.shop_theme_color || '#8b5cf6';
                    themeColorPicker.oninput = (e) => {
                        themeColorInput.value = e.target.value;
                    };
                    themeColorInput.oninput = (e) => {
                        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                            themeColorPicker.value = e.target.value;
                        }
                    };
                }
            }
            if (menuBannerInput) menuBannerInput.value = settings.shop_menu_banner || '';
            if (menuThumbnailInput) menuThumbnailInput.value = settings.shop_menu_thumbnail || '';
        }
    } catch (err) {
        showToast('Failed to load settings', 'error');
    }
}
    // Setup Settings Save
    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const rate = parseFloat(document.getElementById('setting-rate').value);
            const channelId = document.getElementById('setting-channel').value;
            const liveSalesId = document.getElementById('setting-live-sales').value;
            const availableProductsId = document.getElementById('setting-available-products').value;
            const backupChannelId = document.getElementById('setting-backup-channel').value;
            const earnRate = parseInt(document.getElementById('setting-loyalty-earn').value);
            const redeemRate = parseInt(document.getElementById('setting-loyalty-redeem').value);
            const themeColor = document.getElementById('setting-theme-color').value;
            const menuBanner = document.getElementById('setting-menu-banner').value;
            const menuThumbnail = document.getElementById('setting-menu-thumbnail').value;

            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        usdt_to_npr_rate: rate, 
                        notification_channel_id: channelId,
                        live_sales_channel_id: liveSalesId,
                        available_products_channel_id: availableProductsId,
                        backup_channel_id: backupChannelId,
                        loyalty_earn_rate: isNaN(earnRate) ? null : earnRate,
                        loyalty_redeem_rate: isNaN(redeemRate) ? null : redeemRate,
                        shop_theme_color: themeColor,
                        shop_menu_banner: menuBanner,
                        shop_menu_thumbnail: menuThumbnail
                    })
                });
                if (!res.ok) throw new Error('Failed to save settings');
                showToast('Settings saved successfully', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    }

    // Manual Backup Trigger
    const backupBtn = document.getElementById('trigger-backup-btn');
    if (backupBtn) {
        backupBtn.onclick = async () => {
            backupBtn.disabled = true;
            backupBtn.innerText = 'Backing up...';
            try {
                const res = await fetch('/api/backup', { method: 'POST' });
                if (!res.ok) throw new Error('Backup failed');
                showToast('Database backup triggered successfully!', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                backupBtn.disabled = false;
                backupBtn.innerText = 'Backup Database Now';
            }
        };
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
            card.setAttribute('data-name', displayName.toLowerCase());
            const isLocal = p.is_local === true;
            const isInfinite = p.infinite_stock === true;
            const stockCount = p.stock != null ? p.stock : 0;
            const stockBadge = isInfinite
                ? '<span class="badge in-stock" style="background-color:#d1fae5; color:#065f46; border-color:#a7f3d0;">Infinite Stock</span>'
                : (stockCount > 0
                    ? '<span class="badge in-stock">In Stock (' + stockCount + ')</span>'
                    : '<span class="badge out-of-stock">Out of Stock</span>');
            const hiddenBadge = isHidden ? '<span class="badge hidden">Hidden</span>' : '<span class="badge visible">Visible</span>';

            let stockHtml = '';
            if (isLocal) {
                const singleLink = isInfinite && p.stock_list && p.stock_list[0] ? p.stock_list[0] : '';
                stockHtml = `
                    <div class="form-group mt-3">
                        <label>${isInfinite ? 'Reusable Link / Code' : 'Add Stock (One link/code per line)'}</label>
                        <textarea class="textarea-field prod-stock" style="min-height: 80px;" placeholder="${isInfinite ? 'Enter single reusable link here...' : 'Paste new stock lines here to ADD to current stock...'}">${singleLink}</textarea>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">${isInfinite ? 'Reusable stock uses only the first link. Pasting a new one here will overwrite it.' : 'Leaving this empty keeps current stock intact.'}</div>
                    </div>

                    <div class="flex-between mt-3 mb-3">
                        <label>Infinite / Reusable Stock</label>
                        <label class="toggle-switch">
                            <input type="checkbox" class="prod-infinite" ${isInfinite ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="product-header">
                    <div>
                        <div class="product-id">ID: ${p.id} ${isLocal ? '<span class="badge" style="background-color:#e0e7ff; color:#4f46e5; border-color:#c7d2fe; margin-left: 4px;">Local</span>' : ''}</div>
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
                    <label>${isLocal ? 'Product Name' : 'Custom Name'}</label>
                    <input type="text" class="input-field prod-name" value="${isLocal ? p.name : (custom.name || '')}" placeholder="${isLocal ? '' : (p.name || 'Product name')}">
                </div>

                <div class="form-group mt-3">
                    <label>${isLocal ? 'Product Description' : 'Custom Description'}</label>
                    <textarea class="textarea-field prod-desc" placeholder="Product description">${isLocal ? (p.description || '') : (custom.description || '')}</textarea>
                </div>

                <div class="form-group mt-3">
                    <label>${isLocal ? 'Price (NPR)' : 'Custom Price (NPR)'}</label>
                    <input type="number" class="input-field prod-price" value="${isLocal ? (custom.price || '') : (custom.price || '')}" step="0.01" placeholder="${isLocal ? 'Price in NPR' : 'Auto from USDT'}">
                </div>

                ${stockHtml}

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

                if (p.is_local) {
                    const stockInput = card.querySelector('.prod-stock');
                    const stockLines = stockInput ? stockInput.value.split('\n').map(l => l.trim()).filter(Boolean) : [];
                    const infiniteVal = card.querySelector('.prod-infinite').checked;

                    const body = {
                        name: nameVal || p.name,
                        description: descVal || p.description,
                        price: priceVal ? parseFloat(priceVal) : p.price,
                        hidden: hiddenVal,
                        addStockLines: stockLines,
                        infinite_stock: infiniteVal
                    };

                    try {
                        const res = await fetch(`/api/products/local/${p.id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        if (!res.ok) throw new Error('Failed to update local product');
                        showToast('Local product updated', 'success');
                        loadProducts();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                } else {
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
                }
            });

            // Reorder Controls
            const reorderContainer = document.createElement('div');
            reorderContainer.style.display = 'flex';
            reorderContainer.style.gap = '8px';
            reorderContainer.className = 'mt-2';

            const upBtn = document.createElement('button');
            upBtn.className = 'btn-secondary w-50';
            upBtn.innerText = '🔼 Up';
            upBtn.disabled = products.indexOf(p) === 0;
            upBtn.onclick = async () => {
                const index = products.indexOf(p);
                if (index > 0) {
                    const temp = products[index];
                    products[index] = products[index - 1];
                    products[index - 1] = temp;
                    await saveProductOrder(products.map(item => String(item.id)));
                }
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'btn-secondary w-50';
            downBtn.innerText = '🔽 Down';
            downBtn.disabled = products.indexOf(p) === products.length - 1;
            downBtn.onclick = async () => {
                const index = products.indexOf(p);
                if (index < products.length - 1) {
                    const temp = products[index];
                    products[index] = products[index + 1];
                    products[index + 1] = temp;
                    await saveProductOrder(products.map(item => String(item.id)));
                }
            };

            reorderContainer.appendChild(upBtn);
            reorderContainer.appendChild(downBtn);
            card.appendChild(reorderContainer);

            if (p.is_local) {
                // Stock Manager Button
                const stockBtn = document.createElement('button');
                stockBtn.className = 'btn-secondary w-100 mt-2';
                stockBtn.innerText = '🔑 Manage Stock Keys';
                stockBtn.onclick = () => {
                    openStockModal(p.id, displayName);
                };
                card.appendChild(stockBtn);

                const delBtn = document.createElement('button');
                delBtn.className = 'btn-secondary w-100 mt-2';
                delBtn.style.color = '#ef4444';
                delBtn.style.borderColor = '#fee2e2';
                delBtn.innerText = 'Delete Product';
                delBtn.onclick = async () => {
                    if (!confirm('Are you sure you want to delete this product?')) return;
                    try {
                        const res = await fetch(`/api/products/local/${p.id}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('Failed to delete product');
                        showToast('Product deleted', 'success');
                        loadProducts();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                };
                card.appendChild(delBtn);
            }

            grid.appendChild(card);
        });

        const searchInput = document.getElementById('product-search');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase().trim();
                const cards = grid.querySelectorAll('.product-card');
                cards.forEach(c => {
                    const name = c.getAttribute('data-name') || '';
                    if (name.includes(query)) {
                        c.style.display = 'block';
                    } else {
                        c.style.display = 'none';
                    }
                });
            };
        }
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
                (u.discord_id && u.discord_id.toLowerCase().includes(query)) ||
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

        let historyHTML = '<div class="user-history" style="display:none; padding: 15px; border-top: 1px solid var(--border-color);">';
        if (historyCount > 0) {
            historyHTML += `
                <input type="text" class="input-field history-search-input mb-3" style="padding: 6px 12px; font-size: 0.85rem;" placeholder="Search purchases by product name or date...">
                <div class="history-items-container">
            `;
            historyArr.forEach(ph => {
                const prodName = ph.product || ph.item_name || 'Unknown';
                const formattedDate = formatDate(ph.date);
                historyHTML += `<div class="history-item" data-product="${prodName.toLowerCase()}" data-date="${formattedDate.toLowerCase()}">
                    <span><strong>${prodName}</strong> — Qty: ${ph.quantity || 1} — ${ph.price || 0} NPR</span>
                    <span class="log-time">${formattedDate}</span>
                </div>`;
            });
            historyHTML += `</div>`;
        } else {
            historyHTML += '<div class="history-item" style="color: var(--text-secondary);">No purchases yet.</div>';
        }
        historyHTML += '</div>';

        const lastClaim = u.last_daily_claim ? formatDate(new Date(u.last_daily_claim).toISOString()) : 'Never';

        card.innerHTML = `
            <div class="user-card-header">
                <div class="user-info">
                    <h3>${u.username || 'Unknown'} <span class="user-id">(${u.discord_id})</span></h3>
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

        const searchInput = card.querySelector('.history-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const items = card.querySelectorAll('.history-item');
                items.forEach(item => {
                    const prod = item.getAttribute('data-product') || '';
                    const dt = item.getAttribute('data-date') || '';
                    if (prod.includes(query) || dt.includes(query)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }

        card.querySelector('.adjust-balance-btn').addEventListener('click', () => {
            openBalanceModal(u.discord_id, u.username || u.discord_id, u.balance_npr || 0);
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

// Clean Session Cache Button Event
const cleanSessionsBtn = document.getElementById('clean-sessions-btn');
if (cleanSessionsBtn) {
    cleanSessionsBtn.onclick = async () => {
        if (!confirm('Are you sure you want to log out all other administrators and clear database session caches?')) return;
        cleanSessionsBtn.disabled = true;
        cleanSessionsBtn.innerText = 'Clearing sessions...';
        try {
            const res = await fetch('/api/clean-sessions', { method: 'POST' });
            if (!res.ok) throw new Error('Clean session failed');
            showToast('All login sessions successfully cleared!', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            cleanSessionsBtn.disabled = false;
            cleanSessionsBtn.innerText = 'Clean Session Cache';
        }
    };
}

// Manage Stock Keys Modal Events
const stockModalOverlay = document.getElementById('stock-modal-overlay');
const stockModal = document.getElementById('stock-modal');
const closeStockModalBtn = document.getElementById('close-stock-modal-btn');

if (closeStockModalBtn) {
    closeStockModalBtn.onclick = () => {
        stockModalOverlay.style.display = 'none';
        stockModal.style.display = 'none';
    };
}
if (stockModalOverlay) {
    stockModalOverlay.onclick = () => {
        stockModalOverlay.style.display = 'none';
        stockModal.style.display = 'none';
    };
}

async function openStockModal(productId, productName) {
    const titleEl = document.getElementById('stock-modal-product-name');
    const container = document.getElementById('stock-keys-container');
    if (titleEl) titleEl.innerText = productName;
    if (container) container.innerHTML = '<div style="text-align:center; padding:1rem;">Loading keys...</div>';

    stockModalOverlay.style.display = 'block';
    stockModal.style.display = 'block';

    try {
        const res = await fetch(`/api/products/local/${productId}/stock`);
        if (!res.ok) throw new Error('Failed to load keys');
        const data = await res.json();
        
        container.innerHTML = '';
        if (!data.keys || data.keys.length === 0) {
            container.innerHTML = '<div style="text-align:center; color: var(--text-secondary); padding:1rem;">No keys in stock.</div>';
            return;
        }

        data.keys.forEach((key, idx) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px 12px';
            row.style.background = 'rgba(255,255,255,0.04)';
            row.style.borderRadius = '4px';
            row.style.border = '1px solid var(--border-color)';
            
            row.innerHTML = `
                <span style="font-family: monospace; font-size: 0.9rem; word-break: break-all; margin-right: 10px;">${key}</span>
                <button class="btn-secondary" style="color:#ef4444; border-color:#fee2e2; padding: 4px 8px; font-size: 0.8rem; flex-shrink: 0;">Delete</button>
            `;

            row.querySelector('button').onclick = async () => {
                if (!confirm('Are you sure you want to delete this stock key?')) return;
                try {
                    const delRes = await fetch(`/api/products/local/${productId}/stock/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ index: idx })
                    });
                    if (!delRes.ok) throw new Error('Failed to delete key');
                    showToast('Stock key deleted', 'success');
                    openStockModal(productId, productName); // Reload keys list
                    loadProducts(); // Refresh stock badge on main view
                } catch (err) {
                    showToast(err.message, 'error');
                }
            };

            container.appendChild(row);
        });
    } catch (err) {
        container.innerHTML = `<div style="text-align:center; color:var(--danger); padding:1rem;">${err.message}</div>`;
    }
}
