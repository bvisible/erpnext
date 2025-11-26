/**
 * POS Viewer - External page for viewing POS cart in real-time
 * Uses localStorage for API key persistence and WebSocket for real-time updates
 */

class POSViewer {
	constructor() {
		this.apiKey = null;
		this.currentUser = null;
		this.selectedProfile = null;
		this.posOpeningEntry = null;
		this.realtimeConnected = false;
		this.pollingInterval = null;
		this.currentCart = null;
		this.previousCartItemCount = 0; // Track previous cart state for transitions
		this.isPolling = false; // Flag to disable animations during polling
		this.thankYouVisible = false; // Track if thank you message is shown
		this.lastSeenInvoice = null; // Track last completed invoice to detect new sales
		this.currency = 'CHF'; // Default currency
		this.country = 'Switzerland'; // Default country
		this.phoneInput = null; // intl-tel-input instance
		this.twintDialog = null; // Twint payment dialog
		this.twintStatusInterval = null; // Twint status check interval
		this.twintCheckInterval = null; // Twint payment check interval
		this.headerAutoHideTimer = null; // Auto-hide timer for header
		this.headerVisible = false; // Header visibility state
		this.inAppAds = []; // In-App Ads for slider
		this.currentAdIndex = 0; // Current ad being displayed
		this.adsSliderInterval = null; // Auto-rotate ads interval

		// LocalStorage keys
		this.STORAGE_KEY_API = 'pos_viewer_api_key';
		this.STORAGE_KEY_PROFILE = 'pos_viewer_selected_profile';

		this.init();
	}

	init() {
		// Load saved credentials
		this.apiKey = localStorage.getItem(this.STORAGE_KEY_API);
		this.selectedProfile = localStorage.getItem(this.STORAGE_KEY_PROFILE);

		// Setup event listeners
		this.setupEventListeners();

		// Check authentication
		if (this.apiKey) {
			this.validateAndConnect();
		} else {
			this.showAuthModal();
		}
	}

	setupEventListeners() {
		// Auth modal
		document.getElementById('auth-submit-btn').addEventListener('click', () => this.handleAuth());
		document.getElementById('api-key-input').addEventListener('keypress', (e) => {
			if (e.key === 'Enter') this.handleAuth();
		});

		// Logout with confirmation
		document.getElementById('logout-btn').addEventListener('click', () => {
			if (confirm('Are you sure you want to disconnect?')) {
				this.logout();
			}
		});

		// POS Profile selection with confirmation
		document.getElementById('pos-profile-select').addEventListener('change', (e) => {
			const newProfile = e.target.value;
			const currentProfile = this.selectedProfile;

			// If a profile is already selected, ask for confirmation
			if (currentProfile && currentProfile !== newProfile) {
				if (confirm('Are you sure you want to change the POS profile?')) {
					this.handleProfileChange(newProfile);
				} else {
					// Revert the selection
					e.target.value = currentProfile;
				}
			} else {
				this.handleProfileChange(newProfile);
			}
		});

		// Customer modal
		document.getElementById('create-customer-btn').addEventListener('click', () => this.showCustomerModal());
		document.getElementById('close-customer-modal').addEventListener('click', () => this.hideCustomerModal());
		document.getElementById('cancel-customer-btn').addEventListener('click', () => this.hideCustomerModal());
		document.getElementById('save-customer-btn').addEventListener('click', () => this.createCustomer());

		// Customer form submit on Enter
		document.getElementById('customer-form').addEventListener('submit', (e) => {
			e.preventDefault();
			this.createCustomer();
		});

		// Customer type switch
		document.querySelectorAll('input[name="customer-type"]').forEach(radio => {
			radio.addEventListener('change', (e) => this.handleCustomerTypeChange(e.target.value));
		});

		// Header toggle button
		const headerToggleBtn = document.getElementById('header-toggle-btn');
		if (headerToggleBtn) {
			headerToggleBtn.addEventListener('click', () => this.toggleHeader());
		}
	}

	showAuthModal() {
		document.getElementById('auth-modal').style.display = 'flex';
		document.getElementById('main-content').style.display = 'none';
		document.getElementById('api-key-input').focus();
	}

	hideAuthModal() {
		document.getElementById('auth-modal').style.display = 'none';
		document.getElementById('main-content').style.display = 'block';
	}

