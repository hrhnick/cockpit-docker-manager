// Docker Manager - Initialize namespace immediately for other modules
// Merge with existing namespace to preserve module references
window.DockerManager = window.DockerManager || {};

// Add application state to existing namespace
window.DockerManager.app = {
    stacks: [],
    images: [],
    networks: [],
    volumes: [],
    currentTab: 'stacks',
    dockerInstalled: false,
    stacksPath: '/opt/stacks',
    configPath: '/etc/cockpit/docker-manager.conf',
    updateCheckPath: '/etc/cockpit/docker-manager-updates.json',
    stackUpdates: {},
    // Track loaded modules
    loadedModules: {
        stacks: false,
        images: false,
        networks: false,
        volumes: false
    }
};

// Action handlers registry (Priority 3)
window.DockerManager.actions = {};

console.log('Docker Manager namespace initialized');

// Docker Manager - Main Application Coordinator (Cleaned)
(function() {
    'use strict';

    // Auto-refresh configuration
    const refreshConfig = {
        baseInterval: 60000,      // Base refresh interval (60 seconds)
        serviceInterval: 30000,   // Service status interval (30 seconds)
        maxInterval: 300000,      // Maximum interval (5 minutes)
        backoffMultiplier: 1.5,   // Exponential backoff multiplier
        idleTimeout: 120000,      // Time before considering user idle (2 minutes)
        lastActivity: Date.now(),
        currentInterval: 60000,
        refreshTimer: null,
        serviceTimer: null,
        documentHidden: false
    };

    // Module loading configuration
    const moduleConfig = {
        stacks: 'modules/stacks.js',
        images: 'modules/images.js',
        networks: 'modules/networks.js',
        volumes: 'modules/volumes.js'
    };

    // Simple CSS loading check - just use the onload event
    function waitForCSS() {
        return new Promise(function(resolve) {
            // Check if our flag is set (from HTML onload)
            if (window.cssLoaded) {
                resolve();
                return;
            }
            
            // Set a reasonable timeout as fallback
            setTimeout(function() {
                window.cssLoaded = true;
                resolve();
            }, 100);
        });
    }

    // Simplified loading overlay hiding
    function hideLoadingOverlay() {
        const loadingOverlay = window.DockerManager.utils.getElement('loading-overlay');
        if (!loadingOverlay) return;
        
        // Add transition for smooth hiding
        loadingOverlay.style.transition = 'opacity 0.3s ease-out';
        loadingOverlay.style.opacity = '0';
        
        setTimeout(function() {
            loadingOverlay.style.display = 'none';
            
            // Ensure content is visible
            const content = document.querySelector('.pf-v6-c-page__main');
            if (content) {
                content.style.opacity = '1';
            }
        }, 300);
    }

    // Load a module dynamically
    function loadModule(moduleName) {
        const app = window.DockerManager.app;
        
        // If already loaded or loading, return promise
        if (app.loadedModules[moduleName]) {
            return Promise.resolve(true);
        }
        
        // Check if module is already being loaded
        if (app.loadedModules[moduleName + '_loading']) {
            return app.loadedModules[moduleName + '_promise'];
        }
        
        console.log('Loading module:', moduleName);
        
        // Mark as loading
        app.loadedModules[moduleName + '_loading'] = true;
        
        // Create and store the promise
        const loadPromise = new Promise(function(resolve, reject) {
            const script = document.createElement('script');
            script.src = moduleConfig[moduleName];
            script.async = true;
            
            script.onload = function() {
                console.log('Module loaded:', moduleName);
                app.loadedModules[moduleName] = true;
                delete app.loadedModules[moduleName + '_loading'];
                delete app.loadedModules[moduleName + '_promise'];
                
                // Initialize module-specific action handlers
                initializeModuleActions(moduleName);
                
                resolve(true);
            };
            
            script.onerror = function() {
                console.error('Failed to load module:', moduleName);
                delete app.loadedModules[moduleName + '_loading'];
                delete app.loadedModules[moduleName + '_promise'];
                reject(new Error('Failed to load module: ' + moduleName));
            };
            
            document.head.appendChild(script);
        });
        
        // Store the promise for concurrent requests
        app.loadedModules[moduleName + '_promise'] = loadPromise;
        
        return loadPromise;
    }

    // Initialize module-specific action handlers
    function initializeModuleActions(moduleName) {
        const actions = window.DockerManager.actions;
        const modules = window.DockerManager;
        
        switch(moduleName) {
            case 'stacks':
                if (modules.stacks) {
                    actions.viewStack = function(data) {
                        modules.stacks.viewStack(data.name);
                    };
                    actions.editStack = function(data) {
                        modules.stacks.editStack(data.name);
                    };
                    actions.startStack = function(data) {
                        modules.stacks.startStack(data.name);
                    };
                    actions.stopStack = function(data) {
                        modules.stacks.stopStack(data.name);
                    };
                    actions.restartStack = function(data) {
                        modules.stacks.restartStack(data.name);
                    };
                    actions.updateStack = function(data) {
                        modules.stacks.updateStack(data.name);
                    };
                    actions.removeStack = function(data) {
                        modules.stacks.removeStack(data.name);
                    };
                }
                break;
                
            case 'images':
                if (modules.images) {
                    actions.removeImage = function(data) {
                        modules.images.removeImage(data.id);
                    };
                }
                break;
                
            case 'networks':
                if (modules.networks) {
                    actions.removeNetwork = function(data) {
                        modules.networks.removeNetwork(data.id, data.name);
                    };
                }
                break;
                
            case 'volumes':
                if (modules.volumes) {
                    actions.removeVolume = function(data) {
                        modules.volumes.removeVolume(data.name);
                    };
                }
                break;
        }
    }

    // Initialize the application
    function init() {
        // Import references to modules
        const utils = window.DockerManager.utils;
        const config = window.DockerManager.config;
        const ui = window.DockerManager.ui;

        hideLoadingOverlay();
        
        // Setup visibility change detection
        setupVisibilityHandlers();
        
        // Setup activity tracking
        setupActivityTracking();
        
        // Setup centralized event delegation (Priority 3)
        setupEventDelegation();
        
        // Load configuration first
        config.loadConfiguration()
            .then(function() {
                return ui.detectDocker();
            })
            .then(function(installed) {
                if (installed) {
                    utils.dom.toggle('service-status-section', true);
                    utils.dom.toggle('main-content', true);
                    utils.dom.toggle('docker-not-installed', false);
                    
                    ui.setupEventListeners();
                    ui.loadServiceStatus();
                    
                    // Load update status first
                    return config.loadUpdateStatus();
                }
                throw new Error('Docker not installed');
            })
            .then(function() {
                // Load stacks module and initial data
                return loadModule('stacks').then(function() {
                    if (window.DockerManager.stacks) {
                        window.DockerManager.stacks.loadStacks();
                    }
                    
                    // Check if we should automatically check for updates
                    return config.shouldCheckForUpdates();
                });
            })
            .then(function(shouldCheck) {
                if (shouldCheck) {
                    // Check for updates in the background after page loads
                    setTimeout(function() {
                        if (window.DockerManager.stacks && window.DockerManager.stacks.checkAllStacksForUpdates) {
                            window.DockerManager.stacks.checkAllStacksForUpdates(false);
                        }
                    }, 3000);
                }
                
                // Start smart refresh timers
                startSmartRefresh();
            })
            .catch(function(error) {
                if (error.message === 'Docker not installed') {
                    utils.dom.toggle('docker-not-installed', true);
                    utils.dom.toggle('main-content', false);
                    utils.dom.toggle('service-status-section', false);
                } else {
                    utils.showNotification('Failed to initialize Docker manager', 'error');
                }
            });
    }

    // Setup centralized event delegation (Priority 3)
    function setupEventDelegation() {
        // Single event delegation handler
        document.addEventListener('click', function(e) {
            // Check for data-action attribute
            const actionElement = e.target.closest('[data-action]');
            if (actionElement) {
                e.preventDefault();
                const action = actionElement.dataset.action;
                const handler = window.DockerManager.actions[action];
                
                if (handler) {
                    // Pass all data attributes as parameters
                    handler(actionElement.dataset);
                } else {
                    console.warn('No handler registered for action:', action);
                }
            }
        });
    }

    // Setup Page Visibility API handlers
    function setupVisibilityHandlers() {
        // Handle various browser prefixes
        let hidden, visibilityChange;
        if (typeof document.hidden !== "undefined") {
            hidden = "hidden";
            visibilityChange = "visibilitychange";
        } else if (typeof document.msHidden !== "undefined") {
            hidden = "msHidden";
            visibilityChange = "msvisibilitychange";
        } else if (typeof document.webkitHidden !== "undefined") {
            hidden = "webkitHidden";
            visibilityChange = "webkitvisibilitychange";
        }

        if (typeof document[hidden] !== "undefined") {
            document.addEventListener(visibilityChange, function() {
                refreshConfig.documentHidden = document[hidden];
                if (refreshConfig.documentHidden) {
                    // Page is hidden - stop refresh
                    stopSmartRefresh();
                } else {
                    // Page is visible again - restart refresh and update immediately
                    refreshConfig.lastActivity = Date.now();
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                    startSmartRefresh();
                    refreshCurrentTab();
                }
            }, false);
        }
    }

    // Setup activity tracking for idle detection
    function setupActivityTracking() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        
        events.forEach(function(event) {
            document.addEventListener(event, function() {
                const now = Date.now();
                const wasIdle = (now - refreshConfig.lastActivity) > refreshConfig.idleTimeout;
                
                refreshConfig.lastActivity = now;
                
                // If user was idle and is now active, reset interval
                if (wasIdle && refreshConfig.currentInterval > refreshConfig.baseInterval) {
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                    resetRefreshTimer();
                }
            }, true);
        });
    }

    // Smart refresh implementation
    function startSmartRefresh() {
        // Clear any existing timers
        stopSmartRefresh();
        
        // Start service status timer (fixed interval)
        refreshConfig.serviceTimer = setInterval(function() {
            if (!refreshConfig.documentHidden) {
                window.DockerManager.ui.loadServiceStatus();
            }
        }, refreshConfig.serviceInterval);
        
        // Start main content refresh timer
        scheduleNextRefresh();
    }

    function stopSmartRefresh() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
            refreshConfig.refreshTimer = null;
        }
        if (refreshConfig.serviceTimer) {
            clearInterval(refreshConfig.serviceTimer);
            refreshConfig.serviceTimer = null;
        }
    }

    function scheduleNextRefresh() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
        }
        
        refreshConfig.refreshTimer = setTimeout(function() {
            if (!refreshConfig.documentHidden) {
                refreshCurrentTab();
                
                // Calculate next interval with exponential backoff if idle
                const now = Date.now();
                const timeSinceActivity = now - refreshConfig.lastActivity;
                
                if (timeSinceActivity > refreshConfig.idleTimeout) {
                    // User is idle - increase interval
                    refreshConfig.currentInterval = Math.min(
                        refreshConfig.currentInterval * refreshConfig.backoffMultiplier,
                        refreshConfig.maxInterval
                    );
                } else {
                    // User is active - use base interval
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                }
            }
            
            // Schedule next refresh
            scheduleNextRefresh();
        }, refreshConfig.currentInterval);
    }

    function resetRefreshTimer() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
            scheduleNextRefresh();
        }
    }

    function refreshCurrentTab() {
        const app = window.DockerManager.app;
        
        // Only refresh if the module is loaded
        if (!app.loadedModules[app.currentTab]) {
            return;
        }
        
        // Get module references
        const stacks = window.DockerManager.stacks;
        const images = window.DockerManager.images;
        const networks = window.DockerManager.networks;
        const volumes = window.DockerManager.volumes;
        
        // Only refresh the active tab
        switch(app.currentTab) {
            case 'stacks':
                if (stacks && stacks.loadStacks) stacks.loadStacks();
                break;
            case 'images':
                if (images && images.loadImages) images.loadImages();
                break;
            case 'networks':
                if (networks && networks.loadNetworks) networks.loadNetworks();
                break;
            case 'volumes':
                if (volumes && volumes.loadVolumes) volumes.loadVolumes();
                break;
        }
    }

    // Export module loading function for UI to use
    window.DockerManager.loadModule = loadModule;

    // Simplified initialization
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM Content Loaded - Waiting for CSS...');
        
        // Wait for CSS to be loaded
        waitForCSS().then(function() {
            console.log('CSS Loaded - Initializing application...');
            
            // Give cockpit a moment to initialize
            setTimeout(function() {
                if (typeof cockpit !== 'undefined') {
                    init();
                } else {
                    const checkInterval = setInterval(function() {
                        if (typeof cockpit !== 'undefined') {
                            clearInterval(checkInterval);
                            init();
                        }
                    }, 100);
                }
            }, 50);
        });
    });

})();
