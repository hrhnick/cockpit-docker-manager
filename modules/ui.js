// Docker Manager - UI Event Listeners, Setup and Docker Service Management Module (Updated)
(function() {
    'use strict';

    // Lazy dependency getters
    function app() { return window.DockerManager.app; }
    function utils() { return window.DockerManager.utils; }
    function config() { return window.DockerManager.config; }
    function stacks() { return window.DockerManager.stacks; }
    function images() { return window.DockerManager.images; }
    function networks() { return window.DockerManager.networks; }
    function volumes() { return window.DockerManager.volumes; }
    function modals() { return window.DockerManager.modals; }

    // Docker service management using error handler (Priority 4)
    function detectDocker() {
        return utils().errorHandler.handleAsync(
            utils().executeCommand(['which', 'docker'], { suppressError: true }),
            'docker-detect',
            function(result) {
                app().dockerInstalled = true;
                // Check for docker-compose v1, expecting it might not exist
                return utils().executeCommand(['which', 'docker-compose'], { suppressError: true })
                    .then(function(composeResult) {
                        if (!composeResult.success) {
                            // Try docker compose v2
                            return utils().executeCommand(['docker', 'compose', 'version']);
                        }
                        return composeResult;
                    });
            }
        ).then(function(result) {
            app().dockerInstalled = result && result.success;
            return app().dockerInstalled;
        });
    }

    function loadServiceStatus() {
        utils().executeCommand(['systemctl', 'is-active', 'docker'], { suppressError: true })
            .then(function(result) {
                const status = result.success && result.data.trim() === 'active' ? 'active' : 'inactive';
                updateServiceStatus(status);
            });
    }

    // Update service status using DOM utilities (Priority 3)
    function updateServiceStatus(status) {
        const dom = utils().dom;
        const statusBadge = utils().getElement('service-status-badge');
        const startBtn = utils().getElement('start-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        const stopBtn = utils().getElement('stop-service-btn');
        const divider = document.querySelector('.service-actions .pf-v6-c-divider');

        if (statusBadge) {
            statusBadge.className = 'status-badge status-' + status;
            statusBadge.textContent = status === 'active' ? 'Running' : 'Stopped';
        }

        if (startBtn && restartBtn && stopBtn) {
            if (status === 'active') {
                // Service is running - show restart and stop
                dom.toggle(startBtn, false);
                dom.toggle(restartBtn, true);
                dom.toggle(stopBtn, true);
                restartBtn.disabled = false;
                stopBtn.disabled = false;
                // Show divider when multiple action buttons are visible
                if (divider) dom.toggle(divider, true);
            } else {
                // Service is stopped - show only start
                dom.toggle(startBtn, true);
                dom.toggle(restartBtn, false);
                dom.toggle(stopBtn, false);
                startBtn.disabled = false;
                // Show divider when start button is visible
                if (divider) dom.toggle(divider, true);
            }
        }
    }

    // Service control functions using resource actions (Priority 4)
    function startDockerService() {
        const startBtn = utils().getElement('start-service-btn');
        const resources = window.DockerManager.resources;
        
        startBtn.disabled = true;
        
        const action = {
            message: 'Starting Docker service...',
            command: ['systemctl', 'start', 'docker'],
            options: { superuser: 'require' },
            successMessage: 'Docker service started successfully',
            onSuccess: function() {
                setTimeout(function() {
                    loadServiceStatus();
                    startBtn.disabled = false;
                }, 2000);
            },
            onError: function() {
                startBtn.disabled = false;
            }
        };
        
        resources.resourceActions.runCommand(action);
    }

    function restartDockerService() {
        const restartBtn = utils().getElement('restart-service-btn');
        const resources = window.DockerManager.resources;
        
        restartBtn.disabled = true;
        
        const action = {
            message: 'Restarting Docker service...',
            command: ['systemctl', 'restart', 'docker'],
            options: { superuser: 'require' },
            successMessage: 'Docker service restarted successfully',
            onSuccess: function() {
                setTimeout(function() {
                    loadServiceStatus();
                    restartBtn.disabled = false;
                }, 2000);
            },
            onError: function() {
                restartBtn.disabled = false;
            }
        };
        
        resources.resourceActions.runCommand(action);
    }

    function stopDockerService() {
        const stopBtn = utils().getElement('stop-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        const resources = window.DockerManager.resources;
        
        stopBtn.disabled = true;
        restartBtn.disabled = true;
        
        const action = {
            message: 'Stopping Docker service and all containers...',
            command: ['sh', '-c', 'docker ps -q | xargs -r docker stop && systemctl stop docker.socket docker.service'],
            options: { superuser: 'require' },
            successMessage: 'Docker service and all containers stopped',
            onSuccess: function() {
                setTimeout(function() {
                    loadServiceStatus();
                    stopBtn.disabled = false;
                    restartBtn.disabled = false;
                    // Reload stacks to update their status
                    if (app().currentTab === 'stacks' && window.DockerManager.stacks) {
                        window.DockerManager.stacks.loadStacks();
                    }
                }, 1000);
            },
            onError: function() {
                stopBtn.disabled = false;
                restartBtn.disabled = false;
            }
        };
        
        resources.resourceActions.runCommand(action);
    }

    // Tab switching with lazy loading
    function switchTab(tab) {
        const dom = utils().dom;
        const loadModule = window.DockerManager.loadModule;
        
        // Update UI immediately
        document.querySelectorAll('.pf-v6-c-tabs__tab').forEach(function(link) {
            dom.removeClass(link, 'active');
            link.setAttribute('aria-selected', 'false');
        });
        
        const selectedTab = document.querySelector('[data-tab="' + tab + '"]');
        if (selectedTab) {
            dom.addClass(selectedTab, 'active');
            selectedTab.setAttribute('aria-selected', 'true');
        }

        document.querySelectorAll('.tab-content').forEach(function(panel) {
            dom.removeClass(panel, 'active');
        });
        dom.addClass(tab + '-tab', 'active');

        app().currentTab = tab;
        
        // Load module if not already loaded
        if (!app().loadedModules[tab]) {
            // Show loading message
            const tbody = document.querySelector('#' + tab + '-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr class="loading-row"><td colspan="' + 
                    (tbody.parentElement.querySelector('thead tr').children.length) + 
                    '" class="loading-cell">Loading ' + tab + ' module...</td></tr>';
            }
            
            // Load the module
            loadModule(tab).then(function() {
                // Module loaded, now load the data
                loadTabData(tab);
            }).catch(function(error) {
                console.error('Failed to load module:', tab, error);
                if (tbody) {
                    tbody.innerHTML = '<tr class="error-row"><td colspan="' + 
                        (tbody.parentElement.querySelector('thead tr').children.length) + 
                        '" class="error-message">Failed to load ' + tab + ' module</td></tr>';
                }
            });
        } else {
            // Module already loaded, just load the data
            loadTabData(tab);
        }
    }

    // Load tab data after module is loaded
    function loadTabData(tab) {
        switch(tab) {
            case 'images':
                if (images()) images().loadImages();
                break;
            case 'stacks':
                if (stacks()) stacks().loadStacks();
                break;
            case 'networks':
                if (networks()) networks().loadNetworks();
                break;
            case 'volumes':
                if (volumes()) volumes().loadVolumes();
                break;
        }
    }

    // Setup event listeners - simplified with data attributes (Priority 3)
    function setupEventListeners() {
        const dom = utils().dom;
        
        // Service controls - use data attributes for consistency
        const startBtn = utils().getElement('start-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        const stopBtn = utils().getElement('stop-service-btn');
        const settingsBtn = utils().getElement('settings-btn');
        
        if (startBtn) startBtn.addEventListener('click', startDockerService);
        if (restartBtn) restartBtn.addEventListener('click', restartDockerService);
        if (stopBtn) stopBtn.addEventListener('click', stopDockerService);
        if (settingsBtn) settingsBtn.addEventListener('click', function() {
            if (config()) config().showSettingsModal();
        });
        
        // Stack actions - will be initialized when module loads
        const addStackBtn = utils().getElement('add-stack-btn');
        if (addStackBtn) {
            addStackBtn.addEventListener('click', function() {
                if (!app().loadedModules.stacks) {
                    utils().showNotification('Loading stacks module...', 'info');
                    window.DockerManager.loadModule('stacks').then(function() {
                        if (stacks()) stacks().showStackModal('create');
                    });
                } else if (stacks()) {
                    stacks().showStackModal('create');
                }
            });
        }
        
        // Image management - lazy load handlers
        const pullImageBtn = utils().getElement('pull-image-btn');
        const pruneImagesBtn = utils().getElement('prune-images-btn');
        
        if (pullImageBtn) {
            pullImageBtn.addEventListener('click', function() {
                ensureModuleAndCall('images', function() {
                    images().showPullImageModal();
                });
            });
        }
        if (pruneImagesBtn) {
            pruneImagesBtn.addEventListener('click', function() {
                ensureModuleAndCall('images', function() {
                    images().pruneImages();
                });
            });
        }
        
        // Network management - lazy load handlers
        const createNetworkBtn = utils().getElement('create-network-btn');
        const pruneNetworksBtn = utils().getElement('prune-networks-btn');
        
        if (createNetworkBtn) {
            createNetworkBtn.addEventListener('click', function() {
                ensureModuleAndCall('networks', function() {
                    networks().showCreateNetworkModal();
                });
            });
        }
        if (pruneNetworksBtn) {
            pruneNetworksBtn.addEventListener('click', function() {
                ensureModuleAndCall('networks', function() {
                    networks().pruneNetworks();
                });
            });
        }
        
        // Volume management - lazy load handlers
        const createVolumeBtn = utils().getElement('create-volume-btn');
        const pruneVolumesBtn = utils().getElement('prune-volumes-btn');
        
        if (createVolumeBtn) {
            createVolumeBtn.addEventListener('click', function() {
                ensureModuleAndCall('volumes', function() {
                    volumes().showCreateVolumeModal();
                });
            });
        }
        if (pruneVolumesBtn) {
            pruneVolumesBtn.addEventListener('click', function() {
                ensureModuleAndCall('volumes', function() {
                    volumes().pruneVolumes();
                });
            });
        }
        
        // Tab navigation
        document.querySelectorAll('.pf-v6-c-tabs__tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                const tabName = e.target.dataset.tab;
                if (tabName) {
                    switchTab(tabName);
                }
            });
        });
        
        // Initialize tooltips
        initializeTooltips();
    }

    // Helper function to ensure module is loaded before calling
    function ensureModuleAndCall(moduleName, callback) {
        if (!app().loadedModules[moduleName]) {
            utils().showNotification('Loading ' + moduleName + ' module...', 'info');
            window.DockerManager.loadModule(moduleName).then(function() {
                callback();
            }).catch(function(error) {
                utils().showNotification('Failed to load ' + moduleName + ' module', 'error');
            });
        } else {
            callback();
        }
    }

    // Tooltip initialization - simplified (Priority 3)
    function initializeTooltips() {
        const dom = utils().dom;
        
        // Add touch support for mobile devices
        if ('ontouchstart' in window) {
            document.addEventListener('touchstart', function(e) {
                // Hide any visible tooltips when touching elsewhere
                if (!e.target.classList.contains('has-tooltip')) {
                    document.querySelectorAll('.has-tooltip').forEach(function(el) {
                        dom.removeClass(el, 'tooltip-visible');
                    });
                }
            });
            
            // Show tooltip on touch
            document.querySelectorAll('.has-tooltip').forEach(function(el) {
                el.addEventListener('touchstart', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Hide other tooltips
                    document.querySelectorAll('.has-tooltip').forEach(function(other) {
                        if (other !== el) {
                            dom.removeClass(other, 'tooltip-visible');
                        }
                    });
                    
                    // Toggle this tooltip
                    dom.toggleClass(el, 'tooltip-visible');
                });
            });
        }
    }

    // Export public interface (combined from both modules)
    window.DockerManager.ui = {
        // UI functions
        setupEventListeners: setupEventListeners,
        switchTab: switchTab,
        initializeTooltips: initializeTooltips,
        // Service management functions
        detectDocker: detectDocker,
        loadServiceStatus: loadServiceStatus,
        updateServiceStatus: updateServiceStatus,
        startDockerService: startDockerService,
        restartDockerService: restartDockerService,
        stopDockerService: stopDockerService
    };

})();