	async handleAuth() {
		const apiKeyInput = document.getElementById('api-key-input');
		const password = apiKeyInput.value.trim();
		const submitBtn = document.getElementById('auth-submit-btn');
		const errorDiv = document.getElementById('auth-error');

		if (!password) {
			this.showError(errorDiv, 'Please enter your password');
			return;
		}

		// Automatically prepend the fixed API key
		const apiKey = '06fd969c2755b58:' + password;

		// Show loading state
		this.setButtonLoading(submitBtn, true);
		errorDiv.style.display = 'none';

		try {
			const response = await this.callMethod('erpnext.www.pos-viewer.index.validate_api_key', {
				api_key_string: apiKey
			});

			if (response.valid) {
				// Store credentials
				localStorage.setItem(this.STORAGE_KEY_API, apiKey);
				this.apiKey = apiKey;
				this.currentUser = response.user;

				// Hide modal and load main content
				this.hideAuthModal();
				this.displayUserInfo(response);
				await this.loadPOSProfiles();
				await this.loadInAppAds();
			} else {
				this.showError(errorDiv, response.message || 'Incorrect password');
			}
		} catch (error) {
			console.error('Auth error:', error);
			this.showError(errorDiv, 'Connection error. Please try again.');
		} finally {
			this.setButtonLoading(submitBtn, false);
		}
	}

	async validateAndConnect() {
		try {
			const response = await this.callMethod('erpnext.www.pos-viewer.index.validate_api_key', {
				api_key_string: this.apiKey
			});

			if (response.valid) {
				this.currentUser = response.user;
				this.hideAuthModal();
				this.displayUserInfo(response);
				await this.loadPOSProfiles();
				await this.loadInAppAds();
			} else {
				// Invalid credentials, clear and show auth
				this.logout();
			}
		} catch (error) {
			console.error('Validation error:', error);
			this.logout();
		}
	}

	displayUserInfo(userInfo) {
		// User name removed from display
	}

	async loadPOSProfiles() {
		try {
			const data = await this.callMethod('erpnext.www.pos-viewer.index.get_pos_profiles');
			const select = document.getElementById('pos-profile-select');
			select.innerHTML = '';

			if (data.profiles && data.profiles.length > 0) {
				data.profiles.forEach(profile => {
					const option = document.createElement('option');
					option.value = profile.name;
					option.textContent = `${profile.name} (${profile.company})`;
					option.dataset.country = profile.country || 'Switzerland';
					select.appendChild(option);
				});

				// Set saved or default profile
				if (this.selectedProfile && data.profiles.find(p => p.name === this.selectedProfile)) {
					select.value = this.selectedProfile;
				} else if (data.default_profile) {
					select.value = data.default_profile;
					this.selectedProfile = data.default_profile;
					localStorage.setItem(this.STORAGE_KEY_PROFILE, data.default_profile);
				} else {
					select.value = data.profiles[0].name;
					this.selectedProfile = data.profiles[0].name;
					localStorage.setItem(this.STORAGE_KEY_PROFILE, data.profiles[0].name);
				}

				// Store country from selected profile
				const selectedOption = select.options[select.selectedIndex];
				this.country = selectedOption.dataset.country || 'Switzerland';

				// Load POS session and start monitoring
				await this.loadPOSSession();
			} else {
				this.showAlert('No POS profiles available', 'warning');
			}
		} catch (error) {
			console.error('Error loading profiles:', error);
			this.showAlert('Failed to load POS profiles', 'danger');
		}
	}

	async handleProfileChange(profileName) {
		if (!profileName) return;

		this.selectedProfile = profileName;
		localStorage.setItem(this.STORAGE_KEY_PROFILE, profileName);

		// Disconnect from previous session
		this.disconnectRealtime();

		// Load new session
		await this.loadPOSSession();
	}

	async loadPOSSession() {
		try {
			const session = await this.callMethod('erpnext.www.pos-viewer.index.get_pos_opening_entry', {
				pos_profile: this.selectedProfile
			});

			if (session) {
				this.posOpeningEntry = session.name;
				document.getElementById('no-session-message').style.display = 'none';

				// Connect to real-time updates
				this.connectRealtime();

				// Load current cart
				await this.loadCart();
			} else {
				this.posOpeningEntry = null;
				document.getElementById('no-session-message').style.display = 'block';
				document.getElementById('cart-items-list').innerHTML = '<div class="empty-cart-message"><p class="text-muted">No active POS session</p></div>';
			}
		} catch (error) {
			console.error('Error loading POS session:', error);
			this.showAlert('Failed to load POS session', 'danger');
		}
	}

	connectRealtime() {
		if (!this.posOpeningEntry) return;

		// Setup WebSocket listener for cart updates
		const eventName = `pos_cart_updated_${this.posOpeningEntry}`;

		frappe.realtime.on(eventName, (data) => {
			console.log('Real-time cart update received:', data);
			this.updateConnectionStatus(true);
			this.loadCart();
		});

		this.updateConnectionStatus(true);
		this.realtimeConnected = true;

		// Setup polling fallback (every 5 seconds)
		this.startPolling();
	}

	disconnectRealtime() {
		if (this.posOpeningEntry) {
			const eventName = `pos_cart_updated_${this.posOpeningEntry}`;
			frappe.realtime.off(eventName);
		}
		this.stopPolling();
		this.updateConnectionStatus(false);
		this.realtimeConnected = false;
	}

	startPolling() {
		this.stopPolling();
		this.pollingInterval = setInterval(() => {
			// Always poll as fallback since WebSocket may not be available
			this.loadCart();
		}, 5000); // Poll every 5 seconds

		// Start Twint payment polling
		this.startTwintPolling();
	}

	stopPolling() {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}
	}

	updateConnectionStatus(connected) {
		const statusBadge = document.getElementById('connection-status');
		const statusText = statusBadge.querySelector('.status-text');

		if (connected) {
			statusBadge.classList.remove('disconnected');
			statusBadge.classList.add('connected');
			statusText.textContent = 'Connected';
		} else {
			statusBadge.classList.remove('connected');
			statusBadge.classList.add('disconnected');
			statusText.textContent = 'Disconnected';
		}
	}

	toggleHeader() {
		const header = document.getElementById('pos-viewer-header');
		const toggleBtn = document.getElementById('header-toggle-btn');

		if (this.headerVisible) {
			this.hideHeader();
		} else {
			this.showHeader();
		}
	}

	showHeader() {
		const header = document.getElementById('pos-viewer-header');
		const toggleBtn = document.getElementById('header-toggle-btn');

		header.classList.add('visible');
		toggleBtn.classList.add('expanded');
		this.headerVisible = true;

		// Clear any existing timer
		if (this.headerAutoHideTimer) {
			clearTimeout(this.headerAutoHideTimer);
		}

		// Auto-hide after 30 seconds
		this.headerAutoHideTimer = setTimeout(() => {
			this.hideHeader();
		}, 30000);
	}

	hideHeader() {
		const header = document.getElementById('pos-viewer-header');
		const toggleBtn = document.getElementById('header-toggle-btn');

		header.classList.remove('visible');
		toggleBtn.classList.remove('expanded');
		this.headerVisible = false;

		// Clear timer
		if (this.headerAutoHideTimer) {
			clearTimeout(this.headerAutoHideTimer);
			this.headerAutoHideTimer = null;
		}
	}

	async loadCart() {
		if (!this.posOpeningEntry) return;

		// Don't poll while thank you message is displayed
		if (this.thankYouVisible) return;

		this.isPolling = true; // Flag to disable animations during polling

		try {
			// Get current cart
			const cart = await this.callMethod('erpnext.www.pos-viewer.index.get_current_cart', {
				pos_opening_entry: this.posOpeningEntry
			});

			// Calculate current item count
			const currentItemCount = (cart && cart.items) ? cart.items.length : 0;
			const lastCompletedInvoice = cart ? cart.last_completed_invoice : null;

			// Check if a new sale was completed:
			// A new invoice exists that we haven't seen yet
			// (Don't require empty cart - cashier may have already started adding items)
			if (lastCompletedInvoice &&
				lastCompletedInvoice !== this.lastSeenInvoice &&
				this.lastSeenInvoice !== null) {
				// New sale completed! Show thank you message
				this.lastSeenInvoice = lastCompletedInvoice;

				// Clear the cart cache on server side
				this.callMethod('erpnext.www.pos-viewer.index.clear_cart_data', {
					pos_opening_entry: this.posOpeningEntry,
					sale_completed: true
				}).catch(err => console.error('Error clearing cart cache:', err));

				this.showThankYouMessage();
				this.currentCart = null;
				this.previousCartItemCount = 0;
				return;
			}

			// Update last seen invoice if we have one (for initial load)
			if (lastCompletedInvoice && !this.lastSeenInvoice) {
				this.lastSeenInvoice = lastCompletedInvoice;
			}

			// Update previous count for next comparison
			this.previousCartItemCount = currentItemCount;

			this.currentCart = cart;
			this.renderCart(cart);
		} catch (error) {
			console.error('Error loading cart:', error);
		} finally {
			this.isPolling = false;
		}
	}

	renderCart(cart) {
		const itemsList = document.getElementById('cart-items-list');
		const totalsDiv = document.getElementById('cart-totals');
		const customerDisplay = document.getElementById('customer-display');
		const cartContainer = document.querySelector('.cart-container');

		// Hide thank you message if showing cart
		this.hideThankYouMessage();

		// Add/remove no-animation class based on polling state
		if (this.isPolling && cartContainer) {
			cartContainer.classList.add('no-animation');
		} else if (cartContainer) {
			cartContainer.classList.remove('no-animation');
		}

		// Get cart header element
		const cartHeader = document.querySelector('.cart-header');

		if (!cart || !cart.items || cart.items.length === 0) {
			// Show ads slider if we have ads, otherwise show empty cart message
			if (this.inAppAds && this.inAppAds.length > 0) {
				this.renderAdsSlider(itemsList);
				// Hide cart header when showing ads
				if (cartHeader) cartHeader.style.display = 'none';
			} else {
				itemsList.innerHTML = `
					<div class="empty-cart-message">
						<svg class="icon icon-xxl text-muted">
							<use href="#icon-shopping-cart"></use>
						</svg>
						<p class="text-muted">${__('No items in cart')}</p>
						<p class="text-muted small">${__('Add items in POS to see them here')}</p>
					</div>
				`;
				// Show cart header for empty cart message
				if (cartHeader) cartHeader.style.display = '';
			}
			totalsDiv.style.display = 'none';
			return;
		}

		// Show cart header when cart has items
		if (cartHeader) cartHeader.style.display = '';

		// Stop ads slider when cart has items
		this.stopAdsSlider();

		// Update currency if available
		if (cart.currency) {
			this.currency = cart.currency;
		}

		// Render customer
		if (cart.customer) {
			customerDisplay.textContent = cart.customer_name || cart.customer;
			customerDisplay.classList.add('selected');
		} else {
			customerDisplay.textContent = 'No customer selected';
			customerDisplay.classList.remove('selected');
		}

		// Render items (reversed to show newest first)
		let itemsHTML = '';
		const reversedItems = [...cart.items].reverse();
		reversedItems.forEach(item => {
			const imageUrl = item.image || '/assets/erpnext/images/ui-states/cart-empty-state.png';
			itemsHTML += `
				<div class="cart-item">
					<div class="item-image">
						<img src="${imageUrl}" alt="${item.item_name}" onerror="this.src='/assets/erpnext/images/ui-states/cart-empty-state.png'">
					</div>
					<div class="item-details">
						<div class="item-name">${item.item_name}</div>
						<div class="item-code text-muted">${item.item_code}</div>
					</div>
					<div class="item-qty-price">
						<div class="item-quantity">
							<span class="qty-label">Qty: </span>
							<span class="qty-value">${item.qty}</span>
						</div>
						<div class="item-rate">
							<span class="rate-label">@ </span>
							<span class="rate-value">${this.formatCurrency(item.rate)}</span>
						</div>
					</div>
					<div class="item-amount">
						${this.formatCurrency(item.amount)}
					</div>
				</div>
			`;
		});
		itemsList.innerHTML = itemsHTML;

		// Render totals
		document.getElementById('total-qty').textContent = cart.total_qty || 0;
		document.getElementById('net-total').textContent = this.formatCurrency(cart.net_total);
		document.getElementById('total-taxes').textContent = this.formatCurrency(cart.total_taxes_and_charges);
		document.getElementById('grand-total').textContent = this.formatCurrency(cart.grand_total);

		// Show/hide discount row
		if (cart.discount_amount && cart.discount_amount > 0) {
			document.getElementById('discount-row').style.display = 'flex';
			document.getElementById('discount-amount').textContent = this.formatCurrency(cart.discount_amount);
		} else {
			document.getElementById('discount-row').style.display = 'none';
		}

		totalsDiv.style.display = 'block';
	}

	formatCurrency(amount) {
		if (!amount) return `${this.currency} 0.00`;
		return `${this.currency} ${parseFloat(amount).toFixed(2)}`;
	}

	showThankYouMessage() {
		// Don't show if already visible
		if (this.thankYouVisible) return;

		this.thankYouVisible = true;

		const itemsList = document.getElementById('cart-items-list');
		const totalsDiv = document.getElementById('cart-totals');
		const customerDisplay = document.getElementById('customer-display');

		// Hide totals and clear customer
		if (totalsDiv) totalsDiv.style.display = 'none';
		if (customerDisplay) {
			customerDisplay.textContent = '';
			customerDisplay.classList.remove('selected');
		}

		// Show thank you message
		if (itemsList) {
			itemsList.innerHTML = `
				<div class="thank-you-message">
					<div class="thank-you-icon">🎉</div>
					<h2 class="thank-you-title">${__('Merci pour votre achat!')}</h2>
					<p class="thank-you-subtitle">${__('Thank you for your purchase!')}</p>
				</div>
			`;
		}

		// Trigger confetti animation
		this.triggerConfetti();

		// Auto-hide after 8 seconds
		setTimeout(() => {
			this.hideThankYouMessage();
		}, 8000);
	}

	hideThankYouMessage() {
		this.thankYouVisible = false;
	}

	// =====================
	// In-App Ads Slider
	// =====================

	async loadInAppAds() {
		try {
			const ads = await this.callMethod('erpnext.www.pos-viewer.index.get_in_app_ads', {});
			this.inAppAds = ads || [];
			this.currentAdIndex = 0;
		} catch (error) {
			console.error('Error loading in-app ads:', error);
			this.inAppAds = [];
		}
	}

	renderAdsSlider(container) {
		if (!this.inAppAds || this.inAppAds.length === 0) return;

		// Add showing-ads class to container for proper height
		container.classList.add('showing-ads');

		// Build slides HTML
		let slidesHTML = '';
		let dotsHTML = '';

		for (let i = 0; i < this.inAppAds.length; i++) {
			const ad = this.inAppAds[i];
			const isActive = i === this.currentAdIndex ? 'active' : '';
			const altText = ad.ad_name || '';
			slidesHTML += '<div class="ads-slide ' + isActive + '" data-index="' + i + '">' +
				'<img src="' + ad.image + '" alt="' + altText + '">' +
				'</div>';
			dotsHTML += '<div class="ads-slider-dot ' + isActive + '" data-index="' + i + '"></div>';
		}

		let dotsContainer = '';
		if (this.inAppAds.length > 1) {
			dotsContainer = '<div class="ads-slider-dots">' + dotsHTML + '</div>';
		}

		container.innerHTML = '<div class="ads-slider-container">' +
			'<div class="ads-slider">' + slidesHTML + '</div>' +
			dotsContainer +
			'</div>';

		// Add click handlers for dots
		container.querySelectorAll('.ads-slider-dot').forEach(dot => {
			dot.addEventListener('click', (e) => {
				const index = parseInt(e.target.dataset.index);
				this.goToSlide(index);
			});
		});

		// Start auto-rotation if more than one ad
		if (this.inAppAds.length > 1) {
			this.startAdsSlider();
		}
	}

	startAdsSlider() {
		// Clear existing interval if any
		this.stopAdsSlider();

		// Rotate every 5 seconds
		this.adsSliderInterval = setInterval(() => {
			this.nextSlide();
		}, 5000);
	}

	stopAdsSlider() {
		if (this.adsSliderInterval) {
			clearInterval(this.adsSliderInterval);
			this.adsSliderInterval = null;
		}
		// Remove showing-ads class from container
		const container = document.getElementById('cart-items-list');
		if (container) {
			container.classList.remove('showing-ads');
		}
	}

	nextSlide() {
		const nextIndex = (this.currentAdIndex + 1) % this.inAppAds.length;
		this.goToSlide(nextIndex);
	}

	goToSlide(index) {
		// Update current index
		this.currentAdIndex = index;

		// Update slides
		document.querySelectorAll('.ads-slide').forEach((slide, i) => {
			slide.classList.toggle('active', i === index);
		});

		// Update dots
		document.querySelectorAll('.ads-slider-dot').forEach((dot, i) => {
			dot.classList.toggle('active', i === index);
		});
	}

	triggerConfetti() {
		// Check if confetti library is loaded
		if (typeof confetti === 'function') {
			// Fire confetti from both sides
			const count = 200;
			const defaults = {
				origin: { y: 0.7 },
				zIndex: 9999
			};

			function fire(particleRatio, opts) {
				confetti({
					...defaults,
					...opts,
					particleCount: Math.floor(count * particleRatio)
				});
			}

			// Left side
			fire(0.25, {
				spread: 26,
				startVelocity: 55,
				origin: { x: 0.1, y: 0.7 }
			});

			// Center
			fire(0.2, {
				spread: 60,
				origin: { x: 0.5, y: 0.7 }
			});

			// Right side
			fire(0.25, {
				spread: 26,
				startVelocity: 55,
				origin: { x: 0.9, y: 0.7 }
			});

			// More confetti with different colors
			fire(0.1, {
				spread: 120,
				startVelocity: 25,
				decay: 0.92,
				scalar: 1.2,
				origin: { x: 0.5, y: 0.5 }
			});

			fire(0.1, {
				spread: 120,
				startVelocity: 45,
				origin: { x: 0.5, y: 0.6 }
			});
		} else {
			console.log('Confetti library not loaded');
		}
	}

	showCustomerModal() {
		document.getElementById('customer-modal').style.display = 'flex';

		// Clear previous form data
		document.getElementById('customer-form').reset();
		document.getElementById('customer-error').style.display = 'none';
		document.getElementById('customer-success').style.display = 'none';

		// Initialize intl-tel-input if not already initialized
		if (!this.phoneInput) {
			const phoneInputElement = document.getElementById('customer-mobile');
			this.phoneInput = window.intlTelInput(phoneInputElement, {
				initialCountry: this.getCountryCode(this.country),
				preferredCountries: ['ch', 'fr', 'de', 'it'],
				utilsScript: "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.12/build/js/utils.js"
			});
		}

		// Set country field default value
		document.getElementById('customer-country').value = this.country;

		document.getElementById('customer-name').focus();
	}

	hideCustomerModal() {
		document.getElementById('customer-modal').style.display = 'none';
	}

	async createCustomer() {
		const name = document.getElementById('customer-name').value.trim();
		const email = document.getElementById('customer-email').value.trim();
		const address = document.getElementById('customer-address').value.trim();
		const city = document.getElementById('customer-city').value.trim();
		const pincode = document.getElementById('customer-pincode').value.trim();
		const country = document.getElementById('customer-country').value.trim();
		const customerType = document.querySelector('input[name="customer-type"]:checked').value;

		// Get phone number in international format from intl-tel-input
		const mobile = this.phoneInput ? this.phoneInput.getNumber() : document.getElementById('customer-mobile').value.trim();

		const errorDiv = document.getElementById('customer-error');
		const successDiv = document.getElementById('customer-success');
		const saveBtn = document.getElementById('save-customer-btn');

		if (!name) {
			this.showError(errorDiv, 'Customer name is required');
			return;
		}

		// Show loading
		this.setButtonLoading(saveBtn, true);
		errorDiv.style.display = 'none';
		successDiv.style.display = 'none';

		try {
			const response = await this.callMethod('erpnext.www.pos-viewer.index.create_customer', {
				customer_name: name,
				email: email || null,
				mobile_no: mobile || null,
				address_line1: address || null,
				city: city || null,
				pincode: pincode || null,
				country: country || null,
				customer_type: customerType
			});

			if (response.success) {
				successDiv.textContent = response.message;
				successDiv.style.display = 'block';

				// Clear form
				document.getElementById('customer-form').reset();

				// Close modal after 2 seconds
				setTimeout(() => {
					this.hideCustomerModal();
				}, 2000);
			} else {
				this.showError(errorDiv, response.message);
			}
		} catch (error) {
			console.error('Error creating customer:', error);
			this.showError(errorDiv, 'Failed to create customer. Please try again.');
		} finally {
			this.setButtonLoading(saveBtn, false);
		}
	}

	logout() {
		// Clear storage
		localStorage.removeItem(this.STORAGE_KEY_API);
		localStorage.removeItem(this.STORAGE_KEY_PROFILE);

		// Disconnect
		this.disconnectRealtime();

		// Reset state
		this.apiKey = null;
		this.currentUser = null;
		this.selectedProfile = null;
		this.posOpeningEntry = null;

		// Show auth modal
		this.showAuthModal();
		document.getElementById('api-key-input').value = '';
	}

	async callMethod(method, args = {}) {
		// For non-auth methods, use fetch with Authorization header
		if (this.apiKey && method !== 'erpnext.www.pos-viewer.index.validate_api_key') {
			try {
				const formData = new FormData();
				formData.append('cmd', method);
				for (const [key, value] of Object.entries(args)) {
					formData.append(key, value);
				}

				const response = await fetch('/', {
					method: 'POST',
					headers: {
						'Authorization': 'token ' + this.apiKey,
						'X-Frappe-CSRF-Token': frappe.csrf_token || ''
					},
					body: formData
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();
				if (data.message) {
					return data.message;
				}
				throw new Error('No response message');
			} catch (error) {
				console.error('API call error:', error);
				throw error;
			}
		}

		// For auth method, use frappe.call
		return new Promise((resolve, reject) => {
			frappe.call({
				method: method,
				args: args,
				callback: (r) => {
					if (r.message) {
						resolve(r.message);
					} else {
						reject(new Error('No response'));
					}
				},
				error: (err) => {
					reject(err);
				}
			});
		});
	}

	showError(element, message) {
		element.textContent = message;
		element.style.display = 'block';
	}

	showAlert(message, type = 'info') {
		frappe.show_alert({
			message: message,
			indicator: type
		});
	}

	getCountryCode(countryName) {
		// Map common country names to ISO codes for intl-tel-input
		const countryMap = {
			'Switzerland': 'ch',
			'France': 'fr',
			'Germany': 'de',
			'Italy': 'it',
			'Austria': 'at',
			'United States': 'us',
			'United Kingdom': 'gb',
			'Spain': 'es',
			'Portugal': 'pt',
			'Netherlands': 'nl',
			'Belgium': 'be',
			'Luxembourg': 'lu'
		};
		return countryMap[countryName] || 'ch'; // Default to Switzerland
	}

	handleCustomerTypeChange(type) {
		const nameLabel = document.getElementById('customer-name-label');
		const nameInput = document.getElementById('customer-name');

		if (type === 'Company') {
			nameLabel.innerHTML = __('Company Name') + ' <span class="text-danger">*</span>';
			nameInput.placeholder = __('Company name');
		} else {
			nameLabel.innerHTML = __('Full Name') + ' <span class="text-danger">*</span>';
			nameInput.placeholder = __('Full name');
		}
	}

	// ===== TWINT PAYMENT METHODS =====

	startTwintPolling() {
		this.stopTwintPolling();
		this.twintCheckInterval = setInterval(() => {
			this.checkTwintPayment();
		}, 2000); // Check every 2 seconds
	}

	stopTwintPolling() {
		if (this.twintCheckInterval) {
			clearInterval(this.twintCheckInterval);
			this.twintCheckInterval = null;
		}
	}

	async checkTwintPayment() {
		if (!this.posOpeningEntry) return;

		try {
			const paymentData = await this.callMethod('erpnext.www.pos-viewer.index.get_twint_payment', {
				pos_opening_entry: this.posOpeningEntry
			});

			// Check if payment data exists and dialog is not already open
			if (paymentData && paymentData.order_uuid && !this.twintDialog) {
				// New Twint payment detected, show dialog
				this.showTwintDialog(paymentData);
			}
		} catch (error) {
			// Silently ignore errors when no payment is found
			if (error.message !== 'No response') {
				console.error('Error checking Twint payment:', error);
			}
		}
	}

	showTwintDialog(paymentData) {
		// Create modal overlay
		const modalHTML = `
			<div class="twint-payment-modal" id="twint-payment-modal">
				<div class="twint-payment-dialog">
					<div class="twint-dialog-header">
						<h3>Paiement TWINT</h3>
						<button class="twint-dialog-close" id="twint-close-btn">&times;</button>
					</div>
					<div class="twint-payment-container">
						<img class="twint-line" src="/assets/twint_integration/images/line.png">
						<div class="payment-status-container">
							<div class="payment-status">
								<div class="loading-spinner"></div>
								<div class="text-muted" style="margin-top: 10px;">
									En attente du paiement...
								</div>
							</div>
						</div>
						<div class="payment-content">
							<div class="qr-section">
								<div class="qr-code">
									<img src="${paymentData.qr_code}" alt="TWINT QR Code">
								</div>
								<div class="pairing-token">${paymentData.pairing_token}</div>
								<div class="timer-container">
									<div class="timer-text">Code valide pour: <span class="timer-value">5:00</span></div>
									<div class="timer-bar">
										<div class="timer-progress" style="width: 100%"></div>
									</div>
								</div>
							</div>
							<div class="payment-info">
								<div class="amount-section">
									<div class="amount-display">CHF ${parseFloat(paymentData.amount).toFixed(2)}</div>
								</div>
								<div class="company-logo-section">
									<div class="company-logo">
										<img src="/assets/twint_integration/images/twint-app-icon.png">
									</div>
								</div>
							</div>
						</div>
						<div class="twint-instructions">
							<div class="instruction-step">
								<div class="icon-app"></div>
								<p>Ouvrez l'application TWINT sur votre smartphone.</p>
							</div>
							<div class="instruction-step">
								<img src="/assets/twint_integration/images/qr-code-icon.svg" alt="QR Code">
								<p>Appuyez sur le bouton QR en bas de l'écran.</p>
							</div>
							<div class="instruction-step">
								<img src="/assets/twint_integration/images/camera-icon.svg" alt="Camera">
								<p>Pointez l'appareil photo de votre smartphone sur le code QR.</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		// Add to body
		const container = document.createElement('div');
		container.innerHTML = modalHTML;
		document.body.appendChild(container.firstElementChild);

		this.twintDialog = document.getElementById('twint-payment-modal');

		// Animate sections
		setTimeout(() => {
			document.querySelector('.qr-section').classList.add('visible');
		}, 300);
		setTimeout(() => {
			document.querySelector('.amount-section').classList.add('visible');
		}, 400);
		setTimeout(() => {
			document.querySelector('.company-logo-section').classList.add('visible');
		}, 500);

		// Setup close button
		document.getElementById('twint-close-btn').addEventListener('click', () => {
			this.closeTwintDialog();
		});

		// Start countdown timer
		this.startTwintTimer();

		// Start status checking
		this.startTwintStatusCheck(paymentData.order_uuid);
	}

	startTwintTimer() {
		let timeLeft = 300; // 5 minutes
		const timerValue = document.querySelector('.timer-value');
		const timerProgress = document.querySelector('.timer-progress');

		const timerInterval = setInterval(() => {
			timeLeft--;
			const minutes = Math.floor(timeLeft / 60);
			const seconds = timeLeft % 60;
			if (timerValue) {
				timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
			}
			if (timerProgress) {
				timerProgress.style.width = `${(timeLeft / 300) * 100}%`;
			}

			if (timeLeft <= 0) {
				clearInterval(timerInterval);
				this.showTwintError('Le code QR a expiré. Veuillez réessayer.');
			}
		}, 1000);

		// Store interval to clear it later
		this.twintTimerInterval = timerInterval;
	}

	async startTwintStatusCheck(orderUuid) {
		this.stopTwintStatusCheck();

		this.twintStatusInterval = setInterval(async () => {
			try {
				const response = await this.callMethod(
					'twint_integration.twint_integration.doctype.twint_settings.twint_settings.check_payment_status',
					{ order_uuid: orderUuid }
				);

				if (response && response.data) {
					if (response.data.status === 'SUCCESS') {
						this.showTwintSuccess();
						setTimeout(() => {
							this.closeTwintDialog();
						}, 3000);
					} else if (response.data.status === 'FAILURE') {
						this.showTwintError('Le paiement a échoué ou a été annulé');
					}
				}
			} catch (error) {
				console.error('Error checking Twint status:', error);
			}
		}, 3000); // Check every 3 seconds
	}

	stopTwintStatusCheck() {
		if (this.twintStatusInterval) {
			clearInterval(this.twintStatusInterval);
			this.twintStatusInterval = null;
		}
		if (this.twintTimerInterval) {
			clearInterval(this.twintTimerInterval);
			this.twintTimerInterval = null;
		}
	}

	showTwintSuccess() {
		const statusContainer = document.querySelector('.payment-status-container');
		if (statusContainer) {
			statusContainer.innerHTML = `
				<div class="twint-alert twint-alert-success">
					✓ Paiement réussi
				</div>
			`;
		}
		this.stopTwintStatusCheck();
	}

	showTwintError(message) {
		const statusContainer = document.querySelector('.payment-status-container');
		if (statusContainer) {
			statusContainer.innerHTML = `
				<div class="twint-alert twint-alert-danger">
					${message}
				</div>
			`;
		}
		this.stopTwintStatusCheck();
	}

	async closeTwintDialog() {
		if (this.twintDialog) {
			this.twintDialog.remove();
			this.twintDialog = null;
		}
		this.stopTwintStatusCheck();

		// Clear Twint payment from cache
		if (this.posOpeningEntry) {
			try {
				await this.callMethod('erpnext.www.pos-viewer.index.clear_twint_payment', {
					pos_opening_entry: this.posOpeningEntry
				});
			} catch (error) {
				console.error('Error clearing Twint payment:', error);
			}
		}
	}

	setButtonLoading(button, loading) {
		const btnText = button.querySelector('.btn-text');
		const btnLoading = button.querySelector('.btn-loading');

		if (loading) {
			btnText.style.display = 'none';
			btnLoading.style.display = 'inline-block';
			button.disabled = true;
		} else {
			btnText.style.display = 'inline-block';
			btnLoading.style.display = 'none';
			button.disabled = false;
		}
	}
}

// Initialize when DOM is ready
frappe.ready(() => {
	window.posViewer = new POSViewer();
});
